import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  GraduationCap,
  KeyRound,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { collection, doc, onSnapshot, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, generateId, formatFirestoreDate } from '../lib/firebase';
import { ROLE_HOME_ROUTES } from '../lib/permissions';
import { generateApplicationNumber, hashVerificationEmail } from '../lib/schoolProvisioning';
import {
  isValidPhoneDigits,
  resolveSchoolAccessCode,
  sanitizePhoneDigits,
  type ResolvedAccessCode,
} from '../lib/schoolCodes';
import { useAuth } from '../contexts/AuthContext';
import { Button, StatusText, useToast } from '../components/ui/Primitives';
import { BrandLogo } from '../components/ui/BrandLogo';
import type { SchoolJoinRequest } from '../types/models';

const JOIN_ROLES = [
  {
    id: 'coordinator' as const,
    title: 'Coordinator',
    desc: 'Academic monitoring across Principal-assigned classes, timetables, and exams.',
    icon: UserCog,
  },
  {
    id: 'teacher' as const,
    title: 'Teacher',
    desc: 'Attendance marking, homework reviews, exam marks entry, and study materials.',
    icon: Users,
  },
  {
    id: 'student' as const,
    title: 'Student',
    desc: 'Class timetable, online homework submissions, published results, and attendance log.',
    icon: GraduationCap,
  },
];

