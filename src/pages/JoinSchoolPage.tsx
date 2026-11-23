import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
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
  verifyStudentFourCodes,
  type ResolvedAccessCode,
  type VerifiedStudentFourCodes,
} from '../lib/schoolCodes';
import { useAuth } from '../contexts/AuthContext';
import { Button, StatusText, useToast } from '../components/ui/Primitives';
import { BrandLogo } from '../components/ui/BrandLogo';
import type { SchoolApplication, SchoolJoinRequest } from '../types/models';

const STAFF_JOIN_ROLES = [
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
];

export default function JoinSchoolPage() {
  const { activeUser, logout, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { pushToast } = useToast();

  const initialQueryCode = (searchParams.get('code') || '').trim().toUpperCase();

  const [joinMode, setJoinMode] = useState<'student_four_codes' | 'staff_single_code'>(
    initialQueryCode ? 'staff_single_code' : 'student_four_codes',
  );

  // Student 4-code inputs
  const [stSchoolCode, setStSchoolCode] = useState('');
  const [stClassCode, setStClassCode] = useState('');
  const [stTeacherCode, setStTeacherCode] = useState('');
  const [stStudentCode, setStStudentCode] = useState('');
  const [verifyingFourCodes, setVerifyingFourCodes] = useState(false);
  const [verifiedStudent, setVerifiedStudent] = useState<VerifiedStudentFourCodes | null>(null);
  const [fourCodeError, setFourCodeError] = useState('');

  // Staff / single access code state
  const [schoolCodeInput, setSchoolCodeInput] = useState(initialQueryCode);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [resolved, setResolved] = useState<ResolvedAccessCode | null>(null);
  const [codeError, setCodeError] = useState('');

  const [selectedRole, setSelectedRole] = useState<'coordinator' | 'teacher'>('teacher');
  const [fullName, setFullName] = useState(activeUser?.displayName || '');
  const [phone, setPhone] = useState(sanitizePhoneDigits(activeUser?.phone || ''));
  const [classOrDeptInfo, setClassOrDeptInfo] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<{
    applicationNumber: string;
    schoolName: string;
    role: 'coordinator' | 'teacher' | 'student';
    codeLabel: string;
    teacherName?: string;
  } | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [myRequests, setMyRequests] = useState<SchoolJoinRequest[]>([]);
  const [mySchoolApps, setMySchoolApps] = useState<SchoolApplication[]>([]);

  const verifyCodeValue = useCallback(async (rawCode: string) => {
    setCodeError('');
    setResolved(null);
    const trimmed = rawCode.trim().toUpperCase().replace(/\s+/g, '');
    if (trimmed.length < 2) {
      setCodeError('Enter your School Access Code.');
      return;
    }
    setVerifyingCode(true);
    try {
      const outcome = await resolveSchoolAccessCode(trimmed);
      if (outcome.ok === false) {
        setCodeError(outcome.error);
        return;
      }

      // Students must use the 4-code verification tab (School + Class + Teacher + Student Code)
      if (outcome.role === 'student') {
        setStSchoolCode(outcome.schoolEntry.code);
        setStStudentCode(outcome.canonicalCode);
        if (outcome.assignedClass?.classCode) {
          setStClassCode(outcome.assignedClass.classCode);
        }
        if (outcome.memberCodeRecord?.teacherCode) {
          setStTeacherCode(outcome.memberCodeRecord.teacherCode);
        }
        setJoinMode('student_four_codes');
        setFourCodeError('');
        return;
      }

      setResolved(outcome);
      if (outcome.memberCodeRecord?.memberName) {
        setFullName((prev) => prev || outcome.memberCodeRecord?.memberName || '');
      }
      if ((outcome.mode === 'role_code' || outcome.mode === 'named_member_code') && outcome.role && outcome.role !== 'principal') {
        setSelectedRole(outcome.role);
        if (
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
    const appQ = query(collection(db, 'schoolApplications'), where('applicantUid', '==', activeUser.uid));
    const unsubApps = onSnapshot(
      appQ,
      (snap) => {
        setMySchoolApps(snap.docs.map((d) => d.data() as SchoolApplication));
      },
      () => undefined,
    );
    return () => {
      unsub();
      unsubApps();
    };
  }, [activeUser, navigate]);

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
        pushToast('info', 'No approved school placement yet. Verify your access codes below or check your application status.');
      }
    } finally {
      setRechecking(false);
    }
  };

  const handleVerifyFourCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    setFourCodeError('');
    setVerifiedStudent(null);
    setVerifyingFourCodes(true);
    try {
      const res = await verifyStudentFourCodes({
        schoolCode: stSchoolCode,
        classCode: stClassCode,
        teacherCode: stTeacherCode,
        studentCode: stStudentCode,
      });
      if (res.ok === false) {
        setFourCodeError(res.error);
        return;
      }
      setVerifiedStudent(res);
      if (res.studentName) {
        setFullName(res.studentName);
      }
      setClassOrDeptInfo(
        `${res.classSlot.className || res.classCode}${res.rollNumber ? ` (Roll #${res.rollNumber})` : ''}`,
      );
    } finally {
      setVerifyingFourCodes(false);
    }
  };

  const handleSubmitStudentJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUser || !verifiedStudent) return;
    if (fullName.trim().length < 2) {
      pushToast('error', 'Enter your full name.');
      return;
    }
    if (phone.trim() && !isValidPhoneDigits(phone.trim())) {
      pushToast('error', 'Phone number must contain strictly 10 to 15 numeric digits.');
      return;
    }

    setSubmitting(true);
    const reqId = generateId('jreq');
    const applicationNumber = generateApplicationNumber('JOIN');
    const submittedIso = new Date().toISOString();
    const { schoolEntry, classSlot, classCode, teacherCode, teacherName, teacherId, teacherUid, studentCode } =
      verifiedStudent;

    try {
      const verificationEmailHash = await hashVerificationEmail(activeUser.email);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      batch.set(doc(db, 'schoolJoinRequests', reqId), {
        id: reqId,
        applicationNumber,
        schoolId: schoolEntry.schoolId,
        schoolCode: schoolEntry.code,
        accessCode: studentCode,
        classCode,
        teacherCode,
        studentCode,
        targetTeacherId: teacherId,
        targetTeacherUid: teacherUid,
        targetTeacherName: teacherName,
        schoolName: schoolEntry.schoolName,
        applicantUid: activeUser.uid,
        applicantEmail: activeUser.email.toLowerCase(),
        applicantName: fullName.trim().slice(0, 120),
        phone: sanitizePhoneDigits(phone),
        requestedRole: 'student',
        requestedClassId: classSlot.classId || '',
        requestedSection: classSlot.section || '',
        requestedClassInfo: classOrDeptInfo.trim().slice(0, 120) || `${classSlot.className || classCode}`,
        note: note.trim().slice(0, 500),
        status: 'pending',
        approvalStage: 'teacher_pending',
        decisionNote: '',
        reviewedBy: '',
        createdAt: now,
        updatedAt: now,
      });

      batch.set(doc(db, 'applicationStatuses', applicationNumber), {
        applicationNumber,
        type: 'member',
        verificationEmailHash,
        schoolId: schoolEntry.schoolId,
        schoolName: schoolEntry.schoolName,
        requestedRole: 'student',
        status: 'pending',
        schoolCode: schoolEntry.code,
        applicantMessage: `Submitted — awaiting Class Teacher (${teacherName} · ${teacherCode}) approval (Stage 1 of 3).`,
        decisionNote: '',
        applicantResponseNote: '',
        submittedAt: submittedIso,
        createdAt: now,
        updatedAt: now,
      });

      await batch.commit();
      setSubmittedRef({
        applicationNumber,
        schoolName: schoolEntry.schoolName,
        role: 'student',
        codeLabel: `${schoolEntry.code} · ${classCode} · ${teacherCode} · ${studentCode}`,
        teacherName,
      });
      pushToast('success', `Student join request ${applicationNumber} sent to ${teacherName} (Stage 1 of 3).`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to submit student join request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    await verifyCodeValue(schoolCodeInput);
  };

  const handleSubmitStaffJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUser || !resolved) return;
    if (resolved.role === 'principal' || resolved.role === 'student') return;
    if (fullName.trim().length < 2) {
      pushToast('error', 'Enter your full name.');
      return;
    }
    if (phone.trim() && !isValidPhoneDigits(phone.trim())) {
      pushToast('error', 'Phone number must contain strictly 10 to 15 numeric digits.');
      return;
    }

    const effectiveRole: 'coordinator' | 'teacher' =
      (resolved.mode === 'role_code' || resolved.mode === 'named_member_code') &&
      (resolved.role === 'coordinator' || resolved.role === 'teacher')
        ? resolved.role
        : selectedRole;

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
        approvalStage: 'principal_pending',
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
        schoolCode: verifiedSchool.code,
        applicantMessage: `Your ${effectiveRole} join request (Code ${resolved.canonicalCode}) has been sent to the Principal of ${verifiedSchool.schoolName}.`,
        decisionNote: '',
        applicantResponseNote: '',
        submittedAt: submittedIso,
        createdAt: now,
        updatedAt: now,
      });

      await batch.commit();
      setSubmittedRef({
        applicationNumber,
        schoolName: verifiedSchool.schoolName,
        role: effectiveRole,
        codeLabel: resolved.canonicalCode,
      });
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
            Sign in with Email &amp; Password or Google first so we can verify your school codes and link your account.
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
  const effectiveStaffRole: 'coordinator' | 'teacher' =
    (resolved?.mode === 'role_code' || resolved?.mode === 'named_member_code') &&
    (resolved.role === 'coordinator' || resolved.role === 'teacher')
      ? resolved.role
      : selectedRole;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-[#0F295C] text-white border-b border-blue-900/60">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="hover:opacity-90 transition-opacity">
            <BrandLogo size="sm" tone="dark" />
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-blue-100/80 hidden sm:inline">{activeUser.email}</span>
            <Link to="/application-status" className="text-[#FACC15] hover:text-yellow-300 font-medium">
              Track Application
            </Link>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="inline-flex items-center gap-1 text-blue-100/80 hover:text-white cursor-pointer"
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
            <p className="text-xs font-semibold text-teal-700">Verified School Onboarding</p>
            <h1 className="text-xl font-bold font-display text-slate-900 mt-0.5">
              Join Your School Portal
            </h1>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              Signed in as <span className="font-mono text-slate-800">{activeUser.email}</span>. Students verify using
              all 4 codes (School, Class, Teacher, and personal Student Code obtained from their class teacher). Staff
              enter their assigned Coordinator or Teacher role code.
            </p>
          </div>
          <Button variant="secondary" size="sm" disabled={rechecking} onClick={handleRecheckEmail}>
            <RefreshCw className={`w-3.5 h-3.5 ${rechecking ? 'animate-spin' : ''}`} />
            {rechecking ? 'Checking…' : 'Re-check My Email'}
          </Button>
        </div>

        {/* School Registration Application Status Banner (for Principals awaiting Main Head approval) */}
        {mySchoolApps.length > 0 && (
          <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[#0F295C] uppercase tracking-wide">
                  Your School Registration Application
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Once the Main Head approves your school registration, click <strong>Activate Principal Portal</strong>{' '}
                  below to open your Principal dashboard immediately.
                </p>
              </div>
              <Button variant="primary" size="sm" disabled={rechecking} onClick={handleRecheckEmail}>
                <RefreshCw className={`w-3.5 h-3.5 ${rechecking ? 'animate-spin' : ''}`} />
                Activate Principal Portal
              </Button>
            </div>
            <div className="space-y-2">
              {mySchoolApps.map((app) => (
                <div
                  key={app.id}
                  className="bg-white border border-blue-200/80 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <p className="font-bold text-slate-900">{app.schoolName}</p>
                    <p className="text-slate-500 mt-0.5">
                      Ref: <span className="font-mono font-semibold text-slate-800">{app.applicationNumber}</span> ·
                      Principal: {app.principalEmail}
                      {app.approvedSchoolCode ? (
                        <>
                          {' '}
                          · School Code:{' '}
                          <span className="font-mono font-bold text-teal-700">{app.approvedSchoolCode}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusText status={app.status} />
                    <Link to={`/application-status?ref=${encodeURIComponent(app.applicationNumber)}`}>
                      <Button variant="secondary" size="sm">
                        Track Status
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Success Receipt */}
        {submittedRef ? (
          <div className="bg-white border border-slate-200 rounded-xl p-7 space-y-4">
            <div className="flex items-center gap-2.5 text-emerald-700">
              <CheckCircle2 className="w-6 h-6" />
              <h2 className="text-lg font-bold font-display text-slate-900">
                {submittedRef.role === 'student'
                  ? `Student Application Routed to Class Teacher`
                  : `Application Sent to ${submittedRef.schoolName} Principal`}
              </h2>
            </div>

            {submittedRef.role === 'student' ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Your verified codes (<span className="font-mono font-semibold text-slate-900">{submittedRef.codeLabel}</span>)
                  have been submitted to <strong>{submittedRef.schoolName}</strong>. Your approval follows the 3-stage
                  verification chain:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200">
                    <p className="font-bold text-amber-900">1. Class Teacher</p>
                    <p className="text-amber-800 mt-0.5">{submittedRef.teacherName || 'Assigned Teacher'} (Current)</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <p className="font-bold text-slate-800">2. Academic Coordinator</p>
                    <p className="text-slate-500 mt-0.5">Reviews after Teacher</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <p className="font-bold text-slate-800">3. School Principal</p>
                    <p className="text-slate-500 mt-0.5">Final portal activation</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Your <strong className="capitalize">{submittedRef.role}</strong> request using code{' '}
                <span className="font-mono font-semibold text-slate-900">{submittedRef.codeLabel}</span> has been
                submitted. Once approved by your Principal, sign in again or click Re-check My Email above.
              </p>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">Your Join Application Number</p>
                <p className="text-lg font-bold font-mono tabular-nums text-[#0B1528] mt-0.5">
                  {submittedRef.applicationNumber}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(submittedRef.applicationNumber);
                  setCopiedRef(true);
                  setTimeout(() => setCopiedRef(false), 2000);
                }}
              >
                {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedRef ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link to={`/application-status?ref=${encodeURIComponent(submittedRef.applicationNumber)}`}>
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
                  setVerifiedStudent(null);
                  setSchoolCodeInput('');
                }}
              >
                Submit Another Request
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Mode Switcher */}
            <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setJoinMode('student_four_codes')}
                className={`px-4 py-3.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors cursor-pointer ${
                  joinMode === 'student_four_codes'
                    ? 'bg-white text-[#0F295C] border-teal-600'
                    : 'text-slate-500 border-transparent hover:text-slate-800'
                }`}
              >
                <GraduationCap className="w-4 h-4" />
                Student Join (4 Codes)
              </button>
              <button
                type="button"
                onClick={() => setJoinMode('staff_single_code')}
                className={`px-4 py-3.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors cursor-pointer ${
                  joinMode === 'staff_single_code'
                    ? 'bg-white text-[#0F295C] border-teal-600'
                    : 'text-slate-500 border-transparent hover:text-slate-800'
                }`}
              >
                <KeyRound className="w-4 h-4" />
                Coordinator / Teacher Code
              </button>
            </div>

            {/* TAB 1: STUDENT 4-CODE VERIFICATION */}
            {joinMode === 'student_four_codes' ? (
              <div className="p-6 space-y-6">
                <form onSubmit={handleVerifyFourCodes} className="space-y-4">
                  <div>
                    <h2 className="text-sm font-bold font-display text-slate-900">
                      Step 1 — Enter Your 4 Student Access Codes
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Obtain your personal Student Code, Class Code, and Teacher Code from your class teacher. Approval
                      flows strictly from your Teacher → Academic Coordinator → Principal.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label htmlFor="st-school-code" className="block text-xs font-semibold text-slate-700 mb-1">
                        1. School Code *
                      </label>
                      <input
                        id="st-school-code"
                        required
                        value={stSchoolCode}
                        onChange={(e) => {
                          setStSchoolCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
                          setVerifiedStudent(null);
                        }}
                        placeholder="Enter school code"
                        className="w-full font-mono text-sm uppercase border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label htmlFor="st-class-code" className="block text-xs font-semibold text-slate-700 mb-1">
                        2. Class Code *
                      </label>
                      <input
                        id="st-class-code"
                        required
                        value={stClassCode}
                        onChange={(e) => {
                          setStClassCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
                          setVerifiedStudent(null);
                        }}
                        placeholder="Enter class code"
                        className="w-full font-mono text-sm uppercase border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label htmlFor="st-teacher-code" className="block text-xs font-semibold text-slate-700 mb-1">
                        3. Class Teacher Code *
                      </label>
                      <input
                        id="st-teacher-code"
                        required
                        value={stTeacherCode}
                        onChange={(e) => {
                          setStTeacherCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
                          setVerifiedStudent(null);
                        }}
                        placeholder="Enter class teacher code"
                        className="w-full font-mono text-sm uppercase border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label htmlFor="st-student-code" className="block text-xs font-semibold text-slate-700 mb-1">
                        4. Your Personal Student Code *
                      </label>
                      <input
                        id="st-student-code"
                        required
                        value={stStudentCode}
                        onChange={(e) => {
                          setStStudentCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
                          setVerifiedStudent(null);
                        }}
                        placeholder="Enter personal student code"
                        className="w-full font-mono text-sm uppercase border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                  </div>

                  {fourCodeError && (
                    <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                      {fourCodeError}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button type="submit" variant="navy" disabled={verifyingFourCodes}>
                      <Search className="w-4 h-4" />
                      {verifyingFourCodes ? 'Verifying 4 Codes…' : 'Verify All 4 Codes'}
                    </Button>
                  </div>
                </form>

                {verifiedStudent && (
                  <form onSubmit={handleSubmitStudentJoin} className="pt-5 border-t border-slate-200 space-y-5">
                    <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200 space-y-3">
                      <div className="flex items-start gap-3">
                        <Building2 className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-[11px] text-teal-800 font-semibold uppercase tracking-wide">
                            All 4 Codes Verified
                          </p>
                          <p className="text-base font-bold font-display text-slate-900 mt-0.5">
                            {verifiedStudent.schoolEntry.schoolName}
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5 text-xs">
                            <div className="bg-white border border-teal-200/80 rounded-lg px-2.5 py-2">
                              <p className="text-[10px] text-slate-500">School</p>
                              <p className="font-mono font-bold text-slate-900">{verifiedStudent.schoolCode}</p>
                            </div>
                            <div className="bg-white border border-teal-200/80 rounded-lg px-2.5 py-2">
                              <p className="text-[10px] text-slate-500">Class</p>
                              <p className="font-mono font-bold text-slate-900">{verifiedStudent.classCode}</p>
                              <p className="text-[10px] text-slate-500 truncate">{verifiedStudent.classSlot.className}</p>
                            </div>
                            <div className="bg-white border border-teal-200/80 rounded-lg px-2.5 py-2">
                              <p className="text-[10px] text-slate-500">Teacher</p>
                              <p className="font-mono font-bold text-slate-900">{verifiedStudent.teacherCode}</p>
                              <p className="text-[10px] text-slate-500 truncate">{verifiedStudent.teacherName}</p>
                            </div>
                            <div className="bg-white border border-teal-200/80 rounded-lg px-2.5 py-2">
                              <p className="text-[10px] text-slate-500">Student Code</p>
                              <p className="font-mono font-bold text-teal-800">{verifiedStudent.studentCode}</p>
                              {verifiedStudent.studentName && (
                                <p className="text-[10px] text-slate-600 truncate">{verifiedStudent.studentName}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white border border-teal-200/80 rounded-lg px-3 py-2 text-xs text-slate-700 flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-900">Approval Chain:</span>
                        <span>1. {verifiedStudent.teacherName}</span>
                        <ArrowRight className="w-3 h-3 text-slate-400" />
                        <span>2. Academic Coordinator</span>
                        <ArrowRight className="w-3 h-3 text-slate-400" />
                        <span>3. Principal</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Student Full Name *</label>
                        <input
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Parent / Student Phone <span className="font-normal text-slate-400">(Numbers only)</span>
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
                          Note for Class Teacher (Optional)
                        </label>
                        <textarea
                          rows={2}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Add roll number or guardian note if helpful for quick verification…"
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button type="submit" variant="primary" disabled={submitting}>
                        {submitting ? 'Submitting to Class Teacher…' : 'Submit Student Request to Class Teacher'}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            ) : (
              /* TAB 2: COORDINATOR / TEACHER SINGLE ACCESS CODE */
              <div className="p-6 space-y-6">
                <form onSubmit={handleVerifyCode} className="space-y-3">
                  <label htmlFor="school-code" className="block text-xs font-semibold text-slate-700">
                    Step 1 — Enter Your Coordinator or Teacher Access Code
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      id="school-code"
                      value={schoolCodeInput}
                      onChange={(e) => setSchoolCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                      placeholder="Enter Coordinator or Teacher code"
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
                        {verifiedSchool.schoolName} ·{' '}
                        <span className="font-mono text-teal-800">{resolved.canonicalCode}</span>
                      </p>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Principal portal access is activated directly on the official Principal email registered for this
                        school. Click <strong>Activate Principal Portal</strong> below or sign in with the Principal
                        email.
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

                {/* Coordinator / Teacher Form */}
                {resolved && verifiedSchool && resolved.role !== 'principal' && resolved.role !== 'student' && (
                  <form onSubmit={handleSubmitStaffJoin} className="pt-5 border-t border-slate-200 space-y-5">
                    <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <Building2 className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[11px] text-teal-800 font-semibold uppercase tracking-wide">
                              {resolved.mode === 'named_member_code'
                                ? 'Named Staff Code Verified'
                                : resolved.mode === 'role_code'
                                  ? 'Role Code Verified'
                                  : 'Verified School'}
                            </p>
                            <p className="text-base font-bold font-display text-slate-900 mt-0.5">
                              {verifiedSchool.schoolName}
                            </p>
                            <p className="text-xs text-slate-600 mt-0.5">
                              School Prefix:{' '}
                              <span className="font-mono font-semibold text-slate-900">{verifiedSchool.code}</span> ·
                              Code: <span className="font-mono font-semibold text-teal-800">{resolved.canonicalCode}</span>
                              {resolved.memberCodeRecord?.memberName && (
                                <>
                                  {' '}
                                  · Issued to <strong>{resolved.memberCodeRecord.memberName}</strong>
                                </>
                              )}
                            </p>
                          </div>
                        </div>

                        {resolved.role && (
                          <div className="bg-white border border-teal-200 rounded-lg px-3 py-2 text-right">
                            <p className="text-[11px] text-slate-500">Identified Role</p>
                            <p className="text-sm font-bold text-teal-800 capitalize">{resolved.role}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {resolved.mode === 'legacy_school_code' && (
                      <div>
                        <p className="text-xs font-semibold text-slate-700 mb-2.5">
                          Step 2 — Choose Your Staff Role at {verifiedSchool.schoolName}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {STAFF_JOIN_ROLES.map((r) => {
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
                          {effectiveStaffRole === 'teacher'
                            ? 'Primary Subject(s) / Department'
                            : 'Assigned Grade Levels / Wing'}
                        </label>
                        <input
                          value={classOrDeptInfo}
                          onChange={(e) => setClassOrDeptInfo(e.target.value)}
                          placeholder={
                            effectiveStaffRole === 'teacher' ? 'Enter subjects or department' : 'Enter assigned grades or wing'
                          }
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Note for Principal (Optional)
                        </label>
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
                          : `Confirm & Send ${effectiveStaffRole.charAt(0).toUpperCase() + effectiveStaffRole.slice(1)} Application`}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* Applicant's Existing Join Applications */}
        {myRequests.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-sm font-bold font-display text-slate-900 mb-3">Your Submitted School Applications</h2>
            <div className="divide-y divide-slate-100">
              {myRequests.map((req) => {
                const displayStatus =
                  req.status === 'pending' && req.approvalStage ? req.approvalStage : req.status;
                return (
                  <div key={req.id} className="py-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
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
                        {req.requestedRole === 'student' && (req.classCode || req.teacherCode || req.studentCode) && (
                          <p className="text-[11px] font-mono text-slate-600 mt-1">
                            Codes: {req.schoolCode} · {req.classCode || '—'} · {req.teacherCode || '—'} ·{' '}
                            {req.studentCode || req.accessCode || '—'}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusText status={displayStatus} />
                        <Link
                          to={`/application-status?ref=${encodeURIComponent(req.applicationNumber)}`}
                          className="text-xs font-semibold text-teal-700 hover:text-teal-800"
                        >
                          View Status →
                        </Link>
                      </div>
                    </div>

                    {req.requestedRole === 'student' && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-1.5">
                        <span className={req.teacherApprovedBy ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                          1. Teacher {req.teacherApprovedBy ? `✓ (${req.teacherApprovedName || 'Approved'})` : '(Pending)'}
                        </span>
                        <span className="text-slate-300">→</span>
                        <span
                          className={
                            req.coordinatorApprovedBy
                              ? 'text-emerald-700 font-semibold'
                              : req.approvalStage === 'coordinator_pending'
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-400'
                          }
                        >
                          2. Coordinator{' '}
                          {req.coordinatorApprovedBy
                            ? `✓ (${req.coordinatorApprovedName || 'Approved'})`
                            : req.approvalStage === 'coordinator_pending'
                              ? '(Pending)'
                              : '(Waiting)'}
                        </span>
                        <span className="text-slate-300">→</span>
                        <span
                          className={
                            req.status === 'approved'
                              ? 'text-emerald-700 font-semibold'
                              : req.approvalStage === 'principal_pending'
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-400'
                          }
                        >
                          3. Principal{' '}
                          {req.status === 'approved'
                            ? '✓ (Approved)'
                            : req.approvalStage === 'principal_pending'
                              ? '(Final Review)'
                              : '(Waiting)'}
                        </span>
                      </div>
                    )}

                    {req.decisionNote && <p className="text-xs text-slate-600">Note: {req.decisionNote}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
