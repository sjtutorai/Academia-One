import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, Eye, EyeOff, LogOut, KeyRound, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  createAdminVerificationPasscode,
  fetchAdminSecurityConfig,
  isMainHeadSessionUnlocked,
  markMainHeadSessionUnlocked,
  verifyAdminPasscode,
  type AdminSecurityRecord,
} from '../../lib/adminVerification';
import { Button, useToast } from '../ui/Primitives';
import { BrandLogo } from '../ui/BrandLogo';

const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 30;

export function MainHeadVerificationGate({ children }: { children: React.ReactNode }) {
  const { activeUser, realProfile, firebaseUser, isPreviewMode, logout } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [checking, setChecking] = useState(true);
  const [config, setConfig] = useState<AdminSecurityRecord | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Form states
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Brute-force cooldown state
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  const uid = firebaseUser?.uid || realProfile?.uid || activeUser?.uid || '';
  const email = firebaseUser?.email || realProfile?.email || activeUser?.email || '';
  const displayName = realProfile?.displayName || activeUser?.displayName || 'Main Head';

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownLeft]);

  const loadConfig = async () => {
    if (!uid) return;
    setChecking(true);
    setLoadError('');
    try {
      const rec = await fetchAdminSecurityConfig();
      setConfig(rec);
      if (rec && isMainHeadSessionUnlocked(uid, rec.passcodeHash)) {
        setUnlocked(true);
      } else {
        setUnlocked(false);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Unable to load Main Head security verification status.',
      );
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!uid || isPreviewMode) {
      setChecking(false);
      return;
    }
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, isPreviewMode]);

  // Listen for manual re-lock event triggered from Profile & Admin Security
  useEffect(() => {
    const handleRelock = () => {
      setPasscode('');
      setConfirmPasscode('');
      setError('');
      setUnlocked(false);
    };
    window.addEventListener('academiaone-mh-relock', handleRelock);
    return () => window.removeEventListener('academiaone-mh-relock', handleRelock);
  }, []);

  if (isPreviewMode || unlocked) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-6">
        <div className="w-9 h-9 rounded-lg border-2 border-slate-200 border-t-[#2563EB] animate-spin" />
        <p className="text-xs font-medium text-slate-500 mt-4">Checking Main Head 1-Step Verification…</p>
      </div>
    );
  }

  const isSetupMode = !config;

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const clean = passcode.trim();
    if (clean.length < 6) {
      setError('Verification password must be at least 6 characters long.');
      return;
    }
    if (clean !== confirmPasscode.trim()) {
      setError('Passwords do not match. Re-enter the same verification password.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createAdminVerificationPasscode({
        passcode: clean,
        uid,
        email,
        actorName: displayName,
      });
      setConfig(created);
      setUnlocked(true);
      setPasscode('');
      setConfirmPasscode('');
      pushToast('success', '1-Step Verification password created. You can update it anytime in Profile & Security.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save verification password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config || cooldownLeft > 0) return;
    setError('');
    const clean = passcode.trim();
    if (!clean) {
      setError('Enter your 1-Step Verification password to unlock the Admin Dashboard.');
      return;
    }

    setSubmitting(true);
    try {
      const valid = await verifyAdminPasscode(clean, config);
      if (!valid) {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        if (nextAttempts >= MAX_ATTEMPTS) {
          setCooldownLeft(COOLDOWN_SECONDS);
          setFailedAttempts(0);
          setError(`Too many incorrect attempts. Please wait ${COOLDOWN_SECONDS} seconds before trying again.`);
        } else {
          setError(
            `Incorrect verification password. ${MAX_ATTEMPTS - nextAttempts} attempt${
              MAX_ATTEMPTS - nextAttempts === 1 ? '' : 's'
            } remaining.`,
          );
        }
        return;
      }

      markMainHeadSessionUnlocked(uid, config.passcodeHash);
      setFailedAttempts(0);
      setPasscode('');
      setUnlocked(true);
      pushToast('success', 'Main Head Admin Dashboard unlocked for this session.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      <div className="brand-spectrum-bar w-full" />

      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Deep Cobalt Header */}
          <div className="bg-[#0F295C] text-white px-6 py-5 flex items-center justify-between gap-3">
            <BrandLogo size="sm" tone="dark" />
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#FACC15]">
              <ShieldCheck className="w-3.5 h-3.5" />
              1-Step Verification
            </span>
          </div>

          <div className="p-6 sm:p-7 space-y-5">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#2563EB] mb-1.5">
                {isSetupMode ? <KeyRound className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                <span>{isSetupMode ? 'First-Time Admin Security Setup' : 'Main Head Admin Gate'}</span>
              </div>
              <h1 className="text-xl font-bold font-display text-slate-900">
                {isSetupMode ? 'Create Your 1-Step Verification Password' : 'Enter 1-Step Verification Password'}
              </h1>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                {isSetupMode
                  ? 'Set a dedicated admin verification password for your Google-authenticated Main Head account. You will be asked for it once per new browser session and can change it anytime in Profile & Security.'
                  : 'Your Google account is verified. Enter your Main Head 1-Step Verification password to unlock the Admin Dashboard for this session.'}
              </p>
            </div>

            {/* Signed-in Google Account Strip */}
            <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500">Signed in as Main Head</p>
                <p className="font-semibold text-slate-900 truncate">{email}</p>
              </div>
              <span className="text-[11px] font-semibold text-[#16A34A] shrink-0">Verified</span>
            </div>

            {loadError ? (
              <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-2.5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-[#EA4335] shrink-0 mt-0.5" />
                  <p>{loadError}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={loadConfig}>
                  Retry Security Check
                </Button>
              </div>
            ) : (
              <form onSubmit={isSetupMode ? handleSetupSubmit : handleVerifySubmit} className="space-y-4">
                <div>
                  <label htmlFor="mh-verify-pw" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isSetupMode ? 'New 1-Step Verification Password' : '1-Step Verification Password'}
                  </label>
                  <div className="relative">
                    <input
                      id="mh-verify-pw"
                      type={showPasscode ? 'text' : 'password'}
                      autoFocus
                      required
                      disabled={submitting || cooldownLeft > 0}
                      value={passcode}
                      onChange={(e) => {
                        setPasscode(e.target.value);
                        setError('');
                      }}
                      placeholder={isSetupMode ? 'Minimum 6 characters' : 'Enter your verification password'}
                      className="w-full px-3.5 py-2.5 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasscode((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      aria-label={showPasscode ? 'Hide password' : 'Show password'}
                    >
                      {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {isSetupMode && (
                  <div>
                    <label htmlFor="mh-verify-confirm" className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Confirm 1-Step Verification Password
                    </label>
                    <input
                      id="mh-verify-confirm"
                      type={showPasscode ? 'text' : 'password'}
                      required
                      disabled={submitting}
                      value={confirmPasscode}
                      onChange={(e) => {
                        setConfirmPasscode(e.target.value);
                        setError('');
                      }}
                      placeholder="Re-enter your verification password"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                    />
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-[#EA4335] shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {cooldownLeft > 0 && (
                  <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 tabular-nums">
                    Security cooldown active — try again in {cooldownLeft}s.
                  </p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={submitting || cooldownLeft > 0}
                >
                  <ShieldCheck className="w-4 h-4" />
                  {submitting
                    ? isSetupMode
                      ? 'Saving Verification Password…'
                      : 'Verifying…'
                    : isSetupMode
                    ? 'Save & Enter Admin Dashboard'
                    : 'Unlock Admin Dashboard'}
                </Button>
              </form>
            )}

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400">Stored as salted SHA-256 hash</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 font-medium text-slate-600 hover:text-[#EA4335] cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
