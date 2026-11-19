import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  GraduationCap,
  LogOut,
  RefreshCw,
  Search,
  UserCog,
  Users,
} from 'lucide-react';
import { collection, doc, getDoc, onSnapshot, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, generateId, formatFirestoreDate } from '../lib/firebase';
import { ROLE_HOME_ROUTES } from '../lib/permissions';
import { generateApplicationNumber, hashVerificationEmail } from '../lib/schoolProvisioning';
import { useAuth } from '../contexts/AuthContext';
import { Button, StatusText, useToast } from '../components/ui/Primitives';
import type { SchoolCodeEntry, SchoolJoinRequest } from '../types/models';

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
  const { pushToast } = useToast();

  const [schoolCodeInput, setSchoolCodeInput] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [verifiedSchool, setVerifiedSchool] = useState<SchoolCodeEntry | null>(null);
  const [codeError, setCodeError] = useState('');

  const [selectedRole, setSelectedRole] = useState<'coordinator' | 'teacher' | 'student'>('student');
  const [fullName, setFullName] = useState(activeUser?.displayName || '');
  const [phone, setPhone] = useState(activeUser?.phone || '');
  const [classOrDeptInfo, setClassOrDeptInfo] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [myRequests, setMyRequests] = useState<SchoolJoinRequest[]>([]);

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

  const handleRecheckEmail = async () => {
    setRechecking(true);
    try {
      const updated = await refreshProfile();
      if (updated && updated.schoolId && updated.schoolId !== 'unassigned') {
        pushToast('success', `Email matched! Entering your ${updated.role} portal.`);
        navigate(ROLE_HOME_ROUTES[updated.role]);
      } else {
        pushToast('info', 'No pre-registered school match found yet. Use a School Code below to apply.');
      }
    } finally {
      setRechecking(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError('');
    setVerifiedSchool(null);
    const code = schoolCodeInput.trim().toUpperCase();
    if (code.length < 3) {
      setCodeError('Enter a valid School Code (e.g., ACA-7482 or NRPA-2026).');
      return;
    }
    setVerifyingCode(true);
    try {
      const snap = await getDoc(doc(db, 'schoolCodes', code));
      if (!snap.exists()) {
        setCodeError('School Code not found. Confirm the exact code issued to your school.');
        return;
      }
      const entry = snap.data() as SchoolCodeEntry;
      if (entry.status === 'suspended' || entry.status === 'archived') {
        setCodeError(`"${entry.schoolName}" is currently not accepting new join requests (${entry.status}).`);
        return;
      }
      setVerifiedSchool(entry);
    } catch {
      setCodeError('Unable to verify School Code right now.');
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleSubmitJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUser || !verifiedSchool) return;
    if (fullName.trim().length < 2) {
      pushToast('error', 'Enter your full name.');
      return;
    }
    setSubmitting(true);
    const reqId = generateId('jreq');
    const applicationNumber = generateApplicationNumber('JOIN');
    const submittedIso = new Date().toISOString();

    try {
      const verificationEmailHash = await hashVerificationEmail(activeUser.email);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      batch.set(doc(db, 'schoolJoinRequests', reqId), {
        id: reqId,
        applicationNumber,
        schoolId: verifiedSchool.schoolId,
        schoolCode: verifiedSchool.code,
        schoolName: verifiedSchool.schoolName,
        applicantUid: activeUser.uid,
        applicantEmail: activeUser.email.toLowerCase(),
        applicantName: fullName.trim().slice(0, 120),
        phone: phone.trim().slice(0, 32),
        requestedRole: selectedRole,
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
        requestedRole: selectedRole,
        status: 'pending',
        schoolCode: '',
        applicantMessage: `Your ${selectedRole} join request has been sent to the Principal of ${verifiedSchool.schoolName}.`,
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
          <h1 className="text-lg font-bold font-display text-slate-900">Sign In Required</h1>
          <p className="text-sm text-slate-500 mt-2">
            Sign in with Email & Password or Google first so we can check your email against registered schools.
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

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-[#0B1528] text-white border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="font-display font-extrabold text-lg tracking-tight">
            AcademiaOne
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
            <p className="text-xs font-semibold text-teal-700">Email Not Pre-Registered in Any School</p>
            <h1 className="text-xl font-bold font-display text-slate-900 mt-0.5">Join Your School with a School Code</h1>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              We checked <span className="font-mono text-slate-800">{activeUser.email}</span> across all active schools.
              If your Principal already added your email, refresh below—otherwise enter your School Code to apply as a
              Coordinator, Teacher, or Student.
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
              Once the Principal approves your <strong className="capitalize">{selectedRole}</strong> request, sign in
              again (or click Re-check My Email above) to enter your portal automatically.
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
                  setVerifiedSchool(null);
                  setSchoolCodeInput('');
                }}
              >
                Apply to Another School
              </Button>
            </div>
          </div>
        ) : (
          /* Step 1: Enter School Code + Step 2: Role Selection */
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <form onSubmit={handleVerifyCode} className="space-y-3">
              <label htmlFor="school-code" className="block text-xs font-semibold text-slate-700">
                Step 1 — Enter Your School Code
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  id="school-code"
                  value={schoolCodeInput}
                  onChange={(e) => setSchoolCodeInput(e.target.value.toUpperCase())}
                  placeholder="e.g., ACA-7482 or NRPA-2026"
                  className="flex-1 font-mono text-sm uppercase border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                />
                <Button type="submit" variant="navy" disabled={verifyingCode}>
                  <Search className="w-4 h-4" />
                  {verifyingCode ? 'Verifying…' : 'Verify School Code'}
                </Button>
              </div>
              {codeError && <p className="text-xs text-red-700">{codeError}</p>}
            </form>

            {verifiedSchool && (
              <form onSubmit={handleSubmitJoin} className="pt-5 border-t border-slate-200 space-y-5">
                <div className="p-4 rounded-xl bg-teal-50/60 border border-teal-200 flex items-center gap-3">
                  <Building2 className="w-5 h-5 text-teal-700 shrink-0" />
                  <div>
                    <p className="text-xs text-teal-800 font-medium">Verified School</p>
                    <p className="text-sm font-bold text-slate-900">
                      {verifiedSchool.schoolName} · <span className="font-mono text-xs">{verifiedSchool.code}</span>
                    </p>
                  </div>
                </div>

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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number (Optional)</label>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {selectedRole === 'student'
                        ? 'Expected Class / Section or Admission Reference'
                        : selectedRole === 'teacher'
                          ? 'Primary Subject(s) / Department'
                          : 'Grade Levels / Wing to Coordinate'}
                    </label>
                    <input
                      value={classOrDeptInfo}
                      onChange={(e) => setClassOrDeptInfo(e.target.value)}
                      placeholder={
                        selectedRole === 'student'
                          ? 'e.g., Grade 10 Section A'
                          : selectedRole === 'teacher'
                            ? 'e.g., Physics & Mathematics'
                            : 'e.g., Senior Wing Grades 9–12'
                      }
                      className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
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
                    {submitting ? 'Submitting to Principal…' : `Send ${selectedRole} Application to Principal`}
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
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Ref <span className="font-mono text-slate-700">{req.applicationNumber}</span> · Submitted{' '}
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
