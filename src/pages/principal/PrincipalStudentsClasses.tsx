import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import {
  Plus,
  Download,
  ArrowRightLeft,
  History,
  FileSpreadsheet,
  Search,
  Copy,
  Check,
  GraduationCap,
  KeyRound,
  Eye,
  Trash2,
  Sparkles,
  UserX,
  AlertTriangle,
} from 'lucide-react';
import { db, generateId, handleFirestoreError, OperationType } from '../../lib/firebase';
import { exportToCsv } from '../../lib/csv';
import { recordAuditLog } from '../../lib/audit';
import {
  removeOrWithdrawStudent,
  upsertEmailDirectoryEntry,
  upsertMemberAccessCode,
} from '../../lib/schoolProvisioning';
import {
  buildStudentFourCodePack,
  deriveClassSectionCode,
  formatMemberRoleCode,
  formatStudentFourCodeMessage,
  groupClassesByGrade,
  normalizeGradeLevel,
  sanitizePhoneDigits,
  sortClassesInOrder,
  type StudentFourCodePack,
} from '../../lib/schoolCodes';
import {
  Button,
  EmptyState,
  Modal,
  PaginationBar,
  SkeletonTable,
  StatusText,
  useToast,
} from '../../components/ui/Primitives';
import {
  SeparateSchoolCodeCard,
  StudentFourCodesModal,
} from '../../components/shared/GradeClassControls';
import type {
  MemberAccessCode,
  PlatformUser,
  Room,
  SchoolClass,
  StudentProfile,
  Subject,
  TeacherProfile,
  Examination,
} from '../../types/models';

