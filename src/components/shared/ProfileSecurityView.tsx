import React, { useEffect, useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Lock, ShieldCheck, CheckCircle2, Mail, RefreshCw } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { ROLE_LABELS, ROLE_PERMISSION_MATRIX } from '../../lib/permissions';
import { isValidPhoneDigits, sanitizePhoneDigits } from '../../lib/schoolCodes';
import { useAuth } from '../../contexts/AuthContext';
import { Button, StatusText, useToast } from '../ui/Primitives';
import { MainHeadAdminSecurityCard } from '../main-head/MainHeadAdminSecurityCard';

export function ProfileSecurityView() {
  const {
    activeUser,
    realProfile,
    firebaseUser,
    isPreviewMode,
    emailVerified,
    isPasswordAccount,
    replaceTemporaryPassword,
    checkEmailVerification,
    resendVerificationEmail,
    refreshProfile,
  } = useAuth();
  const { pushToast } = useToast();

  const [displayName, setDisplayName] = useState(activeUser?.displayName || '');
  const [phone, setPhone] = useState(sanitizePhoneDigits(activeUser?.phone || ''));
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState('');

  const [checkingVerify, setCheckingVerify] = useState(false);
  const [resendingVerify, setResendingVerify] = useState(false);
  const [verifyCooldown, setVerifyCooldown] = useState(0);

  useEffect(() => {
    if (verifyCooldown <= 0) return;
    const t = window.setInterval(() => setVerifyCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [verifyCooldown]);

  if (!activeUser) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreviewMode) {
      pushToast('info', 'Exit Demo Role Preview to edit your real account profile.');
      return;
    }
    if (displayName.trim().length < 2) {
      pushToast('error', 'Display name must be at least 2 characters.');
      return;
    }
    const cleanPhone = sanitizePhoneDigits(phone);
    if (cleanPhone && !isValidPhoneDigits(cleanPhone)) {
      pushToast('error', 'Phone number must contain 10 to 15 numeric digits only.');
      return;
    }
    setSavingProfile(true);
    try {
      await updateDoc(doc(db, 'users', activeUser.uid), {
        displayName: displayName.trim().slice(0, 120),
        phone: cleanPhone,
        updatedAt: serverTimestamp(),
      });
      await refreshProfile();
      pushToast('success', 'Profile updated.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${activeUser.uid}`);
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    if (isPreviewMode) {
      setPwError('Exit Demo Role Preview to change your own password.');
      return;
    }
    if (isPasswordAccount && !currentPassword) {
      setPwError('Enter your current password to verify your identity.');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match.');
      return;
    }
    setSavingPw(true);
    try {
      const res = await replaceTemporaryPassword(newPassword, currentPassword || undefined);
      if (!res.ok) {
        setPwError(res.error || 'Could not update password.');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      pushToast('success', 'Password changed securely.');
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 space-y-6">
        <MainHeadAdminSecurityCard />
        <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold font-display text-slate-900">Account Profile</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Role and tenant school binding are enforced server-side and cannot be self-modified.
              </p>
            </div>
            <StatusText status={activeUser.status} />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={isPreviewMode}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Phone Number <span className="font-normal text-slate-400">(Numbers only)</span>
              </label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={15}
                value={phone}
                onChange={(e) => setPhone(sanitizePhoneDigits(e.target.value))}
                disabled={isPreviewMode}
                placeholder="9876543210"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600 disabled:bg-slate-50"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 pt-2 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-slate-500">Username</p>
              <p className="font-mono font-medium text-slate-900 mt-0.5 truncate">{activeUser.username}</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-slate-500">Email</p>
              <p className="font-medium text-slate-900 mt-0.5 truncate">{activeUser.email}</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-slate-500">Assigned Role</p>
              <p className="font-semibold text-teal-700 mt-0.5">{ROLE_LABELS[activeUser.role]}</p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" variant="navy" size="sm" disabled={savingProfile || isPreviewMode}>
              {savingProfile ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>

        {/* Secure Password Update */}
        <form onSubmit={handlePasswordUpdate} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
            <Lock className="w-4 h-4 text-teal-600" />
            <h2 className="text-base font-bold font-display text-slate-900">Change Password</h2>
          </div>
          <p className="text-xs text-slate-500">
            Passwords are hashed securely by Firebase Authentication and are never readable in plaintext.
          </p>
          {isPasswordAccount && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={isPreviewMode}
                placeholder="Enter current password"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600 disabled:bg-slate-50"
              />
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isPreviewMode}
                placeholder="Min 8 characters"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isPreviewMode}
                placeholder="Re-enter password"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600 disabled:bg-slate-50"
              />
            </div>
          </div>
          {pwError && <p className="text-xs text-red-600">{pwError}</p>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" disabled={savingPw || isPreviewMode}>
              {savingPw ? 'Updating…' : 'Update Password'}
            </Button>
          </div>
        </form>
      </div>

      {/* Right Column: Email Verification + Role Permission Matrix */}
      <div className="lg:col-span-5 space-y-6">
        {firebaseUser && !isPreviewMode && (
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2 text-sm font-bold font-display text-slate-900">
              <Mail className="w-4 h-4 text-teal-600" />
              Email Verification
            </div>
            {emailVerified ? (
              <p className="mt-2 text-xs text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Verified ({realProfile?.email || firebaseUser.email})
              </p>
            ) : (
              <div className="mt-2 space-y-3">
                <p className="text-xs text-amber-800">
                  Your email address is not yet verified. Verify it to ensure uninterrupted security privileges.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="navy"
                    size="sm"
                    loading={checkingVerify}
                    onClick={async () => {
                      setCheckingVerify(true);
                      try {
                        const ok = await checkEmailVerification();
                        if (ok) {
                          pushToast('success', 'Email verification confirmed!');
                        } else {
                          pushToast('info', 'Not verified yet. Open the link sent to your inbox first.');
                        }
                      } finally {
                        setCheckingVerify(false);
                      }
                    }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Check Status
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={resendingVerify}
                    disabled={verifyCooldown > 0}
                    onClick={async () => {
                      setResendingVerify(true);
                      try {
                        const res = await resendVerificationEmail();
                        if (res.ok) {
                          setVerifyCooldown(60);
                          pushToast('success', 'Verification email sent. Check your inbox and spam folder.');
                        } else {
                          pushToast('error', res.error || 'Could not send verification email.');
                        }
                      } finally {
                        setResendingVerify(false);
                      }
                    }}
                  >
                    {verifyCooldown > 0 ? `Resend in ${verifyCooldown}s` : 'Resend Verification Email'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 text-sm font-bold font-display text-slate-900">
            <ShieldCheck className="w-4 h-4 text-teal-600" />
            Authorized Permissions ({ROLE_LABELS[activeUser.role]})
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Tenant Scope: <span className="font-mono text-slate-700">{activeUser.schoolId}</span>
          </p>
          <ul className="mt-4 space-y-2.5 text-xs text-slate-600">
            {ROLE_PERMISSION_MATRIX[activeUser.role].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
