import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, Eye, EyeOff, CheckCircle2, KeyRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { formatFirestoreDateTime } from '../../lib/firebase';
import {
  changeAdminVerificationPasscode,
  clearAllMainHeadSessionUnlocks,
  createAdminVerificationPasscode,
  fetchAdminSecurityConfig,
  type AdminSecurityRecord,
} from '../../lib/adminVerification';
import { Button, useToast } from '../ui/Primitives';

export function MainHeadAdminSecurityCard() {
  const { activeUser, realProfile, firebaseUser, isPreviewMode } = useAuth();
  const { pushToast } = useToast();

  const [config, setConfig] = useState<AdminSecurityRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPasscode, setCurrentPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [showFields, setShowFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const uid = firebaseUser?.uid || realProfile?.uid || activeUser?.uid || '';
  const email = firebaseUser?.email || realProfile?.email || activeUser?.email || '';
  const displayName = realProfile?.displayName || activeUser?.displayName || 'Main Head';

  useEffect(() => {
    if (!uid || isPreviewMode || activeUser?.role !== 'main_head') {
      setLoading(false);
      return;
    }
    fetchAdminSecurityConfig()
      .then((rec) => setConfig(rec))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [uid, isPreviewMode, activeUser?.role]);

  if (!activeUser || activeUser.role !== 'main_head' || isPreviewMode) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const nextClean = newPasscode.trim();
    if (nextClean.length < 6) {
      setError('New 1-Step Verification password must be at least 6 characters.');
      return;
    }
    if (nextClean !== confirmPasscode.trim()) {
      setError('New verification passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      if (!config) {
        const created = await createAdminVerificationPasscode({
          passcode: nextClean,
          uid,
          email,
          actorName: displayName,
        });
        setConfig(created);
        setNewPasscode('');
        setConfirmPasscode('');
        pushToast('success', 'Main Head 1-Step Verification password created.');
        return;
      }

      if (!currentPasscode.trim()) {
        setError('Enter your current 1-Step Verification password to authorize this change.');
        return;
      }

      const res = await changeAdminVerificationPasscode({
        currentPasscode: currentPasscode.trim(),
        newPasscode: nextClean,
        uid,
        email,
        actorName: displayName,
      });

      if (!res.ok) {
        setError(res.error || 'Could not update 1-Step Verification password.');
        return;
      }

      if (res.record) setConfig(res.record);
      setCurrentPasscode('');
      setNewPasscode('');
      setConfirmPasscode('');
      pushToast('success', '1-Step Verification password updated securely.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save verification password.');
    } finally {
      setSaving(false);
    }
  };

  const handleLockSessionNow = () => {
    clearAllMainHeadSessionUnlocks();
    window.dispatchEvent(new CustomEvent('academiaone-mh-relock'));
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"
    >
      <div className="brand-spectrum-bar w-full" />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#2563EB]" />
              <h2 className="text-base font-bold font-display text-slate-900">
                Main Head 1-Step Verification Password
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Prompted once per new browser session after Google Sign-In before entering the Main Head Admin Dashboard.
            </p>
          </div>
          {!loading && config && (
            <Button type="button" variant="secondary" size="sm" onClick={handleLockSessionNow}>
              <Lock className="w-3.5 h-3.5" />
              Lock Session Now
            </Button>
          )}
        </div>

        {loading ? (
          <p className="text-xs text-slate-500 py-2">Loading verification status…</p>
        ) : (
          <>
            <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                {config ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                    <span className="font-semibold text-slate-900">1-Step Verification Enabled</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4 text-[#EAB308]" />
                    <span className="font-semibold text-slate-900">Not Configured Yet</span>
                  </>
                )}
              </div>
              {config?.updatedAt ? (
                <span className="text-slate-500 tabular-nums">
                  Updated {formatFirestoreDateTime(config.updatedAt)}
                </span>
              ) : null}
            </div>

            {config && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Current 1-Step Verification Password *
                </label>
                <input
                  type={showFields ? 'text' : 'password'}
                  value={currentPasscode}
                  onChange={(e) => {
                    setCurrentPasscode(e.target.value);
                    setError('');
                  }}
                  placeholder="Enter current verification password"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {config ? 'New 1-Step Verification Password *' : 'Create 1-Step Verification Password *'}
                </label>
                <input
                  type={showFields ? 'text' : 'password'}
                  value={newPasscode}
                  onChange={(e) => {
                    setNewPasscode(e.target.value);
                    setError('');
                  }}
                  placeholder="Min 6 characters"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Confirm Verification Password *
                </label>
                <input
                  type={showFields ? 'text' : 'password'}
                  value={confirmPasscode}
                  onChange={(e) => {
                    setConfirmPasscode(e.target.value);
                    setError('');
                  }}
                  placeholder="Re-enter verification password"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>

            {error && <p className="text-xs font-medium text-[#EA4335]">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowFields((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                {showFields ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showFields ? 'Hide passwords' : 'Show passwords'}
              </button>
              <Button type="submit" variant="primary" size="sm" disabled={saving}>
                <ShieldCheck className="w-3.5 h-3.5" />
                {saving
                  ? 'Saving…'
                  : config
                  ? 'Update Verification Password'
                  : 'Enable 1-Step Verification'}
              </Button>
            </div>
          </>
        )}
      </div>
    </form>
  );
}
