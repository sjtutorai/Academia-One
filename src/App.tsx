/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ui/Primitives';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { getSchoolAccessMode, ROLE_LABELS } from './lib/permissions';
import LandingPage from './pages/LandingPage';
import SchoolRegistrationPage from './pages/SchoolRegistrationPage';
import ApplicationStatusPage from './pages/ApplicationStatusPage';
import JoinSchoolPage from './pages/JoinSchoolPage';
import {
  SignInPage,
  SignUpPage,
  EmailVerificationPage,
  FirebaseAuthActionPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  AccessDeniedPage,
} from './pages/AuthPages';
import { PrivacyPolicyPage, TermsOfServicePage } from './pages/LegalPages';
import MainHeadPortal from './pages/main-head/MainHeadPortal';
import { MainHeadVerificationGate } from './components/main-head/MainHeadVerificationGate';
import PrincipalPortal from './pages/principal/PrincipalPortal';
import CoordinatorPortal from './pages/coordinator/CoordinatorPortal';
import TeacherPortal from './pages/teacher/TeacherPortal';
import StudentPortal from './pages/student/StudentPortal';
import { OfflineIndicator } from './components/shared/PWAControls';
import type { UserRole } from './types/models';

function FullScreenLoader() {
  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6">
      <div className="w-9 h-9 rounded-lg border-2 border-slate-200 dark:border-slate-700 border-t-[#2563EB] animate-spin" />
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-4">Loading SJ Academia One workspace…</p>
    </div>
  );
}

function ProtectedRoleRoute({
  requiredRole,
  children,
}: {
  requiredRole: UserRole;
  children: React.ReactNode;
}) {
  const { activeUser, activeSchool, loading, isPreviewMode, needsEmailVerification } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoader />;

  if (!activeUser) {
    const returnTo = `${location.pathname}${location.search || ''}`;
    return <Navigate to="/login" state={{ from: returnTo }} replace />;
  }

  if (needsEmailVerification && !isPreviewMode) {
    return <Navigate to="/verify-email" replace />;
  }

  if (activeUser.status !== 'active') {
    return (
      <AccessDeniedPage
        reason={`Your account is currently ${activeUser.status}. Contact your school Principal or SJ Academia One platform support to restore access.`}
      />
    );
  }

  if (activeUser.mustChangePassword && !isPreviewMode) {
    return <Navigate to="/reset-password" replace />;
  }

  if (activeUser.role !== 'main_head') {
    if (!activeUser.schoolId || activeUser.schoolId === 'unassigned') {
      return <Navigate to="/join-school" replace />;
    }
    const accessMode = getSchoolAccessMode(activeSchool);
    if (accessMode.blocked) {
      return <AccessDeniedPage reason={accessMode.bannerMessage || 'This school workspace is currently unavailable.'} />;
    }
  }

  if (activeUser.role !== requiredRole) {
    return (
      <AccessDeniedPage
        reason={`This route requires ${ROLE_LABELS[requiredRole]} authorization. You are currently signed in as ${ROLE_LABELS[activeUser.role]}.`}
      />
    );
  }

  return <>{children}</>;
}

function JoinSchoolRouteGuard() {
  const { loading, needsEmailVerification } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (needsEmailVerification) {
    return <Navigate to={`/verify-email${location.search || ''}`} replace />;
  }
  return <JoinSchoolPage />;
}

function AccessDeniedRoute() {
  const location = useLocation();
  const state = location.state as { reason?: string } | null;
  return <AccessDeniedPage reason={state?.reason} />;
}

export default function App() {
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = React.useState(false);

  React.useEffect(() => {
    const handleQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        {mapsQuotaExceeded && (
          <div className="bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 dark:text-amber-100 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <NotificationProvider>
              <Routes>
                {/* Public Website, School Registration & Application Status Routes */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/register-school" element={<SchoolRegistrationPage />} />
                <Route path="/application-status" element={<ApplicationStatusPage />} />
                <Route path="/join-school" element={<JoinSchoolRouteGuard />} />
                <Route path="/privacy" element={<PrivacyPolicyPage />} />
                <Route path="/terms" element={<TermsOfServicePage />} />

                {/* Unified Authentication Routes */}
                <Route path="/login" element={<SignInPage />} />
                <Route path="/signup" element={<SignUpPage />} />
                <Route path="/verify-email" element={<EmailVerificationPage />} />
                <Route path="/auth/action" element={<FirebaseAuthActionPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/access-denied" element={<AccessDeniedRoute />} />

                {/* 5 Clean Separate Role-Protected Portals (/role/dashboard, /role/...) */}
                <Route
                  path="/main-head/*"
                  element={
                    <ProtectedRoleRoute requiredRole="main_head">
                      <MainHeadVerificationGate>
                        <MainHeadPortal />
                      </MainHeadVerificationGate>
                    </ProtectedRoleRoute>
                  }
                />
                <Route
                  path="/principal/*"
                  element={
                    <ProtectedRoleRoute requiredRole="principal">
                      <PrincipalPortal />
                    </ProtectedRoleRoute>
                  }
                />
                <Route
                  path="/coordinator/*"
                  element={
                    <ProtectedRoleRoute requiredRole="coordinator">
                      <CoordinatorPortal />
                    </ProtectedRoleRoute>
                  }
                />
                <Route
                  path="/teacher/*"
                  element={
                    <ProtectedRoleRoute requiredRole="teacher">
                      <TeacherPortal />
                    </ProtectedRoleRoute>
                  }
                />
                <Route
                  path="/student/*"
                  element={
                    <ProtectedRoleRoute requiredRole="student">
                      <StudentPortal />
                    </ProtectedRoleRoute>
                  }
                />

                {/* Backward-Compatible Legacy /portal/* Redirects */}
                <Route path="/portal/main-head/*" element={<Navigate to="/main-head/dashboard" replace />} />
                <Route path="/portal/principal/*" element={<Navigate to="/principal/dashboard" replace />} />
                <Route path="/portal/coordinator/*" element={<Navigate to="/coordinator/dashboard" replace />} />
                <Route path="/portal/teacher/*" element={<Navigate to="/teacher/dashboard" replace />} />
                <Route path="/portal/student/*" element={<Navigate to="/student/dashboard" replace />} />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              <OfflineIndicator />
              </NotificationProvider>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
