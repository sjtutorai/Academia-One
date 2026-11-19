import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { Plus, Download, AlertTriangle, Trash2, CheckCircle2, Calendar, List } from 'lucide-react';
import { db, generateId, handleFirestoreError, OperationType } from '../../lib/firebase';
import { detectExamConflicts, detectTimetableConflicts } from '../../lib/permissions';
import { exportToCsv } from '../../lib/csv';
import { recordAuditLog } from '../../lib/audit';
import { Button, EmptyState, Modal, StatusText, useToast } from '../../components/ui/Primitives';
import { DetectLocationAddressPicker } from '../../components/shared/DetectLocationAddressPicker';
import type {
  Announcement,
  DayOfWeek,
  Examination,
  Homework,
  HomeworkSubmission,
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
  timetable,
  classes,
  subjects,
  teachers,
  rooms,
  schoolId,
  actor,
  canWrite,
}: {
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
  const [viewBy, setViewBy] = useState<'class' | 'teacher'>('class');
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id || '');
  const [selectedTeacherId, setSelectedTeacherId] = useState(teachers[0]?.id || '');
  const [modalOpen, setModalOpen] = useState(false);

  const [form, setForm] = useState({
    classId: classes[0]?.id || '',
    dayOfWeek: 'Monday' as DayOfWeek,
    periodNumber: '1',
    startTime: '08:30',
    endTime: '09:20',
    isBreak: false,
    subjectId: subjects[0]?.id || '',
    teacherId: teachers[0]?.id || '',
    roomId: rooms[0]?.id || '',
  });

  const activeClassId = selectedClassId || classes[0]?.id || '';
  const activeTeacherId = selectedTeacherId || teachers[0]?.id || '';

  const visiblePeriods = useMemo(() => {
    return timetable
      .filter((p) => (viewBy === 'class' ? p.classId === activeClassId : p.teacherId === activeTeacherId))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [timetable, viewBy, activeClassId, activeTeacherId]);

  const liveConflicts = useMemo(() => {
    const cls = classes.find((c) => c.id === form.classId);
    const subj = subjects.find((s) => s.id === form.subjectId);
    const tch = teachers.find((t) => t.id === form.teacherId);
    const rm = rooms.find((r) => r.id === form.roomId);
    return detectTimetableConflicts(
      {
        schoolId,
        classId: form.classId,
        className: cls?.name,
        dayOfWeek: form.dayOfWeek,
        periodNumber: Number(form.periodNumber) || 1,
        startTime: form.startTime,
        endTime: form.endTime,
        isBreak: form.isBreak,
        subjectId: form.isBreak ? '' : subj?.id,
        subjectName: form.isBreak ? 'Break' : subj?.name,
        teacherId: form.isBreak ? '' : tch?.id,
        teacherName: form.isBreak ? '' : tch?.name,
        roomId: form.isBreak ? '' : rm?.id,
        roomName: form.isBreak ? '' : rm?.name,
        status: 'published',
      },
      timetable,
    );
  }, [form, classes, subjects, teachers, rooms, timetable, schoolId]);

  const handleAddPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    if (liveConflicts.length > 0) {
      pushToast('error', 'Resolve timetable conflicts before publishing.');
      return;
    }
    const cls = classes.find((c) => c.id === form.classId);
    const subj = subjects.find((s) => s.id === form.subjectId);
    const tch = teachers.find((t) => t.id === form.teacherId);
    const rm = rooms.find((r) => r.id === form.roomId);
    const id = generateId('tt');

    try {
      await setDoc(doc(db, 'timetablePeriods', id), {
        id,
        schoolId,
        classId: form.classId,
        className: cls?.name || '',
        dayOfWeek: form.dayOfWeek,
        periodNumber: Number(form.periodNumber) || 1,
        startTime: form.startTime,
        endTime: form.endTime,
        isBreak: form.isBreak,
        subjectId: form.isBreak ? '' : subj?.id || '',
        subjectName: form.isBreak ? 'Break / Recess' : subj?.name || 'General Study',
        teacherId: form.isBreak ? '' : tch?.id || '',
        teacherName: form.isBreak ? '' : tch?.name || '',
        roomId: form.isBreak ? '' : rm?.id || '',
        roomName: form.isBreak ? '' : rm?.name || '',
        status: 'published',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', 'Timetable slot published.');
      setModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `timetablePeriods/${id}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex p-1 bg-slate-100 rounded-lg text-xs">
            <button type="button" onClick={() => setViewBy('class')} className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${viewBy === 'class' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
              By Class
            </button>
            <button type="button" onClick={() => setViewBy('teacher')} className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${viewBy === 'teacher' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
              By Teacher
            </button>
          </div>

          {viewBy === 'class' ? (
            <select value={activeClassId} onChange={(e) => setSelectedClassId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white">
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          ) : (
            <select value={activeTeacherId} onChange={(e) => setSelectedTeacherId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white">
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>

        <Button
          variant="primary"
          size="sm"
          disabled={!canWrite || classes.length === 0}
          onClick={() => {
            setForm((f) => ({ ...f, classId: activeClassId || classes[0]?.id || '', teacherId: teachers[0]?.id || '', roomId: rooms[0]?.id || '', subjectId: subjects[0]?.id || '' }));
            setModalOpen(true);
          }}
        >
          <Plus className="w-4 h-4" />
          Add Period Slot
        </Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {DAYS.slice(0, 5).map((day) => {
          const dayItems = visiblePeriods.filter((p) => p.dayOfWeek === day);
          return (
            <div key={day} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-bold font-display text-slate-900">{day}</h3>
                <span className="text-xs text-slate-500 tabular-nums">{dayItems.length} periods</span>
              </div>
              <div className="divide-y divide-slate-100">
                {dayItems.length === 0 ? (
                  <p className="p-4 text-xs text-slate-400">No periods scheduled.</p>
                ) : (
                  dayItems.map((p) => (
                    <div key={p.id} className={`p-3.5 flex items-start justify-between gap-2 ${p.isBreak ? 'bg-slate-50/70' : ''}`}>
                      <div>
                        <p className="text-xs font-mono text-teal-700 tabular-nums">{p.startTime} – {p.endTime} · P{p.periodNumber}</p>
                        <p className="text-sm font-semibold text-slate-900 mt-0.5">{p.subjectName || 'Break'}</p>
                        {!p.isBreak && (
                          <p className="text-xs text-slate-500">
                            {viewBy === 'class' ? p.teacherName : p.className} {p.roomName ? `· ${p.roomName}` : ''}
                          </p>
                        )}
                      </div>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteDoc(doc(db, 'timetablePeriods', p.id));
                            pushToast('success', 'Removed period slot.');
                          }}
                          className="text-slate-400 hover:text-red-600 p-1 cursor-pointer"
                          aria-label="Delete period"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Timetable Period" subtitle="Automatic overlap detection checks teacher, class, and room availability.">
        <form onSubmit={handleAddPeriod} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Class</label>
              <select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Day</label>
              <select value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value as DayOfWeek })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Period #</label>
              <input type="number" min={1} max={12} value={form.periodNumber} onChange={(e) => setForm({ ...form, periodNumber: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Start Time</label>
              <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">End Time</label>
              <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" checked={form.isBreak} onChange={(e) => setForm({ ...form, isBreak: e.target.checked })} className="rounded border-slate-300 text-teal-600" />
            Mark slot as Break / Recess
          </label>

          {!form.isBreak && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
                <select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Teacher</label>
                <select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Room</label>
                <select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {liveConflicts.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 space-y-1">
              {liveConflicts.map((c) => (
                <p key={c} className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{c}</span>
                </p>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={liveConflicts.length > 0}>Publish Slot</Button>
          </div>
        </form>
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
// Homework Management
// ============================================================================
export function PrincipalHomeworkView({
  homework,
  submissions,
  classes,
  teachers,
  schoolId,
  actor,
  canWrite,
}: {
  homework: Homework[];
  submissions: HomeworkSubmission[];
  classes: SchoolClass[];
  teachers: TeacherProfile[];
  schoolId: string;
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    classId: classes[0]?.id || '',
    subjectName: 'Mathematics',
    teacherId: teachers[0]?.id || '',
    title: '',
    instructions: '',
    dueDate: '2026-11-30',
    allowOnlineSubmission: true,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const cls = classes.find((c) => c.id === form.classId);
    const tch = teachers.find((t) => t.id === form.teacherId);
    const id = generateId('hw');
    await setDoc(doc(db, 'homework', id), {
      id,
      schoolId,
      classId: form.classId,
      className: cls?.name || '',
      subjectId: '',
      subjectName: form.subjectName.trim(),
      teacherId: tch?.id || '',
      teacherName: tch?.name || actor.displayName,
      title: form.title.trim().slice(0, 160),
      instructions: form.instructions.trim().slice(0, 2000),
      assignedDate: new Date().toISOString().slice(0, 10),
      dueDate: form.dueDate,
      allowOnlineSubmission: form.allowOnlineSubmission,
      attachmentName: '',
      status: 'published',
      createdBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    pushToast('success', 'Homework published.');
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Track class-level homework assignments, due dates, and student submissions.</p>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}>
          <Plus className="w-4 h-4" /> Publish Homework
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {homework.length === 0 ? (
          <EmptyState title="No homework assigned" description="Publish homework to track completion across classes." />
        ) : (
          homework.map((hw) => {
            const subs = submissions.filter((s) => s.homeworkId === hw.id);
            const late = subs.filter((s) => s.isLate).length;
            return (
              <div key={hw.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-teal-700">{hw.className}</span>
                    <span>·</span>
                    <span>{hw.subjectName}</span>
                    <span>·</span>
                    <span className="tabular-nums">Due {hw.dueDate}</span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mt-1">{hw.title}</h3>
                  <p className="text-xs text-slate-600 mt-0.5">{hw.instructions}</p>
                </div>
                <div className="text-xs text-right shrink-0 tabular-nums">
                  <p className="font-semibold text-slate-900">{subs.length} submitted</p>
                  <p className="text-slate-500">{late} late · {hw.teacherName}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Publish Homework">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
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
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Title *</label>
              <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Due Date *</label>
              <input type="date" required value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Instructions</label>
            <textarea rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Publish</Button>
          </div>
        </form>
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
                ['Class Code', 'Name', 'Class Teacher', 'Enrolled', 'Capacity'],
                data.classes.map((c) => [c.code, c.name, c.classTeacherName || '', data.students.filter((s) => s.classId === c.id).length, c.capacity]),
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
  const [address, setAddress] = useState(school?.address || '');
  const [phone, setPhone] = useState(school?.phone || '');
  const [email, setEmail] = useState(school?.email || '');
  const [academicYear, setAcademicYear] = useState(school?.academicYear || '2026-2027');
  const [allowOnline, setAllowOnline] = useState(school?.settings?.allowOnlineHomeworkSubmission !== false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!school) return;
    setAddress(school.address || '');
    setPhone(school.phone || '');
    setEmail(school.email || '');
    setAcademicYear(school.academicYear || '2026-2027');
    setAllowOnline(school.settings?.allowOnlineHomeworkSubmission !== false);
  }, [school?.id, school?.address, school?.phone, school?.email, school?.academicYear, school?.settings?.allowOnlineHomeworkSubmission]);

  if (!school) return <EmptyState title="School profile unavailable" description="No school record is linked to this account." />;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || saving) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'schools', school.id), {
        address: address.trim().slice(0, 300),
        phone: phone.trim().slice(0, 32),
        email: email.trim().slice(0, 160),
        academicYear: academicYear.trim().slice(0, 24),
        settings: { ...(school.settings || {}), allowOnlineHomeworkSubmission: allowOnline },
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
      }).catch(() => undefined);
      pushToast('success', 'School settings and campus address saved.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to save school settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="max-w-2xl bg-white border border-slate-200 rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-base font-bold font-display text-slate-900">{school.name}</h2>
          <p className="text-xs text-slate-500">Code: {school.code} · Free Unlimited Campus Access</p>
        </div>
        <CheckCircle2 className="w-5 h-5 text-teal-600" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Academic Year</label>
          <input
            type="text"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg transition-colors focus:outline-none focus:border-teal-600"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Office Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg transition-colors focus:outline-none focus:border-teal-600"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Office Phone</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full sm:max-w-xs px-3 py-2 text-sm border border-slate-300 rounded-lg transition-colors focus:outline-none focus:border-teal-600"
        />
      </div>

      <div className="space-y-3 pt-1">
        <DetectLocationAddressPicker
          disabled={!canWrite}
          label="Detect Campus Address"
          helperText="Detect your current location to populate the official school address, then drag the pin on the map if needed."
          onAddressDetected={(detected) => {
            setAddress(detected.formattedAddress.slice(0, 300));
            pushToast('success', 'Location detected and campus address updated. Click Save School Settings to apply.');
          }}
        />
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">School Campus Address</label>
          <textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Click Detect Current Location above or enter full campus street address"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg transition-colors focus:outline-none focus:border-teal-600"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={allowOnline}
          onChange={(e) => setAllowOnline(e.target.checked)}
          className="rounded border-slate-300 text-teal-600"
        />
        Enable online homework file submissions for students
      </label>

      <div className="flex justify-end pt-2">
        <Button type="submit" variant="navy" loading={saving} disabled={!canWrite}>
          {saving ? 'Saving…' : 'Save School Settings'}
        </Button>
      </div>
    </form>
  );
}