export default function JoinSchoolPage() {
  const { activeUser, logout, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { pushToast } = useToast();

  const initialQueryCode = (searchParams.get('code') || '').trim().toUpperCase();

  const [schoolCodeInput, setSchoolCodeInput] = useState(initialQueryCode);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [resolved, setResolved] = useState<ResolvedAccessCode | null>(null);
  const [codeError, setCodeError] = useState('');

  const [selectedRole, setSelectedRole] = useState<'coordinator' | 'teacher' | 'student'>('student');
  const [fullName, setFullName] = useState(activeUser?.displayName || '');
  const [phone, setPhone] = useState(sanitizePhoneDigits(activeUser?.phone || ''));
  const [classOrDeptInfo, setClassOrDeptInfo] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [myRequests, setMyRequests] = useState<SchoolJoinRequest[]>([]);

  const verifyCodeValue = useCallback(async (rawCode: string) => {
    setCodeError('');
    setResolved(null);
    const trimmed = rawCode.trim().toUpperCase().replace(/\s+/g, '');
    if (trimmed.length < 2) {
      setCodeError('Enter your School Access Code (e.g., JSS0001, JSSC01, JSST01, or JSSS001).');
      return;
    }
    setVerifyingCode(true);
    try {
      const outcome = await resolveSchoolAccessCode(trimmed);
      if (outcome.ok === false) {
        setCodeError(outcome.error);
        return;
      }
      setResolved(outcome);
      if (outcome.mode === 'role_code' && outcome.role && outcome.role !== 'principal') {
        setSelectedRole(outcome.role);
        if (outcome.role === 'student' && outcome.assignedClass) {
          setClassOrDeptInfo(
            `${outcome.assignedClass.className} (Roll #${outcome.assignedRollNumber || '01'})`,
          );
        } else if (
          outcome.role === 'coordinator' &&
          outcome.assignedCoordinatorClasses &&
          outcome.assignedCoordinatorClasses.length > 0
        ) {
          const grades = Array.from(new Set(outcome.assignedCoordinatorClasses.map((c) => c.gradeLevel)));
          setClassOrDeptInfo(grades.join(', '));
        } else {
          setClassOrDeptInfo('');
        }
      }
    } finally {
      setVerifyingCode(false);
    }
  }, []);

  useEffect(() => {
    if (!activeUser) return;
    if (activeUser.role === 'main_head' || (activeUser.schoolId && activeUser.schoolId !== 'unassigned')) {
      navigate(ROLE_HOME_ROUTES[activeUser.role], { replace: true });
      return;
    }
    setFullName((prev) => prev || activeUser.displayName);

    const q = query(collection(db, 'schoolJoinRequests'), where('applicantUid', '==', activeUser.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMyRequests(snap.docs.map((d) => d.data() as SchoolJoinRequest));
      },
      () => undefined,
    );
    return () => unsub();
  }, [activeUser, navigate]);

  // Auto-verify if `?code=...` was passed from SignUpPage
  useEffect(() => {
    if (activeUser && initialQueryCode && !resolved && !verifyingCode) {
      void verifyCodeValue(initialQueryCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUser, initialQueryCode]);

  const handleRecheckEmail = async () => {
    setRechecking(true);
    try {
      const updated = await refreshProfile();
      if (updated && updated.schoolId && updated.schoolId !== 'unassigned') {
        pushToast('success', `Email matched! Entering your ${updated.role} portal.`);
        navigate(ROLE_HOME_ROUTES[updated.role]);
      } else {
        pushToast('info', 'No pre-registered school match found yet. Use your School Access Code below to continue.');
      }
    } finally {
      setRechecking(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    await verifyCodeValue(schoolCodeInput);
  };

  const handleSubmitJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUser || !resolved) return;
    if (resolved.role === 'principal') return;
    if (fullName.trim().length < 2) {
      pushToast('error', 'Enter your full name.');
      return;
    }
    if (phone.trim() && !isValidPhoneDigits(phone.trim())) {
      pushToast('error', 'Phone number must contain strictly 10 to 15 numeric digits (numbers only).');
      return;
    }

    const effectiveRole: 'coordinator' | 'teacher' | 'student' =
      resolved.mode === 'role_code' && resolved.role ? resolved.role : selectedRole;

    setSubmitting(true);
    const reqId = generateId('jreq');
    const applicationNumber = generateApplicationNumber('JOIN');
    const submittedIso = new Date().toISOString();
    const verifiedSchool = resolved.schoolEntry;

    try {
      const verificationEmailHash = await hashVerificationEmail(activeUser.email);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      batch.set(doc(db, 'schoolJoinRequests', reqId), {
        id: reqId,
        applicationNumber,
        schoolId: verifiedSchool.schoolId,
        schoolCode: verifiedSchool.code,
        accessCode: resolved.canonicalCode,
        schoolName: verifiedSchool.schoolName,
        applicantUid: activeUser.uid,
        applicantEmail: activeUser.email.toLowerCase(),
        applicantName: fullName.trim().slice(0, 120),
        phone: sanitizePhoneDigits(phone),
        requestedRole: effectiveRole,
        requestedClassId: resolved.assignedClass?.classId || '',
        requestedSection: resolved.assignedClass?.section || '',
        requestedClassInfo: classOrDeptInfo.trim().slice(0, 120),
        note: note.trim().slice(0, 500),
        status: 'pending',
        decisionNote: '',
        reviewedBy: '',
        createdAt: now,
        updatedAt: now,
      });

      batch.set(doc(db, 'applicationStatuses', applicationNumber), {
        applicationNumber,
        type: 'member',
        verificationEmailHash,
        schoolId: verifiedSchool.schoolId,
        schoolName: verifiedSchool.schoolName,
        requestedRole: effectiveRole,
        status: 'pending',
        schoolCode: '',
        applicantMessage: `Your ${effectiveRole} join request (Code ${resolved.canonicalCode}) has been sent to the Principal of ${verifiedSchool.schoolName}.`,
        decisionNote: '',
        applicantResponseNote: '',
        submittedAt: submittedIso,
        createdAt: now,
        updatedAt: now,
      });

      await batch.commit();
      setSubmittedRef(applicationNumber);
      pushToast('success', `Join application ${applicationNumber} sent to ${verifiedSchool.schoolName} Principal.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to submit join request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!activeUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center">
          <div className="flex justify-center mb-4">
            <BrandLogo size="lg" />
          </div>
          <h1 className="text-lg font-bold font-display text-slate-900">Sign In Required</h1>
          <p className="text-sm text-slate-500 mt-2">
            Sign in with Email &amp; Password or Google first so we can link your School Access Code to your account.
          </p>
          <div className="mt-5">
            <Link to="/login">
              <Button variant="primary">Go to Sign In</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const verifiedSchool = resolved?.schoolEntry || null;
  const effectiveRole: 'coordinator' | 'teacher' | 'student' =
    resolved?.mode === 'role_code' && resolved.role && resolved.role !== 'principal'
      ? resolved.role
      : selectedRole;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-[#0B1528] text-white border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="hover:opacity-90 transition-opacity">
            <BrandLogo size="sm" tone="dark" />
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-300 hidden sm:inline">{activeUser.email}</span>
            <Link to="/application-status" className="text-teal-300 hover:text-teal-200 font-medium">
              Track Application
            </Link>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="inline-flex items-center gap-1 text-slate-300 hover:text-white cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 space-y-6">
        {/* Email Check Banner */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-teal-700">Role-Based School Code Verification</p>
            <h1 className="text-xl font-bold font-display text-slate-900 mt-0.5">
              Enter Your School Access Code to Continue
            </h1>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              Signed in as <span className="font-mono text-slate-800">{activeUser.email}</span>. Enter your school&apos;s
              role-specific access code below — the system automatically detects your school, role, and assigned class.
            </p>
          </div>
          <Button variant="secondary" size="sm" disabled={rechecking} onClick={handleRecheckEmail}>
            <RefreshCw className={`w-3.5 h-3.5 ${rechecking ? 'animate-spin' : ''}`} />
            {rechecking ? 'Checking…' : 'Re-check My Email'}
          </Button>
        </div>

        {/* Success Receipt */}
        {submittedRef ? (
          <div className="bg-white border border-slate-200 rounded-xl p-7 space-y-4">
            <div className="flex items-center gap-2.5 text-emerald-700">
              <CheckCircle2 className="w-6 h-6" />
              <h2 className="text-lg font-bold font-display text-slate-900">
                Application Sent to {verifiedSchool?.schoolName} Principal
              </h2>
            </div>
            <p className="text-sm text-slate-600">
              Your <strong className="capitalize">{effectiveRole}</strong> request using code{' '}
              <span className="font-mono font-semibold text-slate-900">{resolved?.canonicalCode}</span>
              {resolved?.assignedClass ? ` (${resolved.assignedClass.className})` : ''} has been submitted. Once
              approved by your Principal, sign in again or click Re-check My Email above.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">Your Join Application Number</p>
                <p className="text-lg font-bold font-mono tabular-nums text-[#0B1528] mt-0.5">{submittedRef}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(submittedRef);
                  setCopiedRef(true);
                  setTimeout(() => setCopiedRef(false), 2000);
                }}
              >
                {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedRef ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link to={`/application-status?ref=${encodeURIComponent(submittedRef)}`}>
                <Button variant="primary" size="sm">
                  Track Application Status
                </Button>
              </Link>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSubmittedRef(null);
                  setResolved(null);
                  setSchoolCodeInput('');
                }}
              >
                Use Another Access Code
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <form onSubmit={handleVerifyCode} className="space-y-3">
              <label htmlFor="school-code" className="block text-xs font-semibold text-slate-700">
                Step 1 — Enter Your Role-Specific School Access Code
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  id="school-code"
                  value={schoolCodeInput}
                  onChange={(e) => setSchoolCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                  placeholder="Enter your school access code"
                  className="flex-1 font-mono text-sm uppercase border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                />
                <Button type="submit" variant="navy" disabled={verifyingCode}>
                  <Search className="w-4 h-4" />
                  {verifyingCode ? 'Identifying…' : 'Verify Access Code'}
                </Button>
              </div>

              {codeError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {codeError}
                </div>
              )}
            </form>

            {/* Principal Code Verified Card */}
            {resolved && verifiedSchool && resolved.role === 'principal' && (
              <div className="pt-5 border-t border-slate-200 space-y-4">
                <div className="p-5 rounded-xl bg-teal-50/70 border border-teal-200 space-y-2">
                  <div className="flex items-center gap-2.5 text-teal-800">
                    <ShieldCheck className="w-5 h-5 shrink-0" />
                    <p className="text-xs font-bold uppercase tracking-wide">Principal Access Code Verified</p>
                  </div>
                  <p className="text-base font-bold font-display text-slate-900">
                    {verifiedSchool.schoolName} · <span className="font-mono text-teal-800">{resolved.canonicalCode}</span>
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Principal portal access is automatically activated on the official Principal email registered during
                    school approval. If your school was just approved by the Main Head, click{' '}
                    <strong>Activate Principal Portal</strong> below — or sign in with the registered Principal email
                    address.
                  </p>
                  <div className="pt-2 flex flex-wrap gap-2.5">
                    <Button variant="primary" size="sm" disabled={rechecking} onClick={handleRecheckEmail}>
                      <RefreshCw className={`w-3.5 h-3.5 ${rechecking ? 'animate-spin' : ''}`} />
                      Activate Principal Portal
                    </Button>
                    <Link to="/application-status">
                      <Button variant="secondary" size="sm">
                        Check School Approval Status
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Coordinator / Teacher / Student Verification & Application Form */}
            {resolved && verifiedSchool && resolved.role !== 'principal' && (
              <form onSubmit={handleSubmitJoin} className="pt-5 border-t border-slate-200 space-y-5">
                {/* Auto-Identified School, Role & Class Summary Card */}
                <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Building2 className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[11px] text-teal-800 font-semibold uppercase tracking-wide">
                          {resolved.mode === 'role_code'
                            ? 'Automatically Identified from Access Code'
                            : 'Verified School'}
                        </p>
                        <p className="text-base font-bold font-display text-slate-900 mt-0.5">
                          {verifiedSchool.schoolName}
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5">
                          School Prefix: <span className="font-mono font-semibold text-slate-900">{verifiedSchool.code}</span>
                          {resolved.mode === 'role_code' && (
                            <>
                              {' '}
                              · Code: <span className="font-mono font-semibold text-teal-800">{resolved.canonicalCode}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    {resolved.mode === 'role_code' && resolved.role && (
                      <div className="bg-white border border-teal-200 rounded-lg px-3 py-2 text-right">
                        <p className="text-[11px] text-slate-500">Identified Role</p>
                        <p className="text-sm font-bold text-teal-800 capitalize">
                          {resolved.role}{' '}
                          <span className="font-mono text-xs font-normal text-slate-500 tabular-nums">
                            (#{resolved.sequenceIndex} of {resolved.roleTotalCount})
                          </span>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Student Auto-Identified Class & Section */}
                  {resolved.role === 'student' && resolved.assignedClass && (
                    <div className="bg-white border border-teal-200/90 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <GraduationCap className="w-4 h-4 text-teal-700 shrink-0" />
                        <span className="text-slate-600">Assigned Class &amp; Section:</span>
                        <strong className="text-slate-900">{resolved.assignedClass.className}</strong>
                      </div>
                      <span className="font-mono font-semibold text-teal-800 tabular-nums">
                        Roll #{resolved.assignedRollNumber}
                      </span>
                    </div>
                  )}

                  {/* Coordinator Auto-Identified Class Scope */}
                  {resolved.role === 'coordinator' &&
                    resolved.assignedCoordinatorClasses &&
                    resolved.assignedCoordinatorClasses.length > 0 && (
                      <div className="bg-white border border-teal-200/90 rounded-lg p-3 text-xs flex items-start gap-2">
                        <KeyRound className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-slate-600">Assigned Coordination Scope: </span>
                          <strong className="text-slate-900">
                            {Array.from(new Set(resolved.assignedCoordinatorClasses.map((c) => c.gradeLevel))).join(', ')}
                          </strong>{' '}
                          <span className="text-slate-500 tabular-nums">
                            ({resolved.assignedCoordinatorClasses.length} sections)
                          </span>
                        </div>
                      </div>
                    )}
                </div>

                {/* Role Picker only for legacy bare school codes */}
                {resolved.mode === 'legacy_school_code' && (
                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-2.5">
                      Step 2 — Choose Your Role at {verifiedSchool.schoolName}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {JOIN_ROLES.map((r) => {
                        const Icon = r.icon;
                        const active = selectedRole === r.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setSelectedRole(r.id)}
                            className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                              active
                                ? 'border-teal-600 bg-teal-50/50'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                          >
                            <Icon className={`w-4 h-4 ${active ? 'text-teal-700' : 'text-slate-500'}`} />
                            <p className="text-sm font-bold text-slate-900 mt-2">{r.title}</p>
                            <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{r.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                    <input
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Phone Number <span className="font-normal text-slate-400">(Numbers only, optional)</span>
                    </label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={15}
                      value={phone}
                      onChange={(e) => setPhone(sanitizePhoneDigits(e.target.value))}
                      placeholder="9876543210"
                      className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {effectiveRole === 'student'
                        ? resolved.assignedClass
                          ? 'Auto-Identified Class & Section'
                          : 'Expected Class / Section or Admission Reference'
                        : effectiveRole === 'teacher'
                          ? 'Primary Subject(s) / Department'
                          : 'Assigned Grade Levels / Wing'}
                    </label>
                    <input
                      value={classOrDeptInfo}
                      readOnly={effectiveRole === 'student' && Boolean(resolved.assignedClass)}
                      onChange={(e) => setClassOrDeptInfo(e.target.value)}
                      placeholder={
                        effectiveRole === 'student'
                          ? 'e.g., Class 1 - Section A'
                          : effectiveRole === 'teacher'
                            ? 'e.g., Physics & Mathematics'
                            : 'e.g., Classes 1–4'
                      }
                      className={`w-full text-sm border rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600 ${
                        effectiveRole === 'student' && resolved.assignedClass
                          ? 'bg-slate-50 border-slate-200 text-slate-700 font-medium'
                          : 'border-slate-300'
                      }`}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Note for Principal (Optional)</label>
                    <textarea
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add any ID or verification details to help your Principal approve quickly…"
                      className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" variant="primary" disabled={submitting}>
                    {submitting
                      ? 'Submitting to Principal…'
                      : `Confirm & Send ${effectiveRole.charAt(0).toUpperCase() + effectiveRole.slice(1)} Application`}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Applicant's Existing Join Applications */}
        {myRequests.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-sm font-bold font-display text-slate-900 mb-3">Your Submitted School Applications</h2>
            <div className="divide-y divide-slate-100">
              {myRequests.map((req) => (
                <div key={req.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {req.schoolName} · <span className="capitalize">{req.requestedRole}</span>
                      {req.accessCode && (
                        <span className="ml-2 font-mono text-xs text-teal-700">{req.accessCode}</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Ref <span className="font-mono text-slate-700">{req.applicationNumber}</span>
                      {req.requestedClassInfo ? ` · ${req.requestedClassInfo}` : ''} · Submitted{' '}
                      {formatFirestoreDate(req.createdAt)}
                    </p>
                    {req.decisionNote && <p className="text-xs text-slate-600 mt-1">Note: {req.decisionNote}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusText status={req.status} />
                    <Link
                      to={`/application-status?ref=${encodeURIComponent(req.applicationNumber)}`}
                      className="text-xs font-semibold text-teal-700 hover:text-teal-800"
                    >
                      View Status →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

