import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  DoorOpen,
  Download,
  GraduationCap,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  XCircle,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db, generateId, formatFirestoreDateTime } from '../../lib/firebase';
import { emailToKey, upsertEmailDirectoryEntry } from '../../lib/schoolProvisioning';
import { exportToCsv } from '../../lib/csv';
import {
  SECTION_LETTERS,
  STANDARD_CLASSES,
  expandSectionRange,
  formatMemberRoleCode,
  formatPrincipalCode,
  formatRoleCodeRange,
  formatSectionRangeLabel,
  resolveCoordinatorClassesForIndex,
  resolveStudentClassForIndex,
  sanitizePhoneDigits,
} from '../../lib/schoolCodes';
import { recordAuditLog } from '../../lib/audit';
import {
  Button,
  EmptyState,
  Modal,
  PaginationBar,
  StatCard,
  StatusText,
  useToast,
} from '../../components/ui/Primitives';
import { DetectLocationAddressPicker } from '../../components/shared/DetectLocationAddressPicker';
import type {
  CoordinatorPermissions,
  PlatformUser,
  Room,
  School,
  SchoolClass,
  SchoolCodeClassSlot,
  SchoolCodeEntry,
  SchoolJoinRequest,
} from '../../types/models';

interface ClassDraft {
  id: string;
  gradeLevel: string;
  sectionFrom: string;
  sectionTo: string;
  capacity: number;
}

interface RoomDraft {
  id: string;
  roomNumber: string;
  name: string;
  building: string;
  capacity: number;
  roomType: Room['roomType'];
}

