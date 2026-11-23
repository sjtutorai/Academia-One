import React, { useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  KeyRound,
  LogOut,
  MapPin,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  BookOpen,
  DoorOpen,
  ArrowLeft,
  ArrowRight,
  Copy,
  Check,
} from 'lucide-react';
import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db, generateId } from '../../lib/firebase';
import { recordAuditLog } from '../../lib/audit';
import {
  DEFAULT_CLASS_SECTION_PLAN,
  SECTION_LETTERS,
  STANDARD_CLASSES,
  countTotalClassSections,
  deriveSchoolPrefix,
  expandClassSectionPlan,
  formatMemberRoleCode,
  sanitizePhoneDigits,
  sanitizeSchoolPrefix,
} from '../../lib/schoolCodes';
import { emailToKey } from '../../lib/schoolProvisioning';
import { useAuth } from '../../contexts/AuthContext';
import { BrandLogo } from '../../components/ui/BrandLogo';
import { Button, useToast } from '../../components/ui/Primitives';
import {
  DetectLocationAddressPicker,
  type DetectedAddressData,
} from '../../components/shared/DetectLocationAddressPicker';
import type {
  ClassSectionRange,
  PlatformUser,
  Room,
  School,
  SchoolCodeClassSlot,
} from '../../types/models';

interface NamedCoordinatorDraft {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface NamedTeacherDraft {
  id: string;
  name: string;
  email: string;
  phone: string;
  classCode: string;
}

interface NamedStudentDraft {
  id: string;
  name: string;
  email: string;
  classCode: string;
  teacherIndex: number;
  rollNumber: string;
}

interface RoomDraft {
  id: string;
  roomNumber: string;
  name: string;
  building: string;
  capacity: number;
  roomType: Room['roomType'];
}

const SETUP_STEPS = [
  { id: 1, title: 'School Basic Info', icon: Building2 },
  { id: 2, title: 'Address & Contact', icon: MapPin },
  { id: 3, title: 'Principal Details', icon: ShieldCheck },
  { id: 4, title: 'Classes & Sections', icon: BookOpen },
  { id: 5, title: 'Campus Rooms', icon: DoorOpen },
  { id: 6, title: 'Coordinators, Teachers & Students', icon: Users },
] as const;

export function PrincipalActivationGate({
  school,
  actor,
}: {
  school: School;
  actor: PlatformUser;
}) {
  const { logout } = useAuth();
  const { pushToast } = useToast();

  // Stage 0: Activation Code Verification Gate
  const [activationInput, setActivationInput] = useState('');
  const [activationError, setActivationError] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeVerifiedLocal, setCodeVerifiedLocal] = useState(Boolean(school.activationVerified));

  // Wizard Steps (1..6)
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Step 1: School Basic Info
  const [schoolName, setSchoolName] = useState(school.name || '');
  const [schoolType, setSchoolType] = useState(school.schoolType || 'Private');
  const [board, setBoard] = useState(school.board || 'CBSE');
  const [academicYear, setAcademicYear] = useState(school.academicYear || '2026-2027');
  const [logoDataUrl, setLogoDataUrl] = useState(school.logoDataUrl || '');

  // Step 2: Address & Contact
  const [address, setAddress] = useState(school.address || '');
  const [schoolEmail, setSchoolEmail] = useState(school.email || '');
  const [schoolPhone, setSchoolPhone] = useState(sanitizePhoneDigits(school.phone || ''));

  // Step 3: Principal Details
  const [principalName, setPrincipalName] = useState(school.principalName || actor.displayName || '');
  const [principalEmail] = useState(school.principalEmail || actor.email || '');
  const [principalPhone, setPrincipalPhone] = useState(sanitizePhoneDigits(actor.phone || school.phone || ''));

  // Step 4: Classes & Section Ranges
  const [classPlan, setClassPlan] = useState<ClassSectionRange[]>(DEFAULT_CLASS_SECTION_PLAN);

  // Step 5: Campus Rooms
  const [rooms, setRooms] = useState<RoomDraft[]>([
    { id: 'rm_1', roomNumber: '101', name: 'Room 101', building: 'Main Block', capacity: 40, roomType: 'classroom' },
    { id: 'rm_2', roomNumber: '102', name: 'Room 102', building: 'Main Block', capacity: 40, roomType: 'classroom' },
    { id: 'rm_3', roomNumber: 'LAB-1', name: 'Science Lab', building: 'Science Wing', capacity: 35, roomType: 'science_lab' },
  ]);

  // Step 6: Named Coordinators, Teachers & Students Roster
  const [coordinators, setCoordinators] = useState<NamedCoordinatorDraft[]>([
    { id: 'c_1', name: '', email: '', phone: '' },
  ]);
  const [teachers, setTeachers] = useState<NamedTeacherDraft[]>([
    { id: 't_1', name: '', email: '', phone: '', classCode: 'C1A' },
  ]);
  const [students, setStudents] = useState<NamedStudentDraft[]>([
    { id: 's_1', name: '', email: '', classCode: 'C1A', teacherIndex: 0, rollNumber: '01' },
  ]);

