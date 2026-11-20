import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  ClipboardCheck,
  CalendarDays,
  ClipboardList,
  Megaphone,
  BarChart2,
  Bell,
  UserCircle2,
  Flag,
  Download,
  Plus,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
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
import { db, generateId, handleFirestoreError, OperationType, formatFirestoreDate } from '../../lib/firebase';
import { getSchoolAccessMode, detectExamConflicts } from '../../lib/permissions';
import { exportToCsv } from '../../lib/csv';
import { recordAuditLog } from '../../lib/audit';
import { useAuth } from '../../contexts/AuthContext';
import { useSchoolData, type SchoolDataBundle } from '../../hooks/useSchoolData';
import { DashboardShell, type NavItem } from '../../components/DashboardShell';
import {
  Button,
  EmptyState,
  Modal,
  SkeletonTable,
  StatCard,
  StatusText,
  useToast,
} from '../../components/ui/Primitives';
import { NotificationsAndPreferencesView } from '../../components/shared/NotificationsAndPreferencesView';
import { ProfileSecurityView } from '../../components/shared/ProfileSecurityView';
import type {
  AttendanceEntry,
  AttendanceRecord,
  DayOfWeek,
  Examination,
  PlatformUser,
  SchoolJoinRequest,
} from '../../types/models';

