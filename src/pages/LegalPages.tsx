import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BrandLogo } from '../components/ui/BrandLogo';

export function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-14 px-6">
      <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl p-8 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <Link to="/">
            <BrandLogo size="sm" />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to SJ Academia One
          </Link>
        </div>
        <h1 className="text-2xl font-bold font-display text-slate-900">Privacy Policy</h1>
        <p className="text-xs text-slate-500 mt-1">Effective Date: November 2026 · SJ Academia One Platform</p>
        <div className="mt-6 space-y-5 text-sm text-slate-600 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-slate-900">1. Multi-Tenant Student Data Protection</h2>
            <p className="mt-1">
              SJ Academia One collects only the educational records necessary to operate school attendance,
              timetables, homework, and examinations. Every school record is isolated by a mandatory{' '}
              <span className="font-mono text-xs">schoolId</span> tenant identifier enforced at the Firestore security rules layer.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-slate-900">2. Credential Security</h2>
            <p className="mt-1">
              Authentication is processed by Firebase Authentication using industry-standard salted password hashing.
              SJ Academia One never stores, logs, or displays plaintext user passwords. Administrators may issue
              temporary reset links or temporary credentials that require immediate replacement on sign-in.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-slate-900">3. Notifications & Audit Logs</h2>
            <p className="mt-1">
              Users control their own in-app and browser notification channels. Sensitive administrative
              changes (account creation, marks edits, exam publication, school status updates) are recorded in an
              append-only audit log scoped to authorized administrators.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-slate-50 py-14 px-6">
      <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl p-8 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <Link to="/">
            <BrandLogo size="sm" />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to SJ Academia One
          </Link>
        </div>
        <h1 className="text-2xl font-bold font-display text-slate-900">Terms of Service</h1>
        <p className="text-xs text-slate-500 mt-1">Effective Date: November 2026 · SJ Academia One Platform</p>
        <div className="mt-6 space-y-5 text-sm text-slate-600 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-slate-900">1. Free Access for All Schools</h2>
            <p className="mt-1">
              SJ Academia One is provided completely free of charge for all verified schools, with full access to
              role-based portals, attendance tracking, timetables, homework, exams, and analytics without paid tiers.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-slate-900">2. Authorized Role Use</h2>
            <p className="mt-1">
              Principals are responsible for assigning Coordinator, Teacher, and Student permissions within their
              school. Attempting to access another school’s records or bypassing role restrictions violates platform policy.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