  const effectivePrefix = useMemo(() => {
    const existing = sanitizeSchoolPrefix(school.code || school.schoolPrefix || '');
    return existing.length >= 2 ? existing : deriveSchoolPrefix(schoolName || school.name);
  }, [school.code, school.schoolPrefix, schoolName, school.name]);

  const expandedClasses = useMemo(() => expandClassSectionPlan(classPlan).slice(0, 200), [classPlan]);

  const isActivated = codeVerifiedLocal || Boolean(school.activationVerified);

  const handleVerifyActivationCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setActivationError('');
    const entered = activationInput.trim().toUpperCase();
    const expected = (school.activationCode || '').trim().toUpperCase();

    if (!entered) {
      setActivationError('Enter the Main Head Activation Code provided when your school was registered.');
      return;
    }

    if (expected && entered !== expected) {
      setActivationError('Invalid Activation Code. Confirm the exact code issued by the Main Head administrator.');
      return;
    }

    setVerifyingCode(true);
    try {
      await updateDoc(doc(db, 'schools', school.id), {
        activationVerified: true,
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        schoolId: school.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: 'principal',
        action: 'SCHOOL_ACTIVATION_CODE_VERIFIED',
        targetType: 'school',
        targetId: school.id,
        targetLabel: `${school.name} (${school.code})`,
      }).catch(() => undefined);
      setCodeVerifiedLocal(true);
      pushToast('success', 'Activation Code verified. Complete your school registration setup to launch the dashboard.');
    } catch (err) {
      setActivationError(err instanceof Error ? err.message : 'Unable to verify Activation Code right now.');
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleLogoUpload = (file: File) => {
    if (file.size > 150000) {
      pushToast('error', 'Logo image must be under 150 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDetectedLocation = (loc: DetectedAddressData) => {
    setAddress(loc.formattedAddress || [loc.city, loc.stateRegion, loc.country].filter(Boolean).join(', '));
  };

  const validateCurrentStep = (target: number): string | null => {
    if (target === 1) {
      if (schoolName.trim().length < 2) return 'Enter the official school name.';
      if (academicYear.trim().length < 4) return 'Enter the academic year.';
    }
    if (target === 2) {
      if (address.trim().length < 4) return 'Enter your campus street address (or use Detect Location).';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(schoolEmail.trim())) return 'Enter a valid official school email.';
    }
    if (target === 3) {
      if (principalName.trim().length < 2) return 'Enter the Principal full name.';
    }
    if (target === 4) {
      if (classPlan.length === 0) return 'Add at least one Class and Section range.';
      if (countTotalClassSections(classPlan) > 200) return 'Keep initial classes to 200 or fewer.';
    }
    return null;
  };

  const goNext = () => {
    const err = validateCurrentStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError('');
    setStep((s) => Math.min(SETUP_STEPS.length, s + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCompleteFullSetup = async () => {
    for (let i = 1; i <= 5; i++) {
      const err = validateCurrentStep(i);
      if (err) {
        setStep(i);
        setStepError(err);
        return;
      }
    }

    const validCoordinators = coordinators.filter((c) => c.name.trim().length >= 2);
    const validTeachers = teachers.filter((t) => t.name.trim().length >= 2);
    const validStudents = students.filter((s) => s.name.trim().length >= 2);

    setSaving(true);
    setStepError('');

    try {
      const now = serverTimestamp();
      const classRecords = expandedClasses.map((row) => ({
        classId: generateId('cls'),
        ...row,
      }));
      const classByCode = new Map(classRecords.map((c) => [c.code.toUpperCase(), c]));
      const fallbackClass = classRecords[0];

      // Pre-compute Teacher records + generated codes (e.g. JSST01, JSST02)
      const teacherTotal = Math.max(validTeachers.length, 1);
      const plannedTeachers = validTeachers.map((t, idx) => {
        const teacherId = generateId('tch');
        const teacherCode = formatMemberRoleCode(effectivePrefix, 'teacher', idx + 1, Math.max(teacherTotal, 10));
        const assignedCls = classByCode.get((t.classCode || '').toUpperCase()) || fallbackClass;
        return {
          draft: t,
          teacherId,
          teacherCode,
          assignedCls,
        };
      });

      // Pre-compute Coordinator codes (e.g. JSSC01 for Shubhangi)
      const coordTotal = Math.max(validCoordinators.length, 1);
      const plannedCoordinators = validCoordinators.map((c, idx) => ({
        draft: c,
        coordCode: formatMemberRoleCode(effectivePrefix, 'coordinator', idx + 1, Math.max(coordTotal, 10)),
      }));

      // Pre-compute Student records + generated codes (e.g. JSSS001)
      const studentTotal = Math.max(validStudents.length, 1);
      const plannedStudents = validStudents.map((s, idx) => {
        const studentId = generateId('stu');
        const studentCode = formatMemberRoleCode(effectivePrefix, 'student', idx + 1, Math.max(studentTotal, 100));
        const assignedCls = classByCode.get((s.classCode || '').toUpperCase()) || fallbackClass;
        const linkedTeacher =
          plannedTeachers[s.teacherIndex] ||
          plannedTeachers.find((pt) => pt.assignedCls?.code === assignedCls?.code) ||
          plannedTeachers[0] ||
          null;
        return {
          draft: s,
          studentId,
          studentCode,
          assignedCls,
          linkedTeacher,
        };
      });

      // Helper to commit writes in chunks of 350 operations
      const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

      // 1. Classes
      classRecords.forEach((cls) => {
        const classTeacher = plannedTeachers.find((t) => t.assignedCls?.classId === cls.classId);
        operations.push((b) =>
          b.set(doc(db, 'classes', cls.classId), {
            id: cls.classId,
            schoolId: school.id,
            name: cls.name,
            code: cls.code,
            gradeLevel: cls.gradeLevel,
            section: cls.section,
            capacity: 40,
            academicYear: academicYear.trim().slice(0, 24),
            classTeacherId: classTeacher?.teacherId || '',
            classTeacherName: classTeacher?.draft.name.trim().slice(0, 120) || '',
            roomId: '',
            roomName: '',
            status: 'active',
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
          }),
        );
      });

      // 2. Rooms
      rooms
        .filter((r) => r.roomNumber.trim() && r.name.trim())
        .forEach((r) => {
          const roomId = generateId('room');
          operations.push((b) =>
            b.set(doc(db, 'rooms', roomId), {
              id: roomId,
              schoolId: school.id,
              roomNumber: r.roomNumber.trim().slice(0, 32),
              name: r.name.trim().slice(0, 80),
              building: (r.building.trim() || 'Main Block').slice(0, 80),
              capacity: Math.max(1, Math.min(1000, Number(r.capacity) || 40)),
              roomType: r.roomType,
              available: true,
              status: 'active',
              createdBy: actor.uid,
              createdAt: now,
              updatedAt: now,
            }),
          );
        });

      // 3. Named Coordinators -> memberAccessCodes + optional emailDirectory
      plannedCoordinators.forEach(({ draft, coordCode }) => {
        const cleanEmail = draft.email.trim().toLowerCase();
        operations.push((b) =>
          b.set(doc(db, 'memberAccessCodes', coordCode), {
            code: coordCode,
            schoolId: school.id,
            schoolCode: effectivePrefix,
            schoolName: schoolName.trim().slice(0, 140),
            role: 'coordinator',
            memberName: draft.name.trim().slice(0, 120),
            email: cleanEmail.slice(0, 160),
            classId: '',
            classCode: '',
            className: '',
            teacherId: '',
            teacherCode: '',
            teacherName: '',
            rollNumber: '',
            status: 'active',
            linkedProfileId: '',
            linkedUid: '',
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
          }),
        );
        if (cleanEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          const emailKey = emailToKey(cleanEmail);
          operations.push((b) =>
            b.set(doc(db, 'emailDirectory', emailKey), {
              emailKey,
              email: cleanEmail,
              schoolId: school.id,
              schoolName: schoolName.trim().slice(0, 140),
              role: 'coordinator',
              displayName: draft.name.trim().slice(0, 120),
              accessCode: coordCode,
              linkedProfileId: '',
              classId: '',
              section: '',
              assignedClassIds: classRecords.map((c) => c.classId).slice(0, 50),
              coordinatorPermissions: {
                canEditAttendance: false,
                canEditMarks: false,
                canAssignTeachers: false,
                canPublishNotices: true,
                canCoordinateExams: true,
              },
              status: 'active',
              createdBy: actor.uid,
              createdAt: now,
              updatedAt: now,
            }),
          );
        }
      });

      // 4. Named Teachers -> teachers + memberAccessCodes + optional emailDirectory
      plannedTeachers.forEach(({ draft, teacherId, teacherCode, assignedCls }) => {
        const cleanEmail =
          draft.email.trim().toLowerCase() ||
          `${teacherCode.toLowerCase()}@${effectivePrefix.toLowerCase()}.school.local`;
        operations.push((b) =>
          b.set(doc(db, 'teachers', teacherId), {
            id: teacherId,
            schoolId: school.id,
            userId: '',
            staffId: teacherCode,
            name: draft.name.trim().slice(0, 120),
            email: cleanEmail.slice(0, 160),
            phone: sanitizePhoneDigits(draft.phone || ''),
            subjects: [],
            qualifications: '',
            joiningDate: new Date().toISOString().slice(0, 10),
            assignedClassIds: assignedCls ? [assignedCls.classId] : [],
            classTeacherOfClassId: assignedCls?.classId || '',
            accessCode: teacherCode,
            status: 'active',
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
          }),
        );
        operations.push((b) =>
          b.set(doc(db, 'memberAccessCodes', teacherCode), {
            code: teacherCode,
            schoolId: school.id,
            schoolCode: effectivePrefix,
            schoolName: schoolName.trim().slice(0, 140),
            role: 'teacher',
            memberName: draft.name.trim().slice(0, 120),
            email: draft.email.trim().toLowerCase().slice(0, 160),
            classId: assignedCls?.classId || '',
            classCode: assignedCls?.code || '',
            className: assignedCls?.name || '',
            teacherId,
            teacherCode,
            teacherName: draft.name.trim().slice(0, 120),
            rollNumber: '',
            status: 'active',
            linkedProfileId: teacherId,
            linkedUid: '',
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
          }),
        );
        if (draft.email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
          const emailKey = emailToKey(draft.email);
          operations.push((b) =>
            b.set(doc(db, 'emailDirectory', emailKey), {
              emailKey,
              email: draft.email.trim().toLowerCase(),
              schoolId: school.id,
              schoolName: schoolName.trim().slice(0, 140),
              role: 'teacher',
              displayName: draft.name.trim().slice(0, 120),
              accessCode: teacherCode,
              linkedProfileId: teacherId,
              classId: assignedCls?.classId || '',
              section: assignedCls?.section || '',
              assignedClassIds: assignedCls ? [assignedCls.classId] : [],
              status: 'active',
              createdBy: actor.uid,
              createdAt: now,
              updatedAt: now,
            }),
          );
        }
      });

      // 5. Named Students -> students + memberAccessCodes (so teachers can hand out all 4 codes in class)
      plannedStudents.forEach(({ draft, studentId, studentCode, assignedCls, linkedTeacher }, idx) => {
        const cleanEmail = draft.email.trim().toLowerCase();
        const roll = (draft.rollNumber.trim() || String(idx + 1).padStart(2, '0')).slice(0, 24);
        if (assignedCls) {
          operations.push((b) =>
            b.set(doc(db, 'students', studentId), {
              id: studentId,
              schoolId: school.id,
              userId: '',
              admissionNumber: studentCode,
              rollNumber: roll,
              name: draft.name.trim().slice(0, 120),
              email: cleanEmail.slice(0, 160),
              classId: assignedCls.classId,
              className: assignedCls.name,
              section: assignedCls.section,
              academicYear: academicYear.trim().slice(0, 24),
              guardianName: '',
              guardianPhone: '',
              guardianEmail: '',
              accessCode: studentCode,
              status: 'active',
              history: [
                {
                  date: new Date().toISOString().slice(0, 10),
                  event: 'Initial School Setup Enrollment',
                  toClass: assignedCls.name,
                  academicYear: academicYear.trim(),
                },
              ],
              createdBy: actor.uid,
              createdAt: now,
              updatedAt: now,
            }),
          );
        }
        operations.push((b) =>
          b.set(doc(db, 'memberAccessCodes', studentCode), {
            code: studentCode,
            schoolId: school.id,
            schoolCode: effectivePrefix,
            schoolName: schoolName.trim().slice(0, 140),
            role: 'student',
            memberName: draft.name.trim().slice(0, 120),
            email: cleanEmail.slice(0, 160),
            classId: assignedCls?.classId || '',
            classCode: assignedCls?.code || '',
            className: assignedCls?.name || '',
            teacherId: linkedTeacher?.teacherId || '',
            teacherCode: linkedTeacher?.teacherCode || '',
            teacherName: linkedTeacher?.draft.name.trim().slice(0, 120) || '',
            rollNumber: roll,
            status: 'active',
            linkedProfileId: studentId,
            linkedUid: '',
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
          }),
        );
      });

      // 6. Sync schoolCodes/{code} with classSections (including classCode) & allocations
      const classSectionsPayload: SchoolCodeClassSlot[] = classRecords.map((c) => ({
        classId: c.classId,
        classCode: c.code,
        className: c.name,
        gradeLevel: c.gradeLevel,
        section: c.section,
      }));
      const allocCoords = Math.max(school.allocatedCoordinators || 6, plannedCoordinators.length);
      const allocTeachers = Math.max(school.allocatedTeachers || 20, plannedTeachers.length);
      const allocStudents = Math.max(school.allocatedStudents || 100, plannedStudents.length);

      operations.push((b) =>
        b.update(doc(db, 'schoolCodes', school.code), {
          coordinatorCount: allocCoords,
          teacherCount: allocTeachers,
          studentCount: allocStudents,
          classSections: classSectionsPayload,
          updatedAt: now,
        }),
      );

      // 7. Update schools/{schoolId} with full registration details & mark setupCompleted: true
      operations.push((b) =>
        b.update(doc(db, 'schools', school.id), {
          name: schoolName.trim().slice(0, 140),
          address: address.trim().slice(0, 300),
          email: schoolEmail.trim().toLowerCase().slice(0, 160),
          phone: sanitizePhoneDigits(schoolPhone),
          academicYear: academicYear.trim().slice(0, 24),
          schoolType: schoolType.slice(0, 64),
          board: board.slice(0, 120),
          principalName: principalName.trim().slice(0, 120),
          logoDataUrl: logoDataUrl.slice(0, 200000),
          coordinatorCount: plannedCoordinators.length,
          teacherCount: plannedTeachers.length,
          studentCount: plannedStudents.length,
          allocatedCoordinators: allocCoords,
          allocatedTeachers: allocTeachers,
          allocatedStudents: allocStudents,
          activationVerified: true,
          setupCompleted: true,
          updatedAt: now,
        }),
      );

      const CHUNK = 350;
      for (let i = 0; i < operations.length; i += CHUNK) {
        const batch = writeBatch(db);
        operations.slice(i, i + CHUNK).forEach((fn) => fn(batch));
        await batch.commit();
      }

      await recordAuditLog({
        schoolId: school.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: 'principal',
        action: 'COMPLETE_ACTIVATED_SCHOOL_SETUP',
        targetType: 'school',
        targetId: school.id,
        targetLabel: `${schoolName} (${effectivePrefix})`,
        details: `Completed full setup: ${classRecords.length} classes, ${plannedCoordinators.length} coordinator codes, ${plannedTeachers.length} teacher codes, ${plannedStudents.length} student codes.`,
      }).catch(() => undefined);

      pushToast(
        'success',
        `School setup complete! Generated ${plannedCoordinators.length} coordinator, ${plannedTeachers.length} teacher, and ${plannedStudents.length} student access codes.`,
      );
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Unable to save school setup. Please check your entries.');
    } finally {
      setSaving(false);
    }
  };

  // ============================================================================
  // Stage 0: Locked Main Head Activation Code Gate
  // ============================================================================
  if (!isActivated) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
        <header className="bg-[#0F295C] text-white border-b border-blue-900">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            <BrandLogo size="sm" tone="dark" />
            <Button variant="secondary" size="sm" onClick={() => logout()}>
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </Button>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-6">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 text-[#0F295C] flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
                  Main Head Activation Required
                </p>
                <h1 className="text-xl font-bold font-display text-slate-900 mt-0.5">
                  Activate {school.name}
                </h1>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Your school was pre-registered by the platform Main Head. Enter the unique{' '}
                  <strong>Main Head Activation Code</strong> provided to you, then complete your full school setup
                  (classes, rooms, coordinators, teachers, and students) to unlock your Principal Dashboard.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-1">
              <p className="text-slate-500">Signed in as Principal</p>
              <p className="font-semibold text-slate-900">
                {actor.displayName} · <span className="font-mono">{actor.email}</span>
              </p>
              <p className="text-slate-500">
                School Code Prefix: <span className="font-mono font-bold text-slate-900">{effectivePrefix}</span>
              </p>
            </div>

            <form onSubmit={handleVerifyActivationCode} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Main Head Activation Code *
                </label>
                <input
                  type="text"
                  required
                  value={activationInput}
                  onChange={(e) => setActivationInput(e.target.value.toUpperCase())}
                  placeholder="Enter Main Head activation code"
                  className="w-full px-4 py-3 text-base font-mono font-semibold tracking-wider uppercase border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              {activationError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                  {activationError}
                </p>
              )}

              <Button type="submit" variant="primary" className="w-full" disabled={verifyingCode}>
                {verifyingCode ? 'Verifying Activation Code…' : 'Verify Code & Begin Full School Setup'}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Steps 1–6: Mandatory Full School Registration & Named Member Roster Setup
  // ============================================================================
  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-16">
      <header className="bg-[#0F295C] text-white border-b border-blue-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" tone="dark" />
            <span className="text-blue-300/60 hidden sm:inline">/</span>
            <span className="text-xs text-blue-100 hidden sm:inline">
              Initial School Setup · {school.name} ({effectivePrefix})
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => logout()}>
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-7 space-y-5">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-emerald-900 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            Activation Code verified. Complete all 6 steps below to generate named member codes and unlock your Principal Dashboard.
          </div>
          <span className="font-mono font-bold text-emerald-800 shrink-0">Prefix: {effectivePrefix}</span>
        </div>

        {/* Stepper */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold text-slate-900">
              Step {step} of {SETUP_STEPS.length} · {SETUP_STEPS[step - 1].title}
            </span>
            <span className="text-slate-500 tabular-nums">
              {Math.round((step / SETUP_STEPS.length) * 100)}% complete
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#2563EB] transition-all duration-300"
              style={{ width: `${(step / SETUP_STEPS.length) * 100}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
            {SETUP_STEPS.map((s) => {
              const active = step === s.id;
              const done = step > s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (s.id < step) setStep(s.id);
                  }}
                  className={`text-left px-2.5 py-2 rounded-lg border text-[11px] transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-50/70 text-blue-900 font-semibold'
                      : done
                        ? 'border-emerald-200 bg-emerald-50/40 text-emerald-800 cursor-pointer'
                        : 'border-slate-200 text-slate-400'
                  }`}
                >
                  <span className="block font-mono text-[10px]">0{s.id}</span>
                  <span className="truncate block">{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {stepError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3">
            {stepError}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          {/* STEP 1: School Basic Info */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold font-display text-slate-900">1. School Basic Information</h2>
                <p className="text-xs text-slate-500">
                  Confirm your institution name, academic year, education board, and optional crest. Your 3-letter code prefix is{' '}
                  <span className="font-mono font-semibold text-slate-900">{effectivePrefix}</span>.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Official School Name *</label>
                  <input
                    type="text"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Institution Type</label>
                  <select
                    value={schoolType}
                    onChange={(e) => setSchoolType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Private">Private / Independent</option>
                    <option value="Public">Public / Government</option>
                    <option value="International">International School</option>
                    <option value="Trust / Aided">Trust / Aided</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Affiliation / Board</label>
                  <select
                    value={board}
                    onChange={(e) => setBoard(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="CBSE">CBSE</option>
                    <option value="ICSE / ISC">ICSE / ISC</option>
                    <option value="State Board">State Board</option>
                    <option value="IB">International Baccalaureate (IB)</option>
                    <option value="Cambridge / IGCSE">Cambridge / IGCSE</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Academic Year *</label>
                  <input
                    type="text"
                    value={academicYear}
                    onChange={(e) => setAcademicYear(e.target.value)}
                    placeholder="2026-2027"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">School Logo (Optional, max 150 KB)</label>
                  <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                    <Upload className="w-3.5 h-3.5 text-slate-500" />
                    {logoDataUrl ? 'Replace Logo' : 'Upload Logo'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleLogoUpload(f);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Address & Contact */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold font-display text-slate-900">2. Campus Address & Official Contact</h2>
                <p className="text-xs text-slate-500">Detect your location automatically or enter your full campus address.</p>
              </div>
              <DetectLocationAddressPicker onAddressDetected={handleDetectedLocation} />
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Registered Campus Address *</label>
                <textarea
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, Area, City, State, Postal Code"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Official School Email *</label>
                  <input
                    type="email"
                    value={schoolEmail}
                    onChange={(e) => setSchoolEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">School Contact Phone (Numbers only)</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={15}
                    value={schoolPhone}
                    onChange={(e) => setSchoolPhone(sanitizePhoneDigits(e.target.value))}
                    placeholder="9876543210"
                    className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Principal Details */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold font-display text-slate-900">3. Principal Authority Details</h2>
                <p className="text-xs text-slate-500">Confirm the Principal details linked to this campus.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Principal Full Name *</label>
                  <input
                    type="text"
                    value={principalName}
                    onChange={(e) => setPrincipalName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Principal Phone (Numbers only)</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={15}
                    value={principalPhone}
                    onChange={(e) => setPrincipalPhone(sanitizePhoneDigits(e.target.value))}
                    placeholder="9876543210"
                    className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Verified Principal Login Email</label>
                  <input
                    type="email"
                    disabled
                    value={principalEmail}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 text-slate-600 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Classes & Section Ranges */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold font-display text-slate-900">4. Classes & Section Codes</h2>
                  <p className="text-xs text-slate-500">
                    Each class-section receives an automatic Class Code used by students when joining.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const used = new Set(classPlan.map((p) => p.grade));
                    const nextGrade = STANDARD_CLASSES.find((g) => !used.has(g)) || 'Class 3';
                    setClassPlan([...classPlan, { grade: nextGrade, sectionFrom: 'A', sectionTo: 'B' }]);
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Class Range
                </Button>
              </div>

              <div className="space-y-2.5">
                {classPlan.map((row, idx) => (
                  <div
                    key={`${row.grade}_${idx}`}
                    className="grid grid-cols-12 gap-2.5 items-center p-3 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <div className="col-span-5">
                      <select
                        value={row.grade}
                        onChange={(e) => {
                          const next = [...classPlan];
                          next[idx] = { ...row, grade: e.target.value };
                          setClassPlan(next);
                        }}
                        className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      >
                        {STANDARD_CLASSES.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <select
                        value={row.sectionFrom}
                        onChange={(e) => {
                          const next = [...classPlan];
                          next[idx] = { ...row, sectionFrom: e.target.value };
                          setClassPlan(next);
                        }}
                        className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      >
                        {SECTION_LETTERS.slice(0, 12).map((sec) => (
                          <option key={sec} value={sec}>From {sec}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <select
                        value={row.sectionTo}
                        onChange={(e) => {
                          const next = [...classPlan];
                          next[idx] = { ...row, sectionTo: e.target.value };
                          setClassPlan(next);
                        }}
                        className="w-full px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      >
                        {SECTION_LETTERS.slice(0, 12).map((sec) => (
                          <option key={sec} value={sec}>To {sec}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-1 text-right">
                      {classPlan.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setClassPlan(classPlan.filter((_, i) => i !== idx))}
                          className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-lg text-xs">
                <p className="font-semibold text-blue-900">
                  Generated Class Codes ({expandedClasses.length} total)
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {expandedClasses.slice(0, 20).map((c) => (
                    <span
                      key={c.code}
                      className="px-2 py-0.5 bg-white border border-blue-200 rounded font-mono text-[11px] text-slate-800"
                    >
                      {c.code} ({c.name})
                    </span>
                  ))}
                  {expandedClasses.length > 20 && (
                    <span className="text-slate-500">+{expandedClasses.length - 20} more</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Campus & Exam Rooms */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold font-display text-slate-900">5. Campus & Examination Rooms</h2>
                  <p className="text-xs text-slate-500">Add classrooms, labs, or exam halls (you can edit or add more anytime later).</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setRooms([
                      ...rooms,
                      {
                        id: generateId('rm'),
                        roomNumber: `${101 + rooms.length}`,
                        name: `Room ${101 + rooms.length}`,
                        building: 'Main Block',
                        capacity: 40,
                        roomType: 'classroom',
                      },
                    ])
                  }
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Room
                </Button>
              </div>
              <div className="space-y-2.5">
                {rooms.map((rm, idx) => (
                  <div
                    key={rm.id}
                    className="grid sm:grid-cols-12 gap-2.5 items-center p-3 bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <input
                      type="text"
                      value={rm.roomNumber}
                      onChange={(e) => {
                        const next = [...rooms];
                        next[idx] = { ...rm, roomNumber: e.target.value };
                        setRooms(next);
                      }}
                      placeholder="Room No."
                      className="sm:col-span-2 px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                    />
                    <input
                      type="text"
                      value={rm.name}
                      onChange={(e) => {
                        const next = [...rooms];
                        next[idx] = { ...rm, name: e.target.value };
                        setRooms(next);
                      }}
                      placeholder="Room Name"
                      className="sm:col-span-3 px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                    />
                    <input
                      type="text"
                      value={rm.building}
                      onChange={(e) => {
                        const next = [...rooms];
                        next[idx] = { ...rm, building: e.target.value };
                        setRooms(next);
                      }}
                      placeholder="Building"
                      className="sm:col-span-3 px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                    />
                    <select
                      value={rm.roomType}
                      onChange={(e) => {
                        const next = [...rooms];
                        next[idx] = { ...rm, roomType: e.target.value as Room['roomType'] };
                        setRooms(next);
                      }}
                      className="sm:col-span-3 px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="classroom">Classroom</option>
                      <option value="science_lab">Science Lab</option>
                      <option value="computer_lab">Computer Lab</option>
                      <option value="exam_hall">Exam Hall</option>
                      <option value="auditorium">Auditorium</option>
                    </select>
                    <div className="sm:col-span-1 text-right">
                      <button
                        type="button"
                        onClick={() => setRooms(rooms.filter((_, i) => i !== idx))}
                        className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 6: Named Coordinators, Teachers & Students -> Live 3-Letter Prefix Code Generation */}
          {step === 6 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-base font-bold font-display text-slate-900">
                  6. Named Coordinators, Teachers & Students Roster
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Enter names below to automatically generate personalized Coordinator, Teacher, and Student codes using
                  your school prefix <span className="font-mono font-bold text-slate-900">{effectivePrefix}</span>.
                </p>
              </div>

              {/* Coordinators */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Academic Coordinators ({coordinators.filter((c) => c.name.trim()).length})
                  </h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setCoordinators([...coordinators, { id: generateId('c'), name: '', email: '', phone: '' }])
                    }
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Coordinator
                  </Button>
                </div>
                {coordinators.map((c, idx) => {
                  const previewCode = formatMemberRoleCode(
                    effectivePrefix,
                    'coordinator',
                    idx + 1,
                    Math.max(coordinators.length, 10),
                  );
                  return (
                    <div
                      key={c.id}
                      className="grid sm:grid-cols-12 gap-2.5 items-center p-3 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <div className="sm:col-span-2 flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-1 rounded">
                          {previewCode}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder="Enter coordinator full name"
                        value={c.name}
                        onChange={(e) => {
                          const next = [...coordinators];
                          next[idx] = { ...c, name: e.target.value };
                          setCoordinators(next);
                        }}
                        className="sm:col-span-4 px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                      <input
                        type="email"
                        placeholder="Email (Optional)"
                        value={c.email}
                        onChange={(e) => {
                          const next = [...coordinators];
                          next[idx] = { ...c, email: e.target.value };
                          setCoordinators(next);
                        }}
                        className="sm:col-span-4 px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                      <div className="sm:col-span-2 flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(previewCode);
                            setCopiedCode(previewCode);
                            setTimeout(() => setCopiedCode(null), 1500);
                          }}
                          className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                          title="Copy code"
                        >
                          {copiedCode === previewCode ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {coordinators.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setCoordinators(coordinators.filter((_, i) => i !== idx))}
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Teachers */}
              <div className="space-y-2.5 pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Class Teachers ({teachers.filter((t) => t.name.trim()).length})
                  </h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setTeachers([
                        ...teachers,
                        {
                          id: generateId('t'),
                          name: '',
                          email: '',
                          phone: '',
                          classCode: expandedClasses[0]?.code || 'C1A',
                        },
                      ])
                    }
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Teacher
                  </Button>
                </div>
                {teachers.map((t, idx) => {
                  const previewCode = formatMemberRoleCode(
                    effectivePrefix,
                    'teacher',
                    idx + 1,
                    Math.max(teachers.length, 10),
                  );
                  return (
                    <div
                      key={t.id}
                      className="grid sm:grid-cols-12 gap-2.5 items-center p-3 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <div className="sm:col-span-2">
                        <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-1 rounded">
                          {previewCode}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder="Teacher Full Name"
                        value={t.name}
                        onChange={(e) => {
                          const next = [...teachers];
                          next[idx] = { ...t, name: e.target.value };
                          setTeachers(next);
                        }}
                        className="sm:col-span-3 px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                      <input
                        type="email"
                        placeholder="Email (Optional)"
                        value={t.email}
                        onChange={(e) => {
                          const next = [...teachers];
                          next[idx] = { ...t, email: e.target.value };
                          setTeachers(next);
                        }}
                        className="sm:col-span-3 px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                      <select
                        value={t.classCode}
                        onChange={(e) => {
                          const next = [...teachers];
                          next[idx] = { ...t, classCode: e.target.value };
                          setTeachers(next);
                        }}
                        className="sm:col-span-3 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        {expandedClasses.map((cls) => (
                          <option key={cls.code} value={cls.code}>
                            {cls.code} · {cls.name}
                          </option>
                        ))}
                      </select>
                      <div className="sm:col-span-1 text-right">
                        {teachers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setTeachers(teachers.filter((_, i) => i !== idx))}
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Students */}
              <div className="space-y-2.5 pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Students ({students.filter((s) => s.name.trim()).length})
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Teachers will automatically see these student codes in their portal to hand out in class.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setStudents([
                        ...students,
                        {
                          id: generateId('s'),
                          name: '',
                          email: '',
                          classCode: expandedClasses[0]?.code || 'C1A',
                          teacherIndex: 0,
                          rollNumber: String(students.length + 1).padStart(2, '0'),
                        },
                      ])
                    }
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Student
                  </Button>
                </div>
                {students.map((s, idx) => {
                  const previewCode = formatMemberRoleCode(
                    effectivePrefix,
                    'student',
                    idx + 1,
                    Math.max(students.length, 100),
                  );
                  return (
                    <div
                      key={s.id}
                      className="grid sm:grid-cols-12 gap-2.5 items-center p-3 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <div className="sm:col-span-2">
                        <span className="font-mono text-xs font-bold text-slate-800 bg-white border border-slate-300 px-2 py-1 rounded">
                          {previewCode}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder="Student Full Name"
                        value={s.name}
                        onChange={(e) => {
                          const next = [...students];
                          next[idx] = { ...s, name: e.target.value };
                          setStudents(next);
                        }}
                        className="sm:col-span-3 px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                      <select
                        value={s.classCode}
                        onChange={(e) => {
                          const next = [...students];
                          next[idx] = { ...s, classCode: e.target.value };
                          setStudents(next);
                        }}
                        className="sm:col-span-3 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        {expandedClasses.map((cls) => (
                          <option key={cls.code} value={cls.code}>
                            {cls.code} · {cls.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={s.teacherIndex}
                        onChange={(e) => {
                          const next = [...students];
                          next[idx] = { ...s, teacherIndex: Number(e.target.value) };
                          setStudents(next);
                        }}
                        className="sm:col-span-3 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        {teachers.map((t, tIdx) => {
                          const tCode = formatMemberRoleCode(
                            effectivePrefix,
                            'teacher',
                            tIdx + 1,
                            Math.max(teachers.length, 10),
                          );
                          return (
                            <option key={t.id} value={tIdx}>
                              {tCode} · {t.name.trim() || `Teacher #${tIdx + 1}`}
                            </option>
                          );
                        })}
                      </select>
                      <div className="sm:col-span-1 text-right">
                        {students.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setStudents(students.filter((_, i) => i !== idx))}
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Controls */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
            <Button
              variant="secondary"
              disabled={step === 1 || saving}
              onClick={() => {
                setStepError('');
                setStep((s) => Math.max(1, s - 1));
              }}
            >
              <ArrowLeft className="w-4 h-4" />
              Previous
            </Button>

            {step < SETUP_STEPS.length ? (
              <Button variant="primary" onClick={goNext}>
                Continue
                <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="primary" onClick={handleCompleteFullSetup} disabled={saving}>
                <CheckCircle2 className="w-4 h-4" />
                {saving ? 'Generating Codes & Launching Dashboard…' : 'Complete Setup & Open Principal Dashboard'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