// ============================================================================
// Students Management + Validated Bulk CSV Import/Export + Transfer/Promote
// ============================================================================
export function PrincipalStudentsView({
  students,
  classes,
  teachers = [],
  schoolId,
  schoolCode = 'SCH',
  schoolName = '',
  allocatedStudents,
  academicYear,
  actor,
  canWrite,
  globalSearch,
  loading,
  onOpenExcelImport,
}: {
  students: StudentProfile[];
  classes: SchoolClass[];
  teachers?: TeacherProfile[];
  schoolId: string;
  schoolCode?: string;
  schoolName?: string;
  allocatedStudents?: number;
  academicYear: string;
  actor: PlatformUser;
  canWrite: boolean;
  globalSearch: string;
  loading: boolean;
  onOpenExcelImport?: () => void;
}) {
  const { pushToast } = useToast();
  const [classFilter, setClassFilter] = useState('all');
  const [localSearch, setLocalSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [namedStudentCodes, setNamedStudentCodes] = useState<MemberAccessCode[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StudentProfile | null>(null);
  const [historyStudent, setHistoryStudent] = useState<StudentProfile | null>(null);
  const [transferStudent, setTransferStudent] = useState<StudentProfile | null>(null);
  const [targetClassId, setTargetClassId] = useState('');
  const [transferType, setTransferType] = useState<'transfer' | 'promote'>('transfer');

  // View 4 Codes modal
  const [fourCodesPack, setFourCodesPack] = useState<StudentFourCodePack | null>(null);

  // Assign Code modal (Auto-Generate / Pick Available / Custom)
  const [assignCodeStudent, setAssignCodeStudent] = useState<StudentProfile | null>(null);
  const [assignCodeMode, setAssignCodeMode] = useState<'auto' | 'pick' | 'custom'>('auto');
  const [selectedAvailableCode, setSelectedAvailableCode] = useState('');
  const [customCodeInput, setCustomCodeInput] = useState('');
  const [assigningCode, setAssigningCode] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);

  // Remove Student modal (Withdraw vs Permanently Delete)
  const [removeStudentTarget, setRemoveStudentTarget] = useState<StudentProfile | null>(null);
  const [removeMode, setRemoveMode] = useState<'withdraw' | 'delete'>('withdraw');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [removingStudent, setRemovingStudent] = useState(false);

  const [form, setForm] = useState({
    admissionNumber: '',
    rollNumber: '',
    name: '',
    email: '',
    classId: '',
    accessCode: '',
    guardianName: '',
    guardianPhone: '',
    guardianEmail: '',
    status: 'active' as StudentProfile['status'],
  });

  useEffect(() => {
    if (!schoolId) return;
    const q = query(collection(db, 'memberAccessCodes'), where('schoolId', '==', schoolId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as MemberAccessCode)
          .filter((m) => m.role === 'student');
        setNamedStudentCodes(list);
      },
      () => undefined,
    );
    return () => unsub();
  }, [schoolId]);

  const gradeGroups = useMemo(() => groupClassesByGrade(classes), [classes]);
  const orderedClasses = useMemo(() => sortClassesInOrder(classes), [classes]);

  const usedCodesMap = useMemo(() => {
    const map = new Map<string, { studentId?: string; ownerName: string }>();
    students.forEach((s) => {
      const c = (s.accessCode || '').trim().toUpperCase();
      if (c) map.set(c, { studentId: s.id, ownerName: s.name });
    });
    namedStudentCodes.forEach((m) => {
      const c = (m.code || '').trim().toUpperCase();
      if (c && !map.has(c) && m.linkedProfileId && m.status !== 'revoked') {
        map.set(c, { studentId: m.linkedProfileId, ownerName: m.memberName });
      }
    });
    return map;
  }, [students, namedStudentCodes]);

  const totalCodeBaseline = useMemo(
    () => Math.max(allocatedStudents ?? 100, students.length + 25, 100),
    [allocatedStudents, students.length],
  );

  const computeNextAutoCode = (extraUsed?: Set<string>) => {
    let seq = 1;
    while (seq <= totalCodeBaseline + 5000) {
      const candidate = formatMemberRoleCode(schoolCode, 'student', seq, Math.max(seq, totalCodeBaseline));
      if (!usedCodesMap.has(candidate) && !(extraUsed && extraUsed.has(candidate))) {
        return candidate;
      }
      seq += 1;
    }
    return formatMemberRoleCode(schoolCode, 'student', students.length + 1, Math.max(students.length + 1, 100));
  };

  const availableCodesList = useMemo(() => {
    const out: { code: string; label: string }[] = [];
    const seen = new Set<string>();
    // First include any unclaimed named student codes in Firestore
    namedStudentCodes
      .filter((m) => !m.linkedProfileId && m.status !== 'revoked')
      .forEach((m) => {
        const c = m.code.trim().toUpperCase();
        if (c && !usedCodesMap.has(c) && !seen.has(c)) {
          seen.add(c);
          out.push({ code: c, label: `${c}${m.memberName ? ` · Unlinked (${m.memberName})` : ' · Unlinked slot'}` });
        }
      });
    // Then add next 30 open sequential school student codes
    let seq = 1;
    while (out.length < 35 && seq <= totalCodeBaseline + 200) {
      const candidate = formatMemberRoleCode(schoolCode, 'student', seq, Math.max(seq, totalCodeBaseline));
      if (!usedCodesMap.has(candidate) && !seen.has(candidate)) {
        seen.add(candidate);
        out.push({ code: candidate, label: `${candidate} · Open sequential slot #${seq}` });
      }
      seq += 1;
    }
    return out;
  }, [namedStudentCodes, usedCodesMap, schoolCode, totalCodeBaseline]);

  const studentsMissingCode = useMemo(
    () => students.filter((s) => !(s.accessCode || '').trim() && s.status !== 'withdrawn'),
    [students],
  );

  const activeSearch = (localSearch || globalSearch).trim();

  const filtered = useMemo(() => {
    const q = activeSearch.toLowerCase();
    return students.filter((s) => {
      if (classFilter !== 'all' && s.classId !== classFilter) return false;
      if (
        q &&
        !`${s.name} ${s.admissionNumber} ${s.rollNumber} ${s.className} ${s.section} ${s.accessCode || ''}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [students, classFilter, activeSearch]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const copyFourCodesForStudent = (st: StudentProfile) => {
    const pack = buildStudentFourCodePack({
      schoolCode,
      schoolName: schoolName || 'School',
      student: st,
      classes,
      teachers,
    });
    const msg = formatStudentFourCodeMessage(pack);
    navigator.clipboard?.writeText(msg);
    setCopiedKey(`four-${st.id}`);
    pushToast('success', `Copied all 4 login codes for ${st.name}.`);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const openFourCodesModal = (st: StudentProfile) => {
    setFourCodesPack(
      buildStudentFourCodePack({
        schoolCode,
        schoolName: schoolName || 'School',
        student: st,
        classes,
        teachers,
      }),
    );
  };

  const openAssignCodeModal = (st: StudentProfile) => {
    setAssignCodeStudent(st);
    setAssignCodeMode('auto');
    setSelectedAvailableCode(availableCodesList[0]?.code || computeNextAutoCode());
    setCustomCodeInput((st.accessCode || '').trim().toUpperCase());
  };

  const persistAssignedStudentCode = async (student: StudentProfile, rawCode: string) => {
    const cleanCode = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    if (cleanCode.length < 4) {
      throw new Error('Student code must be at least 4 alphanumeric characters.');
    }
    const existingOwner = usedCodesMap.get(cleanCode);
    if (existingOwner && existingOwner.studentId && existingOwner.studentId !== student.id) {
      throw new Error(`Code "${cleanCode}" is already assigned to ${existingOwner.ownerName}.`);
    }

    const cls = classes.find((c) => c.id === student.classId);
    const classTeacher = cls
      ? teachers.find((t) => t.id === cls.classTeacherId || t.classTeacherOfClassId === cls.id) ||
        teachers.find((t) => (t.assignedClassIds || []).includes(cls.id))
      : undefined;

    await updateDoc(doc(db, 'students', student.id), {
      accessCode: cleanCode,
      updatedAt: serverTimestamp(),
    });

    // If student had a different code before, mark old code revoked/unlinked cleanly
    const oldCode = (student.accessCode || '').trim().toUpperCase();
    if (oldCode && oldCode !== cleanCode) {
      await updateDoc(doc(db, 'memberAccessCodes', oldCode), {
        status: 'revoked',
        linkedProfileId: '',
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }

    await upsertMemberAccessCode({
      code: cleanCode,
      schoolId,
      schoolCode,
      schoolName: schoolName || 'School',
      role: 'student',
      memberName: student.name,
      email: student.email || '',
      classId: cls?.id || student.classId || '',
      classCode: cls?.code || '',
      className: cls?.name || student.className || '',
      teacherId: classTeacher?.id || '',
      teacherCode: classTeacher?.accessCode || classTeacher?.staffId || '',
      teacherName: classTeacher?.name || cls?.classTeacherName || '',
      rollNumber: student.rollNumber || '',
      status: student.status === 'active' || student.status === 'promoted' ? 'active' : 'revoked',
      linkedProfileId: student.id,
      linkedUid: student.userId || '',
      createdBy: actor.uid,
    });

    if (student.email) {
      await upsertEmailDirectoryEntry({
        email: student.email,
        schoolId,
        schoolName,
        role: 'student',
        displayName: student.name,
        accessCode: cleanCode,
        linkedProfileId: student.id,
        classId: cls?.id || student.classId || '',
        section: cls?.section || student.section || '',
        createdBy: actor.uid,
      }).catch(() => undefined);
    }

    return cleanCode;
  };

  const handleConfirmAssignCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignCodeStudent || !canWrite) return;
    const targetCode =
      assignCodeMode === 'auto'
        ? computeNextAutoCode()
        : assignCodeMode === 'pick'
          ? selectedAvailableCode
          : customCodeInput;
    setAssigningCode(true);
    try {
      const savedCode = await persistAssignedStudentCode(assignCodeStudent, targetCode);
      const updatedStudent: StudentProfile = { ...assignCodeStudent, accessCode: savedCode };
      pushToast('success', `Assigned Student Code ${savedCode} to ${assignCodeStudent.name}.`);
      setAssignCodeStudent(null);
      openFourCodesModal(updatedStudent);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to assign code.');
    } finally {
      setAssigningCode(false);
    }
  };

  const handleBulkAssignMissingCodes = async () => {
    if (!canWrite || studentsMissingCode.length === 0) return;
    setBulkAssigning(true);
    try {
      const reserved = new Set<string>();
      let assignedCount = 0;
      for (const st of studentsMissingCode) {
        const nextCode = computeNextAutoCode(reserved);
        reserved.add(nextCode);
        await persistAssignedStudentCode(st, nextCode);
        assignedCount += 1;
      }
      pushToast(
        'success',
        `Auto-assigned unique codes to ${assignedCount} student${assignedCount === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Bulk code assignment encountered an error.');
    } finally {
      setBulkAssigning(false);
    }
  };

  const handleConfirmRemoveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!removeStudentTarget || !canWrite) return;
    setRemovingStudent(true);
    try {
      await removeOrWithdrawStudent({
        mode: removeMode,
        student: removeStudentTarget,
        schoolId,
        totalStudentsCount: students.length,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role === 'main_head' ? 'main_head' : 'principal',
        academicYear,
        reason: withdrawReason,
      });
      pushToast(
        'success',
        removeMode === 'withdraw'
          ? `${removeStudentTarget.name} marked as withdrawn and access code revoked.`
          : `Permanently deleted ${removeStudentTarget.name} from the school roster.`,
      );
      setRemoveStudentTarget(null);
      setWithdrawReason('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to remove student.');
    } finally {
      setRemovingStudent(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm({
      admissionNumber: `ADM-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 899)}`,
      rollNumber: String(students.length + 1).padStart(2, '0'),
      name: '',
      email: '',
      classId: orderedClasses[0]?.id || '',
      accessCode: computeNextAutoCode(),
      guardianName: '',
      guardianPhone: '',
      guardianEmail: '',
      status: 'active',
    });
    setModalOpen(true);
  };

  const openEdit = (st: StudentProfile) => {
    setEditing(st);
    setForm({
      admissionNumber: st.admissionNumber,
      rollNumber: st.rollNumber,
      name: st.name,
      email: st.email || '',
      classId: st.classId,
      accessCode: st.accessCode || '',
      guardianName: st.guardianName || '',
      guardianPhone: st.guardianPhone || '',
      guardianEmail: st.guardianEmail || '',
      status: st.status,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const cls = classes.find((c) => c.id === form.classId);
    if (!cls) {
      pushToast('error', 'Select a valid class/section.');
      return;
    }
    const dupAdm = students.find(
      (s) => s.admissionNumber.toLowerCase() === form.admissionNumber.trim().toLowerCase() && s.id !== editing?.id,
    );
    if (dupAdm) {
      pushToast('error', `Admission number "${form.admissionNumber}" already exists in this school.`);
      return;
    }

    const desiredCode = form.accessCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    if (desiredCode) {
      const conflict = usedCodesMap.get(desiredCode);
      if (conflict && conflict.studentId && conflict.studentId !== editing?.id) {
        pushToast('error', `Student code "${desiredCode}" is already assigned to ${conflict.ownerName}.`);
        return;
      }
    }

    try {
      if (editing) {
        const finalCode = desiredCode || editing.accessCode || '';
        await updateDoc(doc(db, 'students', editing.id), {
          admissionNumber: form.admissionNumber.trim().slice(0, 32),
          rollNumber: form.rollNumber.trim().slice(0, 24),
          name: form.name.trim().slice(0, 120),
          email: form.email.trim().toLowerCase().slice(0, 160),
          classId: cls.id,
          className: cls.name,
          section: cls.section,
          accessCode: finalCode,
          guardianName: form.guardianName.trim().slice(0, 120),
          guardianPhone: form.guardianPhone.trim().slice(0, 32),
          guardianEmail: form.guardianEmail.trim().slice(0, 160),
          status: form.status,
          updatedAt: serverTimestamp(),
        });
        const cleanStudentEmail = form.email.trim().toLowerCase().slice(0, 160);
        if (finalCode) {
          const classTeacher =
            teachers.find((t) => t.id === cls.classTeacherId || t.classTeacherOfClassId === cls.id) ||
            teachers.find((t) => (t.assignedClassIds || []).includes(cls.id));
          await upsertMemberAccessCode({
            code: finalCode,
            schoolId,
            schoolCode,
            schoolName,
            role: 'student',
            memberName: form.name.trim(),
            email: cleanStudentEmail,
            classId: cls.id,
            classCode: cls.code,
            className: cls.name,
            teacherId: classTeacher?.id || '',
            teacherCode: classTeacher?.accessCode || classTeacher?.staffId || '',
            teacherName: classTeacher?.name || cls.classTeacherName || '',
            rollNumber: form.rollNumber.trim(),
            status: form.status === 'active' || form.status === 'promoted' ? 'active' : 'revoked',
            linkedProfileId: editing.id,
            linkedUid: editing.userId || '',
            createdBy: actor.uid,
          }).catch(() => undefined);
        }
        if (cleanStudentEmail) {
          await upsertEmailDirectoryEntry({
            email: cleanStudentEmail,
            schoolId,
            schoolName,
            role: 'student',
            displayName: form.name.trim(),
            accessCode: finalCode,
            linkedProfileId: editing.id,
            classId: cls.id,
            section: cls.section,
            createdBy: actor.uid,
          }).catch(() => undefined);
        }
        pushToast('success', `Updated student ${form.name.trim()}.`);
      } else {
        const id = generateId('stu');
        const cleanStudentEmail = form.email.trim().toLowerCase().slice(0, 160);
        const studentCode = desiredCode || computeNextAutoCode();
        const classTeacher =
          teachers.find((t) => t.id === cls.classTeacherId || t.classTeacherOfClassId === cls.id) ||
          teachers.find((t) => (t.assignedClassIds || []).includes(cls.id));

        await setDoc(doc(db, 'students', id), {
          id,
          schoolId,
          userId: '',
          admissionNumber: form.admissionNumber.trim().slice(0, 32),
          rollNumber: form.rollNumber.trim().slice(0, 24),
          name: form.name.trim().slice(0, 120),
          email: cleanStudentEmail,
          classId: cls.id,
          className: cls.name,
          section: cls.section,
          academicYear,
          guardianName: form.guardianName.trim().slice(0, 120),
          guardianPhone: form.guardianPhone.trim().slice(0, 32),
          guardianEmail: form.guardianEmail.trim().slice(0, 160),
          accessCode: studentCode,
          status: form.status,
          history: [{ date: new Date().toISOString().slice(0, 10), event: `Enrolled in ${cls.name}`, academicYear }],
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await upsertMemberAccessCode({
          code: studentCode,
          schoolId,
          schoolCode,
          schoolName,
          role: 'student',
          memberName: form.name.trim(),
          email: cleanStudentEmail,
          classId: cls.id,
          classCode: cls.code,
          className: cls.name,
          teacherId: classTeacher?.id || '',
          teacherCode: classTeacher?.accessCode || classTeacher?.staffId || '',
          teacherName: classTeacher?.name || cls.classTeacherName || '',
          rollNumber: form.rollNumber.trim(),
          status: 'active',
          linkedProfileId: id,
          createdBy: actor.uid,
        }).catch(() => undefined);
        if (cleanStudentEmail) {
          await upsertEmailDirectoryEntry({
            email: cleanStudentEmail,
            schoolId,
            schoolName,
            role: 'student',
            displayName: form.name.trim(),
            accessCode: studentCode,
            linkedProfileId: id,
            classId: cls.id,
            section: cls.section,
            createdBy: actor.uid,
          }).catch(() => undefined);
        }
        await updateDoc(doc(db, 'schools', schoolId), {
          studentCount: students.length + 1,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
        pushToast('success', `Registered ${form.name.trim()} with Student Code ${studentCode} (Class ${cls.code}).`);
      }
      setModalOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to save student.');
    }
  };

  const handleTransferOrPromote = async () => {
    if (!transferStudent || !targetClassId || !canWrite) return;
    const nextCls = classes.find((c) => c.id === targetClassId);
    if (!nextCls) return;

    const eventText =
      transferType === 'promote'
        ? `Promoted from ${transferStudent.className} to ${nextCls.name}`
        : `Transferred from ${transferStudent.className} to ${nextCls.name}`;

    const nextHistory = [
      ...(transferStudent.history || []),
      {
        date: new Date().toISOString().slice(0, 10),
        event: eventText,
        fromClass: transferStudent.className,
        toClass: nextCls.name,
        academicYear,
      },
    ].slice(-40);

    await updateDoc(doc(db, 'students', transferStudent.id), {
      classId: nextCls.id,
      className: nextCls.name,
      section: nextCls.section,
      status: transferType === 'promote' ? 'promoted' : 'active',
      history: nextHistory,
      updatedAt: serverTimestamp(),
    });
    if (transferStudent.accessCode) {
      const nextTeacher =
        teachers.find((t) => t.id === nextCls.classTeacherId || t.classTeacherOfClassId === nextCls.id) ||
        teachers.find((t) => (t.assignedClassIds || []).includes(nextCls.id));
      await upsertMemberAccessCode({
        code: transferStudent.accessCode,
        schoolId,
        schoolCode,
        schoolName,
        role: 'student',
        memberName: transferStudent.name,
        email: transferStudent.email || '',
        classId: nextCls.id,
        classCode: nextCls.code,
        className: nextCls.name,
        teacherId: nextTeacher?.id || '',
        teacherCode: nextTeacher?.accessCode || nextTeacher?.staffId || '',
        teacherName: nextTeacher?.name || nextCls.classTeacherName || '',
        rollNumber: transferStudent.rollNumber,
        status: 'active',
        linkedProfileId: transferStudent.id,
        linkedUid: transferStudent.userId || '',
        createdBy: actor.uid,
      }).catch(() => undefined);
    }
    await recordAuditLog({
      schoolId,
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      action: transferType === 'promote' ? 'PROMOTE_STUDENT' : 'TRANSFER_STUDENT',
      targetType: 'student',
      targetId: transferStudent.id,
      targetLabel: transferStudent.name,
      details: eventText,
    });
    pushToast('success', eventText);
    setTransferStudent(null);
  };

  if (loading) return <SkeletonTable rows={6} cols={6} />;

  return (
    <div className="space-y-4">
      {/* Separate School Code Banner Card */}
      <SeparateSchoolCodeCard
        schoolCode={schoolCode}
        schoolName={schoolName}
        subtitle="Use this School Code alongside each student's Class Code, Class Teacher Code, and Student Access Code."
      />

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => {
                setLocalSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search student name, roll, or code…"
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg w-60 focus:outline-none focus:border-teal-600"
            />
          </div>
          <select
            value={classFilter}
            onChange={(e) => { setClassFilter(e.target.value); setPage(1); }}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white"
          >
            <option value="all">All Classes ({students.length})</option>
            {gradeGroups.map((grp) => (
              <optgroup key={grp.gradeLevel} label={grp.gradeLevel}>
                {grp.sections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {studentsMissingCode.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              loading={bulkAssigning}
              disabled={!canWrite || bulkAssigning}
              onClick={handleBulkAssignMissingCodes}
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-600" />
              Auto-Assign {studentsMissingCode.length} Missing Code{studentsMissingCode.length === 1 ? '' : 's'}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportToCsv(
                `students_${schoolId}.csv`,
                ['School Code', 'Access Code', 'Admission No', 'Roll No', 'Name', 'Class', 'Section', 'Academic Year', 'Guardian', 'Guardian Phone', 'Status'],
                filtered.map((s) => [schoolCode, s.accessCode || '', s.admissionNumber, s.rollNumber, s.name, s.className, s.section, s.academicYear, s.guardianName || '', s.guardianPhone || '', s.status]),
              )
            }
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
          {onOpenExcelImport && (
            <Button variant="secondary" size="sm" onClick={onOpenExcelImport} disabled={!canWrite}>
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Import Excel
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={openNew} disabled={!canWrite}>
            <Plus className="w-4 h-4" />
            Register Student
          </Button>
        </div>
      </div>

      {/* Live Student Name -> Class & Section Lookup Strip */}
      {activeSearch.length > 0 && filtered.length > 0 && (
        <div className="bg-teal-50/70 border border-teal-200 rounded-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-teal-900 flex items-center gap-1.5">
              <GraduationCap className="w-4 h-4 text-teal-700" />
              Student Lookup Results ({filtered.length} student{filtered.length === 1 ? '' : 's'} found)
            </p>
            {localSearch && (
              <button
                type="button"
                onClick={() => setLocalSearch('')}
                className="text-xs font-medium text-teal-800 hover:underline cursor-pointer"
              >
                Clear search
              </button>
            )}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {filtered.slice(0, 9).map((st) => {
              const cls = classes.find((c) => c.id === st.classId);
              const gradeLabel = cls?.gradeLevel || st.className.split(' - ')[0] || st.className;
              const secLabel = cls?.section || st.section;
              return (
                <div key={`stu-lookup-${st.id}`} className="bg-white border border-teal-200/80 rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{st.name}</p>
                      <p className="text-xs font-semibold text-teal-800 mt-0.5">
                        {gradeLabel}{secLabel ? ` · Section ${secLabel}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Roll #{st.rollNumber} · {st.admissionNumber}
                      </p>
                    </div>
                    {st.accessCode ? (
                      <span className="font-mono text-[11px] font-bold text-[#0F295C] bg-slate-100 px-2 py-0.5 rounded shrink-0">
                        {st.accessCode}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => openAssignCodeModal(st)}
                        className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 cursor-pointer shrink-0"
                      >
                        Assign Code
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[11px]">
                    <button
                      type="button"
                      onClick={() => openFourCodesModal(st)}
                      className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-[#0F295C] cursor-pointer"
                    >
                      <Eye className="w-3 h-3" /> View 4 Codes
                    </button>
                    <button
                      type="button"
                      onClick={() => copyFourCodesForStudent(st)}
                      className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-900 cursor-pointer"
                    >
                      {copiedKey === `four-${st.id}` ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" /> Copied 4 Codes
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy 4 Codes
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {paged.length === 0 ? (
        <EmptyState
          title="No students enrolled"
          description="Register an individual student or import a class roster from Excel."
          actionLabel="Register Student"
          onAction={openNew}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">Adm / Roll / Student Code</th>
                <th className="py-3 px-4 font-semibold">Student Name</th>
                <th className="py-3 px-4 font-semibold">Class &amp; Section</th>
                <th className="py-3 px-4 font-semibold">Login Codes</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.map((st) => (
                <tr key={st.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums">
                    <p className="font-semibold text-slate-900">{st.admissionNumber}</p>
                    <p className="text-slate-500">Roll #{st.rollNumber}</p>
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-900">{st.name}</p>
                    <p className="text-xs text-slate-500">{st.email || st.guardianName || '—'}</p>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">
                    <span className="font-medium text-slate-900">{st.className}</span>
                    <p className="text-[11px] text-slate-500">AY {st.academicYear}</p>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {st.accessCode ? (
                        <span className="font-mono text-xs font-bold text-[#0F295C] bg-slate-100 px-2 py-0.5 rounded tabular-nums">
                          {st.accessCode}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!canWrite}
                          onClick={() => openAssignCodeModal(st)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 cursor-pointer"
                        >
                          <KeyRound className="w-3 h-3" /> Assign Code
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => copyFourCodesForStudent(st)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-900 bg-teal-50/80 border border-teal-200 px-2 py-0.5 rounded cursor-pointer"
                        title="Copy all 4 student login codes (School, Class, Teacher, Student)"
                      >
                        {copiedKey === `four-${st.id}` ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy 4 Codes
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => openFourCodesModal(st)}
                        className="p-1 text-slate-400 hover:text-[#0F295C] cursor-pointer"
                        title="View all 4 login codes"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="py-3 px-4"><StatusText status={st.status} /></td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => openAssignCodeModal(st)}
                        title={st.accessCode ? 'Reassign Student Code' : 'Assign Student Code'}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setHistoryStudent(st)} title="Student History">
                        <History className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => {
                          setTransferStudent(st);
                          setTargetClassId(orderedClasses.find((c) => c.id !== st.classId)?.id || st.classId);
                        }}
                        title="Transfer / Promote"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => openEdit(st)} disabled={!canWrite}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => {
                          setRemoveStudentTarget(st);
                          setRemoveMode('withdraw');
                          setWithdrawReason('');
                        }}
                        title="Remove or Withdraw Student"
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaginationBar page={page} totalPages={totalPages} totalItems={filtered.length} onPageChange={setPage} />

      {/* View All 4 Student Login Codes Modal */}
      <StudentFourCodesModal pack={fourCodesPack} onClose={() => setFourCodesPack(null)} />

      {/* Assign Student Code Modal (Auto-Generate / Pick Available / Custom) */}
      <Modal
        open={Boolean(assignCodeStudent)}
        onClose={() => setAssignCodeStudent(null)}
        title={`Assign Login Code — ${assignCodeStudent?.name || ''}`}
        subtitle="Choose how to assign this student's personal access code."
        maxWidth="max-w-lg"
      >
        {assignCodeStudent && (
          <form onSubmit={handleConfirmAssignCode} className="space-y-4">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{assignCodeStudent.name}</p>
                <p className="text-slate-500">
                  {assignCodeStudent.className} · Roll #{assignCodeStudent.rollNumber}
                </p>
              </div>
              <span className="font-mono text-xs text-slate-600">
                Current: <strong>{assignCodeStudent.accessCode || 'None'}</strong>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['auto', 'Auto-Generate'],
                  ['pick', 'Pick Available'],
                  ['custom', 'Custom Code'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAssignCodeMode(mode)}
                  className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    assignCodeMode === mode
                      ? 'bg-[#0F295C] text-white border-[#0F295C]'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {assignCodeMode === 'auto' && (
              <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200 space-y-1">
                <p className="text-xs font-medium text-teal-800">Next Available School Student Code</p>
                <p className="text-xl font-mono font-bold text-[#0F295C] tabular-nums">
                  {computeNextAutoCode()}
                </p>
                <p className="text-[11px] text-teal-700">
                  Automatically skips all codes currently assigned to other students.
                </p>
              </div>
            )}

            {assignCodeMode === 'pick' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Select from Available Unassigned Codes
                </label>
                <select
                  value={selectedAvailableCode}
                  onChange={(e) => setSelectedAvailableCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-teal-600"
                >
                  {availableCodesList.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {assignCodeMode === 'custom' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Enter Custom Student Code
                </label>
                <input
                  type="text"
                  required
                  value={customCodeInput}
                  onChange={(e) =>
                    setCustomCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24))
                  }
                  placeholder={`Enter custom code (${schoolCode}S...)`}
                  className="w-full px-3.5 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600"
                />
                {customCodeInput &&
                  usedCodesMap.has(customCodeInput) &&
                  usedCodesMap.get(customCodeInput)?.studentId !== assignCodeStudent.id && (
                    <p className="text-xs text-red-600 mt-1">
                      Already assigned to {usedCodesMap.get(customCodeInput)?.ownerName}. Choose a unique code.
                    </p>
                  )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setAssignCodeStudent(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={assigningCode}>
                {assigningCode ? 'Saving Code…' : 'Assign Code & View 4-Code Pack'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Remove Student Modal (Choose Withdraw vs Permanently Delete) */}
      <Modal
        open={Boolean(removeStudentTarget)}
        onClose={() => setRemoveStudentTarget(null)}
        title={`Remove Student — ${removeStudentTarget?.name || ''}`}
        subtitle="Choose whether to withdraw this student while keeping records, or permanently delete them."
        maxWidth="max-w-lg"
      >
        {removeStudentTarget && (
          <form onSubmit={handleConfirmRemoveStudent} className="space-y-4">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
              <p className="font-semibold text-slate-900">{removeStudentTarget.name}</p>
              <p className="text-slate-500 mt-0.5">
                {removeStudentTarget.className} · Admission {removeStudentTarget.admissionNumber} · Roll #
                {removeStudentTarget.rollNumber}
                {removeStudentTarget.accessCode ? ` · Code ${removeStudentTarget.accessCode}` : ''}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRemoveMode('withdraw')}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  removeMode === 'withdraw'
                    ? 'bg-amber-50/90 border-amber-400 ring-1 ring-amber-300'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                  <UserX className="w-4 h-4 text-amber-700" />
                  Withdraw Student
                </div>
                <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                  Marks student as Withdrawn, preserves academic history &amp; reports, and revokes their login code.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setRemoveMode('delete')}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  removeMode === 'delete'
                    ? 'bg-red-50/90 border-red-400 ring-1 ring-red-300'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-bold text-red-900">
                  <Trash2 className="w-4 h-4 text-red-600" />
                  Permanently Delete
                </div>
                <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                  Removes the student record completely, releases their access code, and updates total enrollment count.
                </p>
              </button>
            </div>

            {removeMode === 'withdraw' ? (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Withdrawal Note (Optional)
                </label>
                <input
                  type="text"
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  placeholder="Transfer certificate issued, relocated, etc."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600"
                />
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>
                  Permanent deletion cannot be undone. The student record and assigned access code will be removed immediately.
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setRemoveStudentTarget(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={removeMode === 'delete' ? 'danger' : 'primary'}
                size="sm"
                loading={removingStudent}
              >
                {removingStudent
                  ? 'Processing…'
                  : removeMode === 'delete'
                    ? 'Permanently Delete Student'
                    : 'Confirm Withdrawal'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Individual Student Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.name}` : 'Register Student'} maxWidth="max-w-xl">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Admission No *</label>
              <input type="text" required value={form.admissionNumber} onChange={(e) => setForm({ ...form, admissionNumber: e.target.value })} className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Roll No *</label>
              <input type="text" required value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Class &amp; Section *</label>
              <select required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                {gradeGroups.map((grp) => (
                  <optgroup key={grp.gradeLevel} label={grp.gradeLevel}>
                    {grp.sections.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Student Full Name *</label>
              <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Student Access Code</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={form.accessCode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      accessCode: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24),
                    })
                  }
                  placeholder="Auto-generated"
                  className="w-full px-2.5 py-2 text-xs font-mono uppercase border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, accessCode: computeNextAutoCode() })}
                  title="Generate next available code"
                  className="px-2.5 py-2 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 cursor-pointer shrink-0"
                >
                  Auto
                </button>
              </div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Student Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Guardian Name</label>
              <input type="text" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Guardian Phone (Numbers only)</label>
              <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={15} value={form.guardianPhone} onChange={(e) => setForm({ ...form, guardianPhone: sanitizePhoneDigits(e.target.value) })} placeholder="9876543210" className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StudentProfile['status'] })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="active">Active</option>
                <option value="promoted">Promoted</option>
                <option value="transferred">Transferred</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Save Student</Button>
          </div>
        </form>
      </Modal>

      {/* Transfer / Promote Modal */}
      <Modal open={Boolean(transferStudent)} onClose={() => setTransferStudent(null)} title={`Transfer / Promote · ${transferStudent?.name || ''}`} maxWidth="max-w-md">
        {transferStudent && (
          <div className="space-y-4">
            <p className="text-xs text-slate-600">
              Current placement: <strong>{transferStudent.className}</strong>. Historical records are preserved automatically.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setTransferType('transfer')} className={`flex-1 py-2 text-xs font-medium rounded-lg border cursor-pointer ${transferType === 'transfer' ? 'bg-[#0B1528] text-white border-[#0B1528]' : 'border-slate-300'}`}>
                Transfer Section
              </button>
              <button type="button" onClick={() => setTransferType('promote')} className={`flex-1 py-2 text-xs font-medium rounded-lg border cursor-pointer ${transferType === 'promote' ? 'bg-[#0B1528] text-white border-[#0B1528]' : 'border-slate-300'}`}>
                Promote Next Grade
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Destination Class</label>
              <select value={targetClassId} onChange={(e) => setTargetClassId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                {gradeGroups.map((grp) => (
                  <optgroup key={grp.gradeLevel} label={grp.gradeLevel}>
                    {grp.sections.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setTransferStudent(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleTransferOrPromote}>Confirm Move</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Student History Modal */}
      <Modal open={Boolean(historyStudent)} onClose={() => setHistoryStudent(null)} title={`Academic History · ${historyStudent?.name || ''}`} maxWidth="max-w-md">
        {historyStudent && (
          <div className="space-y-3 text-xs">
            {(historyStudent.history || []).length === 0 ? (
              <p className="text-slate-500">No historical transitions recorded yet.</p>
            ) : (
              (historyStudent.history || []).map((h, i) => (
                <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="font-semibold text-slate-900">{h.event}</p>
                  <p className="text-slate-500 mt-0.5 tabular-nums">{h.date} · AY {h.academicYear || historyStudent.academicYear}</p>
                </div>
              ))
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
// Classes, Sections & Subjects Management
// ============================================================================
export function PrincipalClassesSubjectsView({
  classes,
  subjects,
  teachers,
  students,
  rooms,
  schoolId,
  schoolCode,
  academicYear,
  actor,
  canWrite,
  onOpenExcelImport,
}: {
  classes: SchoolClass[];
  subjects: Subject[];
  teachers: TeacherProfile[];
  students: StudentProfile[];
  rooms: Room[];
  schoolId: string;
  schoolCode?: string;
  academicYear: string;
  actor: PlatformUser;
  canWrite: boolean;
  onOpenExcelImport?: () => void;
}) {
  const { pushToast } = useToast();
  const [classModal, setClassModal] = useState(false);
  const [editingClass, setEditingClass] = useState<SchoolClass | null>(null);
  const [subModal, setSubModal] = useState(false);
  const [classForm, setClassForm] = useState({
    gradeLevel: 'Class 1',
    section: 'A',
    code: 'C1A',
    classTeacherId: '',
    roomId: '',
  });
  const [subForm, setSubForm] = useState({
    name: '',
    code: '',
    classId: classes[0]?.id || '',
    teacherId: '',
  });

  const orderedClasses = useMemo(() => sortClassesInOrder(classes), [classes]);

  const openNewClass = () => {
    setEditingClass(null);
    setClassForm({
      gradeLevel: 'Class 1',
      section: 'A',
      code: 'C1A',
      classTeacherId: '',
      roomId: '',
    });
    setClassModal(true);
  };

  const openEditClass = (cls: SchoolClass) => {
    setEditingClass(cls);
    setClassForm({
      gradeLevel: cls.gradeLevel,
      section: cls.section,
      code: cls.code,
      classTeacherId: cls.classTeacherId || '',
      roomId: cls.roomId || '',
    });
    setClassModal(true);
  };

  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const normalizedGrade = normalizeGradeLevel(classForm.gradeLevel) || classForm.gradeLevel.trim();
    const cleanSection = classForm.section.trim().toUpperCase();
    const cleanCode = (classForm.code.trim() || deriveClassSectionCode(normalizedGrade, cleanSection)).toUpperCase();
    const teacher = teachers.find((t) => t.id === classForm.classTeacherId);
    const room = rooms.find((r) => r.id === classForm.roomId);

    if (editingClass) {
      try {
        await updateDoc(doc(db, 'classes', editingClass.id), {
          name: `${normalizedGrade} - Section ${cleanSection}`,
          gradeLevel: normalizedGrade,
          section: cleanSection,
          code: cleanCode,
          classTeacherId: teacher?.id || '',
          classTeacherName: teacher?.name || '',
          roomId: room?.id || '',
          roomName: room?.name || '',
          updatedAt: serverTimestamp(),
        });
        if (teacher) {
          const nextAssigned = Array.from(new Set([...(teacher.assignedClassIds || []), editingClass.id]));
          await updateDoc(doc(db, 'teachers', teacher.id), {
            classTeacherOfClassId: editingClass.id,
            assignedClassIds: nextAssigned,
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
        }
        pushToast('success', `Updated ${normalizedGrade} - Section ${cleanSection}.`);
        setClassModal(false);
        setEditingClass(null);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `classes/${editingClass.id}`);
      }
      return;
    }

    const dup = classes.find((c) => c.code.toUpperCase() === cleanCode && c.academicYear === academicYear);
    if (dup) {
      pushToast('error', `Duplicate class code "${cleanCode}" already exists in ${academicYear}.`);
      return;
    }
    const id = generateId('cls');
    const className = `${normalizedGrade} - Section ${cleanSection}`;
    try {
      await setDoc(doc(db, 'classes', id), {
        id,
        schoolId,
        name: className,
        gradeLevel: normalizedGrade,
        section: cleanSection,
        code: cleanCode,
        academicYear,
        capacity: 500,
        classTeacherId: teacher?.id || '',
        classTeacherName: teacher?.name || '',
        roomId: room?.id || '',
        roomName: room?.name || '',
        status: 'active',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (teacher) {
        const nextAssigned = Array.from(new Set([...(teacher.assignedClassIds || []), id]));
        await updateDoc(doc(db, 'teachers', teacher.id), {
          classTeacherOfClassId: id,
          assignedClassIds: nextAssigned,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
      }
      if (schoolCode) {
        const mergedSlots = sortClassesInOrder([
          ...classes.map((c) => ({
            classId: c.id,
            classCode: c.code,
            className: c.name,
            gradeLevel: c.gradeLevel,
            section: c.section,
          })),
          {
            classId: id,
            classCode: cleanCode,
            className,
            gradeLevel: normalizedGrade,
            section: cleanSection,
          },
        ]).slice(0, 200);
        await updateDoc(doc(db, 'schoolCodes', schoolCode), {
          classSections: mergedSlots,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
      }
      pushToast('success', `Created ${className} (${cleanCode}).`);
      setClassModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `classes/${id}`);
    }
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const cls = classes.find((c) => c.id === subForm.classId);
    if (!cls) return;
    const teacher = teachers.find((t) => t.id === subForm.teacherId);
    const id = generateId('sub');
    try {
      await setDoc(doc(db, 'subjects', id), {
        id,
        schoolId,
        name: subForm.name.trim().slice(0, 100),
        code: subForm.code.trim().toUpperCase().slice(0, 24),
        classId: cls.id,
        className: cls.name,
        teacherId: teacher?.id || '',
        teacherName: teacher?.name || '',
        status: 'active',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', `Added subject ${subForm.name.trim()}.`);
      setSubModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `subjects/${id}`);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold font-display text-slate-900">Classes &amp; Sections</h2>
            <p className="text-xs text-slate-500">
              Organized in grade and section order with unlimited student capacity per section ({academicYear}).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenExcelImport && (
              <Button variant="secondary" size="sm" onClick={onOpenExcelImport} disabled={!canWrite}>
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Import Excel
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={openNewClass} disabled={!canWrite}>
              <Plus className="w-4 h-4" />
              Add Class / Section
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orderedClasses.map((c) => {
            const enrolled = students.filter((s) => s.classId === c.id && s.status === 'active').length;
            const classSubjects = subjects.filter((s) => s.classId === c.id);
            return (
              <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-teal-700">{c.code}</span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {enrolled} student{enrolled === 1 ? '' : 's'} · Unlimited
                    </span>
                  </div>
                  <h3 className="text-base font-bold font-display text-slate-900 mt-1">{c.name}</h3>
                  <p className="text-xs text-slate-600 mt-1">
                    Class Teacher: <strong className="font-semibold text-slate-800">{c.classTeacherName || 'Unassigned'}</strong>
                  </p>
                  <p className="text-xs text-slate-500">Room: {c.roomName || 'Unassigned'}</p>
                  <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
                    Subjects ({classSubjects.length}): {classSubjects.map((s) => s.name).join(', ') || 'None yet'}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex justify-end pt-1">
                    <Button variant="secondary" size="sm" onClick={() => openEditClass(c)}>
                      <Pencil className="w-3.5 h-3.5" />
                      Assign Teacher / Edit
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Subjects Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold font-display text-slate-900">Subjects &amp; Faculty Allocation</h2>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canWrite || orderedClasses.length === 0}
            onClick={() => {
              setSubForm({ name: '', code: '', classId: orderedClasses[0]?.id || '', teacherId: teachers[0]?.id || '' });
              setSubModal(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Add Subject
          </Button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">Code</th>
                <th className="py-3 px-4 font-semibold">Subject</th>
                <th className="py-3 px-4 font-semibold">Class</th>
                <th className="py-3 px-4 font-semibold">Assigned Teacher</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subjects.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{s.code}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{s.name}</td>
                  <td className="py-3 px-4 text-xs text-slate-700">{s.className}</td>
                  <td className="py-3 px-4 text-xs text-slate-700">{s.teacherName || 'Unassigned'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={classModal}
        onClose={() => { setClassModal(false); setEditingClass(null); }}
        title={editingClass ? `Edit ${editingClass.name}` : 'Create Class & Section'}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleSaveClass} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Class / Grade *</label>
              <input
                type="text"
                required
                value={classForm.gradeLevel}
                onChange={(e) => {
                  const grade = e.target.value;
                  setClassForm((prev) => ({
                    ...prev,
                    gradeLevel: grade,
                    code: editingClass ? prev.code : deriveClassSectionCode(grade, prev.section),
                  }));
                }}
                placeholder="Class 1"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Section *</label>
              <input
                type="text"
                required
                value={classForm.section}
                onChange={(e) => {
                  const sec = e.target.value.toUpperCase();
                  setClassForm((prev) => ({
                    ...prev,
                    section: sec,
                    code: editingClass ? prev.code : deriveClassSectionCode(prev.gradeLevel, sec),
                  }));
                }}
                placeholder="A"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Code *</label>
              <input
                type="text"
                required
                value={classForm.code}
                onChange={(e) => setClassForm({ ...classForm, code: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Homeroom</label>
            <select value={classForm.roomId} onChange={(e) => setClassForm({ ...classForm, roomId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              <option value="">None</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.capacity} seats)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Class Teacher</label>
            <select value={classForm.classTeacherId} onChange={(e) => setClassForm({ ...classForm, classTeacherId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              <option value="">Unassigned</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.accessCode || t.staffId})</option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-slate-500">
            Sections have unlimited student capacity. Students can be added manually or imported from Excel.
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => { setClassModal(false); setEditingClass(null); }}>Cancel</Button>
            <Button type="submit" variant="primary">{editingClass ? 'Save Changes' : 'Create Class'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={subModal} onClose={() => setSubModal(false)} title="Add Subject" maxWidth="max-w-md">
        <form onSubmit={handleCreateSubject} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subject Name *</label>
              <input type="text" required value={subForm.name} onChange={(e) => setSubForm({ ...subForm, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subject Code *</label>
              <input type="text" required value={subForm.code} onChange={(e) => setSubForm({ ...subForm, code: e.target.value.toUpperCase() })} placeholder="CHEM-10" className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Class *</label>
            <select required value={subForm.classId} onChange={(e) => setSubForm({ ...subForm, classId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Assigned Teacher</label>
            <select value={subForm.teacherId} onChange={(e) => setSubForm({ ...subForm, teacherId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              <option value="">Unassigned</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setSubModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Add Subject</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// Room Management
// ============================================================================
export function PrincipalRoomsView({
  rooms,
  classes,
  examinations,
  schoolId,
  actor,
  canWrite,
}: {
  rooms: Room[];
  classes: SchoolClass[];
  examinations: Examination[];
  schoolId: string;
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    roomNumber: '',
    name: '',
    building: 'Main Block',
    capacity: '35',
    roomType: 'classroom' as Room['roomType'],
  });

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const id = generateId('rm');
    try {
      await setDoc(doc(db, 'rooms', id), {
        id,
        schoolId,
        roomNumber: form.roomNumber.trim().slice(0, 32),
        name: form.name.trim().slice(0, 80),
        building: form.building.trim().slice(0, 80),
        capacity: Math.max(1, Number(form.capacity) || 30),
        roomType: form.roomType,
        available: true,
        status: 'active',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', `Room "${form.name.trim()}" added.`);
      setOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `rooms/${id}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Manage classrooms, labs, and exam halls with automatic capacity & overlap warnings.</p>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}>
          <Plus className="w-4 h-4" />
          Add Room
        </Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rooms.map((r) => {
          const homeroomFor = classes.filter((c) => c.roomId === r.id);
          const examBookings = examinations.filter((e) => e.roomId === r.id && e.status === 'scheduled');
          return (
            <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-500">#{r.roomNumber} · {r.building}</span>
                <StatusText status={r.status} />
              </div>
              <h3 className="text-base font-bold font-display text-slate-900 mt-1">{r.name}</h3>
              <p className="text-xs text-slate-600 mt-1 tabular-nums">
                Type: {r.roomType.replace(/_/g, ' ')} · Capacity: <strong>{r.capacity}</strong>
              </p>
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                <p>Assigned Classes: {homeroomFor.map((c) => c.code).join(', ') || 'None'}</p>
                <p>Scheduled Exam Bookings: {examBookings.length}</p>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Create Campus Room" maxWidth="max-w-md">
        <form onSubmit={handleAddRoom} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Room Number *</label>
              <input type="text" required value={form.roomNumber} onChange={(e) => setForm({ ...form, roomNumber: e.target.value })} placeholder="304" className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Capacity *</label>
              <input type="number" min={1} max={1000} required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Room Name *</label>
            <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chemistry Lab 304" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Building / Block *</label>
              <input type="text" required value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Room Type</label>
              <select value={form.roomType} onChange={(e) => setForm({ ...form, roomType: e.target.value as Room['roomType'] })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="classroom">Classroom</option>
                <option value="science_lab">Science Lab</option>
                <option value="computer_lab">Computer Lab</option>
                <option value="exam_hall">Exam Hall</option>
                <option value="auditorium">Auditorium</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Create Room</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