const COORD_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/coordinator/dashboard', icon: LayoutDashboard },
  { id: 'classes', label: 'Assigned Classes', path: '/coordinator/classes', icon: BookOpen },
  { id: 'approvals', label: 'Student Approvals', path: '/coordinator/approvals', icon: UserCheck },
  { id: 'attendance', label: 'Attendance Monitoring', path: '/coordinator/attendance', icon: ClipboardCheck },
  { id: 'schedule', label: 'Timetable & Exams', path: '/coordinator/schedule', icon: CalendarDays },
  { id: 'homework', label: 'Homework Tracking', path: '/coordinator/homework', icon: ClipboardList },
  { id: 'notices', label: 'Notices & Escalations', path: '/coordinator/notices', icon: Megaphone },
  { id: 'reports', label: 'Reports', path: '/coordinator/reports', icon: BarChart2 },
  { id: 'notifications', label: 'Notifications', path: '/coordinator/notifications', icon: Bell },
  { id: 'profile', label: 'Profile', path: '/coordinator/profile', icon: UserCircle2 },
];

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function CoordinatorPortal() {
  const { activeUser, activeSchool } = useAuth();
  const schoolId = activeUser?.schoolId || '';
  const data = useSchoolData(schoolId, true);
  const access = getSchoolAccessMode(activeSchool);
  const [globalSearch, setGlobalSearch] = useState('');

  const assignedClassSet = useMemo(() => {
    const ids = activeUser?.assignedClassIds || [];
    return new Set(ids);
  }, [activeUser?.assignedClassIds]);

  const scopedData = useMemo<SchoolDataBundle>(() => {
    const hasScope = assignedClassSet.size > 0;
    const matchClass = (cid?: string) => (hasScope ? Boolean(cid && assignedClassSet.has(cid)) : false);
    const scopedClasses = data.classes.filter((c) => matchClass(c.id));
    const scopedSubjects = data.subjects.filter((s) => matchClass(s.classId));
    const scopedStudents = data.students.filter((st) => matchClass(st.classId));
    const scopedTimetable = data.timetable.filter((t) => matchClass(t.classId));
    const scopedAttendance = data.attendance.filter((a) => matchClass(a.classId));
    const scopedHomework = data.homework.filter((h) => matchClass(h.classId));
    const scopedSubmissions = data.submissions.filter((sub) => matchClass(sub.classId));
    const scopedExams = data.examinations.filter((ex) => matchClass(ex.classId));
    const scopedResults = data.examResults.filter((r) => matchClass(r.classId));
    const scopedMaterials = data.materials.filter((m) => matchClass(m.classId));
    const teacherIds = new Set<string>();
    scopedClasses.forEach((c) => c.classTeacherId && teacherIds.add(c.classTeacherId));
    scopedSubjects.forEach((s) => s.teacherId && teacherIds.add(s.teacherId));
    scopedTimetable.forEach((p) => p.teacherId && teacherIds.add(p.teacherId));
    const scopedTeachers = data.teachers.filter(
      (t) => teacherIds.has(t.id) || (t.assignedClassIds || []).some((cid) => assignedClassSet.has(cid)),
    );
    const scopedAnnouncements = data.announcements.filter(
      (a) =>
        a.audience === 'school_wide' ||
        a.audience === 'principal_flag' ||
        (a.audience === 'role_specific' && a.targetRole === 'coordinator') ||
        (a.audience === 'class_specific' && matchClass(a.targetClassId)),
    );

    return {
      ...data,
      classes: scopedClasses,
      subjects: scopedSubjects,
      teachers: scopedTeachers,
      students: scopedStudents,
      timetable: scopedTimetable,
      attendance: scopedAttendance,
      homework: scopedHomework,
      submissions: scopedSubmissions,
      examinations: scopedExams,
      examResults: scopedResults,
      materials: scopedMaterials,
      announcements: scopedAnnouncements,
    };
  }, [data, assignedClassSet]);

  if (!activeUser) return null;

  const perms = activeUser.coordinatorPermissions || {
    canEditAttendance: false,
    canEditMarks: false,
    canAssignTeachers: false,
    canPublishNotices: true,
    canCoordinateExams: true,
  };

  return (
    <DashboardShell
      title="Coordinator Portal"
      breadcrumb={`${activeSchool?.name || 'School'} · Assigned Academic Scope`}
      navItems={COORD_NAV}
      onGlobalSearch={setGlobalSearch}
      globalSearchPlaceholder="Search assigned classes, students, exams…"
    >
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route
          path="dashboard"
          element={<CoordinatorOverview user={activeUser} data={scopedData} perms={perms} search={globalSearch} />}
        />
        <Route
          path="classes"
          element={<CoordinatorClassesView data={scopedData} search={globalSearch} />}
        />
        <Route
          path="approvals"
          element={
            <CoordinatorStudentApprovalsView
              user={activeUser}
              assignedClassIds={Array.from(assignedClassSet)}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="attendance"
          element={
            <CoordinatorAttendanceView
              user={activeUser}
              data={scopedData}
              canEdit={access.canWrite && Boolean(perms.canEditAttendance)}
            />
          }
        />
        <Route
          path="schedule"
          element={
            <CoordinatorScheduleExamsView
              user={activeUser}
              schoolYear={activeSchool?.academicYear || '2025-2026'}
              data={scopedData}
              allSchoolExams={data.examinations}
              canCoordinateExams={access.canWrite && Boolean(perms.canCoordinateExams)}
            />
          }
        />
        <Route
          path="homework"
          element={<CoordinatorHomeworkView data={scopedData} search={globalSearch} />}
        />
        <Route
          path="notices"
          element={
            <CoordinatorNoticesView
              user={activeUser}
              data={scopedData}
              canWrite={access.canWrite}
              canPublishNotices={Boolean(perms.canPublishNotices)}
            />
          }
        />
        <Route path="reports" element={<CoordinatorReportsView data={scopedData} />} />
        <Route path="notifications" element={<NotificationsAndPreferencesView />} />
        <Route path="profile" element={<ProfileSecurityView />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardShell>
  );
}

// ============================================================================
// 1. Coordinator Overview
// ============================================================================
function CoordinatorOverview({
  user,
  data,
  perms,
  search,
}: {
  user: PlatformUser;
  data: SchoolDataBundle;
  perms: NonNullable<PlatformUser['coordinatorPermissions']>;
  search: string;
}) {
  if (data.loading) return <SkeletonTable rows={6} cols={4} />;

  const attendanceAlerts = data.attendance.flatMap((rec) =>
    rec.entries
      .filter((e) => e.status === 'absent' || e.status === 'late')
      .map((e) => ({
        date: rec.date,
        className: rec.className || rec.classId,
        studentName: e.studentName,
        rollNumber: e.rollNumber,
        status: e.status,
      })),
  );

  const upcomingExams = data.examinations
    .filter((ex) => ex.status === 'scheduled')
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalExpectedSubs = data.homework.reduce((acc, hw) => {
    const classCount = data.students.filter((s) => s.classId === hw.classId && s.status === 'active').length;
    return acc + classCount;
  }, 0);
  const completionPct =
    totalExpectedSubs > 0 ? Math.min(100, Math.round((data.submissions.length / totalExpectedSubs) * 100)) : 0;

  const q = search.trim().toLowerCase();
  const visibleClasses = data.classes.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-teal-700">Assigned Academic Scope</p>
          <h2 className="text-lg font-bold font-display text-slate-900 mt-0.5">
            Welcome, {user.displayName}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Permissions granted by Principal:{' '}
            {[
              perms.canEditAttendance ? 'Edit Attendance' : 'Read-Only Attendance',
              perms.canCoordinateExams ? 'Coordinate Exams' : 'View Exams',
              perms.canPublishNotices ? 'Publish Notices' : 'View Notices',
              perms.canEditMarks ? 'Edit Marks' : 'View Marks',
            ].join(' · ')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Assigned Classes</p>
          <p className="text-sm font-semibold text-slate-900 mt-0.5">
            {data.classes.length > 0 ? data.classes.map((c) => c.name).join(' · ') : 'No classes assigned yet'}
          </p>
        </div>
      </div>

      {data.classes.length === 0 ? (
        <EmptyState
          title="No Classes Assigned to Your Scope"
          description="Ask your school Principal to assign classes or grade sections to your Coordinator account so you can monitor attendance, exams, and homework."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Assigned Classes"
              value={data.classes.length}
              subtext={`${data.teachers.length} active teachers in scope`}
              tone="teal"
            />
            <StatCard
              label="Students in Scope"
              value={data.students.length}
              subtext={`${data.subjects.length} subjects tracked`}
            />
            <StatCard
              label="Attendance Alerts"
              value={attendanceAlerts.length}
              subtext="Absent or late markings"
              tone={attendanceAlerts.length > 0 ? 'amber' : 'teal'}
            />
            <StatCard
              label="Homework Completion"
              value={`${completionPct}%`}
              subtext={`${data.submissions.length} submissions · ${upcomingExams.length} upcoming exams`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Assigned Classes Summary */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold font-display text-slate-900 mb-4">Assigned Classes & Homeroom</h3>
              <div className="divide-y divide-slate-100">
                {visibleClasses.map((cls) => {
                  const stCount = data.students.filter((s) => s.classId === cls.id).length;
                  const hwCount = data.homework.filter((h) => h.classId === cls.id).length;
                  return (
                    <div key={cls.id} className="py-3 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{cls.name}</p>
                        <p className="text-xs text-slate-500">
                          Code {cls.code} · Teacher: {cls.classTeacherName || 'Unassigned'} · Room {cls.roomName || 'TBD'}
                        </p>
                      </div>
                      <div className="text-right text-xs text-slate-600 tabular-nums">
                        <p className="font-semibold text-slate-900">{stCount} / {cls.capacity} students</p>
                        <p className="text-slate-500">{hwCount} assignments</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Attendance Alerts */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold font-display text-slate-900 mb-4">Recent Attendance Alerts</h3>
              {attendanceAlerts.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">No absences or tardiness recorded in your assigned classes.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {attendanceAlerts.slice(0, 6).map((al, idx) => (
                    <div key={`${al.date}_${al.rollNumber}_${idx}`} className="py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{al.studentName}</p>
                        <p className="text-xs text-slate-500">
                          {al.className} · Roll #{al.rollNumber} · {al.date}
                        </p>
                      </div>
                      <StatusText status={al.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Upcoming Exams */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold font-display text-slate-900 mb-4">Upcoming Examinations</h3>
              {upcomingExams.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">No upcoming examinations scheduled in assigned classes.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {upcomingExams.slice(0, 5).map((ex) => (
                    <div key={ex.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {ex.name} · {ex.subjectName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {ex.className || ex.classId} · {ex.date} · {ex.startTime}–{ex.endTime} · {ex.roomName || 'Room TBD'}
                        </p>
                      </div>
                      <StatusText status={ex.schedulePublished ? 'published' : 'draft'} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Notices */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold font-display text-slate-900 mb-4">Recent Notices & Escalations</h3>
              {data.announcements.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">No notices published yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.announcements.slice(0, 5).map((an) => (
                    <div key={an.id} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{an.title}</p>
                        <StatusText status={an.audience === 'principal_flag' ? 'pending' : an.status} />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{an.body}</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {an.authorName} · {an.audience.replace('_', ' ')} · {formatFirestoreDate(an.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// 2. Assigned Classes Roster & Subjects
// ============================================================================
function CoordinatorClassesView({ data, search }: { data: SchoolDataBundle; search: string }) {
  const [selectedClassId, setSelectedClassId] = useState<string>(data.classes[0]?.id || '');
  const activeClassId = selectedClassId || data.classes[0]?.id || '';
  const selectedClass = data.classes.find((c) => c.id === activeClassId);
  const q = search.trim().toLowerCase();

  const roster = data.students.filter(
    (s) =>
      s.classId === activeClassId &&
      (!q || s.name.toLowerCase().includes(q) || s.admissionNumber.toLowerCase().includes(q)),
  );
  const subjects = data.subjects.filter((s) => s.classId === activeClassId);

  if (data.classes.length === 0) {
    return (
      <EmptyState
        title="No Assigned Classes"
        description="Once the Principal assigns classes to your Coordinator scope, rosters and subject mappings will appear here."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {data.classes.map((cls) => (
          <button
            key={cls.id}
            type="button"
            onClick={() => setSelectedClassId(cls.id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
              activeClassId === cls.id
                ? 'bg-[#0B1528] text-white border-[#0B1528]'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {cls.name} ({cls.code})
          </button>
        ))}
      </div>

      {selectedClass && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold font-display text-slate-900">
                  {selectedClass.name} — Student Roster
                </h3>
                <p className="text-xs text-slate-500">
                  Homeroom: {selectedClass.classTeacherName || 'Unassigned'} · {roster.length} enrolled students
                </p>
              </div>
              <span className="text-xs text-slate-500 tabular-nums">Capacity {selectedClass.capacity}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Roll</th>
                    <th className="py-2.5 px-4 font-semibold">Student</th>
                    <th className="py-2.5 px-4 font-semibold">Admission #</th>
                    <th className="py-2.5 px-4 font-semibold">Guardian</th>
                    <th className="py-2.5 px-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {roster.map((st) => (
                    <tr key={st.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 tabular-nums font-mono text-xs text-slate-600">{st.rollNumber}</td>
                      <td className="py-3 px-4 font-medium text-slate-900">{st.name}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600">{st.admissionNumber}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {st.guardianName || '—'} {st.guardianPhone ? `· ${st.guardianPhone}` : ''}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={st.status} />
                      </td>
                    </tr>
                  ))}
                  {roster.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                        No students matching filter in this class.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-bold font-display text-slate-900 mb-3">Subjects & Teachers</h3>
            {subjects.length === 0 ? (
              <p className="text-xs text-slate-500">No subjects mapped to this class yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {subjects.map((sub) => (
                  <div key={sub.id} className="py-3">
                    <p className="text-sm font-semibold text-slate-900">{sub.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {sub.code} · {sub.teacherName || 'Teacher unassigned'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 3. Attendance Monitoring (Optional Edit If Permitted)
// ============================================================================
function CoordinatorAttendanceView({
  user,
  data,
  canEdit,
}: {
  user: PlatformUser;
  data: SchoolDataBundle;
  canEdit: boolean;
}) {
  const { pushToast } = useToast();
  const [classFilter, setClassFilter] = useState('all');
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [draftEntries, setDraftEntries] = useState<AttendanceEntry[]>([]);
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = data.attendance
    .filter((a) => classFilter === 'all' || a.classId === classFilter)
    .sort((a, b) => b.date.localeCompare(a.date));

  const openEdit = (rec: AttendanceRecord) => {
    setEditingRecord(rec);
    setDraftEntries(rec.entries.map((e) => ({ ...e })));
    setEditReason('');
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    setSaving(true);
    try {
      const nextHistory = [
        ...(editingRecord.editHistory || []),
        {
          editedBy: user.displayName,
          editedAt: new Date().toISOString(),
          note: editReason.trim() || 'Coordinator verified attendance adjustment',
        },
      ];
      await updateDoc(doc(db, 'attendanceRecords', editingRecord.id), {
        entries: draftEntries,
        editHistory: nextHistory,
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: user.role,
        action: 'COORDINATOR_EDITED_ATTENDANCE',
        targetType: 'attendance',
        targetId: editingRecord.id,
        targetLabel: `${editingRecord.className || editingRecord.classId} (${editingRecord.date})`,
        details: editReason.trim() || 'Adjusted attendance entries under delegated permission.',
      });
      pushToast('success', 'Attendance register updated with audit trail.');
      setEditingRecord(null);
    } catch (err) {
      pushToast('error', 'Unable to update attendance record.');
      handleFirestoreError(err, OperationType.UPDATE, `attendanceRecords/${editingRecord.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold font-display text-slate-900">Attendance Monitoring</h2>
          <p className="text-xs text-slate-500">
            {canEdit
              ? 'Your Principal granted attendance adjustment permission for assigned classes.'
              : 'Read-only monitoring mode. Contact your Principal if attendance adjustments are needed.'}
          </p>
        </div>
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-teal-600"
        >
          <option value="all">All Assigned Classes</option>
          {data.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No Attendance Records Found"
          description="Daily attendance registers submitted by teachers for your assigned classes will appear here."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-3 px-4 font-semibold">Date</th>
                  <th className="py-3 px-4 font-semibold">Class</th>
                  <th className="py-3 px-4 font-semibold">Present</th>
                  <th className="py-3 px-4 font-semibold">Absent / Late</th>
                  <th className="py-3 px-4 font-semibold">Rate</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  {canEdit && <th className="py-3 px-4 font-semibold text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((rec) => {
                  const present = rec.entries.filter((e) => e.status === 'present').length;
                  const absent = rec.entries.filter((e) => e.status === 'absent').length;
                  const late = rec.entries.filter((e) => e.status === 'late').length;
                  const rate = rec.entries.length > 0 ? Math.round(((present + late) / rec.entries.length) * 100) : 0;
                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono text-xs text-slate-700">{rec.date}</td>
                      <td className="py-3 px-4 font-medium text-slate-900">{rec.className || rec.classId}</td>
                      <td className="py-3 px-4 tabular-nums text-emerald-700 font-semibold">{present}</td>
                      <td className="py-3 px-4 tabular-nums text-xs text-slate-600">
                        {absent} absent · {late} late
                      </td>
                      <td className="py-3 px-4 tabular-nums font-semibold text-slate-900">{rate}%</td>
                      <td className="py-3 px-4">
                        <StatusText status={rec.status} />
                      </td>
                      {canEdit && (
                        <td className="py-3 px-4 text-right">
                          <Button variant="secondary" size="sm" onClick={() => openEdit(rec)}>
                            Adjust
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(editingRecord)}
        onClose={() => setEditingRecord(null)}
        title={`Adjust Attendance — ${editingRecord?.className || ''}`}
        subtitle={`Register Date: ${editingRecord?.date || ''}`}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {draftEntries.map((entry, idx) => (
              <div key={entry.studentId} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{entry.studentName}</p>
                  <p className="text-xs text-slate-500">Roll #{entry.rollNumber}</p>
                </div>
                <select
                  value={entry.status}
                  onChange={(e) => {
                    const next = [...draftEntries];
                    next[idx] = { ...entry, status: e.target.value as AttendanceEntry['status'] };
                    setDraftEntries(next);
                  }}
                  className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5"
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="late">Late</option>
                  <option value="excused">Excused</option>
                </select>
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Adjustment Reason (Audit Trail)</label>
            <input
              type="text"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="e.g., Medical excuse verified by guardian call"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditingRecord(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={handleSaveEdit}>
              {saving ? 'Saving…' : 'Save Attendance Update'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// 4. Timetable Review & Exam Coordination
// ============================================================================
function CoordinatorScheduleExamsView({
  user,
  schoolYear,
  data,
  allSchoolExams,
  canCoordinateExams,
}: {
  user: PlatformUser;
  schoolYear: string;
  data: SchoolDataBundle;
  allSchoolExams: Examination[];
  canCoordinateExams: boolean;
}) {
  const { pushToast } = useToast();
  const [tab, setTab] = useState<'timetable' | 'exams'>('timetable');
  const [selectedClassId, setSelectedClassId] = useState(data.classes[0]?.id || '');
  const activeClassId = selectedClassId || data.classes[0]?.id || '';
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const [form, setForm] = useState({
    name: '',
    category: 'unit_test' as Examination['category'],
    classId: activeClassId,
    subjectName: '',
    date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    startTime: '09:00',
    endTime: '11:00',
    maxMarks: 100,
    passingMarks: 40,
    roomId: '',
  });

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    const cls = data.classes.find((c) => c.id === form.classId);
    const room = data.rooms.find((r) => r.id === form.roomId);
    const classStudentCount = data.students.filter((s) => s.classId === form.classId).length;
    const found = detectExamConflicts(
      {
        schoolId: user.schoolId,
        classId: form.classId,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        roomId: room?.id,
        roomCapacity: room?.capacity,
        classStudentCount,
      },
      allSchoolExams,
    );
    setConflicts(found);
    if (found.length > 0) return;

    setSaving(true);
    const id = generateId('exm');
    try {
      await setDoc(doc(db, 'examinations', id), {
        id,
        schoolId: user.schoolId,
        name: form.name.trim(),
        category: form.category,
        academicYear: schoolYear,
        classId: form.classId,
        className: cls?.name || '',
        subjectName: form.subjectName.trim(),
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        maxMarks: Number(form.maxMarks),
        passingMarks: Number(form.passingMarks),
        roomId: room?.id || '',
        roomName: room?.name || '',
        schedulePublished: false,
        resultsPublished: false,
        status: 'scheduled',
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: user.role,
        action: 'COORDINATOR_SCHEDULED_EXAM',
        targetType: 'examination',
        targetId: id,
        targetLabel: `${form.name} (${form.subjectName})`,
      });
      pushToast('success', 'Exam scheduled as draft. Principal or Coordinator can publish when finalized.');
      setModalOpen(false);
    } catch (err) {
      pushToast('error', 'Unable to create exam schedule.');
      handleFirestoreError(err, OperationType.CREATE, `examinations/${id}`);
    } finally {
      setSaving(false);
    }
  };

  const togglePublishSchedule = async (ex: Examination) => {
    try {
      await updateDoc(doc(db, 'examinations', ex.id), {
        schedulePublished: !ex.schedulePublished,
        updatedAt: serverTimestamp(),
      });
      pushToast('success', !ex.schedulePublished ? 'Exam schedule published to teachers & students.' : 'Schedule unpublished.');
    } catch (err) {
      pushToast('error', 'Failed to update schedule visibility.');
      handleFirestoreError(err, OperationType.UPDATE, `examinations/${ex.id}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('timetable')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'timetable' ? 'bg-[#0B1528] text-white' : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            Weekly Timetables
          </button>
          <button
            type="button"
            onClick={() => setTab('exams')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              tab === 'exams' ? 'bg-[#0B1528] text-white' : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            Examination Schedules ({data.examinations.length})
          </button>
        </div>

        {tab === 'exams' && canCoordinateExams && data.classes.length > 0 && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setConflicts([]);
              setForm((prev) => ({ ...prev, classId: activeClassId }));
              setModalOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Coordinate Exam
          </Button>
        )}
      </div>

      {tab === 'timetable' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {data.classes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedClassId(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                  activeClassId === c.id
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {DAYS.slice(0, 5).map((day) => {
              const periods = data.timetable
                .filter((p) => p.classId === activeClassId && p.dayOfWeek === day)
                .sort((a, b) => a.periodNumber - b.periodNumber);
              return (
                <div key={day} className="bg-white border border-slate-200 rounded-xl p-4">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-2.5 border-b border-slate-100">
                    {day}
                  </h3>
                  {periods.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4">No periods scheduled</p>
                  ) : (
                    <div className="divide-y divide-slate-100 mt-1">
                      {periods.map((p) => (
                        <div key={p.id} className="py-2.5 flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-900">
                              {p.isBreak ? 'Break / Recess' : p.subjectName || 'Period ' + p.periodNumber}
                            </p>
                            {!p.isBreak && (
                              <p className="text-[11px] text-slate-500">
                                {p.teacherName || 'Unassigned'} · {p.roomName || 'Room TBD'}
                              </p>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                            {p.startTime}–{p.endTime}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-3 px-4 font-semibold">Examination</th>
                  <th className="py-3 px-4 font-semibold">Class & Subject</th>
                  <th className="py-3 px-4 font-semibold">Date & Time</th>
                  <th className="py-3 px-4 font-semibold">Room</th>
                  <th className="py-3 px-4 font-semibold">Schedule</th>
                  {canCoordinateExams && <th className="py-3 px-4 font-semibold text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.examinations.map((ex) => (
                  <tr key={ex.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-semibold text-slate-900">{ex.name}</td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      {ex.className || ex.classId} · {ex.subjectName}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-600 tabular-nums">
                      {ex.date} · {ex.startTime}–{ex.endTime}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">{ex.roomName || 'TBD'}</td>
                    <td className="py-3 px-4">
                      <StatusText status={ex.schedulePublished ? 'published' : 'draft'} />
                    </td>
                    {canCoordinateExams && (
                      <td className="py-3 px-4 text-right">
                        <Button variant="secondary" size="sm" onClick={() => togglePublishSchedule(ex)}>
                          {ex.schedulePublished ? 'Unpublish' : 'Publish Schedule'}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {data.examinations.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                      No exams scheduled for your assigned classes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Coordinate Class Examination">
        <form onSubmit={handleCreateExam} className="space-y-4">
          {conflicts.length > 0 && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Conflict Detected
              </p>
              {conflicts.map((c, i) => (
                <p key={i}>• {c}</p>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Exam Title</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Unit Test 2"
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Class</label>
              <select
                required
                value={form.classId}
                onChange={(e) => setForm({ ...form, classId: e.target.value })}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              >
                {data.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Subject</label>
              <input
                required
                value={form.subjectName}
                onChange={(e) => setForm({ ...form, subjectName: e.target.value })}
                placeholder="e.g., Mathematics"
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Room / Exam Hall</label>
              <select
                value={form.roomId}
                onChange={(e) => setForm({ ...form, roomId: e.target.value })}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              >
                <option value="">Assign later</option>
                {data.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} (Cap {r.capacity})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Exam Date</label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Start</label>
                <input
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">End</label>
                <input
                  type="time"
                  required
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className="w-full text-sm border border-slate-300 rounded-lg px-2 py-2"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Scheduling…' : 'Schedule Exam'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// 5. Homework Completion Monitoring
// ============================================================================
function CoordinatorHomeworkView({ data, search }: { data: SchoolDataBundle; search: string }) {
  const q = search.trim().toLowerCase();
  const visible = data.homework.filter(
    (h) => !q || h.title.toLowerCase().includes(q) || h.subjectName.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold font-display text-slate-900">Homework Completion Monitoring</h2>
        <p className="text-xs text-slate-500">Track submitted, late, and pending work across assigned classes.</p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No Homework Records"
          description="Homework published by teachers in your assigned classes will appear here with completion metrics."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-3 px-4 font-semibold">Assignment</th>
                  <th className="py-3 px-4 font-semibold">Class · Subject</th>
                  <th className="py-3 px-4 font-semibold">Due Date</th>
                  <th className="py-3 px-4 font-semibold">Submissions</th>
                  <th className="py-3 px-4 font-semibold">Late</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((hw) => {
                  const classTotal = data.students.filter((s) => s.classId === hw.classId && s.status === 'active').length;
                  const subs = data.submissions.filter((s) => s.homeworkId === hw.id);
                  const lateCount = subs.filter((s) => s.isLate).length;
                  return (
                    <tr key={hw.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-semibold text-slate-900">{hw.title}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {hw.className || hw.classId} · {hw.subjectName}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600">{hw.dueDate}</td>
                      <td className="py-3 px-4 tabular-nums font-semibold text-slate-900">
                        {subs.length} / {classTotal}
                      </td>
                      <td className="py-3 px-4 tabular-nums text-xs text-amber-700">{lateCount}</td>
                      <td className="py-3 px-4">
                        <StatusText status={hw.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 6. Academic Notices & Flag Issue for Principal
// ============================================================================
function CoordinatorNoticesView({
  user,
  data,
  canWrite,
  canPublishNotices,
}: {
  user: PlatformUser;
  data: SchoolDataBundle;
  canWrite: boolean;
  canPublishNotices: boolean;
}) {
  const { pushToast } = useToast();
  const [mode, setMode] = useState<'notice' | 'flag' | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetClassId, setTargetClassId] = useState(data.classes[0]?.id || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode) return;
    setSaving(true);
    const id = generateId('ann');
    try {
      await setDoc(doc(db, 'announcements', id), {
        id,
        schoolId: user.schoolId,
        title: title.trim(),
        body: body.trim(),
        audience: mode === 'flag' ? 'principal_flag' : 'class_specific',
        targetClassId: mode === 'notice' ? targetClassId : '',
        targetRole: mode === 'flag' ? 'principal' : '',
        authorId: user.uid,
        authorName: user.displayName,
        authorRole: 'coordinator',
        status: 'published',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: user.role,
        action: mode === 'flag' ? 'COORDINATOR_FLAGGED_PRINCIPAL' : 'COORDINATOR_PUBLISHED_NOTICE',
        targetType: 'announcement',
        targetId: id,
        targetLabel: title.trim(),
      });
      pushToast(
        'success',
        mode === 'flag' ? 'Escalation flagged for Principal review.' : 'Academic notice published to assigned class.',
      );
      setTitle('');
      setBody('');
      setMode(null);
    } catch (err) {
      pushToast('error', 'Unable to publish item.');
      handleFirestoreError(err, OperationType.CREATE, `announcements/${id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold font-display text-slate-900">Academic Notices & Principal Escalations</h2>
          <p className="text-xs text-slate-500">
            Communicate updates to assigned classes or flag attendance, resource, or schedule issues to your Principal.
          </p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setMode('flag')}>
              <Flag className="w-4 h-4 text-amber-600" />
              Flag Issue for Principal
            </Button>
            {canPublishNotices && data.classes.length > 0 && (
              <Button variant="primary" size="sm" onClick={() => setMode('notice')}>
                <Plus className="w-4 h-4" />
                Publish Class Notice
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {data.announcements.map((an) => (
          <div key={an.id} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-teal-700">
                  {an.audience === 'principal_flag' ? 'Principal Escalation Flag' : an.audience.replace('_', ' ')}
                </p>
                <h3 className="text-sm font-bold text-slate-900 mt-0.5">{an.title}</h3>
              </div>
              <StatusText status={an.status} />
            </div>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">{an.body}</p>
            <p className="text-xs text-slate-400 mt-3">
              Posted by {an.authorName} ({an.authorRole}) · {formatFirestoreDate(an.createdAt)}
            </p>
          </div>
        ))}
        {data.announcements.length === 0 && (
          <EmptyState title="No Notices Yet" description="School notices and coordinator flags will appear here." />
        )}
      </div>

      <Modal
        open={Boolean(mode)}
        onClose={() => setMode(null)}
        title={mode === 'flag' ? 'Flag Operational Issue for Principal' : 'Publish Assigned Class Notice'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'notice' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Target Assigned Class</label>
              <select
                value={targetClassId}
                onChange={(e) => setTargetClassId(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              >
                {data.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Subject / Title</label>
            <input
              required
              minLength={3}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={mode === 'flag' ? 'e.g., Persistent absence trend in Grade 10-A' : 'e.g., Science Lab Submission Reminder'}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Details</label>
            <textarea
              required
              rows={4}
              minLength={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Sending…' : mode === 'flag' ? 'Submit Escalation' : 'Publish Notice'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// 7. Scoped Reports & CSV Export
// ============================================================================
function CoordinatorReportsView({ data }: { data: SchoolDataBundle }) {
  const { pushToast } = useToast();

  const exportAttendanceReport = () => {
    const rows = data.attendance.flatMap((rec) =>
      rec.entries.map((e) => [rec.date, rec.className || rec.classId, e.rollNumber, e.studentName, e.status]),
    );
    exportToCsv('coordinator_attendance_report.csv', ['Date', 'Class', 'RollNumber', 'StudentName', 'Status'], rows);
    pushToast('success', 'Scoped attendance report exported.');
  };

  const exportExamProgressReport = () => {
    const rows = data.examResults.map((r) => [
      r.examName || r.examId,
      r.subjectName || '',
      r.studentName,
      r.obtainedMarks,
      r.maxMarks,
      r.grade || '',
      r.status,
    ]);
    exportToCsv(
      'coordinator_exam_progress.csv',
      ['Exam', 'Subject', 'Student', 'ObtainedMarks', 'MaxMarks', 'Grade', 'Status'],
      rows,
    );
    pushToast('success', 'Scoped exam progress report exported.');
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold font-display text-slate-900">Scoped Academic Reports</h2>
        <p className="text-xs text-slate-500">Export attendance and exam progress strictly for your assigned classes.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-slate-900">Class-Wise Attendance Summary</p>
            <p className="text-xs text-slate-500 mt-1">
              Includes {data.attendance.length} registers across {data.classes.length} assigned classes.
            </p>
          </div>
          <div>
            <Button variant="secondary" size="sm" onClick={exportAttendanceReport}>
              <Download className="w-4 h-4" />
              Export Attendance CSV
            </Button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-slate-900">Exam Performance & Grade Sheet</p>
            <p className="text-xs text-slate-500 mt-1">
              Includes {data.examResults.length} recorded student scores across assigned classes.
            </p>
          </div>
          <div>
            <Button variant="secondary" size="sm" onClick={exportExamProgressReport}>
              <Download className="w-4 h-4" />
              Export Exam Progress CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-3 text-xs text-slate-600">
        <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
        <span>
          Tenant & Scope Guarantee: Exports only contain records belonging to your school and Principal-assigned classes.
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// 8. Student Join Approvals — Stage 2 of 3 (Teacher -> Coordinator -> Principal)
// ============================================================================
function CoordinatorStudentApprovalsView({
  user,
  assignedClassIds,
  canWrite,
}: {
  user: PlatformUser;
  assignedClassIds: string[];
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [requests, setRequests] = useState<SchoolJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SchoolJoinRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!user.schoolId) return;
    const q = query(collection(db, 'schoolJoinRequests'), where('schoolId', '==', user.schoolId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRequests(snap.docs.map((d) => d.data() as SchoolJoinRequest));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [user.schoolId]);

  const classIdSet = useMemo(() => new Set(assignedClassIds), [assignedClassIds]);

  const scopedStudentRequests = useMemo(() => {
    return requests
      .filter((r) => r.requestedRole === 'student')
      .filter((r) => {
        if (classIdSet.size === 0) return true;
        return !r.requestedClassId || classIdSet.has(r.requestedClassId);
      });
  }, [requests, classIdSet]);

  const pendingStage2 = scopedStudentRequests.filter(
    (r) => r.status === 'pending' && r.approvalStage === 'coordinator_pending',
  );
  const awaitingTeacher = scopedStudentRequests.filter(
    (r) => r.status === 'pending' && r.approvalStage === 'teacher_pending',
  );
  const forwardedOrDecided = scopedStudentRequests.filter(
    (r) =>
      !(r.status === 'pending' && r.approvalStage === 'coordinator_pending') &&
      !(r.status === 'pending' && r.approvalStage === 'teacher_pending'),
  );

  const handleApproveToPrincipal = async (req: SchoolJoinRequest) => {
    if (!canWrite) return;
    setProcessingId(req.id);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      batch.update(doc(db, 'schoolJoinRequests', req.id), {
        approvalStage: 'principal_pending',
        status: 'pending',
        coordinatorApprovedBy: user.uid,
        coordinatorApprovedName: user.displayName,
        coordinatorApprovedAt: new Date().toISOString(),
        updatedAt: now,
      });
      batch.update(doc(db, 'applicationStatuses', req.applicationNumber), {
        status: 'pending',
        applicantMessage: `Approved by Teacher & Academic Coordinator (${user.displayName}) — awaiting Principal final approval (Stage 3 of 3).`,
        updatedAt: now,
      });
      await batch.commit();
      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: 'coordinator',
        action: 'COORDINATOR_APPROVED_STUDENT_JOIN',
        targetType: 'schoolJoinRequest',
        targetId: req.id,
        targetLabel: `${req.applicantName} (${req.studentCode || req.accessCode || req.applicationNumber})`,
      }).catch(() => undefined);
      pushToast('success', `${req.applicantName} approved & forwarded to Principal for final activation (Stage 3 of 3).`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to forward student request.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget || !canWrite) return;
    setProcessingId(rejectTarget.id);
    const reason = rejectReason.trim() || 'Rejected by Academic Coordinator during Stage 2 verification.';
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      batch.update(doc(db, 'schoolJoinRequests', rejectTarget.id), {
        status: 'rejected',
        approvalStage: 'rejected',
        decisionNote: reason.slice(0, 500),
        reviewedBy: user.uid,
        updatedAt: now,
      });
      batch.update(doc(db, 'applicationStatuses', rejectTarget.applicationNumber), {
        status: 'rejected',
        decisionNote: reason.slice(0, 500),
        applicantMessage: `Rejected by Academic Coordinator (${user.displayName}): ${reason}`,
        updatedAt: now,
      });
      await batch.commit();
      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: 'coordinator',
        action: 'COORDINATOR_REJECTED_STUDENT_JOIN',
        targetType: 'schoolJoinRequest',
        targetId: rejectTarget.id,
        targetLabel: rejectTarget.applicantName,
        details: reason,
      }).catch(() => undefined);
      pushToast('info', `Rejected student join request for ${rejectTarget.applicantName}.`);
      setRejectTarget(null);
      setRejectReason('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to reject request.');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <SkeletonTable rows={5} cols={4} />;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-teal-700">Stage 2 of 3 · Coordinator Verification</p>
        <h2 className="text-base font-bold font-display text-slate-900 mt-0.5">
          Student Join Approval Queue ({pendingStage2.length} ready for review)
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Only student requests already verified by their Class Teacher (Stage 1) can be approved here and forwarded to
          the Principal for Stage 3 final activation.
        </p>
      </div>

      {pendingStage2.length === 0 ? (
        <EmptyState
          title="No Student Requests Awaiting Coordinator Review"
          description="Once Class Teachers approve student join requests in Stage 1, they appear here for your Stage 2 verification."
        />
      ) : (
        <div className="space-y-3">
          {pendingStage2.map((req) => (
            <div key={req.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{req.applicantName}</h3>
                    <StatusText status="coordinator_pending" />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {req.applicantEmail}
                    {req.phone ? ` · ${req.phone}` : ''} · Ref{' '}
                    <span className="font-mono text-slate-700">{req.applicationNumber}</span>
                  </p>
                  <p className="text-xs text-emerald-700 font-medium mt-1">
                    Stage 1 Verified by Class Teacher: {req.teacherApprovedName || req.targetTeacherName || 'Assigned Teacher'}
                  </p>
                </div>

                {canWrite && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={processingId === req.id}
                      onClick={() => {
                        setRejectTarget(req);
                        setRejectReason('');
                      }}
                    >
                      <XCircle className="w-3.5 h-3.5 text-red-600" />
                      Reject
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={processingId === req.id}
                      onClick={() => handleApproveToPrincipal(req)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {processingId === req.id ? 'Forwarding…' : 'Approve & Forward to Principal'}
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-slate-50 border border-slate-200/80 rounded-lg p-3">
                <div>
                  <p className="text-[10px] text-slate-500">School Code</p>
                  <p className="font-mono font-bold text-slate-900">{req.schoolCode}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Class Code</p>
                  <p className="font-mono font-bold text-slate-900">{req.classCode || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Teacher Code</p>
                  <p className="font-mono font-bold text-slate-900">{req.teacherCode || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Student Code</p>
                  <p className="font-mono font-bold text-teal-800">{req.studentCode || req.accessCode || '—'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {awaitingTeacher.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold font-display text-slate-900 mb-3">
            Still Awaiting Stage 1 Teacher Approval ({awaitingTeacher.length})
          </h3>
          <div className="divide-y divide-slate-100">
            {awaitingTeacher.map((req) => (
              <div key={req.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {req.applicantName}{' '}
                    <span className="font-mono text-xs text-slate-600">{req.studentCode || req.accessCode}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Class {req.classCode || req.requestedClassInfo} · Routed to{' '}
                    {req.targetTeacherName || req.teacherCode || 'Class Teacher'}
                  </p>
                </div>
                <StatusText status="teacher_pending" />
              </div>
            ))}
          </div>
        </div>
      )}

      {forwardedOrDecided.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold font-display text-slate-900 mb-3">
            Forwarded to Principal &amp; Decided ({forwardedOrDecided.length})
          </h3>
          <div className="divide-y divide-slate-100">
            {forwardedOrDecided.map((req) => (
              <div key={req.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {req.applicantName}{' '}
                    <span className="font-mono text-xs text-teal-700">{req.studentCode || req.accessCode}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Ref <span className="font-mono">{req.applicationNumber}</span>
                    {req.requestedClassInfo ? ` · ${req.requestedClassInfo}` : ''}
                  </p>
                </div>
                <StatusText status={req.status === 'pending' && req.approvalStage ? req.approvalStage : req.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={`Reject Request — ${rejectTarget?.applicantName || ''}`}
      >
        <form onSubmit={handleReject} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Rejection Reason</label>
            <textarea
              required
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why the student join request is rejected…"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={processingId === rejectTarget?.id}>
              Confirm Rejection
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

