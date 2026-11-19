import React, { useEffect, useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { KeyRound, Eye, EyeOff, Sparkles, Copy, Check, Mail, ShieldCheck, AlertCircle } from 'lucide-react';
import { auth, db, changeSchoolPasswordSecondary } from '../../lib/firebase';
import { recordAuditLog } from '../../lib/audit';
import { upsertEmailDirectoryEntry } from '../../lib/schoolProvisioning';
import { Button, Modal, useToast } from '../ui/Primitives';
import type { PlatformUser, School } from '../../types/models';

export interface PasswordChangeTarget {
  kind: 'school' | 'user';
  title: string;
  subtitle: string;
  email: string;
  uid?: string;
  schoolId: string;
  schoolName?: string;
  school?: School;
  user?: PlatformUser;
}

function generateStrongPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%&*!';
  const all = upper + lower + digits + symbols;
  const pick = (pool: string) => pool[Math.floor(Math.random() * pool.length)];
  const chars = [pick(upper), pick(upper), pick(lower), pick(lower), pick(digits), pick(digits), pick(symbols)];
  while (chars.length < 12) {
    chars.push(pick(all));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function ChangeSchoolPasswordModal({
  target,
  actor,
  onClose,
}: {
  target: PasswordChangeTarget | null;
  actor: PlatformUser;
  onClose: () => void;
}) {
  const { pushToast } = useToast();

  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [forceChangeOnLogin, setForceChangeOnLogin] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) return;
    setEmail(target.email || '');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
    setForceChangeOnLogin(true);
    setCopied(false);
    setError('');
  }, [target]);

  const handleGenerate = () => {
    const pw = generateStrongPassword();
    setNewPassword(pw);
    setConfirmPassword(pw);
    setShowPasswords(true);
    setError('');
  };

  const handleCopy = () => {
    if (!newPassword) return;
    navigator.clipboard?.writeText(newPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleSendResetOnly = async () => {
    if (!target) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address before sending a reset link.');
      return;
    }
    setSendingReset(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      if (target.uid) {
        await updateDoc(doc(db, 'users', target.uid), {
          mustChangePassword: true,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
      }
      await recordAuditLog({
        schoolId: target.schoolId,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: target.kind === 'school' ? 'SCHOOL_PASSWORD_RESET_EMAIL' : 'USER_PASSWORD_RESET_EMAIL',
        targetType: target.kind,
        targetId: target.uid || target.schoolId,
        targetLabel: cleanEmail,
        details: `Main Head dispatched Firebase password reset email for ${target.title}.`,
      }).catch(() => undefined);
      pushToast('success', `Password reset link sent to ${cleanEmail}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send password reset email.');
    } finally {
      setSendingReset(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid login email address.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setSaving(true);
    try {
      const res = await changeSchoolPasswordSecondary({
        email: cleanEmail,
        newPassword,
        currentPassword: currentPassword.trim() || undefined,
      });

      if (!res.ok) {
        setError(res.message);
        return;
      }

      const resolvedUid = res.uid || target.uid || '';

      if (target.kind === 'school' && target.school) {
        const schoolUpdates: Record<string, unknown> = {
          principalEmail: cleanEmail,
          updatedAt: serverTimestamp(),
        };
        if (resolvedUid) {
          schoolUpdates.principalUid = resolvedUid;
        }
        await updateDoc(doc(db, 'schools', target.school.id), schoolUpdates).catch(() => undefined);

        if (cleanEmail !== (target.school.principalEmail || '').trim().toLowerCase()) {
          await upsertEmailDirectoryEntry({
            email: cleanEmail,
            schoolId: target.school.id,
            schoolName: target.school.name,
            role: 'principal',
            displayName: target.school.principalName || `${target.school.name} Principal`,
            createdBy: actor.uid,
          }).catch(() => undefined);
        }
      }

      if (resolvedUid) {
        await updateDoc(doc(db, 'users', resolvedUid), {
          mustChangePassword: forceChangeOnLogin,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
      }

      await recordAuditLog({
        schoolId: target.schoolId,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: target.kind === 'school' ? 'MAIN_HEAD_CHANGE_SCHOOL_PASSWORD' : 'MAIN_HEAD_CHANGE_USER_PASSWORD',
        targetType: target.kind,
        targetId: resolvedUid || target.schoolId,
        targetLabel: cleanEmail,
        details: `Mode=${res.mode || 'updated'}, requireChangeOnLogin=${forceChangeOnLogin} (${target.title}).`,
      }).catch(() => undefined);

      pushToast('success', res.message);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={target ? `Change Password — ${target.title}` : 'Change Password'}
      subtitle={target?.subtitle}
      maxWidth="max-w-lg"
    >
      {target && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-[#0F295C] flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
            <span>
              Runs in an isolated authentication session so your Main Head session stays signed in. Passwords are never
              stored in plaintext in Firestore.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {target.kind === 'school' ? 'School Principal Login Email *' : 'Account Login Email *'}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="principal@school.edu"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Current Password <span className="font-normal text-slate-400">(Optional — enter for instant live replacement on existing accounts)</span>
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setError('');
              }}
              placeholder="Leave blank to provision new credential or send reset email"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-700">New Password *</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:text-blue-700 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Generate Strong
                </button>
                {newPassword && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="relative">
                <input
                  type={showPasswords ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="Min 8 characters"
                  className="w-full px-3 py-2 pr-9 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-[#2563EB]"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords((p) => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  aria-label={showPasswords ? 'Hide password' : 'Show password'}
                >
                  {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <input
                type={showPasswords ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError('');
                }}
                placeholder="Confirm new password"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={forceChangeOnLogin}
              onChange={(e) => setForceChangeOnLogin(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
            />
            <span>Require the Principal / user to set a new personal password on their next sign-in.</span>
          </label>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[#EA4335] shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={sendingReset || saving}
              onClick={handleSendResetOnly}
            >
              <Mail className="w-3.5 h-3.5" />
              {sendingReset ? 'Sending…' : 'Send Reset Email Only'}
            </Button>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={saving || sendingReset}>
                <KeyRound className="w-3.5 h-3.5" />
                {saving ? 'Updating…' : 'Update Password'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
