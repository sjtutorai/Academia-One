import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import {
  Plus,
  Download,
  AlertTriangle,
  Trash2,
  CheckCircle2,
  Calendar,
  List,
  Clock,
  FileSpreadsheet,
  MapPin,
  Navigation,
  Pencil,
  Upload,
  Loader2,
  Coffee,
  Sparkles,
  Image as ImageIcon,
  Lock,
} from 'lucide-react';
import { db, generateId, handleFirestoreError, OperationType } from '../../lib/firebase';
import { detectExamConflicts, detectTimetableConflicts } from '../../lib/permissions';
import { exportToCsv } from '../../lib/csv';
import { recordAuditLog } from '../../lib/audit';
import { sanitizePhoneDigits, sortClassesInOrder } from '../../lib/schoolCodes';
import {
  buildDefaultPeriodSchedule,
  chainPeriodScheduleTimings,
  DEFAULT_ATTENDANCE_GEOFENCE_METERS,
  DEFAULT_TEACHER_ATTENDANCE_END,
  DEFAULT_TEACHER_ATTENDANCE_START,
  formatHHMMTo12Hour,
  insertBreakAfterIndex,
  normalizePeriodSchedule,
  parseHHMMToMinutes,
  removeBreakAtIndex,
} from '../../lib/geoAttendance';
import {
  downloadTimetableExcelTemplate,
  parseTimetableExcelFile,
  type TimetableExcelParseResult,
} from '../../lib/excelImport';
import { Button, EmptyState, Modal, StatusText, useToast } from '../../components/ui/Primitives';
import { DetectLocationAddressPicker } from '../../components/shared/DetectLocationAddressPicker';
import type {
  Announcement,
  DayOfWeek,
  Examination,
  Homework,
  HomeworkSubmission,
  PeriodTimingSlot,
  PlatformUser,
  Room,
  School,
  SchoolClass,
  StudentProfile,
  Subject,
  TeacherProfile,
  TimetablePeriod,
} from '../../types/models';
import type { SchoolDataBundle } from '../../hooks/useSchoolData';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ============================================================================
// Conflict-Checked Weekly Timetable Builder
// ============================================================================
export function PrincipalTimetableView({
  school,
  timetable,
  classes,
  subjects,
  teachers,
  rooms,
  schoolId,
  actor,
  canWrite,
}: {
  school?: School | null;
  timetable: TimetablePeriod[];
  classes: SchoolClass[];
  subjects: Subject[];
  teachers: TeacherProfile[];
  rooms: Room[];
  schoolId: string;
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const sortedClasses = useMemo(() => sortClassesInOrder(classes), [classes]);
  const [viewBy, setViewBy] = useState<'class' | 'teacher'>('class');
  const [selectedClassId, setSelectedClassId] = useState(sortedClasses[0]?.id || '');
  const [selectedTeacherId, setSelectedTeacherId] = useState(teachers[0]?.id || '');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<TimetablePeriod | null>(null);
  const [savingSlot, setSavingSlot] = useState(false);

  // Excel Timetable Import modal state
  const [importOpen, setImportOpen] = useState(false);
  const [parsingExcel, setParsingExcel] = useState(false);
  const [importingExcel, setImportingExcel] = useState(false);
  const [parseResult, setParseResult] = useState<TimetableExcelParseResult | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [importError, setImportError] = useState('');

  // AI Timetable Generator modal state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiScope, setAiScope] = useState<'selected' | 'all'>('selected');
  const [aiPreferences, setAiPreferences] = useState('');
  const [aiIncludeBreaks, setAiIncludeBreaks] = useState(true);
  const [aiReplaceExisting, setAiReplaceExisting] = useState(true);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPublishing, setAiPublishing] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiPreviewClassFilter, setAiPreviewClassFilter] = useState('all');
  const [aiResult, setAiResult] = useState<{
    summary: string;
    periods: Array<{
      classId: string;
      className: string;
      dayOfWeek: DayOfWeek;
      periodNumber: number;
      startTime: string;
      endTime: string;
      isBreak: boolean;
      subjectId: string;
      subjectName: string;
      teacherId: string;
      teacherName: string;
      roomId: string;
      roomName: string;
    }>;
  } | null>(null);

  const periodSchedule = useMemo<PeriodTimingSlot[]>(() => {
    if (school?.settings?.periodSchedule && school.settings.periodSchedule.length > 0) {
      return normalizePeriodSchedule(school.settings.periodSchedule);
    }
    return buildDefaultPeriodSchedule(school?.settings?.periodsPerDay || 8);
  }, [school?.settings?.periodSchedule, school?.settings?.periodsPerDay]);

  const teachingPeriodCount = useMemo(
    () => periodSchedule.filter((s) => !s.isBreak).length,
    [periodSchedule],
  );
  const breakSlotCount = useMemo(
    () => periodSchedule.filter((s) => s.isBreak).length,
    [periodSchedule],
  );

  const workingDays = useMemo<DayOfWeek[]>(() => {
    const configured = school?.settings?.workingDays;
    if (configured && configured.length > 0) {
      return DAYS.filter((d) => configured.includes(d));
    }
    return DAYS.slice(0, 5);
  }, [school?.settings?.workingDays]);

  const [form, setForm] = useState({
    classId: sortedClasses[0]?.id || '',
    dayOfWeek: 'Monday' as DayOfWeek,
    slotKey: '0',
    periodNumber: '1',
    breakLabel: 'Short Break / Recess',
    startTime: periodSchedule[0]?.startTime || '08:30',
    endTime: periodSchedule[0]?.endTime || '09:15',
    isBreak: Boolean(periodSchedule[0]?.isBreak),
    subjectId: subjects[0]?.id || '',
    teacherId: teachers[0]?.id || '',
    roomId: rooms[0]?.id || '',
  });

  const activeClassId = selectedClassId || sortedClasses[0]?.id || '';
  const activeTeacherId = selectedTeacherId || teachers[0]?.id || '';

  const visiblePeriods = useMemo(() => {
    return timetable
      .filter((p) => (viewBy === 'class' ? p.classId === activeClassId : p.teacherId === activeTeacherId))
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.periodNumber - b.periodNumber);
  }, [timetable, viewBy, activeClassId, activeTeacherId]);

  const liveConflicts = useMemo(() => {
    const cls = classes.find((c) => c.id === form.classId);
    const subj = subjects.find((s) => s.id === form.subjectId);
    const tch = teachers.find((t) => t.id === form.teacherId);
    const rm = rooms.find((r) => r.id === form.roomId);
    const otherPeriods = editingPeriod ? timetable.filter((p) => p.id !== editingPeriod.id) : timetable;
    return detectTimetableConflicts(
      {
        schoolId,
        classId: form.classId,
        className: cls?.name,
        dayOfWeek: form.dayOfWeek,
        periodNumber: form.isBreak ? 0 : Number(form.periodNumber) || 1,
        startTime: form.startTime,
        endTime: form.endTime,
        isBreak: form.isBreak,
        subjectId: form.isBreak ? '' : subj?.id,
        subjectName: form.isBreak ? form.breakLabel || 'Break / Recess' : subj?.name,
        teacherId: form.isBreak ? '' : tch?.id,
        teacherName: form.isBreak ? '' : tch?.name,
        roomId: form.isBreak ? '' : rm?.id,
        roomName: form.isBreak ? '' : rm?.name,
        status: 'published',
      },
      otherPeriods,
    );
  }, [form, classes, subjects, teachers, rooms, timetable, schoolId, editingPeriod]);

  const applyTimingForSlotIndex = (slotIdxStr: string) => {
    const idx = Number(slotIdxStr);
    const slot = periodSchedule[idx];
    if (slot) {
      setForm((prev) => ({
        ...prev,
        slotKey: slotIdxStr,
        periodNumber: slot.isBreak ? '0' : String(slot.periodNumber),
        breakLabel: slot.isBreak ? slot.label : prev.breakLabel,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isBreak: Boolean(slot.isBreak),
      }));
    }
  };

  const openAddPeriodModal = () => {
    setEditingPeriod(null);
    const firstSlot = periodSchedule[0];
    const classSubjects = subjects.filter((s) => s.classId === activeClassId);
    const defaultSub = classSubjects[0] || subjects[0];
    const defaultTeacherId = defaultSub?.teacherId || teachers[0]?.id || '';
    const activeCls = classes.find((c) => c.id === activeClassId);
    setForm({
      classId: activeClassId || sortedClasses[0]?.id || '',
      dayOfWeek: workingDays[0] || 'Monday',
      slotKey: '0',
      periodNumber: firstSlot?.isBreak ? '0' : String(firstSlot?.periodNumber || 1),
      breakLabel: firstSlot?.isBreak ? firstSlot.label : 'Short Break / Recess',
      startTime: firstSlot?.startTime || '08:30',
      endTime: firstSlot?.endTime || '09:15',
      isBreak: Boolean(firstSlot?.isBreak),
      subjectId: defaultSub?.id || '',
      teacherId: defaultTeacherId,
      roomId: activeCls?.roomId || rooms[0]?.id || '',
    });
    setModalOpen(true);
  };

  const openEditPeriodModal = (p: TimetablePeriod) => {
    setEditingPeriod(p);
    const matchedIdx = periodSchedule.findIndex((s) =>
      p.isBreak
        ? Boolean(s.isBreak) && s.startTime === p.startTime
        : !s.isBreak && s.periodNumber === p.periodNumber,
    );
    setForm({
      classId: p.classId,
      dayOfWeek: p.dayOfWeek,
      slotKey: matchedIdx >= 0 ? String(matchedIdx) : '0',
      periodNumber: p.isBreak ? '0' : String(p.periodNumber || 1),
      breakLabel: p.isBreak ? p.subjectName || 'Break / Recess' : 'Short Break / Recess',
      startTime: p.startTime,
      endTime: p.endTime,
      isBreak: Boolean(p.isBreak),
      subjectId: p.subjectId || '',
      teacherId: p.teacherId || '',
      roomId: p.roomId || '',
    });
    setModalOpen(true);
  };

  const handleSavePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || savingSlot) return;
    if (liveConflicts.length > 0) {
      pushToast('error', 'Resolve timetable conflicts before saving.');
      return;
    }
    const cls = classes.find((c) => c.id === form.classId);
    const subj = subjects.find((s) => s.id === form.subjectId);
    const tch = teachers.find((t) => t.id === form.teacherId);
    const rm = rooms.find((r) => r.id === form.roomId);

    setSavingSlot(true);
    try {
      const payload = {
        classId: form.classId,
        className: cls?.name || '',
        dayOfWeek: form.dayOfWeek,
        periodNumber: form.isBreak ? 0 : Math.max(1, Number(form.periodNumber) || 1),
        startTime: form.startTime,
        endTime: form.endTime,
        isBreak: form.isBreak,
        subjectId: form.isBreak ? '' : subj?.id || '',
        subjectName: form.isBreak ? (form.breakLabel.trim() || 'Break / Recess').slice(0, 100) : subj?.name || 'General Study',
        teacherId: form.isBreak ? '' : tch?.id || '',
        teacherName: form.isBreak ? '' : tch?.name || '',
        roomId: form.isBreak ? '' : rm?.id || '',
        roomName: form.isBreak ? '' : rm?.name || '',
        status: 'published' as const,
        updatedAt: serverTimestamp(),
      };

      if (editingPeriod) {
        await updateDoc(doc(db, 'timetablePeriods', editingPeriod.id), payload);
        pushToast('success', 'Timetable slot updated.');
      } else {
        const id = generateId('tt');
        await setDoc(doc(db, 'timetablePeriods', id), {
          id,
          schoolId,
          ...payload,
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
        });
        pushToast('success', 'Timetable slot published.');
      }
      setModalOpen(false);
      setEditingPeriod(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'timetablePeriods');
      pushToast('error', 'Unable to save timetable slot.');
    } finally {
      setSavingSlot(false);
    }
  };

  const handleTimetableExcelSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setParsingExcel(true);
    setImportError('');
    setParseResult(null);
    try {
      const result = await parseTimetableExcelFile(file, {
        existingClasses: classes,
        existingSubjects: subjects,
        existingTeachers: teachers,
        existingRooms: rooms,
        periodSchedule,
        fallbackClassId: activeClassId,
      });
      setParseResult(result);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unable to parse Excel timetable file.');
    } finally {
      setParsingExcel(false);
    }
  };

  const handleConfirmTimetableImport = async () => {
    if (!canWrite || !parseResult || importingExcel) return;
    const validRows = parseResult.periods.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      pushToast('error', 'No valid timetable periods found in the uploaded sheet.');
      return;
    }

    setImportingExcel(true);
    try {
      const now = serverTimestamp();
      // 1. Auto-create any missing classes detected in the Excel file
      const createdClassIdByCode = new Map<string, { id: string; name: string }>();
      if (parseResult.classesToCreate.length > 0) {
        const classBatch = writeBatch(db);
        for (const draft of parseResult.classesToCreate) {
          const newId = generateId('cls');
          createdClassIdByCode.set(draft.code.toUpperCase(), { id: newId, name: draft.name });
          classBatch.set(doc(db, 'classes', newId), {
            id: newId,
            schoolId,
            name: draft.name,
            code: draft.code,
            gradeLevel: draft.gradeLevel,
            section: draft.section,
            capacity: 40,
            academicYear: school?.academicYear || '2026-2027',
            classTeacherId: '',
            classTeacherName: '',
            roomId: '',
            roomName: '',
            status: 'active',
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
          });
        }
        await classBatch.commit();
      }

      // Resolve final class IDs for each parsed period
      const resolvedRows = validRows
        .map((row) => {
          const created = createdClassIdByCode.get(row.classCode.toUpperCase());
          const finalClassId = row.matchedClassId || created?.id || '';
          const finalClassName = created?.name || row.className;
          return { ...row, finalClassId, finalClassName };
        })
        .filter((r) => Boolean(r.finalClassId));

      // 2. Optionally replace existing periods for affected classes
      if (replaceExisting) {
        const affectedClassIds = new Set(resolvedRows.map((r) => r.finalClassId));
        const existingToDelete = timetable.filter((p) => affectedClassIds.has(p.classId));
        const CHUNK = 350;
        for (let i = 0; i < existingToDelete.length; i += CHUNK) {
          const delBatch = writeBatch(db);
          existingToDelete.slice(i, i + CHUNK).forEach((p) => {
            delBatch.delete(doc(db, 'timetablePeriods', p.id));
          });
          await delBatch.commit();
        }
      }

      // 3. Batch-write imported timetable periods
      const CHUNK = 350;
      for (let i = 0; i < resolvedRows.length; i += CHUNK) {
        const batch = writeBatch(db);
        resolvedRows.slice(i, i + CHUNK).forEach((row) => {
          const id = generateId('tt');
          batch.set(doc(db, 'timetablePeriods', id), {
            id,
            schoolId,
            classId: row.finalClassId,
            className: row.finalClassName.slice(0, 80),
            dayOfWeek: row.dayOfWeek,
            periodNumber: row.periodNumber,
            startTime: row.startTime,
            endTime: row.endTime,
            isBreak: row.isBreak,
            subjectId: row.isBreak ? '' : row.matchedSubjectId || '',
            subjectName: (row.isBreak ? row.subjectName || 'Break / Recess' : row.subjectName || 'General Study').slice(0, 100),
            teacherId: row.isBreak ? '' : row.matchedTeacherId || '',
            teacherName: row.isBreak ? '' : (row.teacherName || '').slice(0, 100),
            roomId: row.isBreak ? '' : row.matchedRoomId || '',
            roomName: row.isBreak ? '' : (row.roomName || '').slice(0, 80),
            status: 'published',
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
          });
        });
        await batch.commit();
      }

      await recordAuditLog({
        schoolId,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'IMPORT_TIMETABLE_EXCEL',
        targetType: 'timetable',
        targetId: schoolId,
        targetLabel: `${resolvedRows.length} periods imported (${parseResult.sheetName})`,
        details: `Format: ${parseResult.detectedFormat}. Auto-created ${parseResult.classesToCreate.length} missing class-sections.`,
      }).catch(() => undefined);

      pushToast(
        'success',
        `Imported ${resolvedRows.length} timetable periods${parseResult.classesToCreate.length > 0 ? ` and created ${parseResult.classesToCreate.length} new classes` : ''}.`,
      );
      setImportOpen(false);
      setParseResult(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to import timetable.');
      handleFirestoreError(err, OperationType.WRITE, 'timetablePeriods');
    } finally {
      setImportingExcel(false);
    }
  };

  const aiTargetClasses = useMemo(() => {
    const active = sortedClasses.filter((c) => c.status !== 'archived');
    if (aiScope === 'all') return active;
    const picked = active.find((c) => c.id === activeClassId) || active[0];
    return picked ? [picked] : [];
  }, [sortedClasses, aiScope, activeClassId]);

  const handleGenerateAiTimetable = async () => {
    if (!canWrite || aiGenerating) return;
    if (aiTargetClasses.length === 0) {
      setAiError('Create at least one active class before generating an AI timetable.');
      return;
    }
    const activeTeachers = teachers.filter((t) => t.status !== 'inactive');
    if (subjects.length === 0 && activeTeachers.length === 0) {
      setAiError('Add subjects and teachers to your school first so the AI can assign periods.');
      return;
    }

    setAiGenerating(true);
    setAiError('');
    setAiResult(null);
    setAiPreviewClassFilter('all');

    try {
      const targetClassIds = new Set(aiTargetClasses.map((c) => c.id));
      const existingOtherClassPeriods = timetable
        .filter((p) => !targetClassIds.has(p.classId) && !p.isBreak)
        .map((p) => ({
          classId: p.classId,
          dayOfWeek: p.dayOfWeek,
          startTime: p.startTime,
          endTime: p.endTime,
          teacherId: p.teacherId || '',
          roomId: p.roomId || '',
        }));

      const res = await fetch('/api/ai/generate-timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolName: school?.name || 'School',
          workingDays,
          periodSchedule,
          targetClasses: aiTargetClasses.map((c) => ({
            id: c.id,
            name: c.name,
            code: c.code,
            classTeacherId: c.classTeacherId || '',
            roomId: c.roomId || '',
            roomName: c.roomName || '',
          })),
          subjects: subjects
            .filter((s) => s.status !== 'archived')
            .map((s) => ({
              id: s.id,
              name: s.name,
              code: s.code,
              classId: s.classId,
              className: s.className || '',
              teacherId: s.teacherId || '',
              teacherName: s.teacherName || '',
            })),
          teachers: activeTeachers.map((t) => ({
            id: t.id,
            name: t.name,
            staffId: t.staffId,
            subjects: t.subjects || [],
            assignedClassIds: t.assignedClassIds || [],
            status: t.status,
          })),
          rooms: rooms
            .filter((r) => r.status === 'active' && r.available !== false)
            .map((r) => ({
              id: r.id,
              name: r.name,
              roomNumber: r.roomNumber,
              roomType: r.roomType,
              capacity: r.capacity,
            })),
          existingOtherClassPeriods,
          customInstructions: aiPreferences.trim(),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        summary?: string;
        periods?: Array<{
          classId: string;
          className: string;
          dayOfWeek: DayOfWeek;
          periodNumber: number;
          startTime: string;
          endTime: string;
          isBreak: boolean;
          subjectId: string;
          subjectName: string;
          teacherId: string;
          teacherName: string;
          roomId: string;
          roomName: string;
        }>;
        error?: { status?: string; message?: string };
      };

      if (!res.ok) {
        throw new Error(body?.error?.message || `AI timetable service returned status ${res.status}.`);
      }

      const teachingPeriods = Array.isArray(body.periods) ? body.periods : [];
      if (teachingPeriods.length === 0) {
        throw new Error('AI returned no periods. Check that subjects and teachers are configured.');
      }

      // Optionally append configured Break/Recess slots (periodNumber: 0) per target class & day
      const combined = [...teachingPeriods];
      if (aiIncludeBreaks) {
        const breakSlots = periodSchedule.filter((s) => s.isBreak);
        for (const cls of aiTargetClasses) {
          for (const day of workingDays) {
            for (const brk of breakSlots) {
              combined.push({
                classId: cls.id,
                className: cls.name,
                dayOfWeek: day,
                periodNumber: 0,
                startTime: brk.startTime,
                endTime: brk.endTime,
                isBreak: true,
                subjectId: '',
                subjectName: (brk.label || 'Break / Recess').slice(0, 100),
                teacherId: '',
                teacherName: '',
                roomId: '',
                roomName: '',
              });
            }
          }
        }
      }

      combined.sort(
        (a, b) =>
          a.className.localeCompare(b.className) ||
          workingDays.indexOf(a.dayOfWeek) - workingDays.indexOf(b.dayOfWeek) ||
          a.startTime.localeCompare(b.startTime) ||
          a.periodNumber - b.periodNumber,
      );

      setAiResult({
        summary: body.summary || `Generated ${teachingPeriods.length} AI-scheduled teaching periods.`,
        periods: combined,
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate AI timetable.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handlePublishAiTimetable = async () => {
    if (!canWrite || !aiResult || aiPublishing) return;
    setAiPublishing(true);
    try {
      const now = serverTimestamp();
      const affectedClassIds = new Set(aiResult.periods.map((p) => p.classId));

      if (aiReplaceExisting) {
        const existingToDelete = timetable.filter((p) => affectedClassIds.has(p.classId));
        const CHUNK = 350;
        for (let i = 0; i < existingToDelete.length; i += CHUNK) {
          const delBatch = writeBatch(db);
          existingToDelete.slice(i, i + CHUNK).forEach((p) => {
            delBatch.delete(doc(db, 'timetablePeriods', p.id));
          });
          await delBatch.commit();
        }
      }

      const CHUNK = 350;
      for (let i = 0; i < aiResult.periods.length; i += CHUNK) {
        const batch = writeBatch(db);
        aiResult.periods.slice(i, i + CHUNK).forEach((row) => {
          const id = generateId('tt');
          batch.set(doc(db, 'timetablePeriods', id), {
            id,
            schoolId,
            classId: row.classId,
            className: row.className.slice(0, 80),
            dayOfWeek: row.dayOfWeek,
            periodNumber: row.isBreak ? 0 : Math.max(1, Math.min(12, row.periodNumber)),
            startTime: row.startTime,
            endTime: row.endTime,
            isBreak: Boolean(row.isBreak),
            subjectId: row.isBreak ? '' : row.subjectId || '',
            subjectName: (row.isBreak ? row.subjectName || 'Break / Recess' : row.subjectName || 'General Study').slice(0, 100),
            teacherId: row.isBreak ? '' : row.teacherId || '',
            teacherName: row.isBreak ? '' : (row.teacherName || '').slice(0, 120),
            roomId: row.isBreak ? '' : row.roomId || '',
            roomName: row.isBreak ? '' : (row.roomName || '').slice(0, 80),
            status: 'published',
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
          });
        });
        await batch.commit();
      }

      const teachingCount = aiResult.periods.filter((p) => !p.isBreak).length;
      await recordAuditLog({
        schoolId,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'AI_GENERATE_TIMETABLE',
        targetType: 'timetable',
        targetId: schoolId,
        targetLabel: `${teachingCount} AI periods across ${affectedClassIds.size} class(es)`,
        details: aiResult.summary.slice(0, 480),
      }).catch(() => undefined);

      pushToast(
        'success',
        `Published ${teachingCount} AI-scheduled teaching periods${aiResult.periods.length > teachingCount ? ` and ${aiResult.periods.length - teachingCount} break slots` : ''}.`,
      );
      setAiOpen(false);
      setAiResult(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to publish AI timetable.');
      handleFirestoreError(err, OperationType.WRITE, 'timetablePeriods');
    } finally {
      setAiPublishing(false);
    }
  };

  const aiVisiblePreview = useMemo(() => {
    if (!aiResult) return [];
    if (aiPreviewClassFilter === 'all') return aiResult.periods;
    return aiResult.periods.filter((p) => p.classId === aiPreviewClassFilter);
  }, [aiResult, aiPreviewClassFilter]);

  const classSubjectsForForm = useMemo(() => {
    const scoped = subjects.filter((s) => s.classId === form.classId);
    return scoped.length > 0 ? scoped : subjects;
  }, [subjects, form.classId]);

  const validImportCount = parseResult ? parseResult.periods.filter((p) => p.errors.length === 0).length : 0;
  const errorImportCount = parseResult ? parseResult.periods.filter((p) => p.errors.length > 0).length : 0;

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setViewBy('class')}
              className={`px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${viewBy === 'class' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
            >
              By Class
            </button>
            <button
              type="button"
              onClick={() => setViewBy('teacher')}
              className={`px-3 py-1.5 rounded-md font-medium cursor-pointer transition-colors ${viewBy === 'teacher' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
            >
              By Teacher
            </button>
          </div>

          {viewBy === 'class' ? (
            <select
              value={activeClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
            >
              {sortedClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          ) : (
            <select
              value={activeTeacherId}
              onChange={(e) => setSelectedTeacherId(e.target.value)}
              className="border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
            >
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          <span className="hidden xl:inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            <Clock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            {teachingPeriodCount} periods/day{breakSlotCount > 0 ? ` + ${breakSlotCount} ${breakSlotCount === 1 ? 'break' : 'breaks'}` : ''} · {workingDays.length} working days
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!canWrite || classes.length === 0}
            onClick={() => {
              setAiError('');
              setAiResult(null);
              setAiScope(classes.length === 1 ? 'selected' : 'selected');
              setAiOpen(true);
            }}
          >
            <Sparkles className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            AI Create Timetable
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canWrite}
            onClick={() => {
              setParseResult(null);
              setImportError('');
              setImportOpen(true);
            }}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
            Import Excel Timetable
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canWrite || classes.length === 0}
            onClick={openAddPeriodModal}
          >
            <Plus className="w-4 h-4" />
            Add Period Slot
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workingDays.map((day) => {
          const dayItems = visiblePeriods.filter((p) => p.dayOfWeek === day);
          const dayTeachingCount = dayItems.filter((p) => !p.isBreak).length;
          const dayBreakCount = dayItems.filter((p) => p.isBreak).length;
          return (
            <div key={day} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100">{day}</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {dayTeachingCount} {dayTeachingCount === 1 ? 'period' : 'periods'}
                  {dayBreakCount > 0 ? ` · ${dayBreakCount} ${dayBreakCount === 1 ? 'break' : 'breaks'}` : ''}
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {dayItems.length === 0 ? (
                  <p className="p-4 text-xs text-slate-400 dark:text-slate-500">No periods scheduled.</p>
                ) : (
                  dayItems.map((p) => (
                    <div key={p.id} className={`p-3.5 flex items-start justify-between gap-2 ${p.isBreak ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}>
                      <div>
                        <p className={`text-xs font-mono tabular-nums ${p.isBreak ? 'text-amber-700 dark:text-amber-400' : 'text-teal-700 dark:text-teal-400'}`}>
                          {p.startTime} – {p.endTime} · {p.isBreak ? 'Break' : `P${p.periodNumber}`}
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{p.subjectName || (p.isBreak ? 'Break / Recess' : 'General Study')}</p>
                        {!p.isBreak && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {viewBy === 'class' ? p.teacherName || 'Unassigned Teacher' : p.className} {p.roomName ? `· ${p.roomName}` : ''}
                          </p>
                        )}
                      </div>
                      {canWrite && (
                        <div className="inline-flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditPeriodModal(p)}
                            className="text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 p-1 cursor-pointer"
                            aria-label="Edit period"
                            title="Edit period slot"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteDoc(doc(db, 'timetablePeriods', p.id));
                              pushToast('success', 'Removed period slot.');
                            }}
                            className="text-slate-400 hover:text-red-600 p-1 cursor-pointer"
                            aria-label="Delete period"
                            title="Delete period slot"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Single Period Modal */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingPeriod(null);
        }}
        title={editingPeriod ? 'Edit Timetable Period' : 'Add Timetable Period'}
        subtitle="Period timings auto-fill from School Settings. Overlap checks guard teacher, class, and room conflicts."
      >
        <form onSubmit={handleSavePeriod} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Class</label>
              <select
                value={form.classId}
                onChange={(e) => setForm({ ...form, classId: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              >
                {sortedClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Day</label>
              <select
                value={form.dayOfWeek}
                onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value as DayOfWeek })}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              >
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Bell Slot</label>
              <select
                value={form.slotKey}
                onChange={(e) => applyTimingForSlotIndex(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
              >
                {periodSchedule.map((slot, idx) => (
                  <option key={slot.id || `${idx}_${slot.periodNumber}`} value={String(idx)}>
                    {slot.isBreak ? `Break · ${slot.label}` : `P${slot.periodNumber} · ${slot.label}`} ({slot.startTime})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Start Time</label>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">End Time</label>
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isBreak}
              onChange={(e) =>
                setForm({
                  ...form,
                  isBreak: e.target.checked,
                  periodNumber: e.target.checked ? '0' : form.periodNumber === '0' ? '1' : form.periodNumber,
                })
              }
              className="rounded border-slate-300 text-teal-600"
            />
            Break / Recess slot (does not count as a teaching period)
          </label>

          {form.isBreak && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Break / Recess Label</label>
              <input
                type="text"
                value={form.breakLabel}
                onChange={(e) => setForm({ ...form, breakLabel: e.target.value })}
                placeholder="e.g. Short Break, Lunch Recess"
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
          )}

          {!form.isBreak && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Subject</label>
                <select
                  value={form.subjectId}
                  onChange={(e) => {
                    const nextSubId = e.target.value;
                    const matched = subjects.find((s) => s.id === nextSubId);
                    setForm({
                      ...form,
                      subjectId: nextSubId,
                      teacherId: matched?.teacherId || form.teacherId,
                    });
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                >
                  <option value="">Select subject…</option>
                  {classSubjectsForForm.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Teacher</label>
                <select
                  value={form.teacherId}
                  onChange={(e) => setForm({ ...form, teacherId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                >
                  <option value="">Unassigned</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Room</label>
                <select
                  value={form.roomId}
                  onChange={(e) => setForm({ ...form, roomId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                >
                  <option value="">No Room</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {liveConflicts.length > 0 && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-lg text-xs text-red-800 dark:text-red-300 space-y-1">
              {liveConflicts.map((c) => (
                <p key={c} className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{c}</span>
                </p>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setModalOpen(false);
                setEditingPeriod(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={savingSlot} disabled={liveConflicts.length > 0}>
              {editingPeriod ? 'Save Changes' : 'Publish Slot'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Excel Timetable Import Modal */}
      <Modal
        open={importOpen}
        onClose={() => !importingExcel && setImportOpen(false)}
        title="Import Timetable from Excel"
        subtitle="Upload an .xlsx, .xls, or .csv timetable. Automatically detects class-section rows or weekly period grids and applies your configured school timings."
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
              <p className="font-semibold text-slate-900 dark:text-slate-100">Supports both Tabular &amp; Weekly Grid Excel Layouts</p>
              <p>
                Tabular: <span className="font-mono">Class, Section, Day, Period, Start Time, End Time, Subject, Teacher, Room</span>
              </p>
              <p>
                Grid: <span className="font-mono">Class, Section, Day, Period 1, Period 2, …</span> (timings auto-filled from School Settings)
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => downloadTimetableExcelTemplate(periodSchedule, sortedClasses[0]?.code || 'C1A')}
            >
              <Download className="w-3.5 h-3.5" />
              Download Template (.xlsx)
            </Button>
          </div>

          <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-teal-500 dark:hover:border-teal-500 transition-colors cursor-pointer text-center">
            {parsingExcel ? (
              <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
            ) : (
              <Upload className="w-6 h-6 text-teal-600 dark:text-teal-400" />
            )}
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {parsingExcel ? 'Analyzing Excel sheet…' : 'Click to choose Excel (.xlsx, .xls) or CSV timetable file'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Classes, sections, subjects, teachers, and period timings are matched automatically.
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleTimetableExcelSelect}
              disabled={parsingExcel || importingExcel}
              className="hidden"
            />
          </label>

          {importError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {parseResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <p className="text-slate-500 dark:text-slate-400">Detected Layout</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100 capitalize mt-0.5">{parseResult.detectedFormat}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50">
                  <p className="text-emerald-700 dark:text-emerald-400">Valid Periods</p>
                  <p className="font-bold text-emerald-900 dark:text-emerald-200 tabular-nums mt-0.5">{validImportCount}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50">
                  <p className="text-blue-700 dark:text-blue-400">New Classes to Create</p>
                  <p className="font-bold text-blue-900 dark:text-blue-200 tabular-nums mt-0.5">{parseResult.classesToCreate.length}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50">
                  <p className="text-amber-700 dark:text-amber-400">Skipped / Errors</p>
                  <p className="font-bold text-amber-900 dark:text-amber-200 tabular-nums mt-0.5">{errorImportCount}</p>
                </div>
              </div>

              {parseResult.classesToCreate.length > 0 && (
                <div className="p-3 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 text-xs text-blue-800 dark:text-blue-300">
                  Missing classes will be auto-created:{' '}
                  <span className="font-semibold">
                    {parseResult.classesToCreate.map((c) => `${c.name} (${c.code})`).join(', ')}
                  </span>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="rounded border-slate-300 text-teal-600"
                />
                Replace existing timetable slots for the classes included in this Excel sheet
              </label>

              <div className="max-h-60 overflow-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 sticky top-0">
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 px-3 font-semibold">Class</th>
                      <th className="py-2 px-3 font-semibold">Day</th>
                      <th className="py-2 px-3 font-semibold">Period &amp; Time</th>
                      <th className="py-2 px-3 font-semibold">Subject</th>
                      <th className="py-2 px-3 font-semibold">Teacher / Room</th>
                      <th className="py-2 px-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parseResult.periods.slice(0, 40).map((row, idx) => (
                      <tr key={`${row.rowNumber}_${row.periodNumber}_${idx}`}>
                        <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                          {row.className || '—'} <span className="font-mono text-[10px] text-slate-500">{row.classCode}</span>
                        </td>
                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{row.dayOfWeek}</td>
                        <td className="py-2 px-3 font-mono tabular-nums text-teal-700 dark:text-teal-400">
                          P{row.periodNumber} · {row.startTime}–{row.endTime}
                        </td>
                        <td className="py-2 px-3 text-slate-800 dark:text-slate-200">
                          {row.isBreak ? 'Break / Recess' : row.subjectName || '—'}
                        </td>
                        <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                          {[row.teacherName, row.roomName].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="py-2 px-3">
                          {row.errors.length === 0 ? (
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Ready</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400">{row.errors[0]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parseResult.periods.length > 40 && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 px-3 py-2 bg-slate-50 dark:bg-slate-800/70">
                    Showing first 40 of {parseResult.periods.length} analyzed period rows.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setImportOpen(false)} disabled={importingExcel}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={importingExcel}
              disabled={!canWrite || validImportCount === 0}
              onClick={handleConfirmTimetableImport}
            >
              Import {validImportCount > 0 ? `${validImportCount} Periods` : 'Timetable'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* AI Timetable Generator Modal */}
      <Modal
        open={aiOpen}
        onClose={() => !aiGenerating && !aiPublishing && setAiOpen(false)}
        title="AI Timetable Generator"
        subtitle="Automatically builds a balanced, conflict-checked weekly timetable using your school's teachers, subjects, rooms, and period timings."
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Target Scope
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAiScope('selected');
                    setAiResult(null);
                  }}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border text-left transition-colors cursor-pointer ${
                    aiScope === 'selected'
                      ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/30 text-teal-800 dark:text-teal-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  Selected Class
                  <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {sortedClasses.find((c) => c.id === activeClassId)?.name || sortedClasses[0]?.name || 'None'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAiScope('all');
                    setAiResult(null);
                  }}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border text-left transition-colors cursor-pointer ${
                    aiScope === 'all'
                      ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/30 text-teal-800 dark:text-teal-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  All Active Classes
                  <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    {sortedClasses.filter((c) => c.status !== 'archived').length} classes
                  </span>
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3 text-xs space-y-1">
              <p className="font-semibold text-slate-800 dark:text-slate-200">Inputs Analyzed by AI</p>
              <p className="text-slate-600 dark:text-slate-400 tabular-nums">
                {aiTargetClasses.length} {aiTargetClasses.length === 1 ? 'class' : 'classes'} ·{' '}
                {subjects.filter((s) => s.status !== 'archived').length} subjects ·{' '}
                {teachers.filter((t) => t.status !== 'inactive').length} active teachers ·{' '}
                {teachingPeriodCount} teaching periods/day
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Working days: {workingDays.join(', ')}
                {breakSlotCount > 0 ? ` · ${breakSlotCount} dedicated break(s)` : ''}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Scheduling Preferences (Optional)
            </label>
            <input
              type="text"
              value={aiPreferences}
              onChange={(e) => setAiPreferences(e.target.value)}
              placeholder="e.g., Schedule Mathematics and Science in morning periods, avoid consecutive periods of the same subject…"
              maxLength={400}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={aiIncludeBreaks}
                onChange={(e) => setAiIncludeBreaks(e.target.checked)}
                className="rounded border-slate-300 text-teal-600"
              />
              Include configured Break / Recess slots ({breakSlotCount})
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={aiReplaceExisting}
                onChange={(e) => setAiReplaceExisting(e.target.checked)}
                className="rounded border-slate-300 text-teal-600"
              />
              Replace existing timetable for target class(es)
            </label>
          </div>

          {aiError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{aiError}</span>
            </div>
          )}

          {!aiResult ? (
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="secondary" onClick={() => setAiOpen(false)} disabled={aiGenerating}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={aiGenerating}
                disabled={!canWrite || aiTargetClasses.length === 0}
                onClick={handleGenerateAiTimetable}
              >
                <Sparkles className="w-4 h-4" />
                {aiGenerating ? 'Generating Schedule…' : 'Generate Timetable with AI'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="p-3 rounded-lg bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900/50 text-xs text-teal-900 dark:text-teal-200 flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    AI Draft Ready · {aiResult.periods.filter((p) => !p.isBreak).length} teaching periods
                    {aiResult.periods.some((p) => p.isBreak)
                      ? ` + ${aiResult.periods.filter((p) => p.isBreak).length} breaks`
                      : ''}
                  </p>
                  <p className="text-teal-800/90 dark:text-teal-300/90">{aiResult.summary}</p>
                </div>
                {aiTargetClasses.length > 1 && (
                  <select
                    value={aiPreviewClassFilter}
                    onChange={(e) => setAiPreviewClassFilter(e.target.value)}
                    className="border border-teal-300 dark:border-teal-800 rounded-md px-2.5 py-1 text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                  >
                    <option value="all">All Generated Classes ({aiTargetClasses.length})</option>
                    {aiTargetClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Class</th>
                      <th className="py-2 px-3">Day</th>
                      <th className="py-2 px-3">Slot & Time</th>
                      <th className="py-2 px-3">Subject</th>
                      <th className="py-2 px-3">Teacher · Room</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {aiVisiblePreview.slice(0, 60).map((row, idx) => (
                      <tr
                        key={`${row.classId}_${row.dayOfWeek}_${row.startTime}_${idx}`}
                        className={row.isBreak ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}
                      >
                        <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">{row.className}</td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{row.dayOfWeek}</td>
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {row.isBreak ? 'Break' : `P${row.periodNumber}`} · {row.startTime}–{row.endTime}
                        </td>
                        <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">{row.subjectName}</td>
                        <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                          {row.isBreak ? 'Recess' : [row.teacherName, row.roomName].filter(Boolean).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {aiVisiblePreview.length > 60 && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 px-3 py-2 bg-slate-50 dark:bg-slate-800/70">
                    Showing first 60 of {aiVisiblePreview.length} generated slots. All slots will be published.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={aiGenerating}
                  disabled={aiPublishing}
                  onClick={handleGenerateAiTimetable}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Regenerate
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAiOpen(false)}
                    disabled={aiPublishing || aiGenerating}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    loading={aiPublishing}
                    disabled={!canWrite || aiGenerating}
                    onClick={handlePublishAiTimetable}
                  >
                    Publish AI Timetable ({aiResult.periods.filter((p) => !p.isBreak).length} Periods)
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// Examination Management (Calendar & List Views + Conflict Guard + Export)
// ============================================================================
export function PrincipalExamsView({
  examinations,
  classes,
  subjects,
  rooms,
  students,
  schoolId,
  academicYear,
  actor,
  canWrite,
}: {
  examinations: Examination[];
  classes: SchoolClass[];
  subjects: Subject[];
  rooms: Room[];
  students: StudentProfile[];
  schoolId: string;
  academicYear: string;
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    name: 'Winter Final Assessment',
    category: 'midterm' as Examination['category'],
    classId: classes[0]?.id || '',
    subjectName: subjects[0]?.name || 'Mathematics',
    date: '2026-12-10',
    startTime: '09:00',
    endTime: '11:00',
    maxMarks: '100',
    passingMarks: '40',
    roomId: rooms[0]?.id || '',
  });

  const conflicts = useMemo(() => {
    const room = rooms.find((r) => r.id === form.roomId);
    const classCount = students.filter((s) => s.classId === form.classId && s.status === 'active').length;
    return detectExamConflicts(
      {
        schoolId,
        classId: form.classId,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        roomId: form.roomId,
        roomCapacity: room?.capacity,
        classStudentCount: classCount,
      },
      examinations,
    );
  }, [form, rooms, students, examinations, schoolId]);

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const maxM = Number(form.maxMarks) || 100;
    const passM = Number(form.passingMarks) || 40;
    if (passM > maxM) {
      pushToast('error', 'Passing marks cannot exceed maximum marks.');
      return;
    }
    const cls = classes.find((c) => c.id === form.classId);
    const rm = rooms.find((r) => r.id === form.roomId);
    const id = generateId('ex');
    try {
      await setDoc(doc(db, 'examinations', id), {
        id,
        schoolId,
        name: form.name.trim().slice(0, 140),
        category: form.category,
        academicYear,
        classId: form.classId,
        className: cls?.name || '',
        subjectId: '',
        subjectName: form.subjectName.trim().slice(0, 100),
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        maxMarks: maxM,
        passingMarks: passM,
        roomId: rm?.id || '',
        roomName: rm?.name || '',
        schedulePublished: true,
        resultsPublished: false,
        status: 'scheduled',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        schoolId,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'SCHEDULE_EXAMINATION',
        targetType: 'examination',
        targetId: id,
        targetLabel: `${form.name} · ${form.subjectName}`,
      });
      pushToast('success', 'Examination scheduled.');
      setModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `examinations/${id}`);
    }
  };

  const togglePublish = async (ex: Examination, field: 'schedulePublished' | 'resultsPublished') => {
    if (!canWrite) return;
    const nextVal = !ex[field];
    await updateDoc(doc(db, 'examinations', ex.id), { [field]: nextVal, updatedAt: serverTimestamp() });
    await recordAuditLog({
      schoolId,
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      action: field === 'resultsPublished' ? 'TOGGLE_RESULTS_PUBLICATION' : 'TOGGLE_EXAM_SCHEDULE',
      targetType: 'examination',
      targetId: ex.id,
      targetLabel: ex.name,
      details: `${field}=${nextVal}`,
    });
    pushToast('success', `${field === 'resultsPublished' ? 'Results' : 'Schedule'} ${nextVal ? 'published' : 'unpublished'}.`);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 bg-slate-100 rounded-lg text-xs">
          <button type="button" onClick={() => setViewMode('list')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium cursor-pointer ${viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
            <List className="w-3.5 h-3.5" /> List View
          </button>
          <button type="button" onClick={() => setViewMode('calendar')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium cursor-pointer ${viewMode === 'calendar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
            <Calendar className="w-3.5 h-3.5" /> Date Grouped
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportToCsv(
                `exam_timetable_${schoolId}.csv`,
                ['Exam', 'Category', 'Class', 'Subject', 'Date', 'Start', 'End', 'Room', 'Max Marks', 'Passing Marks', 'Schedule Published', 'Results Published'],
                examinations.map((e) => [e.name, e.category, e.className || '', e.subjectName, e.date, e.startTime, e.endTime, e.roomName || '', e.maxMarks, e.passingMarks, e.schedulePublished, e.resultsPublished]),
              )
            }
          >
            <Download className="w-3.5 h-3.5" /> Export Timetable
          </Button>
          <Button variant="primary" size="sm" onClick={() => setModalOpen(true)} disabled={!canWrite}>
            <Plus className="w-4 h-4" /> Schedule Exam
          </Button>
        </div>
      </div>

      {examinations.length === 0 ? (
        <EmptyState title="No examinations scheduled" description="Create unit tests, midterms, or finals with automatic room conflict warnings." actionLabel="Schedule Exam" onAction={() => setModalOpen(true)} />
      ) : viewMode === 'list' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">Exam & Subject</th>
                <th className="py-3 px-4 font-semibold">Class</th>
                <th className="py-3 px-4 font-semibold">Date & Time</th>
                <th className="py-3 px-4 font-semibold">Room</th>
                <th className="py-3 px-4 font-semibold text-right">Marks</th>
                <th className="py-3 px-4 font-semibold">Publication</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {examinations.map((ex) => (
                <tr key={ex.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-900">{ex.name}</p>
                    <p className="text-xs text-slate-500">{ex.subjectName} · {ex.category.replace(/_/g, ' ')}</p>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">{ex.className}</td>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-700">{ex.date} · {ex.startTime}–{ex.endTime}</td>
                  <td className="py-3 px-4 text-xs text-slate-600">{ex.roomName || 'TBA'}</td>
                  <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">{ex.passingMarks}/{ex.maxMarks}</td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" size="sm" disabled={!canWrite} onClick={() => togglePublish(ex, 'schedulePublished')}>
                        {ex.schedulePublished ? 'Schedule Live' : 'Publish Schedule'}
                      </Button>
                      <Button variant={ex.resultsPublished ? 'primary' : 'secondary'} size="sm" disabled={!canWrite} onClick={() => togglePublish(ex, 'resultsPublished')}>
                        {ex.resultsPublished ? 'Results Live' : 'Publish Results'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from(new Set(examinations.map((e) => e.date))).sort().map((date) => (
            <div key={date} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <p className="text-sm font-bold font-mono text-teal-700 tabular-nums">{date}</p>
              {examinations.filter((e) => e.date === date).map((ex) => (
                <div key={ex.id} className="pt-2.5 border-t border-slate-100 text-xs">
                  <p className="font-semibold text-slate-900">{ex.subjectName} · {ex.className}</p>
                  <p className="text-slate-500 tabular-nums">{ex.startTime}–{ex.endTime} · {ex.roomName || 'TBA'}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Schedule Examination" maxWidth="max-w-xl">
        <form onSubmit={handleCreateExam} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Exam Name *</label>
              <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Examination['category'] })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="unit_test">Unit Test</option>
                <option value="midterm">Midterm</option>
                <option value="final">Final</option>
                <option value="practical">Practical</option>
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Class</label>
              <select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subject *</label>
              <input type="text" required value={form.subjectName} onChange={(e) => setForm({ ...form, subjectName: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Room</label>
              <select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.capacity})</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Date *</label>
              <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Start Time</label>
              <input type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">End Time</label>
              <input type="time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Max Marks</label>
              <input type="number" min={1} max={1000} value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Passing Marks</label>
              <input type="number" min={0} max={1000} value={form.passingMarks} onChange={(e) => setForm({ ...form, passingMarks: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
          </div>
          {conflicts.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
              {conflicts.map((c) => <p key={c}>{c}</p>)}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Save Examination</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// Homework Management (Read-Only Monitoring — Only Teachers Can Publish)
// ============================================================================
export function PrincipalHomeworkView({
  homework,
  submissions,
}: {
  homework: Homework[];
  submissions: HomeworkSubmission[];
  classes?: SchoolClass[];
  teachers?: TeacherProfile[];
  schoolId?: string;
  actor?: PlatformUser;
  canWrite?: boolean;
}) {
  const [previewPhoto, setPreviewPhoto] = useState<{ title: string; url: string; fileName?: string } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Homework Monitoring &amp; Submission Oversight
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Track class-level homework assignments, attached worksheet photos, due dates, and student submissions.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg">
          <Lock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          Teachers Only Can Publish Homework
        </span>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
        {homework.length === 0 ? (
          <EmptyState
            title="No homework assigned yet"
            description="Homework published by your school's Teachers will appear here automatically for oversight."
          />
        ) : (
          homework.map((hw) => {
            const subs = submissions.filter((s) => s.homeworkId === hw.id);
            const late = subs.filter((s) => s.isLate).length;
            return (
              <div key={hw.id} className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  {hw.photoDataUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewPhoto({
                          title: hw.title,
                          url: hw.photoDataUrl || '',
                          fileName: hw.attachmentName,
                        })
                      }
                      className="shrink-0 group relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 cursor-pointer"
                      title="Click to view homework photo"
                    >
                      <img
                        src={hw.photoDataUrl}
                        alt={`Homework photo for ${hw.title}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </button>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-teal-700 dark:text-teal-400">{hw.className}</span>
                      <span>·</span>
                      <span>{hw.subjectName}</span>
                      <span>·</span>
                      <span className="tabular-nums">Due {hw.dueDate}</span>
                      {hw.photoDataUrl && (
                        <>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewPhoto({
                                title: hw.title,
                                url: hw.photoDataUrl || '',
                                fileName: hw.attachmentName,
                              })
                            }
                            className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 hover:underline font-medium cursor-pointer"
                          >
                            <ImageIcon className="w-3 h-3" /> View Photo
                          </button>
                        </>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">{hw.title}</h3>
                    {hw.instructions && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                        {hw.instructions}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-xs text-right shrink-0 tabular-nums">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{subs.length} submitted</p>
                  <p className="text-slate-500 dark:text-slate-400">
                    {late} late · {hw.teacherName || 'Teacher'}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Modal
        open={Boolean(previewPhoto)}
        onClose={() => setPreviewPhoto(null)}
        title={previewPhoto?.title || 'Homework Photo'}
        subtitle={previewPhoto?.fileName || 'Uploaded by Teacher'}
        maxWidth="max-w-2xl"
      >
        {previewPhoto && (
          <div className="space-y-3">
            <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
              <img
                src={previewPhoto.url}
                alt={previewPhoto.title}
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewPhoto(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
// Announcements & Communication
// ============================================================================
export function PrincipalAnnouncementsView({
  announcements,
  classes,
  schoolId,
  actor,
  canWrite,
}: {
  announcements: Announcement[];
  classes: SchoolClass[];
  schoolId: string;
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Announcement['audience']>('school_wide');
  const [targetClassId, setTargetClassId] = useState('');

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || title.trim().length < 2) return;
    const id = generateId('ann');
    await setDoc(doc(db, 'announcements', id), {
      id,
      schoolId,
      title: title.trim().slice(0, 160),
      body: body.trim().slice(0, 2000),
      audience,
      targetClassId: audience === 'class_specific' ? targetClassId : '',
      targetRole: '',
      attachmentName: '',
      authorId: actor.uid,
      authorName: actor.displayName,
      authorRole: actor.role === 'student' ? 'teacher' : actor.role,
      status: 'published',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setTitle('');
    setBody('');
    pushToast('success', 'Announcement published within school boundary.');
  };

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <form onSubmit={handlePublish} className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4 h-fit">
        <h2 className="text-base font-bold font-display text-slate-900">Publish School Notice</h2>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Notice Title *</label>
          <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Audience</label>
          <select value={audience} onChange={(e) => setAudience(e.target.value as Announcement['audience'])} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
            <option value="school_wide">School-Wide</option>
            <option value="class_specific">Specific Class</option>
            <option value="role_specific">Faculty / Staff</option>
          </select>
        </div>
        {audience === 'class_specific' && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Target Class</label>
            <select value={targetClassId} onChange={(e) => setTargetClassId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Message *</label>
          <textarea rows={4} required value={body} onChange={(e) => setBody(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
        </div>
        <Button type="submit" variant="navy" className="w-full" disabled={!canWrite}>Publish Announcement</Button>
      </form>

      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {announcements.length === 0 ? (
          <EmptyState title="No announcements yet" description="Notices you publish will be delivered strictly to your school's users." />
        ) : (
          announcements.map((a) => (
            <div key={a.id} className="p-5">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className={`font-semibold ${a.audience === 'principal_flag' ? 'text-amber-700' : 'text-teal-700'}`}>
                  {a.audience.replace(/_/g, ' ')}
                </span>
                <span>{a.authorName} ({a.authorRole})</span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-1">{a.title}</h3>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">{a.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// School Reports (Attendance, Exam Results, Class Strength)
// ============================================================================
export function PrincipalReportsView({ data }: { data: SchoolDataBundle }) {
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold font-display text-slate-900">Attendance Summary Report</h3>
            <p className="text-xs text-slate-500 mt-1">{data.attendance.length} daily class registers recorded.</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportToCsv(
                'school_attendance_report.csv',
                ['Date', 'Class', 'Present', 'Late', 'Absent', 'Status'],
                data.attendance.map((r) => [
                  r.date,
                  r.className || r.classId,
                  r.entries.filter((e) => e.status === 'present').length,
                  r.entries.filter((e) => e.status === 'late').length,
                  r.entries.filter((e) => e.status === 'absent').length,
                  r.status,
                ]),
              )
            }
          >
            <Download className="w-3.5 h-3.5" /> Export Attendance CSV
          </Button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold font-display text-slate-900">Academic & Exam Results Report</h3>
            <p className="text-xs text-slate-500 mt-1">{data.examResults.length} graded exam result entries.</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportToCsv(
                'school_exam_results.csv',
                ['Exam', 'Subject', 'Student', 'Obtained', 'Max Marks', 'Grade', 'Status'],
                data.examResults.map((r) => [r.examName || r.examId, r.subjectName || '', r.studentName, r.obtainedMarks, r.maxMarks, r.grade || '', r.status]),
              )
            }
          >
            <Download className="w-3.5 h-3.5" /> Export Results CSV
          </Button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold font-display text-slate-900">Class Strength & Allocation</h3>
            <p className="text-xs text-slate-500 mt-1">{data.classes.length} classes · {data.teachers.length} teachers.</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportToCsv(
                'school_class_strength.csv',
                ['Class Code', 'Name', 'Class Teacher', 'Enrolled', 'Section Limit'],
                data.classes.map((c) => [c.code, c.name, c.classTeacherName || '', data.students.filter((s) => s.classId === c.id).length, 'Unlimited']),
              )
            }
          >
            <Download className="w-3.5 h-3.5" /> Export Strength CSV
          </Button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <th className="py-3 px-4 font-semibold">Student</th>
              <th className="py-3 px-4 font-semibold">Exam & Subject</th>
              <th className="py-3 px-4 font-semibold text-right">Score</th>
              <th className="py-3 px-4 font-semibold">Grade</th>
              <th className="py-3 px-4 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.examResults.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-semibold text-slate-900">{r.studentName}</td>
                <td className="py-3 px-4 text-xs text-slate-700">{r.examName} · {r.subjectName}</td>
                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">{r.obtainedMarks} / {r.maxMarks}</td>
                <td className="py-3 px-4 font-mono text-xs font-bold text-teal-700">{r.grade || '—'}</td>
                <td className="py-3 px-4"><StatusText status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// School Settings
// ============================================================================
export function PrincipalSchoolSettingsView({
  school,
  actor,
  canWrite,
}: {
  school: School | null;
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();

  const deriveTeachingCount = (s: School | null): number => {
    if (s?.settings?.periodSchedule && s.settings.periodSchedule.length > 0) {
      const teachingOnly = s.settings.periodSchedule.filter((slot) => !slot.isBreak).length;
      if (teachingOnly > 0) return Math.min(12, teachingOnly);
    }
    return Math.max(1, Math.min(12, s?.settings?.periodsPerDay || 8));
  };

  const initialCount = deriveTeachingCount(school);
  const [address, setAddress] = useState(school?.address || '');
  const [phone, setPhone] = useState(school?.phone || '');
  const [email, setEmail] = useState(school?.email || '');
  const [academicYear, setAcademicYear] = useState(school?.academicYear || '2026-2027');
  const [allowOnline, setAllowOnline] = useState(school?.settings?.allowOnlineHomeworkSubmission !== false);
  const [periodsPerDay, setPeriodsPerDay] = useState<number>(initialCount);
  const [periodSchedule, setPeriodSchedule] = useState<PeriodTimingSlot[]>(
    buildDefaultPeriodSchedule(initialCount, school?.settings?.periodSchedule),
  );
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>(
    school?.settings?.workingDays?.length
      ? school.settings.workingDays
      : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  );
  const [campusLat, setCampusLat] = useState<string>(
    typeof school?.settings?.campusLatitude === 'number' ? String(school.settings.campusLatitude) : '',
  );
  const [campusLng, setCampusLng] = useState<string>(
    typeof school?.settings?.campusLongitude === 'number' ? String(school.settings.campusLongitude) : '',
  );
  const [geofenceMeters, setGeofenceMeters] = useState<string>(
    String(school?.settings?.attendanceGeofenceMeters || DEFAULT_ATTENDANCE_GEOFENCE_METERS),
  );
  const [teacherWindowEnabled, setTeacherWindowEnabled] = useState<boolean>(
    Boolean(school?.settings?.teacherAttendanceTimeWindowEnabled),
  );
  const [teacherStartTime, setTeacherStartTime] = useState<string>(
    school?.settings?.teacherAttendanceStartTime || DEFAULT_TEACHER_ATTENDANCE_START,
  );
  const [teacherEndTime, setTeacherEndTime] = useState<string>(
    school?.settings?.teacherAttendanceEndTime || DEFAULT_TEACHER_ATTENDANCE_END,
  );
  const [locatingGps, setLocatingGps] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!school) return;
    const count = deriveTeachingCount(school);
    setAddress(school.address || '');
    setPhone(school.phone || '');
    setEmail(school.email || '');
    setAcademicYear(school.academicYear || '2026-2027');
    setAllowOnline(school.settings?.allowOnlineHomeworkSubmission !== false);
    setPeriodsPerDay(count);
    setPeriodSchedule(buildDefaultPeriodSchedule(count, school.settings?.periodSchedule));
    setWorkingDays(
      school.settings?.workingDays?.length
        ? school.settings.workingDays
        : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    );
    setCampusLat(typeof school.settings?.campusLatitude === 'number' ? String(school.settings.campusLatitude) : '');
    setCampusLng(typeof school.settings?.campusLongitude === 'number' ? String(school.settings.campusLongitude) : '');
    setGeofenceMeters(String(school.settings?.attendanceGeofenceMeters || DEFAULT_ATTENDANCE_GEOFENCE_METERS));
    setTeacherWindowEnabled(Boolean(school.settings?.teacherAttendanceTimeWindowEnabled));
    setTeacherStartTime(school.settings?.teacherAttendanceStartTime || DEFAULT_TEACHER_ATTENDANCE_START);
    setTeacherEndTime(school.settings?.teacherAttendanceEndTime || DEFAULT_TEACHER_ATTENDANCE_END);
  }, [school]);

  if (!school) return <EmptyState title="School profile unavailable" description="No school record is linked to this account." />;

  const handlePeriodCountChange = (nextCount: number) => {
    const clamped = Math.max(1, Math.min(12, Math.round(nextCount) || 1));
    setPeriodsPerDay(clamped);
    setPeriodSchedule((prev) => buildDefaultPeriodSchedule(clamped, prev));
  };

  const handleSlotLabelChange = (index: number, label: string) => {
    setPeriodSchedule((prev) =>
      prev.map((slot, idx) => (idx === index ? { ...slot, label } : slot)),
    );
  };

  const handleSlotTimeChange = (index: number, field: 'startTime' | 'endTime', value: string) => {
    setPeriodSchedule((prev) => chainPeriodScheduleTimings(prev, index, field, value));
  };

  const handleInsertBreakAfter = (index: number) => {
    setPeriodSchedule((prev) => {
      const existingBreaks = prev.filter((s) => s.isBreak).length;
      const defaultLabel = existingBreaks === 0 ? 'Short Break / Recess' : 'Lunch Break';
      return insertBreakAfterIndex(prev, index, defaultLabel, existingBreaks === 0 ? 20 : 30);
    });
  };

  const handleRemoveBreak = (index: number) => {
    setPeriodSchedule((prev) => removeBreakAtIndex(prev, index));
  };

  const toggleWorkingDay = (day: DayOfWeek) => {
    setWorkingDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length <= 1) return prev;
        return prev.filter((d) => d !== day);
      }
      return DAYS.filter((d) => prev.includes(d) || d === day);
    });
  };

  const handlePinCurrentGps = () => {
    if (!navigator.geolocation) {
      pushToast('error', 'Geolocation is not supported in this browser.');
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCampusLat(pos.coords.latitude.toFixed(6));
        setCampusLng(pos.coords.longitude.toFixed(6));
        setLocatingGps(false);
        pushToast('success', 'Campus GPS coordinates pinned. Save School Settings to apply.');
      },
      (err) => {
        setLocatingGps(false);
        pushToast('error', err.message || 'Unable to detect current GPS coordinates. Please allow location access.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || saving) return;

    const parsedLat = campusLat.trim() ? Number(campusLat.trim()) : undefined;
    const parsedLng = campusLng.trim() ? Number(campusLng.trim()) : undefined;
    if (
      (parsedLat !== undefined && (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90)) ||
      (parsedLng !== undefined && (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180))
    ) {
      pushToast('error', 'Enter valid campus GPS latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }

    if (teacherWindowEnabled) {
      const startMins = parseHHMMToMinutes(teacherStartTime);
      const endMins = parseHHMMToMinutes(teacherEndTime);
      if (startMins === null || endMins === null || endMins <= startMins) {
        pushToast('error', 'Teacher attendance closing time must be later than opening time.');
        return;
      }
    }

    const parsedRadius = Math.max(
      25,
      Math.min(2000, Math.round(Number(geofenceMeters) || DEFAULT_ATTENDANCE_GEOFENCE_METERS)),
    );

    const normalizedSchedule = normalizePeriodSchedule(periodSchedule);
    const teachingCount = normalizedSchedule.filter((s) => !s.isBreak).length;
    const sanitizedSchedule: PeriodTimingSlot[] = normalizedSchedule.map((s) => ({
      id: s.id,
      periodNumber: s.isBreak ? 0 : s.periodNumber,
      label: (s.label.trim() || (s.isBreak ? 'Short Break / Recess' : `Period ${s.periodNumber}`)).slice(0, 40),
      startTime: s.startTime || '08:30',
      endTime: s.endTime || '09:15',
      isBreak: Boolean(s.isBreak),
    }));

    const nextSettings: NonNullable<School['settings']> = {
      ...(school.settings || {}),
      allowOnlineHomeworkSubmission: allowOnline,
      workingDays,
      periodsPerDay: teachingCount,
      periodSchedule: sanitizedSchedule,
      attendanceGeofenceMeters: parsedRadius,
      teacherAttendanceTimeWindowEnabled: teacherWindowEnabled,
      teacherAttendanceStartTime: teacherStartTime || DEFAULT_TEACHER_ATTENDANCE_START,
      teacherAttendanceEndTime: teacherEndTime || DEFAULT_TEACHER_ATTENDANCE_END,
    };
    if (parsedLat !== undefined && parsedLng !== undefined) {
      nextSettings.campusLatitude = parsedLat;
      nextSettings.campusLongitude = parsedLng;
    } else {
      delete nextSettings.campusLatitude;
      delete nextSettings.campusLongitude;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, 'schools', school.id), {
        address: address.trim().slice(0, 300),
        phone: phone.trim().slice(0, 32),
        email: email.trim().slice(0, 160),
        academicYear: academicYear.trim().slice(0, 24),
        settings: nextSettings,
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        schoolId: school.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'UPDATE_SCHOOL_SETTINGS',
        targetType: 'school',
        targetId: school.id,
        targetLabel: school.name,
        details: `Teaching periods/day: ${teachingCount}, Breaks: ${sanitizedSchedule.length - teachingCount}, Attendance radius: ${parsedRadius}m${teacherWindowEnabled ? `, Teacher check-in hours: ${teacherStartTime}-${teacherEndTime}` : ''}.`,
      }).catch(() => undefined);
      pushToast('success', 'School settings, bell timings, and teacher attendance hours saved.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to save school settings.');
    } finally {
      setSaving(false);
    }
  };

  const breakCount = periodSchedule.filter((s) => s.isBreak).length;

  return (
    <form onSubmit={handleSave} className="max-w-4xl space-y-6">
      {/* 1. Core School Profile & Contact */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold font-display text-slate-900 dark:text-slate-100">{school.name}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Code: {school.code} · Free Unlimited Campus Access</p>
          </div>
          <CheckCircle2 className="w-5 h-5 text-teal-600 dark:text-teal-400" />
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Academic Year</label>
            <input
              type="text"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Office Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Office Phone (Numbers only)</label>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={15}
              value={phone}
              onChange={(e) => setPhone(sanitizePhoneDigits(e.target.value))}
              placeholder="9876543210"
              className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={allowOnline}
            onChange={(e) => setAllowOnline(e.target.checked)}
            className="rounded border-slate-300 text-teal-600"
          />
          Enable online homework file submissions for students
        </label>
      </div>

      {/* 2. Daily Periods & Timings Configuration (Breaks separate from Period numbering + Auto-Chained Timings) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-2.5">
            <Clock className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100">
                Daily Periods &amp; Bell Timings
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Breaks / Recess are kept separate and never counted as periods. Editing any slot&apos;s end time automatically sets the next slot&apos;s start time to match.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Teaching Periods / Day</label>
            <select
              value={periodsPerDay}
              disabled={!canWrite}
              onChange={(e) => handlePeriodCountChange(Number(e.target.value))}
              className="px-3 py-1.5 text-sm font-semibold tabular-nums border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'Period' : 'Periods'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Working Days */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Active School Working Days</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => {
              const active = workingDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!canWrite}
                  onClick={() => toggleWorkingDay(day)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#0F295C] dark:bg-teal-600 text-white border-[#0F295C] dark:border-teal-600'
                      : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* Period & Break Timings Table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="tabular-nums">
              {periodsPerDay} teaching {periodsPerDay === 1 ? 'period' : 'periods'}
              {breakCount > 0 ? ` + ${breakCount} dedicated ${breakCount === 1 ? 'break' : 'breaks'}` : ' (no breaks added yet)'}
            </span>
            <span className="text-[11px]">Tip: Use &ldquo;+ Break&rdquo; on any period row to insert recess after it.</span>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 font-semibold w-24">Slot</th>
                  <th className="py-2.5 px-3 font-semibold">Label</th>
                  <th className="py-2.5 px-3 font-semibold w-36">Start Time</th>
                  <th className="py-2.5 px-3 font-semibold w-36">End Time</th>
                  <th className="py-2.5 px-3 font-semibold w-32 text-right">Break Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {periodSchedule.map((slot, idx) => {
                  const isLastRow = idx === periodSchedule.length - 1;
                  const nextIsBreak = periodSchedule[idx + 1]?.isBreak;
                  return (
                    <tr key={slot.id || `${idx}_${slot.periodNumber}`} className={slot.isBreak ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}>
                      <td className="py-2 px-3">
                        {slot.isBreak ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded text-[11px]">
                            <Coffee className="w-3 h-3" /> Break
                          </span>
                        ) : (
                          <span className="font-mono font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                            P{slot.periodNumber}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={slot.label}
                          disabled={!canWrite}
                          onChange={(e) => handleSlotLabelChange(idx, e.target.value)}
                          placeholder={slot.isBreak ? 'Short Break / Lunch' : `Period ${slot.periodNumber}`}
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="time"
                          value={slot.startTime}
                          disabled={!canWrite}
                          onChange={(e) => handleSlotTimeChange(idx, 'startTime', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs tabular-nums border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="time"
                          value={slot.endTime}
                          disabled={!canWrite}
                          onChange={(e) => handleSlotTimeChange(idx, 'endTime', e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs tabular-nums border border-slate-300 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        {slot.isBreak ? (
                          <button
                            type="button"
                            disabled={!canWrite}
                            onClick={() => handleRemoveBreak(idx)}
                            className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 hover:underline font-medium disabled:opacity-40 cursor-pointer"
                            title="Remove this break slot"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remove
                          </button>
                        ) : !isLastRow && !nextIsBreak ? (
                          <button
                            type="button"
                            disabled={!canWrite}
                            onClick={() => handleInsertBreakAfter(idx)}
                            className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 hover:underline font-medium disabled:opacity-40 cursor-pointer"
                            title={`Insert a Break / Recess right after Period ${slot.periodNumber}`}
                          >
                            <Coffee className="w-3.5 h-3.5" /> + Break
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 3. Campus Location, Geofence & Daily Teacher Attendance Marking Timings */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-2.5">
            <MapPin className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100">
                Campus Location, Geofence &amp; Teacher Attendance Timings
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Teachers must be within the configured campus radius (default 100 metres) with a live photo and within the daily attendance window below.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canWrite || locatingGps}
            onClick={handlePinCurrentGps}
          >
            {locatingGps ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
            {locatingGps ? 'Locating…' : 'Pin Current GPS'}
          </Button>
        </div>

        {/* Daily Teacher Attendance Time Window (Teachers Only) */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={teacherWindowEnabled}
                disabled={!canWrite}
                onChange={(e) => setTeacherWindowEnabled(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-teal-600"
              />
              <div>
                <span className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                  Set Daily Attendance Marking Timings (Teachers Only)
                </span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  When enabled, Teachers can only mark their daily self-attendance between the opening and closing times below. Student class attendance and Principal manual overrides remain unrestricted.
                </span>
              </div>
            </label>
            {teacherWindowEnabled && (
              <span className="text-xs font-mono font-semibold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 px-2.5 py-1 rounded-md tabular-nums">
                {formatHHMMTo12Hour(teacherStartTime)} – {formatHHMMTo12Hour(teacherEndTime)}
              </span>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Teacher Attendance Opens At
              </label>
              <input
                type="time"
                value={teacherStartTime}
                disabled={!canWrite || !teacherWindowEnabled}
                onChange={(e) => setTeacherStartTime(e.target.value)}
                className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 disabled:opacity-50 focus:outline-none focus:border-teal-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Teacher Attendance Closes At
              </label>
              <input
                type="time"
                value={teacherEndTime}
                disabled={!canWrite || !teacherWindowEnabled}
                onChange={(e) => setTeacherEndTime(e.target.value)}
                className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 disabled:opacity-50 focus:outline-none focus:border-teal-600"
              />
            </div>
          </div>
        </div>

        <DetectLocationAddressPicker
          disabled={!canWrite}
          label="Detect Campus Address & Pin Coordinates"
          helperText="Detect your campus location to fill the official address and set exact GPS geofence coordinates (drag the pin to refine)."
          onAddressDetected={(detected) => {
            setAddress(detected.formattedAddress.slice(0, 300));
            setCampusLat(detected.latitude.toFixed(6));
            setCampusLng(detected.longitude.toFixed(6));
            pushToast('success', 'Campus address & GPS coordinates updated. Click Save School Settings to apply.');
          }}
        />

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">School Campus Address</label>
          <textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Click Detect Current Location above or enter full campus street address"
            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
          />
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Campus Latitude</label>
            <input
              type="text"
              value={campusLat}
              onChange={(e) => setCampusLat(e.target.value)}
              placeholder="e.g. 28.613939"
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Campus Longitude</label>
            <input
              type="text"
              value={campusLng}
              onChange={(e) => setCampusLng(e.target.value)}
              placeholder="e.g. 77.209021"
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Allowed Range (Metres)</label>
            <input
              type="number"
              min={25}
              max={2000}
              value={geofenceMeters}
              onChange={(e) => setGeofenceMeters(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-600"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="navy" loading={saving} disabled={!canWrite}>
          {saving ? 'Saving…' : 'Save School Settings'}
        </Button>
      </div>
    </form>
  );
}
