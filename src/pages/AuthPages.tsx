import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Eye,
  EyeOff,
  Lock,
  ArrowLeft,
  ShieldAlert,
  CheckCircle2,
  Mail,
  RefreshCw,
  LogOut,
  AlertTriangle,
} from 'lucide-react';
import {
  applyActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggleButton, useTheme } from '../contexts/ThemeContext';
import { ROLE_HOME_ROUTES } from '../lib/permissions';
import { MOTION_EASE } from '../lib/motion';
import { Button, GoogleLogo, useToast } from '../components/ui/Primitives';
import { BrandLogo } from '../components/ui/BrandLogo';

// ============================================================================
// Unified Login Page (Strictly NO Role Selector Dropdown)
// ============================================================================
export function SignInPage() {
  const { signInUnified, signInGoogle } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const resolvePostLoginRoute = (role: keyof typeof ROLE_HOME_ROUTES) => {
    const requestedFrom = (location.state as { from?: string } | null)?.from;
    const rolePrefix = `/${role.replace('_', '-')}/`;
    if (
      typeof requestedFrom === 'string' &&
      requestedFrom.startsWith(rolePrefix) &&
      !requestedFrom.includes('//')
    ) {
      return requestedFrom;
    }
    return ROLE_HOME_ROUTES[role];
  };

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [needsEmailSetup, setNeedsEmailSetup] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNeedsEmailSetup(false);
    if (!identifier.trim() || !password) {
      setError('Enter both your username or email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await signInUnified(identifier, password);
      if (!res.ok) {
        setError(res.error || 'Invalid credentials.');
        if (res.needsEmailAuthSetup) setNeedsEmailSetup(true);
        return;
      }
      if (res.profile) {
        if (res.needsEmailVerification) {
          pushToast('info', 'Please verify your email address before entering your portal.');
          navigate('/verify-email');
          return;
        }
        if (res.profile.status !== 'active') {
          navigate('/access-denied', {
            state: { reason: `Your account is currently ${res.profile.status}. Contact your school administrator or platform support.` },
          });
          return;
        }
        if (res.profile.role !== 'main_head' && (!res.profile.schoolId || res.profile.schoolId === 'unassigned')) {
          pushToast('info', 'Email not yet linked to a school. Enter your School Code to apply.');
          navigate('/join-school');
          return;
        }
        pushToast('success', `Signed in as ${res.profile.displayName}`);
        navigate(resolvePostLoginRoute(res.profile.role), { replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleSubmitting(true);
    try {
      const res = await signInGoogle();
      if (!res.ok) {
        setError(res.error || 'Google sign-in could not complete.');
        return;
      }
      if (res.profile) {
        if (res.profile.status !== 'active') {
          navigate('/access-denied', {
            state: { reason: `Your account is currently ${res.profile.status}.` },
          });
          return;
        }
        if (res.profile.role !== 'main_head' && (!res.profile.schoolId || res.profile.schoolId === 'unassigned')) {
          pushToast('info', 'Email not yet linked to a school. Enter your School Code to apply.');
          navigate('/join-school');
          return;
        }
        pushToast('success', `Signed in as ${res.profile.displayName}`);
        navigate(resolvePostLoginRoute(res.profile.role), { replace: true });
      }
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const busy = submitting || googleSubmitting;

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex flex-col justify-center py-8 sm:py-12 px-4 sm:px-6 safe-top safe-bottom transition-colors duration-200">
      <div className="max-w-md w-full mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to SJ Academia One
          </Link>
          <ThemeToggleButton variant="pill" />
        </div>

        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.28, ease: MOTION_EASE.out }}
          className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm"
        >
          <div className="p-6 sm:p-8">
          <div className="mb-6">
            <BrandLogo size="md" tone={isDark ? 'dark' : 'light'} />
            <h1 className="text-xl font-bold font-display text-[#0F295C] dark:text-white mt-4">Sign in to your account</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Enter your credentials. You will be routed automatically to your authorized portal.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-id" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Username or Email
              </label>
              <input
                id="login-id"
                type="text"
                autoComplete="username"
                required
                disabled={busy}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Enter username or email"
                className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15 disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-pw" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium text-teal-700 dark:text-blue-400 hover:text-teal-800 dark:hover:text-blue-300 transition-colors"
                >
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="login-pw"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15 disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={showPassword ? 'hide' : 'show'}
                      initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.85 }}
                      transition={{ duration: 0.12 }}
                      className="block"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </motion.span>
                  </AnimatePresence>
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberSession}
                onChange={(e) => setRememberSession(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600 text-teal-600 focus:ring-teal-600"
              />
              Keep session active on this trusted device (60 min idle timeout enforced)
            </label>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: MOTION_EASE.out }}
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed"
                >
                  {error}
                  {needsEmailSetup && (
                    <p className="mt-2 text-slate-700">
                      Firebase Console path:{' '}
                      <span className="font-mono">Authentication → Sign-in method → Email/Password → Enable</span>
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" variant="navy" className="w-full" loading={submitting} disabled={busy}>
              {submitting ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2.5 bg-white text-slate-400">or continue with verified SSO</span>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={handleGoogleSignIn}
            loading={googleSubmitting}
            disabled={busy}
          >
            {!googleSubmitting && <GoogleLogo className="w-4 h-4 shrink-0" />}
            {googleSubmitting ? 'Connecting to Google…' : 'Continue with Google'}
          </Button>

          <p className="mt-6 text-center text-xs text-slate-500">
            New user?{' '}
            <Link to="/signup" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
              Create an Email & Password account
            </Link>
          </p>
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <Link to="/register-school" className="hover:text-green-700 font-medium transition-colors">
              Register Your School Free
            </Link>
            <Link to="/application-status" className="hover:text-blue-700 font-medium transition-colors">
              Track Application →
            </Link>
          </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ============================================================================
// Email & Password Registration Page
// ============================================================================
export function SignUpPage() {
  const { signUpEmailPassword, signInGoogle } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [needsEmailSetup, setNeedsEmailSetup] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNeedsEmailSetup(false);
    if (displayName.trim().length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }
    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPw) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await signUpEmailPassword({ displayName, username, email, password });
      if (!res.ok) {
        setError(res.error || 'Registration failed.');
        if (res.needsEmailAuthSetup) setNeedsEmailSetup(true);
        return;
      }
      if (res.profile) {
        const cleanCode = schoolCode.trim().toUpperCase().replace(/\s+/g, '');
        if (res.needsEmailVerification) {
          pushToast(
            'success',
            res.verificationEmailSent
              ? 'Account created! We sent a verification link to your email.'
              : 'Account created! Verify your email to continue.',
          );
          navigate(cleanCode ? `/verify-email?code=${encodeURIComponent(cleanCode)}` : '/verify-email');
          return;
        }
        if (res.profile.role !== 'main_head' && (!res.profile.schoolId || res.profile.schoolId === 'unassigned')) {
          pushToast(
            'success',
            cleanCode
              ? `Account created. Verifying access code ${cleanCode}…`
              : 'Account created. Enter your School Access Code to continue.',
          );
          navigate(cleanCode ? `/join-school?code=${encodeURIComponent(cleanCode)}` : '/join-school');
          return;
        }
        pushToast('success', `Account created & linked to your school as ${res.profile.role}.`);
        navigate(ROLE_HOME_ROUTES[res.profile.role]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] flex flex-col justify-center py-8 sm:py-12 px-4 sm:px-6 safe-top safe-bottom">
      <div className="max-w-md w-full mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to SJ Academia One
        </Link>

        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.28, ease: MOTION_EASE.out }}
          className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-sm"
        >
          <div className="p-6 sm:p-8">
          <div className="mb-6">
            <BrandLogo size="md" />
            <h1 className="text-xl font-bold font-display text-[#0F295C] mt-4">Create your account</h1>
            <p className="text-sm text-slate-500 mt-1">
              Sign up with email and password. School administrators can link your account to your school roster.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                School Access Code <span className="font-normal text-slate-400">(Optional — auto-detects school, role &amp; class)</span>
              </label>
              <input
                type="text"
                value={schoolCode}
                onChange={(e) => setSchoolCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                placeholder="Enter your school access code"
                className="w-full px-3.5 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full pl-3 pr-9 py-2 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    aria-label="Toggle password visibility"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Confirm Password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Repeat password"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                />
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: MOTION_EASE.out }}
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed"
                >
                  {error}
                  {needsEmailSetup && (
                    <p className="mt-2 text-slate-700">
                      Open Firebase Console → <span className="font-mono">Authentication → Sign-in method → Email/Password</span> and toggle Enable. You may also sign in immediately with Google below.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" variant="primary" className="w-full" loading={submitting}>
              {submitting ? 'Creating account…' : 'Create Account'}
            </Button>
          </form>

          <div className="mt-4">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={async () => {
                const res = await signInGoogle();
                if (res.ok && res.profile) {
                  if (res.profile.role !== 'main_head' && (!res.profile.schoolId || res.profile.schoolId === 'unassigned')) {
                    const cleanCode = schoolCode.trim().toUpperCase().replace(/\s+/g, '');
                    pushToast('info', 'Enter your School Access Code to identify your school and role.');
                    navigate(cleanCode ? `/join-school?code=${encodeURIComponent(cleanCode)}` : '/join-school');
                    return;
                  }
                  navigate(ROLE_HOME_ROUTES[res.profile.role]);
                }
              }}
            >
              <GoogleLogo className="w-4 h-4 shrink-0" />
              Continue with Google
            </Button>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700 transition-colors">
              Sign In
            </Link>
          </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ============================================================================
// Email Verification Gate Page (/verify-email)
// ============================================================================
export function EmailVerificationPage() {
  const {
    firebaseUser,
    activeUser,
    emailVerified,
    needsEmailVerification,
    loading,
    checkEmailVerification,
    resendVerificationEmail,
    logout,
  } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const pendingCode = (searchParams.get('code') || '').trim().toUpperCase();
  const oobCode = searchParams.get('oobCode') || '';

  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [oobApplied, setOobApplied] = useState(false);

  const navigateAfterVerification = React.useCallback(
    (profileOverride?: typeof activeUser) => {
      const targetProfile = profileOverride || activeUser;
      if (!targetProfile) {
        navigate('/login', { replace: true });
        return;
      }
      if (targetProfile.role !== 'main_head' && (!targetProfile.schoolId || targetProfile.schoolId === 'unassigned')) {
        navigate(pendingCode ? `/join-school?code=${encodeURIComponent(pendingCode)}` : '/join-school', {
          replace: true,
        });
        return;
      }
      navigate(ROLE_HOME_ROUTES[targetProfile.role], { replace: true });
    },
    [activeUser, navigate, pendingCode],
  );

  // If opened directly from a Firebase verifyEmail link with ?oobCode=...
  useEffect(() => {
    if (!oobCode || oobApplied) return;
    let cancelled = false;
    setChecking(true);
    setError('');
    applyActionCode(auth, oobCode)
      .then(async () => {
        if (cancelled) return;
        setOobApplied(true);
        const verified = await checkEmailVerification();
        if (cancelled) return;
        setStatusMessage('Your email address has been verified.');
        pushToast('success', 'Email verified! Opening your workspace…');
        if (verified || auth.currentUser) {
          navigateAfterVerification();
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
          setError('This verification link has expired or was already used. Request a fresh link below.');
        } else {
          setError(err instanceof Error ? err.message : 'Unable to apply verification code.');
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [oobCode, oobApplied, checkEmailVerification, navigateAfterVerification, pushToast]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  // Auto-redirect once verified
  useEffect(() => {
    if (!loading && firebaseUser && emailVerified && !needsEmailVerification) {
      navigateAfterVerification();
    }
  }, [loading, firebaseUser, emailVerified, needsEmailVerification, navigateAfterVerification]);

  // Auto-check when user returns to this browser tab after clicking the link in their inbox
  useEffect(() => {
    if (!firebaseUser || emailVerified) return;
    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        checkEmailVerification().then((verified) => {
          if (verified) {
            pushToast('success', 'Email verified successfully!');
            navigateAfterVerification();
          }
        });
      }
    };
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    return () => {
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [firebaseUser, emailVerified, checkEmailVerification, navigateAfterVerification, pushToast]);

  const handleManualCheck = async () => {
    setError('');
    setStatusMessage('');
    setChecking(true);
    try {
      const verified = await checkEmailVerification();
      if (verified) {
        pushToast('success', 'Email verified! Redirecting now…');
        navigateAfterVerification();
      } else {
        setStatusMessage('Not verified yet. Open the verification email in your inbox or spam folder and click the link.');
      }
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError('');
    setStatusMessage('');
    setResending(true);
    try {
      const res = await resendVerificationEmail();
      if (!res.ok) {
        setError(res.error || 'Unable to resend verification email right now.');
        return;
      }
      setCooldown(60);
      setStatusMessage('A fresh verification email has been sent. Check your inbox and spam/junk folder.');
      pushToast('success', 'Verification email sent.');
    } finally {
      setResending(false);
    }
  };

  if (!loading && !firebaseUser && !oobCode) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] flex items-center justify-center p-4 safe-top safe-bottom">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm text-center space-y-4">
          <div className="flex justify-center">
            <BrandLogo size="sm" />
          </div>
          <h1 className="text-lg font-bold font-display text-[#0F295C]">Sign in to verify your email</h1>
          <p className="text-sm text-slate-500">
            Sign in with your Email &amp; Password credentials to check or resend your verification email.
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="navy" onClick={() => navigate('/login')}>
              Go to Sign In
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] flex flex-col justify-center py-8 sm:py-12 px-4 safe-top safe-bottom">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.26, ease: MOTION_EASE.out }}
        className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm"
      >
        <div className="p-6 sm:p-8 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <BrandLogo size="sm" />
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">
              <Mail className="w-4 h-4" />
              Email Verification
            </span>
          </div>

          <div>
            <h1 className="text-xl font-bold font-display text-[#0F295C]">Verify your email address</h1>
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
              We sent a verification link to{' '}
              <span className="font-semibold text-slate-900">{firebaseUser?.email || activeUser?.email || 'your email'}</span>.
              Verify your email to unlock your SJ Academia One workspace.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-2 leading-relaxed">
            <p className="font-semibold text-slate-800">Next steps:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Open your email inbox and click the SJ Academia One verification link.</li>
              <li>Check your Spam or Promotions folder if you do not see it within a minute.</li>
              <li>Return here and click <span className="font-semibold text-slate-800">I&apos;ve Verified My Email</span>.</li>
            </ol>
            {pendingCode && (
              <p className="pt-1 text-teal-800 font-medium">
                Saved School Access Code: <span className="font-mono font-bold">{pendingCode}</span> (will be applied automatically after verification).
              </p>
            )}
          </div>

          {statusMessage && (
            <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <span>{statusMessage}</span>
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2.5 pt-1">
            <Button
              type="button"
              variant="navy"
              className="w-full"
              loading={checking}
              onClick={handleManualCheck}
            >
              {!checking && <RefreshCw className="w-4 h-4" />}
              {checking ? 'Checking verification status…' : "I've Verified My Email"}
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="w-full"
              loading={resending}
              disabled={cooldown > 0}
              onClick={handleResend}
            >
              <Mail className="w-4 h-4" />
              {cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend Verification Email'}
            </Button>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Entered the wrong email?</span>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/signup', { replace: true });
              }}
              className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-red-600 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ============================================================================
// Firebase Auth Email Action Handler (/auth/action)
// ============================================================================
export function FirebaseAuthActionPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mode = searchParams.get('mode') || '';
  const oobCode = searchParams.get('oobCode') || '';

  useEffect(() => {
    if (mode === 'resetPassword' && oobCode) {
      navigate(`/reset-password?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}`, { replace: true });
      return;
    }
    if (mode === 'verifyEmail' && oobCode) {
      navigate(`/verify-email?mode=verifyEmail&oobCode=${encodeURIComponent(oobCode)}`, { replace: true });
      return;
    }
    navigate('/login', { replace: true });
  }, [mode, oobCode, navigate]);

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-9 h-9 rounded-lg border-2 border-slate-200 border-t-[#0F295C] animate-spin" />
      <p className="text-xs font-medium text-slate-500 mt-4">Processing your secure link…</p>
    </div>
  );
}

// ============================================================================
// Forgot Password Page (Real Email Delivery + Error Feedback + Resend Cooldown)
// ============================================================================
export function ForgotPasswordPage() {
  const { requestPasswordRecovery } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const { pushToast } = useToast();

  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  const sendReset = async (targetEmail: string) => {
    setError('');
    setSubmitting(true);
    try {
      const res = await requestPasswordRecovery(targetEmail);
      if (!res.ok) {
        setError(res.error || 'Could not send password reset email.');
        return;
      }
      setSentTo(res.email || targetEmail.trim().toLowerCase());
      setCooldown(60);
      pushToast('success', 'Password reset email dispatched.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Enter your registered email address.');
      return;
    }
    await sendReset(email);
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] flex flex-col justify-center py-8 sm:py-12 px-4 safe-top safe-bottom">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.26, ease: MOTION_EASE.out }}
        className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm"
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3 mb-5">
            <BrandLogo size="sm" />
            <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sign In
            </Link>
          </div>
          <h1 className="text-xl font-bold font-display text-[#0F295C]">Reset your password</h1>
          <p className="text-sm text-slate-500 mt-1">
            Enter your registered email address and we will send you a secure password reset link.
          </p>

          {sentTo ? (
            <div className="mt-6 space-y-4">
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-950 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Reset link sent</p>
                  <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
                    If an Email &amp; Password account exists for <span className="font-semibold">{sentTo}</span>, a password reset link has been sent. Check your inbox and Spam/Junk folder.
                  </p>
                  <p className="text-xs text-emerald-800 mt-2 leading-relaxed">
                    Note: If you originally signed up with <span className="font-semibold">Continue with Google</span>, return to Sign In and use Google Sign-In instead.
                  </p>
                </div>
              </div>

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {error}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2.5">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  loading={submitting}
                  disabled={cooldown > 0}
                  onClick={() => sendReset(sentTo)}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Email'}
                </Button>
                <Button
                  type="button"
                  variant="navy"
                  className="flex-1"
                  onClick={() => {
                    setSentTo('');
                    setError('');
                  }}
                >
                  Use Another Email
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              <div>
                <label htmlFor="forgot-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Registered Email Address
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Enter your registered email address"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                />
              </div>

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
                  {error}
                </div>
              )}

              <Button type="submit" variant="navy" className="w-full" loading={submitting}>
                {submitting ? 'Sending Reset Link…' : 'Send Password Reset Link'}
              </Button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ============================================================================
// Reset Password Screen (/reset-password)
// Supports BOTH email reset links (?oobCode=...) AND logged-in temporary password replacement
// ============================================================================
export function ResetPasswordPage() {
  const { replaceTemporaryPassword, activeUser, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const oobCode = searchParams.get('oobCode') || '';
  const isEmailResetFlow = Boolean(oobCode);

  const [verifyingCode, setVerifyingCode] = useState(isEmailResetFlow);
  const [resetEmail, setResetEmail] = useState('');
  const [codeError, setCodeError] = useState('');
  const [resetComplete, setResetComplete] = useState(false);

  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!oobCode) return;
    let cancelled = false;
    setVerifyingCode(true);
    setCodeError('');
    verifyPasswordResetCode(auth, oobCode)
      .then((verifiedEmail) => {
        if (!cancelled) {
          setResetEmail(verifiedEmail);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
          setCodeError('This password reset link is invalid or has expired. Please request a fresh link.');
        } else {
          setCodeError(err instanceof Error ? err.message : 'Unable to validate reset link.');
        }
      })
      .finally(() => {
        if (!cancelled) setVerifyingCode(false);
      });
    return () => {
      cancelled = true;
    };
  }, [oobCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPw.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      if (isEmailResetFlow) {
        await confirmPasswordReset(auth, oobCode, newPw);
        setResetComplete(true);
        pushToast('success', 'Password reset successfully. Sign in with your new password.');
        return;
      }

      const res = await replaceTemporaryPassword(newPw);
      if (!res.ok) {
        setError(res.error || 'Could not update password.');
        return;
      }
      pushToast('success', 'Password updated securely.');
      if (activeUser) navigate(ROLE_HOME_ROUTES[activeUser.role]);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
        setError('This reset link has expired. Request a new password reset link.');
      } else if (code === 'auth/weak-password') {
        setError('Please choose a stronger password (at least 8 characters with letters and numbers).');
      } else {
        setError(err instanceof Error ? err.message : 'Could not reset password.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] flex items-center justify-center p-4 safe-top safe-bottom">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.26, ease: MOTION_EASE.out }}
        className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm"
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <BrandLogo size="sm" />
          <div className="flex items-center gap-1.5 text-teal-700">
            <Lock className="w-4 h-4" />
            <span className="text-xs font-semibold">Password Security</span>
          </div>
        </div>

        {verifyingCode ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-8 h-8 rounded-lg border-2 border-slate-200 border-t-[#0F295C] animate-spin mx-auto" />
            <p className="text-xs text-slate-500">Verifying your password reset link…</p>
          </div>
        ) : codeError ? (
          <div className="space-y-4">
            <h1 className="text-xl font-bold font-display text-slate-900">Reset link expired</h1>
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
              {codeError}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="navy" className="flex-1" onClick={() => navigate('/forgot-password')}>
                Request New Reset Link
              </Button>
              <Button variant="secondary" onClick={() => navigate('/login')}>
                Sign In
              </Button>
            </div>
          </div>
        ) : resetComplete ? (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-950 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Password updated</p>
                <p className="text-xs text-emerald-800 mt-1">
                  Your password for <span className="font-semibold">{resetEmail}</span> has been reset. You can now sign in with your new password.
                </p>
              </div>
            </div>
            <Button variant="navy" className="w-full" onClick={() => navigate('/login', { replace: true })}>
              Continue to Sign In
            </Button>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold font-display text-[#0F295C]">
              {isEmailResetFlow ? 'Choose a new password' : 'Set your permanent password'}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {isEmailResetFlow
                ? `Enter a new password for ${resetEmail || 'your account'}.`
                : 'Temporary administrator-issued credentials must be replaced before accessing your dashboard.'}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full pl-3.5 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Confirm New Password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                />
              </div>
              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                  {error}
                </div>
              )}
              <div className="flex items-center gap-3 pt-2">
                {!isEmailResetFlow ? (
                  <Button type="button" variant="secondary" onClick={logout}>
                    Sign Out
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => navigate('/login')}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" variant="primary" className="flex-1" loading={saving}>
                  {saving ? 'Updating…' : 'Update Password'}
                </Button>
              </div>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}

// ============================================================================
// Unauthorized / Suspended Access Page
// ============================================================================
export function AccessDeniedPage({ reason }: { reason?: string }) {
  const { activeUser, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] flex items-center justify-center p-4 sm:p-6 safe-top safe-bottom">
      <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm">
        <div className="mb-4">
          <BrandLogo size="sm" />
        </div>
        <div className="flex items-center gap-3 text-red-700 mb-4">
          <ShieldAlert className="w-6 h-6" />
          <h1 className="text-lg font-bold font-display text-slate-900">Access Restricted</h1>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          {reason ||
            'You do not have permission to view this portal or cross-school resource. All access attempts are enforced by role and school tenant boundaries.'}
        </p>
        <div className="mt-6 p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
          Need help restoring an inactive school account? Contact{' '}
          <span className="font-semibold text-slate-900">support@academiaone.edu</span>.
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {activeUser && activeUser.status === 'active' && (
            <Button variant="primary" onClick={() => navigate(ROLE_HOME_ROUTES[activeUser.role])}>
              Return to My Dashboard
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/')}>
            Public Home
          </Button>
          {activeUser && (
            <Button variant="ghost" onClick={logout}>
              Sign Out
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
