import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Search,
  AlertCircle,
  XCircle,
  Send,
} from 'lucide-react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, formatFirestoreDateTime } from '../lib/firebase';
import { hashVerificationEmail } from '../lib/schoolProvisioning';
import { Button, StatusText, useToast } from '../components/ui/Primitives';
import { BrandLogo } from '../components/ui/BrandLogo';
import type { ApplicationStatusRecord } from '../types/models';

export default function ApplicationStatusPage() {
  const [searchParams] = useSearchParams();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const [appNumber, setAppNumber] = useState(searchParams.get('ref') || '');
  const [verifyEmail, setVerifyEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [record, setRecord] = useState<ApplicationStatusRecord | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Clarification resubmit state when status === 'more_info_required'
  const [clarificationNote, setClarificationNote] = useState('');
  const [resubmitting, setResubmitting] = useState(false);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setRecord(null);

    const normalizedRef = appNumber.trim().toUpperCase();
    const cleanEmail = verifyEmail.trim().toLowerCase();
    if (normalizedRef.length < 6) {
      setError('Enter your complete Application Number (for example: SCH-2026-XXXXXX or JOIN-2026-XXXXXX).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter the applicant email address used during submission to verify your identity.');
      return;
    }

    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'applicationStatuses', normalizedRef));
      if (!snap.exists()) {
        setError('No matching application was found for that Application Number and email combination.');
        return;
      }
      const data = snap.data() as ApplicationStatusRecord;
      if (data.verificationEmailHash) {
        const expectedHash = await hashVerificationEmail(cleanEmail);
        if (expectedHash !== data.verificationEmailHash) {
          setError('No matching application was found for that Application Number and email combination.');
          return;
        }
      }
      setRecord(data);
    } catch {
      setError('Unable to check application status right now. Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  const handleResubmitInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record || clarificationNote.trim().length < 5) {
      pushToast('error', 'Please provide clear details addressing the reviewer request.');
      return;
    }
    setResubmitting(true);
    try {
      await updateDoc(doc(db, 'applicationStatuses', record.applicationNumber), {
        status: 'submitted',
        applicantResponseNote: clarificationNote.trim().slice(0, 1000),
        updatedAt: serverTimestamp(),
      });
      setRecord((prev) =>
        prev
          ? {
              ...prev,
              status: 'submitted',
              applicantResponseNote: clarificationNote.trim(),
            }
          : prev,
      );
      setClarificationNote('');
      pushToast('success', 'Clarification submitted. Your application is back in the review queue.');
    } catch {
      pushToast('error', 'Could not submit clarification right now.');
    } finally {
      setResubmitting(false);
    }
  };

  const isApproved = record?.status === 'approved';
  const isRejected = record?.status === 'rejected' || record?.status === 'withdrawn';
  const needsInfo = record?.status === 'more_info_required';

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-[#0F295C] text-white border-b border-blue-900/60">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="hover:opacity-90 transition-opacity">
            <BrandLogo size="sm" tone="dark" />
          </Link>
          <div className="flex items-center gap-4 text-xs">
            <Link to="/register-school" className="text-blue-100/80 hover:text-white font-medium">
              Register School
            </Link>
            <Link to="/login" className="text-[#FACC15] hover:text-yellow-300 font-medium">
              Sign In
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to AcademiaOne
        </Link>
        <h1 className="text-2xl font-bold font-display text-slate-900 mt-2">Track Application Status</h1>
        <p className="text-sm text-slate-500 mt-1">
          Enter your Application Number and registered email address to view live status for a School Registration
          (<span className="font-mono text-xs">SCH-...</span>) or a School Member Join Request (
          <span className="font-mono text-xs">JOIN-...</span>).
        </p>

        <form onSubmit={handleLookup} className="mt-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="track-ref" className="block text-xs font-semibold text-slate-700 mb-1">
                Application Number *
              </label>
              <input
                id="track-ref"
                required
                value={appNumber}
                onChange={(e) => setAppNumber(e.target.value.toUpperCase())}
                placeholder="SCH-2026-XXXXXX"
                className="w-full font-mono text-sm uppercase border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
              />
            </div>
            <div>
              <label htmlFor="track-email" className="block text-xs font-semibold text-slate-700 mb-1">
                Registered Applicant Email *
              </label>
              <input
                id="track-email"
                type="email"
                required
                value={verifyEmail}
                onChange={(e) => setVerifyEmail(e.target.value)}
                placeholder="you@school.edu"
                className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">{error}</div>
          )}

          <Button type="submit" variant="navy" className="w-full sm:w-auto" disabled={loading}>
            <Search className="w-4 h-4" />
            {loading ? 'Checking Status…' : 'Check Application Status'}
          </Button>
        </form>

        {record && (
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-6 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <p className="text-xs font-medium text-teal-700">
                  {record.type === 'school' ? 'School Registration Application' : 'School Member Join Request'} ·{' '}
                  <span className="font-mono">{record.applicationNumber}</span>
                </p>
                <h2 className="text-lg font-bold font-display text-slate-900 mt-0.5">{record.schoolName}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Requested Role: <span className="capitalize font-medium text-slate-700">{record.requestedRole}</span>{' '}
                  · Submitted {formatFirestoreDateTime(record.submittedAt || record.createdAt)}
                </p>
              </div>
              <StatusText status={record.status} />
            </div>

            {/* 3-Step Visual Progress */}
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-teal-50/60 border border-teal-200">
                <p className="font-semibold text-teal-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-700" /> 1. Submitted
                </p>
                <p className="text-slate-600 mt-0.5">Application received</p>
              </div>
              <div
                className={`p-3 rounded-lg border ${
                  record.status === 'under_review' || needsInfo || isApproved || isRejected
                    ? 'bg-teal-50/60 border-teal-200'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-teal-700" /> 2. Review
                </p>
                <p className="text-slate-600 mt-0.5">
                  {record.type === 'school' ? 'Main Head check' : 'Principal review'}
                </p>
              </div>
              <div
                className={`p-3 rounded-lg border ${
                  isApproved
                    ? 'bg-emerald-50 border-emerald-200'
                    : isRejected
                      ? 'bg-red-50 border-red-200'
                      : 'bg-slate-50 border-slate-200'
                }`}
              >
                <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                  {isApproved ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  ) : isRejected ? (
                    <XCircle className="w-3.5 h-3.5 text-red-700" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  3. Decision
                </p>
                <p className="text-slate-600 mt-0.5 capitalize">{record.status.replace(/_/g, ' ')}</p>
              </div>
            </div>

            {/* Reviewer Applicant-Visible Message (Never Internal Notes) */}
            {(record.applicantMessage || record.decisionNote) && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700 leading-relaxed">
                <p className="text-xs font-semibold text-slate-900 mb-1">Reviewer Update</p>
                <p>{record.applicantMessage || record.decisionNote}</p>
              </div>
            )}

            {/* Approved School Code Card */}
            {isApproved && record.type === 'school' && record.schoolCode && (
              <div className="p-5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                <p className="text-xs font-semibold text-emerald-800">School Approved · Unique School Code Issued</p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-600">Share this code with staff & students when needed:</p>
                    <p className="text-2xl font-bold font-mono tabular-nums tracking-wider text-[#0B1528] mt-1">
                      {record.schoolCode}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(record.schoolCode || '');
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCode ? 'Copied' : 'Copy Code'}
                  </Button>
                </div>
                <div className="pt-2 flex flex-wrap gap-2.5">
                  <Link to="/login">
                    <Button variant="primary" size="sm">
                      Sign In as Principal (Email/Password or Google)
                    </Button>
                  </Link>
                  <Link to="/signup">
                    <Button variant="secondary" size="sm">
                      First-Time Email & Password Setup
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {/* Approved Member CTA */}
            {isApproved && record.type === 'member' && (
              <div className="p-5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                <p className="text-sm font-semibold text-emerald-900">
                  Approved by {record.schoolName} Principal as {record.requestedRole}.
                </p>
                <p className="text-xs text-slate-700">
                  Sign in using your registered email (Email & Password or Google) to enter your portal automatically.
                </p>
                <Link to="/login">
                  <Button variant="primary" size="sm">
                    Sign In to Portal
                  </Button>
                </Link>
              </div>
            )}

            {/* More Info Required Resubmission Form */}
            {needsInfo && (
              <form onSubmit={handleResubmitInfo} className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3">
                <p className="text-xs font-semibold text-amber-900">Additional Information Requested</p>
                <p className="text-xs text-amber-800">
                  Provide the requested clarification below to move your application back into Main Head review.
                </p>
                <textarea
                  required
                  rows={3}
                  value={clarificationNote}
                  onChange={(e) => setClarificationNote(e.target.value)}
                  placeholder="Enter requested verification details or corrections…"
                  className="w-full text-sm bg-white border border-amber-300 rounded-lg px-3 py-2"
                />
                <Button type="submit" variant="primary" size="sm" disabled={resubmitting}>
                  <Send className="w-3.5 h-3.5" />
                  {resubmitting ? 'Resubmitting…' : 'Submit Clarification'}
                </Button>
              </form>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
