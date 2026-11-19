import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Eye, EyeOff, Lock, ArrowLeft, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_HOME_ROUTES } from '../lib/permissions';
import { MOTION_EASE } from '../lib/motion';
import { Button, useToast } from '../components/ui/Primitives';
import { BrandLogo } from '../components/ui/BrandLogo';

// ============================================================================
// Unified Login Page (Strictly NO Role Selector Dropdown)
// ============================================================================
export function SignInPage() {
  const { signInUnified, signInGoogle } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

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
        navigate(ROLE_HOME_ROUTES[res.profile.role]);
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
        navigate(ROLE_HOME_ROUTES[res.profile.role]);
      }
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const busy = submitting || googleSubmitting;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] flex flex-col justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to AcademiaOne
        </Link>

        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.28, ease: MOTION_EASE.out }}
          className="bg-white border border-slate-200/90 rounded-xl p-8 shadow-sm"
        >
          <div className="mb-6">
            <BrandLogo size="md" />
            <h1 className="text-xl font-bold font-display text-slate-900 mt-4">Sign in to your account</h1>
            <p className="text-sm text-slate-500 mt-1">
              Enter your credentials. You will be routed automatically to your authorized portal.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-id" className="block text-xs font-medium text-slate-700 mb-1.5">
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
                placeholder="name@school.edu or username"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15 disabled:bg-slate-50"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-pw" className="block text-xs font-medium text-slate-700">
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium text-teal-700 hover:text-teal-800 transition-colors"
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
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15 disabled:bg-slate-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
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

            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberSession}
                onChange={(e) => setRememberSession(e.target.checked)}
                className="rounded border-slate-300 text-teal-600 focus:ring-teal-600"
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
            {googleSubmitting ? 'Connecting to Google…' : 'Continue with Google'}
          </Button>

          <p className="mt-6 text-center text-xs text-slate-500">
            New user?{' '}
            <Link to="/signup" className="font-semibold text-teal-700 hover:text-teal-800 transition-colors">
              Create an Email & Password account
            </Link>
          </p>
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <Link to="/register-school" className="hover:text-slate-900 font-medium transition-colors">
              Register Your School Free
            </Link>
            <Link to="/application-status" className="hover:text-teal-700 font-medium transition-colors">
              Track Application →
            </Link>
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
        if (res.profile.role !== 'main_head' && (!res.profile.schoolId || res.profile.schoolId === 'unassigned')) {
          pushToast('success', 'Account created. Enter your School Code to apply to your school.');
          navigate('/join-school');
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
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] flex flex-col justify-center py-12 px-4 sm:px-6">
      <div className="max-w-md w-full mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to AcademiaOne
        </Link>

        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.28, ease: MOTION_EASE.out }}
          className="bg-white border border-slate-200/90 rounded-xl p-8 shadow-sm"
        >
          <div className="mb-6">
            <BrandLogo size="md" />
            <h1 className="text-xl font-bold font-display text-slate-900 mt-4">Create your account</h1>
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
                placeholder="Jordan Taylor"
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
                placeholder="jordan.taylor"
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
                placeholder="jordan@school.edu"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
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
                    pushToast('info', 'Email not yet linked to a school. Enter your School Code to apply.');
                    navigate('/join-school');
                    return;
                  }
                  navigate(ROLE_HOME_ROUTES[res.profile.role]);
                }
              }}
            >
              Continue with Google
            </Button>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-teal-700 hover:text-teal-800 transition-colors">
              Sign In
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}

// ============================================================================
// Non-Revealing Forgot Password Page
// ============================================================================
export function ForgotPasswordPage() {
  const { requestPasswordRecovery } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setSubmitting(true);
    try {
      await requestPasswordRecovery(identifier);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] flex flex-col justify-center py-12 px-4">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.26, ease: MOTION_EASE.out }}
        className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-xl p-8 shadow-sm"
      >
        <div className="flex items-center justify-between gap-3 mb-5">
          <BrandLogo size="sm" />
          <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Sign In
          </Link>
        </div>
        <h1 className="text-xl font-bold font-display text-slate-900">Account Recovery</h1>
        <p className="text-sm text-slate-500 mt-1">
          Enter your registered email or username. For security, we never confirm whether an account exists.
        </p>

        {sent ? (
          <div className="mt-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Recovery request processed</p>
              <p className="text-xs text-emerald-800 mt-1">
                If an active account matches that email, password reset instructions have been sent. If your account uses an administrator-issued login, contact your Principal or Main Head for a temporary reset.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Username or Email</label>
              <input
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="name@school.edu"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
              />
            </div>
            <Button type="submit" variant="navy" className="w-full" loading={submitting}>
              {submitting ? 'Sending…' : 'Send Recovery Link'}
            </Button>
          </form>
        )}
      </motion.div>
    </div>
  );
}

// ============================================================================
// Forced Temporary Password Replacement Screen (/reset-password)
// ============================================================================
export function ResetPasswordPage() {
  const { replaceTemporaryPassword, activeUser, logout } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
      const res = await replaceTemporaryPassword(newPw);
      if (!res.ok) {
        setError(res.error || 'Could not update password.');
        return;
      }
      pushToast('success', 'Password updated securely.');
      if (activeUser) navigate(ROLE_HOME_ROUTES[activeUser.role]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-[#EFF4FB] to-[#E8EEF8] flex items-center justify-center p-4">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.26, ease: MOTION_EASE.out }}
        className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 shadow-sm"
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <BrandLogo size="sm" />
          <div className="flex items-center gap-1.5 text-teal-700">
            <Lock className="w-4 h-4" />
            <span className="text-xs font-semibold">Security Requirement</span>
          </div>
        </div>
        <h1 className="text-xl font-bold font-display text-slate-900">Set your permanent password</h1>
        <p className="text-sm text-slate-500 mt-1">
          Temporary administrator-issued credentials must be replaced before accessing your dashboard.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">New Password</label>
            <input
              type="password"
              required
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              required
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Re-enter password"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg transition-all duration-150 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={logout}>
              Sign Out
            </Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>
              {saving ? 'Updating…' : 'Update Password'}
            </Button>
          </div>
        </form>
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
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8 shadow-sm">
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