// ============================================================================
// Post-Approval Campus Setup Wizard (/principal/setup)
// ============================================================================
export function PrincipalSetupWizardView({
  school,
  existingClasses,
  existingRooms,
  actor,
  canWrite,
}: {
  school: School | null;
  existingClasses: SchoolClass[];
  existingRooms: Room[];
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [step, setStep] = useState(1);
  const [copiedCode, setCopiedCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [campusAddress, setCampusAddress] = useState(school?.address || '');
  const [savingAddress, setSavingAddress] = useState(false);

  // Step 2: Classes & Section Ranges Builder (Choose-not-write)
  const [classDrafts, setClassDrafts] = useState<ClassDraft[]>([
    { id: 'cd_1', gradeLevel: 'Class 1', sectionFrom: 'A', sectionTo: 'G', capacity: 35 },
    { id: 'cd_2', gradeLevel: 'Class 2', sectionFrom: 'A', sectionTo: 'H', capacity: 35 },
  ]);

  // Step 3: Campus & Examination Rooms Builder
  const [roomDrafts, setRoomDrafts] = useState<RoomDraft[]>([
    { id: 'rd_1', roomNumber: '101', name: 'Classroom 101', building: 'Main Block', capacity: 36, roomType: 'classroom' },
    { id: 'rd_2', roomNumber: '102', name: 'Classroom 102', building: 'Main Block', capacity: 36, roomType: 'classroom' },
    { id: 'rd_3', roomNumber: 'EH-01', name: 'Examination Hall 1', building: 'Exam Wing', capacity: 80, roomType: 'exam_hall' },
  ]);
  const [quickExamCount, setQuickExamCount] = useState(2);
  const [quickExamCapacity, setQuickExamCapacity] = useState(60);

  // Step 4: Quick Email ID Registration (Coordinators, Teachers, Students)
  const [coordLines, setCoordLines] = useState('');
  const [teacherLines, setTeacherLines] = useState('');
  const [studentClassId, setStudentClassId] = useState(existingClasses[0]?.id || '');
  const [studentLines, setStudentLines] = useState('');

  useEffect(() => {
    if (!studentClassId && existingClasses.length > 0) {
      setStudentClassId(existingClasses[0].id);
    }
  }, [existingClasses, studentClassId]);

  useEffect(() => {
    if (school?.address) {
      setCampusAddress((prev) => prev || school.address || '');
    }
  }, [school?.address]);

  if (!school) return null;

  const handleSaveCampusAddress = async () => {
    if (!canWrite || savingAddress) return;
    if (campusAddress.trim().length < 4) {
      pushToast('error', 'Detect your location or enter a valid campus address (at least 4 characters).');
      return;
    }
    setSavingAddress(true);
    try {
      await updateDoc(doc(db, 'schools', school.id), {
        address: campusAddress.trim().slice(0, 300),
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        schoolId: school.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'UPDATE_CAMPUS_ADDRESS',
        targetType: 'school',
        targetId: school.id,
        targetLabel: campusAddress.trim().slice(0, 120),
      }).catch(() => undefined);
      pushToast('success', 'School campus address saved.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to save campus address.');
    } finally {
      setSavingAddress(false);
    }
  };

  const generatedSectionsCount = classDrafts.reduce(
    (acc, row) => acc + expandSectionRange(row.sectionFrom, row.sectionTo).length,
    0,
  );

  const handleSaveClassesAndSections = async () => {
    if (!canWrite) return;
    const rowsToCreate: { grade: string; section: string; capacity: number }[] = [];
    for (const draft of classDrafts) {
      const grade = draft.gradeLevel.trim();
      if (!grade) continue;
      const sections = expandSectionRange(draft.sectionFrom, draft.sectionTo);
      for (const sec of sections) {
        rowsToCreate.push({ grade, section: sec, capacity: Math.max(5, Number(draft.capacity) || 35) });
      }
    }
    if (rowsToCreate.length === 0) {
      pushToast('error', 'Choose at least one class with a section range.');
      return;
    }

    setSaving(true);
    try {
      const now = serverTimestamp();
      let created = 0;
      const newlyAddedSlots: SchoolCodeClassSlot[] = [];

      const toInsert: {
        id: string;
        code: string;
        name: string;
        gradeLevel: string;
        section: string;
        capacity: number;
      }[] = [];

      for (const item of rowsToCreate) {
        const shortGrade = item.grade
          .replace(/^Class\s+/i, '')
          .replace(/^Grade\s+/i, '')
          .replace(/[^A-Z0-9]/gi, '')
          .toUpperCase();
        const code = `C${shortGrade}${item.section}`.slice(0, 16);
        const alreadyExists = existingClasses.some(
          (c) =>
            c.code.toUpperCase() === code ||
            (c.gradeLevel.toLowerCase() === item.grade.toLowerCase() &&
              c.section.toUpperCase() === item.section.toUpperCase()),
        );
        if (alreadyExists) continue;
        const id = generateId('cls');
        const name = `${item.grade} - Section ${item.section}`;
        toInsert.push({
          id,
          code,
          name,
          gradeLevel: item.grade,
          section: item.section,
          capacity: item.capacity,
        });
        newlyAddedSlots.push({
          classId: id,
          className: name,
          gradeLevel: item.grade,
          section: item.section,
        });
      }

      if (toInsert.length > 0) {
        const CHUNK_SIZE = 350;
        for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
          const chunk = toInsert.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          for (const cls of chunk) {
            batch.set(doc(db, 'classes', cls.id), {
              id: cls.id,
              schoolId: school.id,
              name: cls.name,
              gradeLevel: cls.gradeLevel,
              section: cls.section,
              code: cls.code,
              academicYear: school.academicYear || '2026-2027',
              capacity: cls.capacity,
              classTeacherId: '',
              classTeacherName: '',
              roomId: '',
              roomName: '',
              status: 'active',
              createdBy: actor.uid,
              createdAt: now,
              updatedAt: now,
            });
            created += 1;
          }
          await batch.commit();
        }

        // Sync merged classSections to schoolCodes/{school.code} so student access codes map cleanly
        const mergedSlots: SchoolCodeClassSlot[] = [
          ...existingClasses.map((c) => ({
            classId: c.id,
            className: c.name,
            gradeLevel: c.gradeLevel,
            section: c.section,
          })),
          ...newlyAddedSlots,
        ].slice(0, 200);
        await updateDoc(doc(db, 'schoolCodes', school.code), {
          classSections: mergedSlots,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);

        await recordAuditLog({
          schoolId: school.id,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'SETUP_CLASSES_AND_SECTIONS',
          targetType: 'classes',
          targetId: school.id,
          targetLabel: `${created} class sections configured`,
        }).catch(() => undefined);
        pushToast('success', `Created ${created} separate class section${created > 1 ? 's' : ''} and synced access codes.`);
      } else {
        pushToast('info', 'All selected class sections already exist.');
      }
      setStep(3);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to save classes.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuickExamRooms = () => {
    const count = Math.min(20, Math.max(1, Number(quickExamCount) || 1));
    const cap = Math.max(10, Number(quickExamCapacity) || 50);
    const startIdx = roomDrafts.filter((r) => r.roomType === 'exam_hall').length + 1;
    const added: RoomDraft[] = [];
    for (let i = 0; i < count; i++) {
      const n = startIdx + i;
      added.push({
        id: `rd_${Date.now()}_${i}`,
        roomNumber: `EH-${String(n).padStart(2, '0')}`,
        name: `Examination Room ${n}`,
        building: 'Examination Block',
        capacity: cap,
        roomType: 'exam_hall',
      });
    }
    setRoomDrafts((prev) => [...prev, ...added]);
  };

  const handleSaveRooms = async () => {
    if (!canWrite) return;
    const valid = roomDrafts.filter((r) => r.roomNumber.trim() && r.name.trim());
    if (valid.length === 0) {
      pushToast('error', 'Add at least one classroom or examination room.');
      return;
    }
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      let created = 0;
      for (const r of valid) {
        const exists = existingRooms.some((er) => er.roomNumber.toLowerCase() === r.roomNumber.trim().toLowerCase());
        if (exists) continue;
        const id = generateId('rm');
        batch.set(doc(db, 'rooms', id), {
          id,
          schoolId: school.id,
          roomNumber: r.roomNumber.trim().slice(0, 24),
          name: r.name.trim().slice(0, 80),
          building: (r.building || 'Main Block').trim().slice(0, 80),
          capacity: Math.max(5, Number(r.capacity) || 35),
          roomType: r.roomType,
          available: true,
          status: 'active',
          createdBy: actor.uid,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
      }
      if (created > 0) {
        await batch.commit();
        await recordAuditLog({
          schoolId: school.id,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'SETUP_CAMPUS_ROOMS',
          targetType: 'rooms',
          targetId: school.id,
          targetLabel: `${created} rooms added`,
        }).catch(() => undefined);
        pushToast('success', `Saved ${created} campus & examination room${created > 1 ? 's' : ''}.`);
      } else {
        pushToast('info', 'All specified room numbers are already registered.');
      }
      setStep(4);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to save rooms.');
    } finally {
      setSaving(false);
    }
  };

  const parseEmailLines = (raw: string): { name: string; email: string }[] => {
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        if (line.includes(',')) {
          const [namePart, emailPart] = line.split(',').map((s) => s.trim());
          return { name: namePart || emailPart.split('@')[0], email: (emailPart || '').toLowerCase() };
        }
        return { name: line.split('@')[0].replace(/[._-]/g, ' '), email: line.toLowerCase() };
      })
      .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email));
  };

  const handleSaveDirectoryAndFinish = async () => {
    if (!canWrite) return;
    const coords = parseEmailLines(coordLines);
    const teachers = parseEmailLines(teacherLines);
    const students = parseEmailLines(studentLines);
    const targetCls = existingClasses.find((c) => c.id === studentClassId) || existingClasses[0];

    if (students.length > 0 && !targetCls) {
      pushToast('error', 'Please create at least one Class & Section in Step 2 before registering student email IDs.');
      setStep(2);
      return;
    }

    setSaving(true);
    try {

      let registeredCount = 0;

      // Register Coordinators in emailDirectory
      for (const c of coords) {
        await upsertEmailDirectoryEntry({
          email: c.email,
          schoolId: school.id,
          schoolName: school.name,
          role: 'coordinator',
          displayName: c.name,
          assignedClassIds: existingClasses.map((cl) => cl.id),
          coordinatorPermissions: {
            canEditAttendance: true,
            canEditMarks: false,
            canAssignTeachers: false,
            canPublishNotices: true,
            canCoordinateExams: true,
          },
          createdBy: actor.uid,
        });
        registeredCount += 1;
      }

      // Register Teachers in teachers collection + emailDirectory
      for (const t of teachers) {
        const tchId = generateId('tch');
        const batch = writeBatch(db);
        const now = serverTimestamp();
        batch.set(doc(db, 'teachers', tchId), {
          id: tchId,
          schoolId: school.id,
          userId: '',
          staffId: `STF-${Math.floor(100 + Math.random() * 899)}`,
          name: t.name.slice(0, 120),
          email: t.email,
          phone: '',
          subjects: [],
          qualifications: '',
          joiningDate: new Date().toISOString().slice(0, 10),
          assignedClassIds: existingClasses.slice(0, 2).map((cl) => cl.id),
          classTeacherOfClassId: '',
          status: 'active',
          createdBy: actor.uid,
          createdAt: now,
          updatedAt: now,
        });
        const key = emailToKey(t.email);
        batch.set(doc(db, 'emailDirectory', key), {
          emailKey: key,
          email: t.email,
          schoolId: school.id,
          schoolName: school.name,
          role: 'teacher',
          displayName: t.name.slice(0, 120),
          linkedProfileId: tchId,
          classId: '',
          section: '',
          assignedClassIds: existingClasses.slice(0, 2).map((cl) => cl.id),
          status: 'active',
          createdBy: actor.uid,
          createdAt: now,
          updatedAt: now,
        });
        await batch.commit();
        registeredCount += 1;
      }

      // Register Students in students collection + emailDirectory
      for (let i = 0; i < students.length; i++) {
        const s = students[i];
        const stuId = generateId('stu');
        const batch = writeBatch(db);
        const now = serverTimestamp();
        batch.set(doc(db, 'students', stuId), {
          id: stuId,
          schoolId: school.id,
          userId: '',
          admissionNumber: `${school.code}-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 899)}`,
          rollNumber: String(i + 1).padStart(2, '0'),
          name: s.name.slice(0, 120),
          email: s.email,
          classId: targetCls?.id || '',
          className: targetCls?.name || 'Unassigned',
          section: targetCls?.section || '',
          academicYear: school.academicYear || '2026-2027',
          guardianName: '',
          guardianPhone: '',
          guardianEmail: '',
          status: 'active',
          history: [
            {
              date: new Date().toISOString().slice(0, 10),
              event: `Pre-registered via Campus Setup Wizard`,
              academicYear: school.academicYear || '2026-2027',
            },
          ],
          createdBy: actor.uid,
          createdAt: now,
          updatedAt: now,
        });
        const key = emailToKey(s.email);
        batch.set(doc(db, 'emailDirectory', key), {
          emailKey: key,
          email: s.email,
          schoolId: school.id,
          schoolName: school.name,
          role: 'student',
          displayName: s.name.slice(0, 120),
          linkedProfileId: stuId,
          classId: targetCls?.id || '',
          section: targetCls?.section || '',
          assignedClassIds: [],
          status: 'active',
          createdBy: actor.uid,
          createdAt: now,
          updatedAt: now,
        });
        await batch.commit();
        registeredCount += 1;
      }

      await updateDoc(doc(db, 'schools', school.id), {
        setupCompleted: true,
        teacherCount: (school.teacherCount || 0) + teachers.length,
        studentCount: (school.studentCount || 0) + students.length,
        updatedAt: serverTimestamp(),
      });

      setCoordLines('');
      setTeacherLines('');
      setStudentLines('');
      pushToast(
        'success',
        registeredCount > 0
          ? `Registered ${registeredCount} email ID(s) for automatic Email & Google login. Campus setup marked complete.`
          : 'Campus setup marked complete.',
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to complete member registration.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Progress */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-teal-700">Post-Approval Campus Configuration</p>
            <h2 className="text-lg font-bold font-display text-slate-900 mt-0.5">
              Campus Setup Wizard — {school.name}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure separate sections per class, examination & classroom rooms, and register staff/student email IDs.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">School Code</p>
              <p className="font-mono text-sm font-bold text-[#0B1528]">{school.code}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(school.code);
                setCopiedCode(true);
                setTimeout(() => setCopiedCode(false), 1800);
              }}
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCode ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        {/* 4 Step Selector Pills */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mt-6">
          {[
            { num: 1, title: 'School Code', icon: Building2 },
            { num: 2, title: 'Classes & Sections', icon: Layers },
            { num: 3, title: 'Rooms & Exam Halls', icon: DoorOpen },
            { num: 4, title: 'Register Email IDs', icon: UserPlus },
          ].map((s) => {
            const Icon = s.icon;
            const active = step === s.num;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => setStep(s.num)}
                className={`p-3 rounded-xl border text-left transition-colors cursor-pointer flex items-center gap-2.5 ${
                  active
                    ? 'bg-[#0B1528] text-white border-[#0B1528]'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-teal-400' : 'text-slate-500'}`} />
                <div className="min-w-0">
                  <p className={`text-[10px] ${active ? 'text-slate-300' : 'text-slate-400'}`}>Step {s.num}</p>
                  <p className="text-xs font-semibold truncate">{s.title}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 1 */}
      {step === 1 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h3 className="text-base font-bold font-display text-slate-900">
              Step 1 — School Code & Campus Address
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed max-w-2xl mt-1">
              Share <span className="font-mono font-bold text-slate-900">{school.code}</span> with Coordinators, Teachers,
              and Students who are not yet pre-registered. Pre-registered emails in Step 4 enter directly on sign-in.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard label="Current Classes & Sections" value={existingClasses.length} subtext="Configured in Firestore" />
            <StatCard label="Campus & Exam Rooms" value={existingRooms.length} subtext="Available for timetables & exams" />
            <StatCard label="Academic Year" value={school.academicYear || '2026-2027'} subtext={school.board || 'Free Unlimited Campus'} />
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-3">
            <DetectLocationAddressPicker
              disabled={!canWrite}
              compact
              label="Detect Campus Address"
              helperText="Use GPS to auto-fill your school's physical address and verify your campus pin on the map."
              onAddressDetected={(detected) => {
                setCampusAddress(detected.formattedAddress.slice(0, 300));
                pushToast('success', 'Location detected. Click Save Address to update your school profile.');
              }}
            />
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-700 mb-1">Registered Campus Address</label>
                <input
                  type="text"
                  value={campusAddress}
                  onChange={(e) => setCampusAddress(e.target.value)}
                  placeholder="Detect location above or type full school address"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                loading={savingAddress}
                disabled={!canWrite}
                onClick={handleSaveCampusAddress}
              >
                Save Address
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="primary" onClick={() => setStep(2)}>
              Continue to Classes & Separate Sections →
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Choose Classes & Section Ranges (Dropdowns only) */}
      {step === 2 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold font-display text-slate-900">
                Step 2 — Choose Classes &amp; Section Ranges
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Pick each class and choose its section range (e.g., Class 1 Section: A–G, Class 2 Section: A–H).{' '}
                <strong className="text-teal-700 tabular-nums">{generatedSectionsCount} sections staged</strong>.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const used = new Set(classDrafts.map((r) => r.gradeLevel));
                const nextGrade = STANDARD_CLASSES.find((g) => !used.has(g)) || 'Class 3';
                setClassDrafts((prev) => [
                  ...prev,
                  { id: `cd_${Date.now()}`, gradeLevel: nextGrade, sectionFrom: 'A', sectionTo: 'D', capacity: 35 },
                ]);
              }}
            >
              <Plus className="w-3.5 h-3.5" /> Add Class Row
            </Button>
          </div>

          <div className="space-y-2.5">
            {classDrafts.map((row) => {
              const rangeCount = expandSectionRange(row.sectionFrom, row.sectionTo).length;
              return (
                <div
                  key={row.id}
                  className="grid grid-cols-12 gap-3 items-end p-3 rounded-lg bg-slate-50 border border-slate-200"
                >
                  <div className="col-span-12 sm:col-span-3">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Class</label>
                    <select
                      value={row.gradeLevel}
                      onChange={(e) =>
                        setClassDrafts((prev) =>
                          prev.map((r) => (r.id === row.id ? { ...r, gradeLevel: e.target.value } : r)),
                        )
                      }
                      className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg"
                    >
                      {STANDARD_CLASSES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Section From</label>
                    <select
                      value={row.sectionFrom}
                      onChange={(e) => {
                        const fromVal = e.target.value;
                        setClassDrafts((prev) =>
                          prev.map((r) =>
                            r.id === row.id
                              ? { ...r, sectionFrom: fromVal, sectionTo: fromVal > r.sectionTo ? fromVal : r.sectionTo }
                              : r,
                          ),
                        );
                      }}
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    >
                      {SECTION_LETTERS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Section To</label>
                    <select
                      value={row.sectionTo}
                      onChange={(e) => {
                        const toVal = e.target.value;
                        setClassDrafts((prev) =>
                          prev.map((r) =>
                            r.id === row.id
                              ? { ...r, sectionFrom: toVal < r.sectionFrom ? toVal : r.sectionFrom, sectionTo: toVal }
                              : r,
                          ),
                        );
                      }}
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    >
                      {SECTION_LETTERS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Seats / Sec</label>
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={row.capacity}
                      onChange={(e) =>
                        setClassDrafts((prev) =>
                          prev.map((r) => (r.id === row.id ? { ...r, capacity: Number(e.target.value) || 35 } : r)),
                        )
                      }
                      className="w-full px-3 py-2 text-xs tabular-nums bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2 pb-2 text-xs font-medium text-teal-800 tabular-nums">
                    {formatSectionRangeLabel(row.sectionFrom, row.sectionTo)} ({rangeCount})
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex justify-end">
                    <button
                      type="button"
                      disabled={classDrafts.length <= 1}
                      onClick={() => setClassDrafts((prev) => prev.filter((r) => r.id !== row.id))}
                      className="p-2 text-slate-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                      aria-label="Remove class row"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <Button variant="secondary" onClick={() => setStep(1)}>← Back</Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setStep(3)}>Skip for Now</Button>
              <Button variant="primary" disabled={saving || !canWrite} onClick={handleSaveClassesAndSections}>
                {saving ? 'Saving Sections…' : `Save ${generatedSectionsCount} Sections & Continue →`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Rooms & Examination Halls */}
      {step === 3 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold font-display text-slate-900">
                Step 3 — Configure Campus & Examination Rooms
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Specify how many rooms are available for daily classes, science/computer labs, and examinations.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setRoomDrafts((prev) => [
                  ...prev,
                  {
                    id: `rd_${Date.now()}`,
                    roomNumber: String(100 + prev.length + 1),
                    name: `Room ${100 + prev.length + 1}`,
                    building: 'Main Block',
                    capacity: 35,
                    roomType: 'classroom',
                  },
                ])
              }
            >
              <Plus className="w-3.5 h-3.5" /> Add Room
            </Button>
          </div>

          {/* Quick Bulk Exam Rooms Generator */}
          <div className="p-4 rounded-xl bg-teal-50/60 border border-teal-200 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-teal-900 mb-1">
                Quick Add Examination Rooms (Count)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={quickExamCount}
                onChange={(e) => setQuickExamCount(Number(e.target.value) || 1)}
                className="w-28 px-3 py-1.5 text-xs bg-white border border-teal-300 rounded-lg tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-teal-900 mb-1">Seats per Exam Room</label>
              <input
                type="number"
                min={10}
                max={500}
                value={quickExamCapacity}
                onChange={(e) => setQuickExamCapacity(Number(e.target.value) || 60)}
                className="w-32 px-3 py-1.5 text-xs bg-white border border-teal-300 rounded-lg tabular-nums"
              />
            </div>
            <Button variant="primary" size="sm" onClick={handleAddQuickExamRooms}>
              <Sparkles className="w-3.5 h-3.5" /> Generate Exam Rooms
            </Button>
          </div>

          <div className="space-y-2.5">
            {roomDrafts.map((room) => (
              <div key={room.id} className="grid grid-cols-12 gap-2.5 items-end p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="col-span-2">
                  <label className="block text-[11px] text-slate-600 mb-1">Room No.</label>
                  <input
                    value={room.roomNumber}
                    onChange={(e) =>
                      setRoomDrafts((prev) => prev.map((r) => (r.id === room.id ? { ...r, roomNumber: e.target.value } : r)))
                    }
                    className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-[11px] text-slate-600 mb-1">Room Name</label>
                  <input
                    value={room.name}
                    onChange={(e) =>
                      setRoomDrafts((prev) => prev.map((r) => (r.id === room.id ? { ...r, name: e.target.value } : r)))
                    }
                    className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-[11px] text-slate-600 mb-1">Room Type</label>
                  <select
                    value={room.roomType}
                    onChange={(e) =>
                      setRoomDrafts((prev) =>
                        prev.map((r) => (r.id === room.id ? { ...r, roomType: e.target.value as Room['roomType'] } : r)),
                      )
                    }
                    className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="classroom">Classroom</option>
                    <option value="exam_hall">Examination Hall</option>
                    <option value="science_lab">Science Lab</option>
                    <option value="computer_lab">Computer Lab</option>
                    <option value="auditorium">Auditorium</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] text-slate-600 mb-1">Building</label>
                  <input
                    value={room.building}
                    onChange={(e) =>
                      setRoomDrafts((prev) => prev.map((r) => (r.id === room.id ? { ...r, building: e.target.value } : r)))
                    }
                    className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-[11px] text-slate-600 mb-1">Seats</label>
                  <input
                    type="number"
                    min={5}
                    value={room.capacity}
                    onChange={(e) =>
                      setRoomDrafts((prev) =>
                        prev.map((r) => (r.id === room.id ? { ...r, capacity: Number(e.target.value) || 35 } : r)),
                      )
                    }
                    className="w-full px-2 py-2 text-xs tabular-nums bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setRoomDrafts((prev) => prev.filter((r) => r.id !== room.id))}
                    className="p-2 text-slate-400 hover:text-red-600 cursor-pointer"
                    aria-label="Remove room"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <Button variant="secondary" onClick={() => setStep(2)}>← Back</Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setStep(4)}>Skip for Now</Button>
              <Button variant="primary" disabled={saving || !canWrite} onClick={handleSaveRooms}>
                {saving ? 'Saving Rooms…' : `Save ${roomDrafts.length} Rooms & Continue →`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Register Coordinator, Teacher & Student Email IDs */}
      {step === 4 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h3 className="text-base font-bold font-display text-slate-900">
              Step 4 — Register Coordinator, Teacher & Student Email IDs
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Enter one email per line (or <span className="font-mono">Full Name, email@school.edu</span>). Every email
              registered here will automatically match this school whether the user signs in via Email & Password or Google.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">Coordinator Email IDs</label>
              <textarea
                rows={6}
                value={coordLines}
                onChange={(e) => setCoordLines(e.target.value)}
                placeholder={'Ananya Rao, coord.senior@school.edu\nlead.junior@school.edu'}
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-3 focus:outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">Teacher Email IDs</label>
              <textarea
                rows={6}
                value={teacherLines}
                onChange={(e) => setTeacherLines(e.target.value)}
                placeholder={'Dr. Ravi Nair, math@school.edu\nphysics@school.edu'}
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-3 focus:outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-semibold text-slate-800">Student Email IDs</label>
                <select
                  value={studentClassId}
                  onChange={(e) => setStudentClassId(e.target.value)}
                  className="text-[11px] border border-slate-300 rounded px-2 py-1 bg-white"
                >
                  {existingClasses.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.code} ({cl.name})
                    </option>
                  ))}
                  {existingClasses.length === 0 && <option value="">No classes yet</option>}
                </select>
              </div>
              <textarea
                rows={6}
                value={studentLines}
                onChange={(e) => setStudentLines(e.target.value)}
                placeholder={'Rohan Verma, rohan@school.edu\nmeera@school.edu'}
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-3 focus:outline-none focus:border-teal-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <Button variant="secondary" onClick={() => setStep(3)}>← Back</Button>
            <Button variant="primary" disabled={saving || !canWrite} onClick={handleSaveDirectoryAndFinish}>
              <CheckCircle2 className="w-4 h-4" />
              {saving ? 'Registering Emails…' : 'Register Email IDs & Complete Setup'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Principal School-Code Join Requests Queue (/principal/join-requests)
// ============================================================================
export function PrincipalJoinRequestsView({
  school,
  classes,
  actor,
  canWrite,
}: {
  school: School | null;
  classes: SchoolClass[];
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [requests, setRequests] = useState<SchoolJoinRequest[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [approvingReq, setApprovingReq] = useState<SchoolJoinRequest | null>(null);
  const [rejectingReq, setRejectingReq] = useState<SchoolJoinRequest | null>(null);
  const [saving, setSaving] = useState(false);

  // Approval assignment state
  const [assignClassId, setAssignClassId] = useState(classes[0]?.id || '');
  const [admissionNo, setAdmissionNo] = useState('');
  const [rollNo, setRollNo] = useState('01');
  const [staffId, setStaffId] = useState('');
  const [subjectsCsv, setSubjectsCsv] = useState('');
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [coordPerms, setCoordPerms] = useState<CoordinatorPermissions>({
    canEditAttendance: true,
    canEditMarks: false,
    canAssignTeachers: false,
    canPublishNotices: true,
    canCoordinateExams: true,
  });
  const [decisionNote, setDecisionNote] = useState('');

  useEffect(() => {
    if (!school?.id) return;
    const q = query(collection(db, 'schoolJoinRequests'), where('schoolId', '==', school.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as SchoolJoinRequest);
        list.sort(
          (a, b) =>
            ((b.createdAt as { seconds?: number })?.seconds || 0) -
            ((a.createdAt as { seconds?: number })?.seconds || 0),
        );
        setRequests(list);
      },
      () => undefined,
    );
    return () => unsub();
  }, [school?.id]);

  const filtered = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  const openApproveModal = (req: SchoolJoinRequest) => {
    setApprovingReq(req);
    const matchedClass =
      (req.requestedClassId && classes.find((c) => c.id === req.requestedClassId)) || classes[0];
    setAssignClassId(matchedClass?.id || '');
    setAdmissionNo(
      req.accessCode ||
        `${school?.code || 'SCH'}-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 899)}`,
    );
    const rollMatch = /Roll\s*#(\d+)/i.exec(req.requestedClassInfo || '');
    setRollNo(rollMatch ? rollMatch[1] : String(Math.floor(1 + Math.random() * 40)).padStart(2, '0'));
    setStaffId(req.accessCode || `STF-${Math.floor(100 + Math.random() * 899)}`);
    setSubjectsCsv(req.requestedClassInfo || '');
    setSelectedClassIds(classes.slice(0, 2).map((c) => c.id));
    setDecisionNote('');
  };

  const handleConfirmApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school || !approvingReq || !canWrite) return;
    setSaving(true);
    try {
      const now = serverTimestamp();
      const batch = writeBatch(db);
      const emailKey = emailToKey(approvingReq.applicantEmail);
      let linkedProfileId = '';
      let finalClassId = '';
      let finalSection = '';

      if (approvingReq.requestedRole === 'student') {
        const cls = classes.find((c) => c.id === assignClassId) || classes[0];
        linkedProfileId = generateId('stu');
        finalClassId = cls?.id || '';
        finalSection = cls?.section || '';
        batch.set(doc(db, 'students', linkedProfileId), {
          id: linkedProfileId,
          schoolId: school.id,
          userId: approvingReq.applicantUid,
          admissionNumber: admissionNo.trim().slice(0, 32),
          rollNumber: rollNo.trim().slice(0, 24),
          name: approvingReq.applicantName.slice(0, 120),
          email: approvingReq.applicantEmail.toLowerCase(),
          classId: finalClassId,
          className: cls?.name || 'Unassigned',
          section: finalSection,
          academicYear: school.academicYear || '2026-2027',
          guardianName: '',
          guardianPhone: approvingReq.phone || '',
          guardianEmail: '',
          status: 'active',
          history: [
            {
              date: new Date().toISOString().slice(0, 10),
              event: `Approved via School Code join application ${approvingReq.applicationNumber}`,
              academicYear: school.academicYear || '2026-2027',
            },
          ],
          createdBy: actor.uid,
          createdAt: now,
          updatedAt: now,
        });
      } else if (approvingReq.requestedRole === 'teacher') {
        linkedProfileId = generateId('tch');
        batch.set(doc(db, 'teachers', linkedProfileId), {
          id: linkedProfileId,
          schoolId: school.id,
          userId: approvingReq.applicantUid,
          staffId: staffId.trim().slice(0, 32),
          name: approvingReq.applicantName.slice(0, 120),
          email: approvingReq.applicantEmail.toLowerCase(),
          phone: approvingReq.phone || '',
          subjects: subjectsCsv.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12),
          qualifications: '',
          joiningDate: new Date().toISOString().slice(0, 10),
          assignedClassIds: selectedClassIds,
          classTeacherOfClassId: '',
          status: 'active',
          createdBy: actor.uid,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Write Email Directory binding so applicant auto-claims their approved role & schoolId immediately
      const dirPayload: Record<string, unknown> = {
        emailKey,
        email: approvingReq.applicantEmail.toLowerCase(),
        schoolId: school.id,
        schoolName: school.name,
        role: approvingReq.requestedRole,
        displayName: approvingReq.applicantName.slice(0, 120),
        linkedProfileId,
        classId: finalClassId,
        section: finalSection,
        assignedClassIds: approvingReq.requestedRole === 'student' ? [] : selectedClassIds,
        status: 'active',
        createdBy: actor.uid,
        createdAt: now,
        updatedAt: now,
      };
      if (approvingReq.requestedRole === 'coordinator') {
        dirPayload.coordinatorPermissions = coordPerms;
      }
      batch.set(doc(db, 'emailDirectory', emailKey), dirPayload);

      const noteText =
        decisionNote.trim() ||
        `Approved as ${approvingReq.requestedRole} at ${school.name}. Sign in with Email/Password or Google to enter your portal.`;

      batch.update(doc(db, 'schoolJoinRequests', approvingReq.id), {
        status: 'approved',
        decisionNote: noteText.slice(0, 500),
        reviewedBy: actor.uid,
        updatedAt: now,
      });

      batch.update(doc(db, 'applicationStatuses', approvingReq.applicationNumber), {
        status: 'approved',
        schoolCode: school.code,
        decisionNote: noteText.slice(0, 500),
        applicantMessage: noteText.slice(0, 1000),
        updatedAt: now,
      });

      await batch.commit();
      await recordAuditLog({
        schoolId: school.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'APPROVE_JOIN_REQUEST',
        targetType: 'schoolJoinRequest',
        targetId: approvingReq.id,
        targetLabel: `${approvingReq.applicantName} (${approvingReq.requestedRole})`,
      }).catch(() => undefined);

      pushToast(
        'success',
        `Approved ${approvingReq.applicantName} as ${approvingReq.requestedRole}. Their email is now active for sign-in.`,
      );
      setApprovingReq(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to approve join request.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school || !rejectingReq || !canWrite) return;
    if (decisionNote.trim().length < 4) {
      pushToast('error', 'Enter a short reason for rejecting this join application.');
      return;
    }
    setSaving(true);
    try {
      const now = serverTimestamp();
      const batch = writeBatch(db);
      batch.update(doc(db, 'schoolJoinRequests', rejectingReq.id), {
        status: 'rejected',
        decisionNote: decisionNote.trim().slice(0, 500),
        reviewedBy: actor.uid,
        updatedAt: now,
      });
      batch.update(doc(db, 'applicationStatuses', rejectingReq.applicationNumber), {
        status: 'rejected',
        decisionNote: decisionNote.trim().slice(0, 500),
        applicantMessage: decisionNote.trim().slice(0, 1000),
        updatedAt: now,
      });
      await batch.commit();
      pushToast('success', `Rejected join request ${rejectingReq.applicationNumber}.`);
      setRejectingReq(null);
      setDecisionNote('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to reject join request.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((tab) => {
            const count = tab === 'all' ? requests.length : requests.filter((r) => r.status === tab).length;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize cursor-pointer ${
                  filter === tab ? 'bg-[#0B1528] text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab} ({count})
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          School Code: <span className="font-mono font-bold text-slate-900">{school?.code || '—'}</span>
        </p>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No join requests in this view"
          description="Unregistered Coordinators, Teachers, and Students who submit your School Code on /join-school will appear here for Principal approval."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {filtered.map((req) => (
            <div key={req.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StatusText status={req.status} />
                  <span className="text-slate-300">·</span>
                  <span className="font-semibold text-teal-800 capitalize">{req.requestedRole}</span>
                  {req.accessCode && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono font-bold text-[#0B1528]">{req.accessCode}</span>
                    </>
                  )}
                  <span className="text-slate-300">·</span>
                  <span className="font-mono text-slate-500">{req.applicationNumber}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-400 tabular-nums">{formatFirestoreDateTime(req.createdAt)}</span>
                </div>
                <p className="text-sm font-bold text-slate-900">{req.applicantName}</p>
                <p className="text-xs text-slate-600">
                  {req.applicantEmail} {req.phone ? `· ${req.phone}` : ''}
                </p>
                {req.requestedClassInfo && (
                  <p className="text-xs text-slate-600">
                    {req.requestedClassId ? 'Auto-Identified Class: ' : 'Requested Class / Subject: '}
                    <span className="font-medium text-slate-800">{req.requestedClassInfo}</span>
                  </p>
                )}
                {req.note && <p className="text-xs text-slate-500 italic">&ldquo;{req.note}&rdquo;</p>}
                {req.decisionNote && <p className="text-xs text-slate-700 pt-1">Decision: {req.decisionNote}</p>}
              </div>

              {req.status === 'pending' && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!canWrite}
                    onClick={() => {
                      setRejectingReq(req);
                      setDecisionNote('');
                    }}
                  >
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </Button>
                  <Button variant="primary" size="sm" disabled={!canWrite} onClick={() => openApproveModal(req)}>
                    <UserCheck className="w-3.5 h-3.5" /> Approve & Assign
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Approve Modal */}
      <Modal
        open={Boolean(approvingReq)}
        onClose={() => setApprovingReq(null)}
        title={approvingReq ? `Approve ${approvingReq.applicantName} (${approvingReq.requestedRole})` : 'Approve Request'}
        subtitle="Assign class/role scope. Approving binds their email immediately for both Email/Password and Google login."
      >
        {approvingReq && (
          <form onSubmit={handleConfirmApprove} className="space-y-4">
            {approvingReq.requestedRole === 'student' && (
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Assign Class & Section</label>
                  <select
                    value={assignClassId}
                    onChange={(e) => setAssignClassId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Admission Number *</label>
                  <input
                    required
                    value={admissionNo}
                    onChange={(e) => setAdmissionNo(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Roll No. *</label>
                  <input
                    required
                    value={rollNo}
                    onChange={(e) => setRollNo(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            )}

            {approvingReq.requestedRole === 'teacher' && (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Staff ID *</label>
                    <input
                      required
                      value={staffId}
                      onChange={(e) => setStaffId(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Subjects (comma-separated)</label>
                    <input
                      value={subjectsCsv}
                      onChange={(e) => setSubjectsCsv(e.target.value)}
                      placeholder="Mathematics, Physics"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-700 mb-1.5">Assigned Classes</p>
                  <div className="flex flex-wrap gap-2">
                    {classes.map((cl) => {
                      const sel = selectedClassIds.includes(cl.id);
                      return (
                        <button
                          key={cl.id}
                          type="button"
                          onClick={() =>
                            setSelectedClassIds((prev) =>
                              sel ? prev.filter((x) => x !== cl.id) : [...prev, cl.id],
                            )
                          }
                          className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer ${
                            sel ? 'bg-[#0B1528] text-white border-[#0B1528]' : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          {cl.code}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {approvingReq.requestedRole === 'coordinator' && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-slate-700 mb-1.5">Coordinator Class Scope</p>
                  <div className="flex flex-wrap gap-2">
                    {classes.map((cl) => {
                      const sel = selectedClassIds.includes(cl.id);
                      return (
                        <button
                          key={cl.id}
                          type="button"
                          onClick={() =>
                            setSelectedClassIds((prev) =>
                              sel ? prev.filter((x) => x !== cl.id) : [...prev, cl.id],
                            )
                          }
                          className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer ${
                            sel ? 'bg-[#0B1528] text-white border-[#0B1528]' : 'bg-white text-slate-700 border-slate-300'
                          }`}
                        >
                          {cl.code}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1.5 pt-2 border-t border-slate-200">
                  <p className="text-xs font-semibold text-slate-700">Granted Coordinator Permissions</p>
                  {(
                    [
                      ['canEditAttendance', 'Allow editing attendance registers'],
                      ['canEditMarks', 'Allow editing examination marks'],
                      ['canAssignTeachers', 'Allow adjusting teacher assignments'],
                      ['canPublishNotices', 'Allow publishing academic notices'],
                      ['canCoordinateExams', 'Allow coordinating examination schedules'],
                    ] as [keyof CoordinatorPermissions, string][]
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={coordPerms[key]}
                        onChange={(e) => setCoordPerms({ ...coordPerms, [key]: e.target.checked })}
                        className="rounded border-slate-300 text-teal-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Welcome Note (Optional)</label>
              <input
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="Visible to applicant on /application-status…"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setApprovingReq(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                <GraduationCap className="w-4 h-4" />
                {saving ? 'Approving…' : 'Confirm Approval'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reject Modal */}
      <Modal
        open={Boolean(rejectingReq)}
        onClose={() => setRejectingReq(null)}
        title="Reject Join Application"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleConfirmReject} className="space-y-4">
          <p className="text-xs text-slate-600">
            Provide a reason visible to <strong>{rejectingReq?.applicantName}</strong> when they check application{' '}
            <span className="font-mono">{rejectingReq?.applicationNumber}</span>.
          </p>
          <textarea
            rows={3}
            required
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            placeholder="e.g., Email does not match current semester enrollment records…"
            className="w-full text-sm border border-slate-300 rounded-lg p-3"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRejectingReq(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={saving}>
              {saving ? 'Rejecting…' : 'Confirm Reject'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// Principal Role-Based Access Codes Directory (/principal/access-codes)
// ============================================================================
interface GeneratedCodeRow {
  code: string;
  role: 'principal' | 'coordinator' | 'teacher' | 'student';
  slotNumber: number;
  classLabel: string;
  classId: string;
  rollNumber: string;
}

export function PrincipalAccessCodesView({
  school,
  classes,
  actor,
  canWrite,
}: {
  school: School | null;
  classes: SchoolClass[];
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [codeDoc, setCodeDoc] = useState<SchoolCodeEntry | null>(null);
  const [roleTab, setRoleTab] = useState<'all' | 'principal' | 'coordinator' | 'teacher' | 'student'>('all');
  const [classFilter, setClassFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Editable allocation counts
  const [coordInput, setCoordInput] = useState(String(school?.allocatedCoordinators ?? 6));
  const [teacherInput, setTeacherInput] = useState(String(school?.allocatedTeachers ?? 20));
  const [studentInput, setStudentInput] = useState(String(school?.allocatedStudents ?? 100));
  const [savingAlloc, setSavingAlloc] = useState(false);

  useEffect(() => {
    if (!school?.code) return;
    const unsub = onSnapshot(
      doc(db, 'schoolCodes', school.code),
      (snap) => {
        if (snap.exists()) {
          const entry = snap.data() as SchoolCodeEntry;
          setCodeDoc(entry);
          setCoordInput(String(entry.coordinatorCount ?? school.allocatedCoordinators ?? 6));
          setTeacherInput(String(entry.teacherCount ?? school.allocatedTeachers ?? 20));
          setStudentInput(String(entry.studentCount ?? school.allocatedStudents ?? 100));
        }
      },
      () => undefined,
    );
    return () => unsub();
  }, [school?.code, school?.allocatedCoordinators, school?.allocatedTeachers, school?.allocatedStudents]);

  const prefix = school?.code || 'SCH';
  const coordCount = codeDoc?.coordinatorCount ?? school?.allocatedCoordinators ?? 6;
  const teacherCount = codeDoc?.teacherCount ?? school?.allocatedTeachers ?? 20;
  const studentCount = codeDoc?.studentCount ?? school?.allocatedStudents ?? 100;

  const classSlots: SchoolCodeClassSlot[] = useMemo(() => {
    if (classes.length > 0) {
      return classes.slice(0, 200).map((c) => ({
        classId: c.id,
        className: c.name,
        gradeLevel: c.gradeLevel,
        section: c.section,
      }));
    }
    return codeDoc?.classSections || [];
  }, [classes, codeDoc?.classSections]);

  const allCodes: GeneratedCodeRow[] = useMemo(() => {
    const rows: GeneratedCodeRow[] = [
      {
        code: formatPrincipalCode(prefix),
        role: 'principal',
        slotNumber: 1,
        classLabel: 'All Classes & Campus Admin',
        classId: '',
        rollNumber: '—',
      },
    ];

    const safeCoords = Math.min(coordCount, 500);
    for (let i = 1; i <= safeCoords; i++) {
      const assigned = resolveCoordinatorClassesForIndex(classSlots, i, coordCount);
      const gradeSet = Array.from(new Set(assigned.map((s) => s.gradeLevel)));
      rows.push({
        code: formatMemberRoleCode(prefix, 'coordinator', i, coordCount),
        role: 'coordinator',
        slotNumber: i,
        classLabel: gradeSet.length > 0 ? `${gradeSet.join(', ')} (${assigned.length} sec)` : 'School-wide',
        classId: '',
        rollNumber: '—',
      });
    }

    const safeTeachers = Math.min(teacherCount, 1000);
    for (let i = 1; i <= safeTeachers; i++) {
      rows.push({
        code: formatMemberRoleCode(prefix, 'teacher', i, teacherCount),
        role: 'teacher',
        slotNumber: i,
        classLabel: 'Assigned on Approval',
        classId: '',
        rollNumber: '—',
      });
    }

    const safeStudents = Math.min(studentCount, 5000);
    for (let i = 1; i <= safeStudents; i++) {
      const { slot, rollNumber } = resolveStudentClassForIndex(classSlots, i, studentCount);
      rows.push({
        code: formatMemberRoleCode(prefix, 'student', i, studentCount),
        role: 'student',
        slotNumber: i,
        classLabel: slot ? slot.className : 'Unassigned',
        classId: slot?.classId || '',
        rollNumber: `#${rollNumber}`,
      });
    }

    return rows;
  }, [prefix, coordCount, teacherCount, studentCount, classSlots]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allCodes.filter((row) => {
      if (roleTab !== 'all' && row.role !== roleTab) return false;
      if (classFilter !== 'all' && row.role === 'student' && row.classId !== classFilter) return false;
      if (classFilter !== 'all' && row.role !== 'student') return false;
      if (q && !`${row.code} ${row.role} ${row.classLabel} ${row.rollNumber}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [allCodes, roleTab, classFilter, searchTerm]);

  const pageSize = 50;
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSaveAllocations = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school || !canWrite) return;
    const nextCoords = Math.max(0, Math.min(5000, Number(coordInput) || 0));
    const nextTeachers = Math.max(0, Math.min(20000, Number(teacherInput) || 0));
    const nextStudents = Math.max(0, Math.min(100000, Number(studentInput) || 0));

    setSavingAlloc(true);
    try {
      const now = serverTimestamp();
      const batch = writeBatch(db);
      batch.update(doc(db, 'schools', school.id), {
        allocatedCoordinators: nextCoords,
        allocatedTeachers: nextTeachers,
        allocatedStudents: nextStudents,
        updatedAt: now,
      });

      if (codeDoc) {
        batch.update(doc(db, 'schoolCodes', school.code), {
          coordinatorCount: nextCoords,
          teacherCount: nextTeachers,
          studentCount: nextStudents,
          classSections: classSlots.slice(0, 200),
          updatedAt: now,
        });
      } else {
        await setDoc(doc(db, 'schoolCodes', school.code), {
          code: school.code,
          schoolId: school.id,
          schoolName: school.name,
          status: school.status,
          principalCode: formatPrincipalCode(school.code),
          coordinatorCount: nextCoords,
          teacherCount: nextTeachers,
          studentCount: nextStudents,
          classSections: classSlots.slice(0, 200),
          createdAt: now,
          updatedAt: now,
        });
      }

      await batch.commit();
      await recordAuditLog({
        schoolId: school.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'UPDATE_ACCESS_CODE_ALLOCATIONS',
        targetType: 'schoolCodes',
        targetId: school.code,
        targetLabel: `Coord:${nextCoords}, Teacher:${nextTeachers}, Student:${nextStudents}`,
      }).catch(() => undefined);
      pushToast('success', 'Role access code counts & class mappings synced.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to update code allocations.');
    } finally {
      setSavingAlloc(false);
    }
  };

  const handleExportCsv = () => {
    exportToCsv(
      `${prefix}_access_codes.csv`,
      ['Access Code', 'Role', 'Slot #', 'School', 'Auto-Identified Class / Scope', 'Roll No'],
      filtered.map((r) => [r.code, r.role, String(r.slotNumber), school?.name || '', r.classLabel, r.rollNumber]),
    );
    pushToast('success', `Exported ${filtered.length} access codes to CSV.`);
  };

  if (!school) return null;

  return (
    <div className="space-y-6">
      {/* Top Role Code Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Principal Login Code" value={formatPrincipalCode(prefix)} tone="teal" subtext={`Prefix: ${prefix}`} />
        <StatCard
          label={`Coordinator Codes (${coordCount})`}
          value={formatRoleCodeRange(prefix, 'coordinator', coordCount)}
          subtext="Auto-identifies school & scope"
        />
        <StatCard
          label={`Teacher Codes (${teacherCount})`}
          value={formatRoleCodeRange(prefix, 'teacher', teacherCount)}
          subtext="Faculty join identification"
        />
        <StatCard
          label={`Student Codes (${studentCount})`}
          value={formatRoleCodeRange(prefix, 'student', studentCount)}
          subtext={`Mapped across ${classSlots.length} class-sections`}
        />
      </div>

      {/* Allocation Update Form */}
      <form
        onSubmit={handleSaveAllocations}
        className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-end justify-between gap-4"
      >
        <div className="space-y-1 max-w-md">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <KeyRound className="w-4 h-4 text-teal-700" />
            Manage Role Code Counts &amp; Class Sync
          </div>
          <p className="text-xs text-slate-500">
            Update the number of Coordinators, Teachers, or Students anytime to expand or trim valid sequential codes
            and refresh class-section assignments.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Coordinators</label>
            <input
              type="text"
              inputMode="numeric"
              value={coordInput}
              onChange={(e) => setCoordInput(sanitizePhoneDigits(e.target.value, 4))}
              className="w-24 px-3 py-2 text-xs tabular-nums border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Teachers</label>
            <input
              type="text"
              inputMode="numeric"
              value={teacherInput}
              onChange={(e) => setTeacherInput(sanitizePhoneDigits(e.target.value, 5))}
              className="w-24 px-3 py-2 text-xs tabular-nums border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Students</label>
            <input
              type="text"
              inputMode="numeric"
              value={studentInput}
              onChange={(e) => setStudentInput(sanitizePhoneDigits(e.target.value, 6))}
              className="w-28 px-3 py-2 text-xs tabular-nums border border-slate-300 rounded-lg"
            />
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={!canWrite || savingAlloc}>
            <RefreshCw className={`w-3.5 h-3.5 ${savingAlloc ? 'animate-spin' : ''}`} />
            {savingAlloc ? 'Syncing…' : 'Save & Sync Codes'}
          </Button>
        </div>
      </form>

      {/* Filter Toolbar & CSV Export */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'principal', 'coordinator', 'teacher', 'student'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setRoleTab(tab);
                setPage(1);
                if (tab !== 'student') setClassFilter('all');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize cursor-pointer ${
                roleTab === tab ? 'bg-[#0B1528] text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {classSlots.length > 0 && (
            <select
              aria-label="Filter student codes by class"
              value={classFilter}
              onChange={(e) => {
                setClassFilter(e.target.value);
                if (e.target.value !== 'all') setRoleTab('student');
                setPage(1);
              }}
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-2 bg-white"
            >
              <option value="all">All Classes</option>
              {classSlots.map((slot) => (
                <option key={slot.classId} value={slot.classId}>
                  {slot.className}
                </option>
              ))}
            </select>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              placeholder="Search code or class…"
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg w-48 focus:outline-none focus:border-teal-600"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={handleExportCsv}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <th className="py-3 px-4 font-semibold">Access Code</th>
              <th className="py-3 px-4 font-semibold">Role</th>
              <th className="py-3 px-4 font-semibold">Auto-Identified Class / Scope</th>
              <th className="py-3 px-4 font-semibold">Roll No.</th>
              <th className="py-3 px-4 font-semibold text-right">Copy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.map((row) => (
              <tr key={`${row.role}-${row.code}`} className="hover:bg-slate-50/70">
                <td className="py-2.5 px-4 font-mono text-xs font-bold text-[#0B1528] tabular-nums">{row.code}</td>
                <td className="py-2.5 px-4 text-xs font-medium capitalize text-teal-800">{row.role}</td>
                <td className="py-2.5 px-4 text-xs text-slate-700">{row.classLabel}</td>
                <td className="py-2.5 px-4 text-xs font-mono text-slate-500 tabular-nums">{row.rollNumber}</td>
                <td className="py-2.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(row.code);
                      setCopiedCode(row.code);
                      setTimeout(() => setCopiedCode(null), 1600);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 cursor-pointer"
                  >
                    {copiedCode === row.code ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </>
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > pageSize && (
          <div className="p-3 border-t border-slate-100">
            <PaginationBar
              page={page}
              totalPages={Math.max(1, Math.ceil(filtered.length / pageSize))}
              totalItems={filtered.length}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

