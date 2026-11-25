import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Award,
  FolderOpen,
  Megaphone,
  Bell,
  UserCircle2,
  Plus,
  CheckCircle2,
  Save,
  Upload,
  UserCheck,
  KeyRound,
  Copy,
  Check,
  Download,
  XCircle,
  Eye,
  FileSpreadsheet,
  FileText,
  Camera,
  MapPin,
  Navigation,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  Loader2,
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
import { getSchoolAccessMode, computeLetterGrade } from '../../lib/permissions';
import { recordAuditLog } from '../../lib/audit';
import { exportToCsv } from '../../lib/csv';
import {
  sortClassesInOrder,
  buildStudentFourCodePack,
  formatStudentFourCodeMessage,
  type StudentFourCodePack,
} from '../../lib/schoolCodes';
import {
  downloadStudentCodesExcel,
  downloadStudentCodesPdf,
  downloadStudentCodesCsv,
  exportStudentCodeRowsExcel,
  exportStudentCodeRowsPdf,
} from '../../lib/studentCodeExport';
import { useAuth } from '../../contexts/AuthContext';
import { useSchoolData, type SchoolDataBundle } from '../../hooks/useSchoolData';
import { DashboardShell, type NavItem } from '../../components/DashboardShell';
import { AnimatedAssignedClassesPanel, StudentFourCodesModal } from '../../components/shared/GradeClassControls';
import {
  Button,
  EmptyState,
  Modal,
  SkeletonTable,
  StatCard,
  StatusText,
  useToast,
} from '../../components/ui/Primitives';
import {
  calculateDistanceMeters,
  captureVideoFrameToDataUrl,
  compressImageFileToDataUrl,
  DEFAULT_ATTENDANCE_GEOFENCE_METERS,
} from '../../lib/geoAttendance';
import { NotificationsAndPreferencesView } from '../../components/shared/NotificationsAndPreferencesView';
import { ProfileSecurityView } from '../../components/shared/ProfileSecurityView';
import type {
  AttendanceEntry,
  DayOfWeek,
  ExamResult,
  Homework,
  HomeworkSubmission,
  LearningMaterial,
  MemberAccessCode,
  PlatformUser,
  School,
  SchoolJoinRequest,
  Subject,
  TeacherAttendanceRecord,
  TeacherProfile,
} from '../../types/models';

const TEACHER_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/teacher/dashboard', icon: LayoutDashboard },
  { id: 'timetable', label: 'My Timetable', path: '/teacher/timetable', icon: CalendarDays },
  { id: 'classes', label: 'My Classes', path: '/teacher/classes', icon: BookOpen },
  { id: 'student-codes', label: 'Class Student Codes', path: '/teacher/student-codes', icon: KeyRound },
  { id: 'approvals', label: 'Student Approvals', path: '/teacher/approvals', icon: UserCheck },
  { id: 'attendance', label: 'Attendance', path: '/teacher/attendance', icon: ClipboardCheck },
  { id: 'homework', label: 'Homework & Reviews', path: '/teacher/homework', icon: ClipboardList },
  { id: 'marks', label: 'Exams & Marks', path: '/teacher/marks', icon: Award },
  { id: 'materials', label: 'Learning Materials', path: '/teacher/materials', icon: FolderOpen },
  { id: 'announcements', label: 'Announcements', path: '/teacher/announcements', icon: Megaphone },
  { id: 'notifications', label: 'Notifications', path: '/teacher/notifications', icon: Bell },
  { id: 'profile', label: 'Profile', path: '/teacher/profile', icon: UserCircle2 },
];

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getTodayDayName(): DayOfWeek {
  const map: DayOfWeek[] = ['Monday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return map[new Date().getDay()] || 'Monday';
}

export default function TeacherPortal() {
  const { activeUser, activeSchool } = useAuth();
  const schoolId = activeUser?.schoolId || '';
  const data = useSchoolData(schoolId, false, undefined, activeUser?.uid);
  const access = getSchoolAccessMode(activeSchool);
  const [globalSearch, setGlobalSearch] = useState('');

  // Resolve teacher profile & assigned classes
  const teacherProfile = useMemo(() => {
    if (!activeUser) return undefined;
    return data.teachers.find(
      (t) => t.userId === activeUser.uid || t.email.toLowerCase() === activeUser.email.toLowerCase(),
    );
  }, [data.teachers, activeUser]);

  const assignedClassSet = useMemo(() => {
    const ids = new Set<string>([
      ...(activeUser?.assignedClassIds || []),
      ...(teacherProfile?.assignedClassIds || []),
    ]);
    if (teacherProfile?.id) {
      data.classes.forEach((c) => {
        if (c.classTeacherId === teacherProfile.id) ids.add(c.id);
      });
      data.subjects.forEach((s) => {
        if (s.teacherId === teacherProfile.id) ids.add(s.classId);
      });
      data.timetable.forEach((p) => {
        if (p.teacherId === teacherProfile.id) ids.add(p.classId);
      });
    }
    return ids;
  }, [activeUser?.assignedClassIds, teacherProfile, data.classes, data.subjects, data.timetable]);

  const scopedData = useMemo<SchoolDataBundle>(() => {
    const inClass = (cid?: string) => Boolean(cid && assignedClassSet.has(cid));
    return {
      ...data,
      classes: data.classes.filter((c) => inClass(c.id)),
      subjects: data.subjects.filter(
        (s) =>
          inClass(s.classId) &&
          (!teacherProfile?.id || !s.teacherId || s.teacherId === teacherProfile.id || (activeUser?.assignedSubjectIds || []).includes(s.id)),
      ),
      students: data.students.filter((st) => inClass(st.classId)),
      timetable: data.timetable.filter(
        (p) =>
          (teacherProfile?.id && p.teacherId === teacherProfile.id) ||
          (p.teacherName && activeUser && p.teacherName.toLowerCase() === activeUser.displayName.toLowerCase()),
      ),
      attendance: data.attendance.filter((a) => inClass(a.classId)),
      homework: data.homework.filter((h) => inClass(h.classId)),
      submissions: data.submissions.filter((sub) => inClass(sub.classId)),
      examinations: data.examinations.filter((ex) => inClass(ex.classId)),
      examResults: data.examResults.filter((r) => inClass(r.classId)),
      materials: data.materials.filter((m) => inClass(m.classId)),
      announcements: data.announcements.filter(
        (a) =>
          a.audience === 'school_wide' ||
          (a.audience === 'role_specific' && a.targetRole === 'teacher') ||
          (a.audience === 'class_specific' && inClass(a.targetClassId)),
      ),
    };
  }, [data, assignedClassSet, teacherProfile?.id, activeUser]);

  if (!activeUser) return null;

  return (
    <DashboardShell
      title="Teacher Portal"
      breadcrumb={`${activeSchool?.name || 'School'} · Classroom Workspace`}
      navItems={TEACHER_NAV}
      onGlobalSearch={setGlobalSearch}
      globalSearchPlaceholder="Search classes, students, homework…"
    >
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            <TeacherOverview
              user={activeUser}
              data={scopedData}
              allSchoolClasses={data.classes}
              teacherId={teacherProfile?.id}
            />
          }
        />
        <Route path="timetable" element={<TeacherTimetableView data={scopedData} />} />
        <Route
          path="classes"
          element={
            <TeacherClassesView
              data={scopedData}
              allSubjects={data.subjects}
              allTeachers={data.teachers}
              schoolCode={activeSchool?.schoolPrefix || activeSchool?.code || ''}
              schoolName={activeSchool?.name || 'SJ Academia One'}
              search={globalSearch}
            />
          }
        />
        <Route
          path="student-codes"
          element={
            <TeacherStudentCodesView
              user={activeUser}
              schoolCode={activeSchool?.schoolPrefix || activeSchool?.code || ''}
              schoolName={activeSchool?.name || 'School'}
              teacherProfile={teacherProfile}
              assignedClassIds={Array.from(assignedClassSet)}
              data={scopedData}
              search={globalSearch}
            />
          }
        />
        <Route
          path="approvals"
          element={
            <TeacherStudentApprovalsView
              user={activeUser}
              teacherProfile={teacherProfile}
              assignedClassIds={Array.from(assignedClassSet)}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="attendance"
          element={
            <TeacherAttendanceView
              user={activeUser}
              school={activeSchool}
              teacherProfile={teacherProfile}
              teacherId={teacherProfile?.id || activeUser.uid}
              teacherAttendance={data.teacherAttendance}
              data={scopedData}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="homework"
          element={
            <TeacherHomeworkView
              user={activeUser}
              teacherId={teacherProfile?.id || activeUser.uid}
              data={scopedData}
              canWrite={access.canWrite}
              search={globalSearch}
            />
          }
        />
        <Route
          path="marks"
          element={<TeacherMarksView user={activeUser} data={scopedData} canWrite={access.canWrite} />}
        />
        <Route
          path="materials"
          element={
            <TeacherMaterialsView
              user={activeUser}
              teacherId={teacherProfile?.id || activeUser.uid}
              data={scopedData}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="announcements"
          element={<TeacherAnnouncementsView user={activeUser} data={scopedData} canWrite={access.canWrite} />}
        />
        <Route path="notifications" element={<NotificationsAndPreferencesView />} />
        <Route path="profile" element={<ProfileSecurityView />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardShell>
  );
}

// ============================================================================
// 1. Teacher Overview
// ============================================================================
function TeacherOverview({
  user,
  data,
  allSchoolClasses,
}: {
  user: PlatformUser;
  data: SchoolDataBundle;
  allSchoolClasses: SchoolDataBundle['classes'];
  teacherId?: string;
}) {
  if (data.loading) return <SkeletonTable rows={6} cols={4} />;

  const today = getTodayDayName();
  const todayPeriods = data.timetable
    .filter((p) => p.dayOfWeek === today && !p.isBreak)
    .sort((a, b) => a.periodNumber - b.periodNumber);

  const pendingReviews = data.submissions.filter((s) => s.reviewStatus === 'submitted');
  const upcomingExams = data.examinations
    .filter((ex) => ex.status === 'scheduled' && ex.schedulePublished)
    .sort((a, b) => a.date.localeCompare(b.date));

  const todayDate = new Date().toISOString().slice(0, 10);
  const markedTodayCount = data.attendance.filter((a) => a.date === todayDate && a.status === 'submitted').length;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-teal-700">{today} Teaching Summary</p>
            <h2 className="text-lg font-bold font-display text-slate-900 mt-0.5">Welcome, {user.displayName}</h2>
            <p className="text-xs text-slate-500 mt-1">
              {data.classes.length} assigned section{data.classes.length === 1 ? '' : 's'} · {data.subjects.length} subjects · {data.students.length} students
            </p>
          </div>
          {todayPeriods[0] && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-xs">
              <p className="text-slate-500">Next Scheduled Period ({today})</p>
              <p className="font-semibold text-slate-900 mt-0.5">
                {todayPeriods[0].subjectName} · {todayPeriods[0].className} ({todayPeriods[0].startTime}–{todayPeriods[0].endTime})
              </p>
            </div>
          )}
        </div>
        <AnimatedAssignedClassesPanel
          assignedClasses={data.classes}
          allSchoolClasses={allSchoolClasses}
          title="Assigned Teaching Classes by Grade"
          emptyLabel="No classes assigned to your profile yet"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Today's Periods"
          value={todayPeriods.length}
          subtext={todayPeriods.length > 0 ? `${todayPeriods[0].roomName || 'Assigned Room'}` : 'No periods today'}
          tone="teal"
        />
        <StatCard
          label="Pending Homework Reviews"
          value={pendingReviews.length}
          subtext={`${data.homework.length} active assignments`}
          tone={pendingReviews.length > 0 ? 'amber' : 'default'}
        />
        <StatCard
          label="Today's Attendance"
          value={`${markedTodayCount} / ${data.classes.length}`}
          subtext="Classes submitted today"
        />
        <StatCard
          label="Upcoming Exams"
          value={upcomingExams.length}
          subtext={`${data.materials.length} learning resources shared`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold font-display text-slate-900 mb-4">Today's Teaching Schedule ({today})</h3>
          {todayPeriods.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">No classes scheduled on {today}.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {todayPeriods.map((p) => (
                <div key={p.id} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Period {p.periodNumber} · {p.subjectName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {p.className || p.classId} · {p.roomName || 'Room TBD'}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-slate-600 tabular-nums">
                    {p.startTime}–{p.endTime}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold font-display text-slate-900 mb-4">School & Class Announcements</h3>
          {data.announcements.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">No announcements posted.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.announcements.slice(0, 5).map((an) => (
                <div key={an.id} className="py-2.5">
                  <p className="text-sm font-semibold text-slate-900">{an.title}</p>
                  <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{an.body}</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {an.authorName} · {formatFirestoreDate(an.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 2. Personal Teaching Timetable
// ============================================================================
function TeacherTimetableView({ data }: { data: SchoolDataBundle }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold font-display text-slate-900">My Weekly Teaching Timetable</h2>
        <p className="text-xs text-slate-500">Published periods assigned to you across your classes.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {DAYS.slice(0, 5).map((day) => {
          const periods = data.timetable
            .filter((p) => p.dayOfWeek === day && !p.isBreak)
            .sort((a, b) => a.periodNumber - b.periodNumber);
          return (
            <div key={day} className="bg-white border border-slate-200 rounded-xl p-4">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-2.5 border-b border-slate-100">
                {day}
              </h3>
              {periods.length === 0 ? (
                <p className="text-xs text-slate-400 py-4">No periods assigned</p>
              ) : (
                <div className="divide-y divide-slate-100 mt-1">
                  {periods.map((p) => (
                    <div key={p.id} className="py-2.5 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          P{p.periodNumber} · {p.subjectName}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {p.className || p.classId} · {p.roomName || 'Room TBD'}
                        </p>
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
  );
}

// ============================================================================
// 3. Assigned Classes & Roster
// ============================================================================
function TeacherClassesView({
  data,
  allSubjects,
  allTeachers,
  schoolCode,
  schoolName,
  search,
}: {
  data: SchoolDataBundle;
  allSubjects: Subject[];
  allTeachers: TeacherProfile[];
  schoolCode: string;
  schoolName: string;
  search: string;
}) {
  const { pushToast } = useToast();
  const sortedClasses = useMemo(() => sortClassesInOrder(data.classes), [data.classes]);
  const [selectedClassId, setSelectedClassId] = useState(sortedClasses[0]?.id || '');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [fourCodesPack, setFourCodesPack] = useState<StudentFourCodePack | null>(null);

  const activeClassId =
    selectedClassId && sortedClasses.some((c) => c.id === selectedClassId)
      ? selectedClassId
      : sortedClasses[0]?.id || '';
  const activeClass = sortedClasses.find((c) => c.id === activeClassId);
  const q = search.trim().toLowerCase();

  const classTeacher = useMemo(() => {
    if (!activeClass) return undefined;
    return allTeachers.find(
      (t) =>
        (activeClass.classTeacherId && t.id === activeClass.classTeacherId) ||
        t.classTeacherOfClassId === activeClass.id,
    );
  }, [activeClass, allTeachers]);

  const classSubjects = useMemo(
    () =>
      allSubjects
        .filter((s) => s.classId === activeClassId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allSubjects, activeClassId],
  );

  const roster = useMemo(
    () =>
      data.students
        .filter(
          (s) =>
            s.classId === activeClassId &&
            (!q ||
              s.name.toLowerCase().includes(q) ||
              s.rollNumber.toLowerCase().includes(q) ||
              (s.accessCode || '').toLowerCase().includes(q)),
        )
        .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true })),
    [data.students, activeClassId, q],
  );

  const handleCopyFourCodes = (pack: StudentFourCodePack) => {
    const key = pack.studentCode || pack.studentName;
    navigator.clipboard?.writeText(formatStudentFourCodeMessage(pack));
    setCopiedCode(key);
    pushToast('success', `All 4 login codes copied for ${pack.studentName}.`);
    setTimeout(() => setCopiedCode((prev) => (prev === key ? null : prev)), 2000);
  };

  const handleDownload = (format: 'excel' | 'pdf' | 'csv') => {
    if (!activeClass) return;
    const params = {
      cls: activeClass,
      students: data.students,
      teachers: allTeachers,
      schoolCode,
      schoolName,
    };
    if (format === 'excel') {
      const count = downloadStudentCodesExcel(params);
      pushToast('success', `Downloaded Excel sheet with ${count} student codes for ${activeClass.name}.`);
    } else if (format === 'pdf') {
      const count = downloadStudentCodesPdf(params);
      pushToast('success', `Prepared printable PDF for ${activeClass.name} (${count} students).`);
    } else {
      const count = downloadStudentCodesCsv(params);
      pushToast('success', `Downloaded CSV with ${count} student codes for ${activeClass.name}.`);
    }
  };

  if (sortedClasses.length === 0) {
    return (
      <EmptyState
        title="No Assigned Classes Yet"
        description="Your school Principal assigns classes and subjects to your profile."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {sortedClasses.map((cls) => (
          <button
            key={cls.id}
            type="button"
            onClick={() => setSelectedClassId(cls.id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
              activeClassId === cls.id
                ? 'bg-[#0B1528] text-white border-[#0B1528]'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {cls.name} ({cls.code})
          </button>
        ))}
      </div>

      {/* Assigned Faculty Card: Class Teacher + Subject Teachers */}
      {activeClass && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-teal-700">
                {activeClass.name} · Code <span className="font-mono">{activeClass.code}</span>
                {activeClass.roomName ? ` · Room ${activeClass.roomName}` : ''}
              </p>
              <h3 className="text-base font-bold font-display text-slate-900 mt-0.5">
                Assigned Class & Subject Teachers
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => handleDownload('excel')}>
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                Excel (.xlsx)
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleDownload('pdf')}>
                <FileText className="w-3.5 h-3.5 text-rose-700" />
                PDF
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleDownload('csv')}>
                <Download className="w-3.5 h-3.5 text-slate-700" />
                CSV
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-3.5 py-2.5">
              <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Class Teacher</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {classTeacher?.name || activeClass.classTeacherName || 'Not Assigned'}
              </p>
              {classTeacher?.accessCode && (
                <p className="text-[11px] font-mono text-blue-800 mt-0.5">Code: {classTeacher.accessCode}</p>
              )}
            </div>

            {classSubjects.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 sm:col-span-1 lg:col-span-2 flex items-center">
                <p className="text-xs text-slate-500">
                  No subject teachers assigned to this section yet.
                </p>
              </div>
            ) : (
              classSubjects.map((sub) => {
                const subTeacher = allTeachers.find((t) => t.id === sub.teacherId);
                return (
                  <div key={sub.id} className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                    <p className="text-[11px] font-semibold text-slate-500">
                      {sub.name} Teacher
                    </p>
                    <p className="text-sm font-semibold text-slate-900 mt-0.5">
                      {subTeacher?.name || sub.teacherName || 'Unassigned'}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 mt-0.5">{sub.code}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold font-display text-slate-900">
              Class Roster & Student Access Codes ({roster.length} students)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Download student login codes in Excel, PDF, or CSV format, or copy individual 4-code packs.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Roll</th>
                <th className="py-2.5 px-4 font-semibold">Student Name</th>
                <th className="py-2.5 px-4 font-semibold">Admission #</th>
                <th className="py-2.5 px-4 font-semibold">Student Code</th>
                <th className="py-2.5 px-4 font-semibold">Guardian Contact</th>
                <th className="py-2.5 px-4 font-semibold">Status</th>
                <th className="py-2.5 px-4 font-semibold text-right">4-Code Pack</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roster.map((st) => {
                const pack = activeClass
                  ? buildStudentFourCodePack({
                      schoolCode,
                      schoolName,
                      student: st,
                      classes: [activeClass],
                      teachers: allTeachers,
                    })
                  : null;
                const copyKey = pack?.studentCode || st.name;
                return (
                  <tr key={st.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-600">{st.rollNumber}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">{st.name}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">{st.admissionNumber}</td>
                    <td className="py-3 px-4 font-mono text-xs font-bold text-[#0F295C]">
                      {st.accessCode || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {st.guardianName || '—'} {st.guardianPhone ? `· ${st.guardianPhone}` : ''}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={st.status} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      {pack && (
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleCopyFourCodes(pack)}
                          >
                            {copiedCode === copyKey ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            {copiedCode === copyKey ? 'Copied' : 'Copy 4 Codes'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFourCodesPack(pack)}
                            title="View 4-code bundle"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <StudentFourCodesModal pack={fourCodesPack} onClose={() => setFourCodesPack(null)} />
    </div>
  );
}

// ============================================================================
// 4. Daily Attendance Marking (Duplicate-Safe + Edit Audit Trail)
// ============================================================================
function TeacherAttendanceView({
  user,
  school,
  teacherProfile,
  teacherId,
  teacherAttendance,
  data,
  canWrite,
}: {
  user: PlatformUser;
  school: School | null;
  teacherProfile?: TeacherProfile;
  teacherId: string;
  teacherAttendance: TeacherAttendanceRecord[];
  data: SchoolDataBundle;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [activeTab, setActiveTab] = useState<'self' | 'students'>('self');

  // ---------- Teacher Self Attendance (100m Geofence + Live Photo) ----------
  const todayStr = new Date().toISOString().slice(0, 10);
  const allowedRadiusMeters = school?.settings?.attendanceGeofenceMeters || DEFAULT_ATTENDANCE_GEOFENCE_METERS;
  const campusLat = school?.settings?.campusLatitude;
  const campusLng = school?.settings?.campusLongitude;
  const hasCampusCoords = typeof campusLat === 'number' && typeof campusLng === 'number';

  const myRecords = useMemo(
    () =>
      teacherAttendance
        .filter((r) => r.teacherUid === user.uid || r.teacherId === teacherId)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [teacherAttendance, user.uid, teacherId],
  );
  const todaySelfRecord = useMemo(
    () => myRecords.find((r) => r.date === todayStr),
    [myRecords, todayStr],
  );

  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [selfNote, setSelfNote] = useState('');
  const [submittingSelf, setSubmittingSelf] = useState(false);
  const [previewPhotoRecord, setPreviewPhotoRecord] = useState<TeacherAttendanceRecord | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const withinRange =
    hasCampusCoords && distanceMeters !== null ? distanceMeters <= allowedRadiusMeters : false;

  const handleVerifyLocation = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }
    setLocating(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng, accuracy: Math.round(pos.coords.accuracy || 0) });
        if (hasCampusCoords && campusLat !== undefined && campusLng !== undefined) {
          const dist = calculateDistanceMeters(lat, lng, campusLat, campusLng);
          setDistanceMeters(dist);
          if (dist <= allowedRadiusMeters) {
            pushToast('success', `Location verified: ${dist}m from campus (within ${allowedRadiusMeters}m limit).`);
          } else {
            pushToast('error', `You are ${dist}m from campus. Move within ${allowedRadiusMeters}m to mark attendance.`);
          }
        }
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setGpsError(err.message || 'Location permission denied. Enable GPS/location access and try again.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  };

  const handleStartCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Live camera access is unavailable in this browser. Use the Upload / Take Photo button below.');
      return;
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
      });
    } catch {
      setCameraError('Unable to open live camera (permission blocked or no camera found). Use the photo capture upload below.');
    }
  };

  const handleCapturePhoto = () => {
    if (!videoRef.current) return;
    const dataUrl = captureVideoFrameToDataUrl(videoRef.current, 480, 0.72);
    if (!dataUrl || dataUrl.length > 290000) {
      pushToast('error', 'Captured photo could not be compressed. Please try again.');
      return;
    }
    setPhotoDataUrl(dataUrl);
    stopCamera();
  };

  const handleFallbackPhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const compressed = await compressImageFileToDataUrl(file, 480, 0.7);
      if (compressed.length > 290000) {
        pushToast('error', 'Photo size is too large. Please take a smaller photo.');
        return;
      }
      setPhotoDataUrl(compressed);
      setCameraError('');
      stopCamera();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to process photo.');
    }
  };

  const handleSubmitSelfAttendance = async () => {
    if (!canWrite || submittingSelf) return;
    if (!hasCampusCoords) {
      pushToast('error', 'School campus GPS coordinates are not configured yet. Ask your Principal to pin them in School Settings.');
      return;
    }
    if (!coords || distanceMeters === null || distanceMeters > allowedRadiusMeters) {
      pushToast('error', `You must verify your GPS location within ${allowedRadiusMeters}m of campus.`);
      return;
    }
    if (!photoDataUrl) {
      pushToast('error', 'Please capture a live verification photo before marking attendance.');
      return;
    }

    setSubmittingSelf(true);
    const recordId = `tatt_${user.schoolId}_${teacherId}_${todayStr}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const checkInTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    try {
      const payload = {
        id: recordId,
        schoolId: user.schoolId,
        teacherId,
        teacherUid: user.uid,
        teacherName: (teacherProfile?.name || user.displayName || 'Teacher').slice(0, 120),
        staffId: (teacherProfile?.staffId || user.accessCode || '').slice(0, 40),
        date: todayStr,
        status: 'present' as const,
        checkInTime,
        latitude: coords.lat,
        longitude: coords.lng,
        distanceMeters: Math.round(distanceMeters),
        withinRange: true,
        photoDataUrl,
        note: selfNote.trim().slice(0, 300),
        markedBy: 'teacher' as const,
        markedByUid: user.uid,
        markedByName: user.displayName.slice(0, 120),
        updatedAt: serverTimestamp(),
      };

      if (todaySelfRecord) {
        await updateDoc(doc(db, 'teacherAttendance', todaySelfRecord.id), payload);
      } else {
        await setDoc(doc(db, 'teacherAttendance', recordId), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: 'teacher',
        action: 'TEACHER_SELF_ATTENDANCE_MARKED',
        targetType: 'teacherAttendance',
        targetId: recordId,
        targetLabel: `${user.displayName} · ${todayStr} (${Math.round(distanceMeters)}m)`,
      }).catch(() => undefined);

      pushToast('success', `Daily attendance marked at ${checkInTime} (${Math.round(distanceMeters)}m from campus).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `teacherAttendance/${recordId}`);
      pushToast('error', 'Failed to submit self attendance. Please try again.');
    } finally {
      setSubmittingSelf(false);
    }
  };

  // ---------- Class Student Attendance Register ----------
  const [selectedClassId, setSelectedClassId] = useState(data.classes[0]?.id || '');
  const activeClassId = selectedClassId || data.classes[0]?.id || '';
  const [date, setDate] = useState(todayStr);
  const [entries, setEntries] = useState<AttendanceEntry[]>([]);
  const [saving, setSaving] = useState(false);

  const existingRecord = useMemo(
    () => data.attendance.find((a) => a.classId === activeClassId && a.date === date),
    [data.attendance, activeClassId, date],
  );

  const classStudents = useMemo(
    () =>
      data.students
        .filter((s) => s.classId === activeClassId && s.status === 'active')
        .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true })),
    [data.students, activeClassId],
  );

  useEffect(() => {
    if (existingRecord) {
      setEntries(existingRecord.entries.map((e) => ({ ...e })));
    } else {
      setEntries(
        classStudents.map((st) => ({
          studentId: st.id,
          studentName: st.name,
          rollNumber: st.rollNumber,
          status: 'present',
        })),
      );
    }
  }, [existingRecord, classStudents]);

  const markAll = (status: AttendanceEntry['status']) => {
    setEntries((prev) => prev.map((e) => ({ ...e, status })));
  };

  const handleSave = async (status: 'draft' | 'submitted') => {
    if (!activeClassId || entries.length === 0) return;
    setSaving(true);
    const cls = data.classes.find((c) => c.id === activeClassId);
    try {
      if (existingRecord) {
        const nextHistory = [
          ...(existingRecord.editHistory || []),
          {
            editedBy: user.displayName,
            editedAt: new Date().toISOString(),
            note: `Updated register (${status})`,
          },
        ];
        await updateDoc(doc(db, 'attendanceRecords', existingRecord.id), {
          status,
          entries,
          editHistory: nextHistory,
          updatedAt: serverTimestamp(),
        });
      } else {
        const id = generateId('att');
        await setDoc(doc(db, 'attendanceRecords', id), {
          id,
          schoolId: user.schoolId,
          classId: activeClassId,
          className: cls?.name || '',
          date,
          teacherId,
          status,
          entries,
          editHistory: [],
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: user.role,
        action: status === 'submitted' ? 'ATTENDANCE_SUBMITTED' : 'ATTENDANCE_DRAFT_SAVED',
        targetType: 'attendance',
        targetId: existingRecord?.id || `${activeClassId}_${date}`,
        targetLabel: `${cls?.name || activeClassId} · ${date}`,
      });
      pushToast('success', status === 'submitted' ? 'Attendance register submitted.' : 'Attendance saved as draft.');
    } catch (err) {
      pushToast('error', 'Failed to save attendance register.');
      handleFirestoreError(err, OperationType.WRITE, 'attendanceRecords');
    } finally {
      setSaving(false);
    }
  };

  const summary = {
    present: entries.filter((e) => e.status === 'present').length,
    absent: entries.filter((e) => e.status === 'absent').length,
    late: entries.filter((e) => e.status === 'late').length,
    excused: entries.filter((e) => e.status === 'excused').length,
  };

  return (
    <div className="space-y-5">
      {/* Top Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('self')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'self'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            My Daily Attendance ({allowedRadiusMeters}m + Photo)
          </button>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setActiveTab('students');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'students'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            Class Student Attendance
          </button>
        </div>

        {todaySelfRecord && (
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 px-3 py-1.5 rounded-lg">
            <ShieldCheck className="w-4 h-4" />
            Checked in today at {todaySelfRecord.checkInTime || '—'}
            {typeof todaySelfRecord.distanceMeters === 'number' ? ` · ${todaySelfRecord.distanceMeters}m from campus` : ''}
          </div>
        )}
      </div>

      {activeTab === 'self' ? (
        <div className="space-y-5">
          {!hasCampusCoords && (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
                <p className="font-bold">Campus GPS Coordinates Not Configured</p>
                <p>
                  Your Principal needs to pin the school&apos;s GPS coordinates in <strong>School Settings</strong> before teachers can verify location-based check-in within {allowedRadiusMeters}m.
                </p>
              </div>
            </div>
          )}

          {todaySelfRecord && (
            <div className="bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {todaySelfRecord.photoDataUrl ? (
                  <button
                    type="button"
                    onClick={() => setPreviewPhotoRecord(todaySelfRecord)}
                    className="w-16 h-16 rounded-xl overflow-hidden border-2 border-emerald-400 shrink-0 cursor-pointer"
                  >
                    <img
                      src={todaySelfRecord.photoDataUrl}
                      alt="Check-in verification"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Today&apos;s Attendance Recorded ({todayStr})</h3>
                    <StatusText status={todaySelfRecord.status} />
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 tabular-nums">
                    Check-in: <strong>{todaySelfRecord.checkInTime || '—'}</strong>
                    {typeof todaySelfRecord.distanceMeters === 'number'
                      ? ` · Verified ${todaySelfRecord.distanceMeters}m from school campus`
                      : ''}
                    {' · '}Marked by {todaySelfRecord.markedBy === 'principal' ? `Principal (${todaySelfRecord.markedByName})` : 'Self Check-In'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Check-In Steps Grid */}
          <div className="grid lg:grid-cols-2 gap-5">
            {/* Step 1: GPS Geofence Verification */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400">Step 1 · Geofence Check</p>
                  <h3 className="text-base font-bold font-display text-slate-900 dark:text-slate-100 mt-0.5">
                    Verify School Campus Range ({allowedRadiusMeters}m)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Confirm you are physically within {allowedRadiusMeters} metres of {school?.name || 'your school campus'}.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={locating || !hasCampusCoords}
                  onClick={handleVerifyLocation}
                >
                  {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
                  {locating ? 'Locating…' : coords ? 'Re-Verify GPS' : 'Verify My Location'}
                </Button>
              </div>

              {gpsError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{gpsError}</span>
                </div>
              )}

              {coords && distanceMeters !== null && (
                <div
                  className={`p-4 rounded-xl border ${
                    withinRange
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60'
                      : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        withinRange ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'
                      }`}
                    >
                      {distanceMeters}m from school campus
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        withinRange ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {withinRange ? `Within ${allowedRadiusMeters}m limit` : `Outside ${allowedRadiusMeters}m limit`}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400 mt-1.5 tabular-nums">
                    GPS: {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)} (±{coords.accuracy}m accuracy)
                  </p>
                </div>
              )}
            </div>

            {/* Step 2: Live Photo Capture */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400">Step 2 · Live Photo Proof</p>
                  <h3 className="text-base font-bold font-display text-slate-900 dark:text-slate-100 mt-0.5">
                    Capture Verification Photo
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Take a live selfie on campus to attach to your daily staff attendance record.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {!cameraActive && (
                    <Button type="button" variant="secondary" size="sm" onClick={handleStartCamera}>
                      <Camera className="w-3.5 h-3.5" />
                      Open Camera
                    </Button>
                  )}
                </div>
              </div>

              {cameraError && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300">
                  {cameraError}
                </div>
              )}

              {cameraActive && (
                <div className="space-y-2.5">
                  <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-300 dark:border-slate-700 aspect-[4/3]">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={stopCamera}>
                      Cancel Camera
                    </Button>
                    <Button type="button" variant="primary" size="sm" onClick={handleCapturePhoto}>
                      <Camera className="w-3.5 h-3.5" />
                      Capture Photo
                    </Button>
                  </div>
                </div>
              )}

              {!cameraActive && photoDataUrl && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                  <img
                    src={photoDataUrl}
                    alt="Captured teacher selfie"
                    className="w-24 h-24 rounded-lg object-cover border border-slate-300 dark:border-slate-600"
                  />
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Verification photo ready
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={handleStartCamera}>
                        <RefreshCw className="w-3.5 h-3.5" />
                        Retake with Camera
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setPhotoDataUrl('')}>
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {!cameraActive && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Or take/upload photo from device camera</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    onChange={handleFallbackPhotoFile}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Step 3: Submit Self Attendance */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-end justify-between gap-4">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Optional Note (e.g. Morning duty, Bus escort)
              </label>
              <input
                type="text"
                value={selfNote}
                onChange={(e) => setSelfNote(e.target.value)}
                placeholder="Optional check-in remark"
                maxLength={250}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
            <Button
              type="button"
              variant="primary"
              loading={submittingSelf}
              disabled={!canWrite || !withinRange || !photoDataUrl}
              onClick={handleSubmitSelfAttendance}
            >
              <CheckCircle2 className="w-4 h-4" />
              {todaySelfRecord ? 'Update Today’s Attendance' : 'Mark My Attendance'}
            </Button>
          </div>

          {/* Teacher Attendance History */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70">
              <h3 className="text-sm font-bold font-display text-slate-900 dark:text-slate-100">
                My Recent Attendance Log ({myRecords.length})
              </h3>
            </div>
            {myRecords.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No daily check-in records yet. Verify your GPS location and photo above to mark today&apos;s attendance.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Date</th>
                      <th className="py-2.5 px-4 font-semibold">Status</th>
                      <th className="py-2.5 px-4 font-semibold">Check-In Time</th>
                      <th className="py-2.5 px-4 font-semibold">Campus Distance</th>
                      <th className="py-2.5 px-4 font-semibold">Recorded By</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Photo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {myRecords.slice(0, 30).map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">{rec.date}</td>
                        <td className="py-2.5 px-4"><StatusText status={rec.status} /></td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">{rec.checkInTime || '—'}</td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {typeof rec.distanceMeters === 'number' ? `${rec.distanceMeters}m` : 'Manual'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                          {rec.markedBy === 'principal' ? `Principal (${rec.markedByName})` : 'Self (GPS + Photo)'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {rec.photoDataUrl ? (
                            <button
                              type="button"
                              onClick={() => setPreviewPhotoRecord(rec)}
                              className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 font-semibold hover:underline cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" /> View
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Modal
            open={Boolean(previewPhotoRecord)}
            onClose={() => setPreviewPhotoRecord(null)}
            title={previewPhotoRecord ? `Verification Photo · ${previewPhotoRecord.date}` : 'Verification Photo'}
            subtitle={
              previewPhotoRecord
                ? `Check-in ${previewPhotoRecord.checkInTime || '—'}${typeof previewPhotoRecord.distanceMeters === 'number' ? ` · ${previewPhotoRecord.distanceMeters}m from campus` : ''}`
                : undefined
            }
          >
            {previewPhotoRecord?.photoDataUrl && (
              <img
                src={previewPhotoRecord.photoDataUrl}
                alt="Attendance verification"
                className="w-full max-h-[65vh] object-contain rounded-xl border border-slate-200 dark:border-slate-700"
              />
            )}
          </Modal>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Assigned Class</label>
                <select
                  value={activeClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  {data.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Attendance Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
              {existingRecord && (
                <div className="pb-2 text-xs text-slate-500 dark:text-slate-400">
                  Existing register loaded · <StatusText status={existingRecord.status} />
                </div>
              )}
            </div>

            {canWrite && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => markAll('present')}>
                  Mark All Present
                </Button>
                <Button variant="secondary" size="sm" disabled={saving || entries.length === 0} onClick={() => handleSave('draft')}>
                  <Save className="w-4 h-4" />
                  Save Draft
                </Button>
                <Button variant="primary" size="sm" disabled={saving || entries.length === 0} onClick={() => handleSave('submitted')}>
                  <CheckCircle2 className="w-4 h-4" />
                  {existingRecord ? 'Update Submission' : 'Submit Attendance'}
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Present" value={summary.present} tone="teal" />
            <StatCard label="Absent" value={summary.absent} tone={summary.absent > 0 ? 'red' : 'default'} />
            <StatCard label="Late" value={summary.late} tone={summary.late > 0 ? 'amber' : 'default'} />
            <StatCard label="Excused" value={summary.excused} />
          </div>

          {entries.length === 0 ? (
            <EmptyState
              title="No Active Students in Selected Class"
              description="Select an assigned class with active enrolled students to mark daily attendance."
            />
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {entries.map((entry, idx) => (
                  <div key={entry.studentId} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{entry.studentName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Roll #{entry.rollNumber}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(['present', 'absent', 'late', 'excused'] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          disabled={!canWrite}
                          onClick={() => {
                            const next = [...entries];
                            next[idx] = { ...entry, status: st };
                            setEntries(next);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize border transition-colors cursor-pointer ${
                            entry.status === st
                              ? st === 'present'
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : st === 'absent'
                                  ? 'bg-red-600 text-white border-red-600'
                                  : st === 'late'
                                    ? 'bg-amber-600 text-white border-amber-600'
                                    : 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 5. Homework Creation & Submission Reviews
// ============================================================================
function TeacherHomeworkView({
  user,
  teacherId,
  data,
  canWrite,
  search,
}: {
  user: PlatformUser;
  teacherId: string;
  data: SchoolDataBundle;
  canWrite: boolean;
  search: string;
}) {
  const { pushToast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewHw, setReviewHw] = useState<Homework | null>(null);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, { status: HomeworkSubmission['reviewStatus']; feedback: string }>>({});
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    classId: data.classes[0]?.id || '',
    subjectName: data.subjects[0]?.name || 'Mathematics',
    title: '',
    instructions: '',
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    allowOnlineSubmission: true,
  });

  const q = search.trim().toLowerCase();
  const visibleHw = data.homework
    .filter((h) => !q || h.title.toLowerCase().includes(q) || h.subjectName.toLowerCase().includes(q))
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cls = data.classes.find((c) => c.id === form.classId);
    setSaving(true);
    const id = generateId('hw');
    try {
      await setDoc(doc(db, 'homework', id), {
        id,
        schoolId: user.schoolId,
        classId: form.classId,
        className: cls?.name || '',
        subjectName: form.subjectName.trim(),
        teacherId,
        teacherName: user.displayName,
        title: form.title.trim(),
        instructions: form.instructions.trim(),
        assignedDate: new Date().toISOString().slice(0, 10),
        dueDate: form.dueDate,
        allowOnlineSubmission: form.allowOnlineSubmission,
        status: 'published',
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: user.role,
        action: 'HOMEWORK_PUBLISHED',
        targetType: 'homework',
        targetId: id,
        targetLabel: form.title.trim(),
      });
      pushToast('success', 'Homework published to students.');
      setCreateOpen(false);
      setForm((prev) => ({ ...prev, title: '', instructions: '' }));
    } catch (err) {
      pushToast('error', 'Failed to publish homework.');
      handleFirestoreError(err, OperationType.CREATE, `homework/${id}`);
    } finally {
      setSaving(false);
    }
  };

  const openReviewModal = (hw: Homework) => {
    const subs = data.submissions.filter((s) => s.homeworkId === hw.id);
    const map: Record<string, { status: HomeworkSubmission['reviewStatus']; feedback: string }> = {};
    subs.forEach((s) => {
      map[s.id] = { status: s.reviewStatus, feedback: s.feedback || '' };
    });
    setFeedbackDrafts(map);
    setReviewHw(hw);
  };

  const saveReview = async (sub: HomeworkSubmission) => {
    const draft = feedbackDrafts[sub.id];
    if (!draft) return;
    try {
      await updateDoc(doc(db, 'homeworkSubmissions', sub.id), {
        reviewStatus: draft.status,
        feedback: draft.feedback.trim(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', `Saved feedback for ${sub.studentName}.`);
    } catch (err) {
      pushToast('error', 'Failed to save review.');
      handleFirestoreError(err, OperationType.UPDATE, `homeworkSubmissions/${sub.id}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold font-display text-slate-900">Homework & Student Submissions</h2>
          <p className="text-xs text-slate-500">Create assignments and review online student work with inline feedback.</p>
        </div>
        {canWrite && data.classes.length > 0 && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setForm((prev) => ({ ...prev, classId: prev.classId || data.classes[0]?.id || '' }));
              setCreateOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            New Homework
          </Button>
        )}
      </div>

      {visibleHw.length === 0 ? (
        <EmptyState
          title="No Homework Assignments"
          description="Publish an assignment for your assigned classes to start collecting and reviewing submissions."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleHw.map((hw) => {
            const subs = data.submissions.filter((s) => s.homeworkId === hw.id);
            const reviewedCount = subs.filter((s) => s.reviewStatus === 'reviewed' || s.reviewStatus === 'completed').length;
            return (
              <div key={hw.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-teal-700">
                        {hw.className || hw.classId} · {hw.subjectName}
                      </p>
                      <h3 className="text-sm font-bold text-slate-900 mt-0.5">{hw.title}</h3>
                    </div>
                    <StatusText status={hw.status} />
                  </div>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">{hw.instructions || 'No extra notes.'}</p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                  <span className="text-slate-500 tabular-nums">
                    Due {hw.dueDate} · {subs.length} submitted ({reviewedCount} reviewed)
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => openReviewModal(hw)}>
                    Review ({subs.length})
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Homework Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Publish Homework Assignment">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Class</label>
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
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Assignment Title</label>
            <input
              required
              minLength={3}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Enter assignment title"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Instructions</label>
            <textarea
              rows={3}
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              placeholder="Detail questions, page references, and formatting rules…"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Due Date</label>
              <input
                type="date"
                required
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowOnlineSubmission}
                onChange={(e) => setForm({ ...form, allowOnlineSubmission: e.target.checked })}
                className="rounded border-slate-300 text-teal-600"
              />
              Enable online student file/text submission
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Publishing…' : 'Publish Assignment'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Review Submissions Modal */}
      <Modal
        open={Boolean(reviewHw)}
        onClose={() => setReviewHw(null)}
        title={`Submissions — ${reviewHw?.title || ''}`}
        subtitle={`${reviewHw?.className || ''} · Due ${reviewHw?.dueDate || ''}`}
        maxWidth="max-w-2xl"
      >
        {reviewHw && (
          <div className="space-y-4">
            {data.submissions.filter((s) => s.homeworkId === reviewHw.id).length === 0 ? (
              <p className="text-sm text-slate-500 py-4">No student submissions received for this assignment yet.</p>
            ) : (
              data.submissions
                .filter((s) => s.homeworkId === reviewHw.id)
                .map((sub) => {
                  const draft = feedbackDrafts[sub.id] || { status: sub.reviewStatus, feedback: sub.feedback || '' };
                  return (
                    <div key={sub.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{sub.studentName}</p>
                          <p className="text-xs text-slate-500">
                            {sub.fileName ? `File: ${sub.fileName} (${sub.fileSizeKb || 0} KB)` : 'Text response'}
                            {sub.isLate ? ' · Submitted Late' : ''}
                          </p>
                        </div>
                        <StatusText status={sub.reviewStatus} />
                      </div>
                      {sub.submissionText && (
                        <p className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-3">
                          {sub.submissionText}
                        </p>
                      )}
                      {canWrite && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Review Status</label>
                            <select
                              value={draft.status}
                              onChange={(e) =>
                                setFeedbackDrafts((prev) => ({
                                  ...prev,
                                  [sub.id]: { ...draft, status: e.target.value as HomeworkSubmission['reviewStatus'] },
                                }))
                              }
                              className="w-full text-xs border border-slate-300 rounded-lg px-2.5 py-2"
                            >
                              <option value="submitted">Submitted</option>
                              <option value="reviewed">Reviewed</option>
                              <option value="needs_correction">Needs Correction</option>
                              <option value="completed">Completed</option>
                            </select>
                          </div>
                          <div className="sm:col-span-2 flex gap-2">
                            <input
                              type="text"
                              value={draft.feedback}
                              onChange={(e) =>
                                setFeedbackDrafts((prev) => ({
                                  ...prev,
                                  [sub.id]: { ...draft, feedback: e.target.value },
                                }))
                              }
                              placeholder="Write constructive feedback…"
                              className="flex-1 text-xs border border-slate-300 rounded-lg px-3 py-2"
                            />
                            <Button variant="primary" size="sm" onClick={() => saveReview(sub)}>
                              Save
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
// 6. Examinations & Bounded Marks Entry
// ============================================================================
function TeacherMarksView({
  user,
  data,
  canWrite,
}: {
  user: PlatformUser;
  data: SchoolDataBundle;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [selectedExamId, setSelectedExamId] = useState(data.examinations[0]?.id || '');
  const activeExamId = selectedExamId || data.examinations[0]?.id || '';
  const selectedExam = data.examinations.find((ex) => ex.id === activeExamId);

  const [scoreInputs, setScoreInputs] = useState<Record<string, { marks: string; remarks: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const examStudents = useMemo(
    () =>
      selectedExam
        ? data.students
            .filter((s) => s.classId === selectedExam.classId && s.status === 'active')
            .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }))
        : [],
    [data.students, selectedExam],
  );

  useEffect(() => {
    if (!selectedExam) return;
    const map: Record<string, { marks: string; remarks: string }> = {};
    examStudents.forEach((st) => {
      const existing = data.examResults.find((r) => r.examId === selectedExam.id && r.studentId === st.id);
      map[st.id] = {
        marks: existing ? String(existing.obtainedMarks) : '',
        remarks: existing?.remarks || '',
      };
    });
    setScoreInputs(map);
  }, [selectedExam, examStudents, data.examResults]);

  const handleSaveMark = async (studentId: string, status: ExamResult['status']) => {
    if (!selectedExam) return;
    const st = examStudents.find((s) => s.id === studentId);
    const input = scoreInputs[studentId];
    if (!st || !input) return;

    const num = Number(input.marks);
    if (Number.isNaN(num) || num < 0 || num > selectedExam.maxMarks) {
      pushToast('error', `Marks for ${st.name} must be between 0 and ${selectedExam.maxMarks}.`);
      return;
    }

    setSavingId(studentId);
    const existing = data.examResults.find((r) => r.examId === selectedExam.id && r.studentId === st.id);
    const grade = computeLetterGrade(num, selectedExam.maxMarks, selectedExam.passingMarks);

    try {
      if (existing) {
        const nextAudit = [
          ...(existing.auditHistory || []),
          {
            updatedBy: user.displayName,
            updatedAt: new Date().toISOString(),
            previousMarks: existing.obtainedMarks,
            newMarks: num,
          },
        ];
        await updateDoc(doc(db, 'examResults', existing.id), {
          obtainedMarks: num,
          grade,
          remarks: input.remarks.trim(),
          status,
          auditHistory: nextAudit,
          updatedAt: serverTimestamp(),
        });
      } else {
        const id = generateId('res');
        await setDoc(doc(db, 'examResults', id), {
          id,
          schoolId: user.schoolId,
          examId: selectedExam.id,
          examName: selectedExam.name,
          classId: selectedExam.classId,
          subjectName: selectedExam.subjectName,
          studentId: st.id,
          studentUid: st.userId || '',
          studentName: st.name,
          maxMarks: selectedExam.maxMarks,
          passingMarks: selectedExam.passingMarks,
          obtainedMarks: num,
          grade,
          remarks: input.remarks.trim(),
          status,
          auditHistory: [],
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      pushToast('success', `Saved ${num}/${selectedExam.maxMarks} (${grade}) for ${st.name}.`);
    } catch (err) {
      pushToast('error', 'Failed to save student marks.');
      handleFirestoreError(err, OperationType.WRITE, 'examResults');
    } finally {
      setSavingId(null);
    }
  };

  if (data.examinations.length === 0) {
    return (
      <EmptyState
        title="No Examinations Assigned"
        description="Published examinations for your assigned classes will appear here for marks entry."
      />
    );
  }

  const resultsForExam = data.examResults.filter((r) => r.examId === activeExamId);
  const avgScore =
    resultsForExam.length > 0
      ? Math.round(resultsForExam.reduce((sum, r) => sum + r.obtainedMarks, 0) / resultsForExam.length)
      : 0;

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Select Examination</label>
          <select
            value={activeExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-3 py-2 min-w-[260px]"
          >
            {data.examinations.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name} · {ex.subjectName} ({ex.className || ex.classId})
              </option>
            ))}
          </select>
        </div>

        {selectedExam && (
          <div className="text-xs text-slate-600 flex flex-wrap gap-5 tabular-nums">
            <div>
              <p className="text-slate-400">Date</p>
              <p className="font-semibold text-slate-900">{selectedExam.date}</p>
            </div>
            <div>
              <p className="text-slate-400">Max / Passing</p>
              <p className="font-semibold text-slate-900">
                {selectedExam.maxMarks} / {selectedExam.passingMarks}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Recorded Avg</p>
              <p className="font-semibold text-teal-700">{resultsForExam.length > 0 ? `${avgScore} / ${selectedExam.maxMarks}` : '—'}</p>
            </div>
          </div>
        )}
      </div>

      {selectedExam && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-3 px-4 font-semibold">Roll</th>
                  <th className="py-3 px-4 font-semibold">Student</th>
                  <th className="py-3 px-4 font-semibold">Marks (0–{selectedExam.maxMarks})</th>
                  <th className="py-3 px-4 font-semibold">Grade</th>
                  <th className="py-3 px-4 font-semibold">Remarks</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  {canWrite && <th className="py-3 px-4 font-semibold text-right">Save</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {examStudents.map((st) => {
                  const existing = data.examResults.find((r) => r.examId === selectedExam.id && r.studentId === st.id);
                  const inp = scoreInputs[st.id] || { marks: '', remarks: '' };
                  const previewNum = inp.marks !== '' ? Number(inp.marks) : null;
                  const previewGrade =
                    previewNum !== null && !Number.isNaN(previewNum) && previewNum >= 0 && previewNum <= selectedExam.maxMarks
                      ? computeLetterGrade(previewNum, selectedExam.maxMarks, selectedExam.passingMarks)
                      : '—';

                  return (
                    <tr key={st.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">{st.rollNumber}</td>
                      <td className="py-3 px-4 font-medium text-slate-900">{st.name}</td>
                      <td className="py-3 px-4">
                        <input
                          type="number"
                          min={0}
                          max={selectedExam.maxMarks}
                          disabled={!canWrite}
                          value={inp.marks}
                          onChange={(e) =>
                            setScoreInputs((prev) => ({
                              ...prev,
                              [st.id]: { ...inp, marks: e.target.value },
                            }))
                          }
                          placeholder="0"
                          className="w-24 text-sm tabular-nums border border-slate-300 rounded-lg px-2.5 py-1.5"
                        />
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900 tabular-nums">{previewGrade}</td>
                      <td className="py-3 px-4">
                        <input
                          type="text"
                          disabled={!canWrite}
                          value={inp.remarks}
                          onChange={(e) =>
                            setScoreInputs((prev) => ({
                              ...prev,
                              [st.id]: { ...inp, remarks: e.target.value },
                            }))
                          }
                          placeholder="Optional remark"
                          className="w-44 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={existing?.status || 'draft'} />
                      </td>
                      {canWrite && (
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={savingId === st.id || inp.marks === ''}
                              onClick={() => handleSaveMark(st.id, 'submitted')}
                            >
                              Submit
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={savingId === st.id || inp.marks === ''}
                              onClick={() => handleSaveMark(st.id, 'published')}
                            >
                              Publish
                            </Button>
                          </div>
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
    </div>
  );
}

// ============================================================================
// 7. Learning Materials Upload & Management
// ============================================================================
function TeacherMaterialsView({
  user,
  teacherId,
  data,
  canWrite,
}: {
  user: PlatformUser;
  teacherId: string;
  data: SchoolDataBundle;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    classId: data.classes[0]?.id || '',
    subjectName: data.subjects[0]?.name || 'Mathematics',
    title: '',
    topic: '',
    description: '',
    fileName: '',
    fileType: 'PDF' as LearningMaterial['fileType'],
    fileSizeKb: 240,
    contentPreview: '',
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      pushToast('error', 'File exceeds 10 MB maximum limit.');
      return;
    }
    const ext = file.name.split('.').pop()?.toUpperCase() || '';
    const allowed: Record<string, LearningMaterial['fileType']> = {
      PDF: 'PDF',
      DOCX: 'DOCX',
      DOC: 'DOCX',
      PNG: 'PNG',
      JPG: 'JPG',
      JPEG: 'JPG',
      PPTX: 'SLIDES',
      TXT: 'NOTE',
    };
    const mapped = allowed[ext];
    if (!mapped) {
      pushToast('error', 'Allowed file types: PDF, DOCX, PNG, JPG, PPTX, TXT.');
      return;
    }
    setForm((prev) => ({
      ...prev,
      fileName: file.name,
      fileType: mapped,
      fileSizeKb: Math.max(1, Math.round(file.size / 1024)),
    }));
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const cls = data.classes.find((c) => c.id === form.classId);
    setSaving(true);
    const id = generateId('mat');
    try {
      await setDoc(doc(db, 'learningMaterials', id), {
        id,
        schoolId: user.schoolId,
        classId: form.classId,
        className: cls?.name || '',
        subjectName: form.subjectName.trim(),
        teacherId,
        teacherName: user.displayName,
        title: form.title.trim(),
        topic: form.topic.trim(),
        description: form.description.trim(),
        fileName: (form.fileName || `${form.title.trim().replace(/\s+/g, '_')}.pdf`).slice(0, 155),
        fileType: form.fileType,
        fileSizeKb: form.fileSizeKb,
        contentPreview: form.contentPreview.trim(),
        status: 'published',
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', 'Learning material published to class students.');
      setModalOpen(false);
      setForm((prev) => ({ ...prev, title: '', topic: '', description: '', fileName: '', contentPreview: '' }));
    } catch (err) {
      pushToast('error', 'Failed to publish material.');
      handleFirestoreError(err, OperationType.CREATE, `learningMaterials/${id}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async (mat: LearningMaterial) => {
    const next = mat.status === 'published' ? 'archived' : 'published';
    try {
      await updateDoc(doc(db, 'learningMaterials', mat.id), {
        status: next,
        updatedAt: serverTimestamp(),
      });
      pushToast('success', next === 'archived' ? 'Material archived.' : 'Material restored.');
    } catch (err) {
      pushToast('error', 'Failed to update material status.');
      handleFirestoreError(err, OperationType.UPDATE, `learningMaterials/${mat.id}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold font-display text-slate-900">Learning Materials & Study Notes</h2>
          <p className="text-xs text-slate-500">Share validated PDFs, slides, diagrams, and topic notes with your classes.</p>
        </div>
        {canWrite && data.classes.length > 0 && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setForm((prev) => ({ ...prev, classId: prev.classId || data.classes[0]?.id || '' }));
              setModalOpen(true);
            }}
          >
            <Upload className="w-4 h-4" />
            Upload Material
          </Button>
        )}
      </div>

      {data.materials.length === 0 ? (
        <EmptyState
          title="No Learning Materials Shared"
          description="Upload notes, worksheets, or slide decks so students can review them anytime."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.materials.map((mat) => (
            <div key={mat.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-teal-700">
                      {mat.className || mat.classId} · {mat.subjectName} · {mat.fileType}
                    </p>
                    <h3 className="text-sm font-bold text-slate-900 mt-0.5">{mat.title}</h3>
                  </div>
                  <StatusText status={mat.status} />
                </div>
                {mat.topic && <p className="text-xs text-slate-500 mt-1">Topic: {mat.topic}</p>}
                {mat.description && <p className="text-xs text-slate-600 mt-2">{mat.description}</p>}
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs text-slate-500">
                <span className="truncate max-w-[220px]">
                  {mat.fileName} · {mat.fileSizeKb || 0} KB
                </span>
                {canWrite && (
                  <Button variant="ghost" size="sm" onClick={() => toggleArchive(mat)}>
                    {mat.status === 'published' ? 'Archive' : 'Restore'}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Upload Class Learning Material">
        <form onSubmit={handleUpload} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Title</label>
              <input
                required
                minLength={3}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Enter resource title"
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Topic / Unit</label>
              <input
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="Enter topic or unit"
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Attach File (PDF, DOCX, PNG, JPG, PPTX · max 10 MB)</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.pptx,.txt"
              onChange={handleFileSelect}
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-slate-50"
            />
            {form.fileName && (
              <p className="text-[11px] text-teal-700 mt-1">
                Selected: {form.fileName} ({form.fileType} · {form.fileSizeKb} KB)
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Summary Notes / Study Key Points</label>
            <textarea
              rows={3}
              value={form.contentPreview}
              onChange={(e) => setForm({ ...form, contentPreview: e.target.value })}
              placeholder="Paste key definitions or study bullets students can read directly in-app…"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Publishing…' : 'Publish Material'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// 8. Class Announcements
// ============================================================================
function TeacherAnnouncementsView({
  user,
  data,
  canWrite,
}: {
  user: PlatformUser;
  data: SchoolDataBundle;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [classId, setClassId] = useState(data.classes[0]?.id || '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const id = generateId('ann');
    try {
      await setDoc(doc(db, 'announcements', id), {
        id,
        schoolId: user.schoolId,
        title: title.trim(),
        body: body.trim(),
        audience: 'class_specific',
        targetClassId: classId,
        authorId: user.uid,
        authorName: user.displayName,
        authorRole: 'teacher',
        status: 'published',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', 'Class announcement published.');
      setTitle('');
      setBody('');
      setOpen(false);
    } catch (err) {
      pushToast('error', 'Failed to publish announcement.');
      handleFirestoreError(err, OperationType.CREATE, `announcements/${id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold font-display text-slate-900">Class & School Announcements</h2>
          <p className="text-xs text-slate-500">View school notices and send class-specific updates to your students.</p>
        </div>
        {canWrite && data.classes.length > 0 && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setClassId((prev) => prev || data.classes[0]?.id || '');
              setOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Post Class Notice
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {data.announcements.map((an) => (
          <div key={an.id} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-teal-700">{an.audience.replace('_', ' ')}</p>
                <h3 className="text-sm font-bold text-slate-900 mt-0.5">{an.title}</h3>
              </div>
              <StatusText status={an.status} />
            </div>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">{an.body}</p>
            <p className="text-xs text-slate-400 mt-3">
              {an.authorName} ({an.authorRole}) · {formatFirestoreDate(an.createdAt)}
            </p>
          </div>
        ))}
        {data.announcements.length === 0 && (
          <EmptyState title="No Announcements" description="School-wide and class announcements appear here." />
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Post Class Announcement">
        <form onSubmit={handlePublish} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Class</label>
            <select
              required
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">Title</label>
            <input
              required
              minLength={3}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Message</label>
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
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Posting…' : 'Publish Notice'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// 9. Class Student Codes Distribution (Hand Out Codes to Students in Class)
// ============================================================================
function TeacherStudentCodesView({
  user,
  schoolCode,
  schoolName,
  teacherProfile,
  assignedClassIds,
  data,
  search,
}: {
  user: PlatformUser;
  schoolCode: string;
  schoolName: string;
  teacherProfile?: TeacherProfile;
  assignedClassIds: string[];
  data: SchoolDataBundle;
  search: string;
}) {
  const { pushToast } = useToast();
  const [memberCodes, setMemberCodes] = useState<MemberAccessCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [classFilter, setClassFilter] = useState('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!user.schoolId) return;
    const q = query(collection(db, 'memberAccessCodes'), where('schoolId', '==', user.schoolId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMemberCodes(snap.docs.map((d) => d.data() as MemberAccessCode));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [user.schoolId]);

  const myTeacherCode = useMemo(() => {
    if (teacherProfile?.accessCode) return teacherProfile.accessCode;
    if (user.accessCode) return user.accessCode;
    const match = memberCodes.find(
      (c) =>
        c.role === 'teacher' &&
        (c.linkedUid === user.uid ||
          (teacherProfile?.id && c.linkedProfileId === teacherProfile.id) ||
          (c.email && c.email.toLowerCase() === user.email.toLowerCase())),
    );
    return match?.code || '';
  }, [teacherProfile, user, memberCodes]);

  const classIdSet = useMemo(() => new Set(assignedClassIds), [assignedClassIds]);

  const rows = useMemo(() => {
    const byStudentCode = new Map<
      string,
      {
        studentCode: string;
        studentName: string;
        rollNumber: string;
        classId: string;
        classCode: string;
        className: string;
        teacherCode: string;
        status: string;
      }
    >();

    // 1. Pull from memberAccessCodes where role == student
    memberCodes
      .filter((c) => c.role === 'student')
      .filter((c) => {
        if (c.classId && classIdSet.has(c.classId)) return true;
        if (teacherProfile?.id && c.teacherId === teacherProfile.id) return true;
        if (myTeacherCode && c.teacherCode && c.teacherCode.toUpperCase() === myTeacherCode.toUpperCase()) return true;
        return classIdSet.size === 0;
      })
      .forEach((c) => {
        const cls = data.classes.find((cl) => cl.id === c.classId);
        byStudentCode.set(c.code, {
          studentCode: c.code,
          studentName: c.memberName,
          rollNumber: c.rollNumber || '',
          classId: c.classId || '',
          classCode: c.classCode || cls?.code || '',
          className: c.className || cls?.name || '',
          teacherCode: c.teacherCode || myTeacherCode,
          status: c.status,
        });
      });

    // 2. Merge any students in scopedData.students that already have an accessCode
    data.students.forEach((st) => {
      if (!st.accessCode || byStudentCode.has(st.accessCode)) return;
      const cls = data.classes.find((cl) => cl.id === st.classId);
      byStudentCode.set(st.accessCode, {
        studentCode: st.accessCode,
        studentName: st.name,
        rollNumber: st.rollNumber || '',
        classId: st.classId,
        classCode: cls?.code || '',
        className: cls?.name || st.className || '',
        teacherCode: myTeacherCode,
        status: st.status,
      });
    });

    const q = search.trim().toLowerCase();
    return Array.from(byStudentCode.values())
      .filter((r) => (classFilter === 'all' ? true : r.classId === classFilter))
      .filter(
        (r) =>
          !q ||
          r.studentName.toLowerCase().includes(q) ||
          r.studentCode.toLowerCase().includes(q) ||
          r.classCode.toLowerCase().includes(q) ||
          r.rollNumber.toLowerCase().includes(q),
      )
      .sort((a, b) => a.studentCode.localeCompare(b.studentCode, undefined, { numeric: true }));
  }, [memberCodes, data.students, data.classes, classIdSet, teacherProfile?.id, myTeacherCode, classFilter, search]);

  const copyText = (key: string, text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    pushToast('success', `${label} copied to clipboard.`);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
  };

  const sortedAssignedClasses = useMemo(() => sortClassesInOrder(data.classes), [data.classes]);
  const selectedClassObj = sortedAssignedClasses.find((c) => c.id === classFilter);

  const handleExportExcel = () => {
    const count = exportStudentCodeRowsExcel({
      titleSlug: selectedClassObj ? selectedClassObj.code : schoolCode || 'assigned_classes',
      sheetName: selectedClassObj ? selectedClassObj.code : 'StudentCodes',
      rows: rows.map((r) => ({ ...r, schoolCode })),
    });
    pushToast('success', `Downloaded Excel file with ${count} student codes.`);
  };

  const handleExportPdf = () => {
    const count = exportStudentCodeRowsPdf({
      schoolName,
      schoolCode,
      heading: selectedClassObj ? `${selectedClassObj.name} Student Codes` : 'Assigned Class Student Codes',
      subtitle: selectedClassObj
        ? `Class ${selectedClassObj.name} (${selectedClassObj.code})`
        : `All Assigned Classes (${sortedAssignedClasses.length} sections)`,
      rows,
    });
    pushToast('success', `Prepared printable PDF with ${count} student codes.`);
  };

  const handleExportCsv = () => {
    exportToCsv(
      `SJ_Academia_One_${(selectedClassObj?.code || schoolCode || 'school').toLowerCase()}_student_codes.csv`,
      ['StudentName', 'RollNo', 'SchoolCode', 'ClassName', 'ClassCode', 'TeacherCode', 'StudentCode', 'Status'],
      rows.map((r) => [
        r.studentName,
        r.rollNumber,
        schoolCode,
        r.className,
        r.classCode,
        r.teacherCode,
        r.studentCode,
        r.status,
      ]),
    );
    pushToast('success', 'Class student access codes exported to CSV.');
  };

  if (loading) return <SkeletonTable rows={6} cols={6} />;

  return (
    <div className="space-y-5">
      {/* Teacher & School Code Summary Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-teal-700">Classroom Code Distribution</p>
          <h2 className="text-base font-bold font-display text-slate-900 mt-0.5">
            Student Join Codes for {schoolName}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Share all 4 codes with each student in class (School Code, Class Code, your Teacher Code, and their personal
            Student Code). When they join, their request arrives in your Student Approvals queue first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-xs">
            <p className="text-[10px] text-slate-500">School Code</p>
            <p className="font-mono font-bold text-slate-900">{schoolCode || '—'}</p>
          </div>
          <div className="bg-teal-50/70 border border-teal-200 rounded-lg px-3.5 py-2 text-xs">
            <p className="text-[10px] text-teal-800">Your Teacher Code</p>
            <p className="font-mono font-bold text-teal-900">{myTeacherCode || 'Not issued yet'}</p>
          </div>
          <Button variant="secondary" size="sm" disabled={rows.length === 0} onClick={handleExportExcel}>
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            Excel
          </Button>
          <Button variant="secondary" size="sm" disabled={rows.length === 0} onClick={handleExportPdf}>
            <FileText className="w-4 h-4 text-rose-700" />
            PDF
          </Button>
          <Button variant="secondary" size="sm" disabled={rows.length === 0} onClick={handleExportCsv}>
            <Download className="w-4 h-4" />
            CSV
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      {sortedAssignedClasses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setClassFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
              classFilter === 'all'
                ? 'bg-[#0B1528] text-white border-[#0B1528]'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All Assigned Classes ({rows.length})
          </button>
          {sortedAssignedClasses.map((cls) => (
            <button
              key={cls.id}
              type="button"
              onClick={() => setClassFilter(cls.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                classFilter === cls.id
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cls.name} ({cls.code})
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No Student Codes Found for Your Classes"
          description="Once your Principal adds students or completes initial school setup, every student's 4-code bundle appears here ready to share in class."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-3 px-4 font-semibold">Student</th>
                  <th className="py-3 px-4 font-semibold">School Code</th>
                  <th className="py-3 px-4 font-semibold">Class Code</th>
                  <th className="py-3 px-4 font-semibold">Teacher Code</th>
                  <th className="py-3 px-4 font-semibold">Student Code</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const bundleText = `School: ${schoolCode} | Class: ${row.classCode || '—'} | Teacher: ${row.teacherCode || '—'} | Student (${row.studentName}): ${row.studentCode}`;
                  return (
                    <tr key={row.studentCode} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{row.studentName}</p>
                        <p className="text-[11px] text-slate-500">
                          {row.className || 'Assigned Class'}
                          {row.rollNumber ? ` · Roll #${row.rollNumber}` : ''}
                        </p>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums">{schoolCode}</td>
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-800 tabular-nums">
                        {row.classCode || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums">
                        {row.teacherCode || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs font-bold text-teal-800 tabular-nums">
                        {row.studentCode}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={row.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => copyText(row.studentCode, bundleText, `${row.studentName}'s 4 codes`)}
                        >
                          {copiedKey === row.studentCode ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedKey === row.studentCode ? 'Copied' : 'Copy 4 Codes'}
                        </Button>
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
// 10. Student Join Approvals — Stage 1 of 3 (Teacher -> Coordinator -> Principal)
// ============================================================================
function TeacherStudentApprovalsView({
  user,
  teacherProfile,
  assignedClassIds,
  canWrite,
}: {
  user: PlatformUser;
  teacherProfile?: TeacherProfile;
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
  const myTeacherCode = (teacherProfile?.accessCode || user.accessCode || '').toUpperCase();

  const myStudentRequests = useMemo(() => {
    return requests
      .filter((req) => req.requestedRole === 'student')
      .filter((req) => {
        if (teacherProfile?.id && req.targetTeacherId && req.targetTeacherId === teacherProfile.id) return true;
        if (req.targetTeacherUid && req.targetTeacherUid === user.uid) return true;
        if (myTeacherCode && req.teacherCode && req.teacherCode.toUpperCase() === myTeacherCode) return true;
        if (!req.targetTeacherId && !req.targetTeacherUid && req.requestedClassId && classIdSet.has(req.requestedClassId)) {
          return true;
        }
        return false;
      });
  }, [requests, teacherProfile?.id, user.uid, myTeacherCode, classIdSet]);

  const pendingStage1 = myStudentRequests.filter(
    (r) => r.status === 'pending' && r.approvalStage === 'teacher_pending',
  );
  const reviewedOrForwarded = myStudentRequests.filter(
    (r) => !(r.status === 'pending' && r.approvalStage === 'teacher_pending'),
  );

  const handleApproveToCoordinator = async (req: SchoolJoinRequest) => {
    if (!canWrite) return;
    setProcessingId(req.id);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      batch.update(doc(db, 'schoolJoinRequests', req.id), {
        approvalStage: 'coordinator_pending',
        status: 'pending',
        teacherApprovedBy: user.uid,
        teacherApprovedName: user.displayName,
        teacherApprovedAt: new Date().toISOString(),
        updatedAt: now,
      });
      batch.update(doc(db, 'applicationStatuses', req.applicationNumber), {
        status: 'pending',
        applicantMessage: `Approved by Class Teacher (${user.displayName}) — forwarded to Academic Coordinator for Stage 2 review.`,
        updatedAt: now,
      });
      await batch.commit();
      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: 'teacher',
        action: 'TEACHER_APPROVED_STUDENT_JOIN',
        targetType: 'schoolJoinRequest',
        targetId: req.id,
        targetLabel: `${req.applicantName} (${req.studentCode || req.accessCode || req.applicationNumber})`,
      }).catch(() => undefined);
      pushToast('success', `${req.applicantName} approved & forwarded to Academic Coordinator (Stage 2 of 3).`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to approve student request.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget || !canWrite) return;
    setProcessingId(rejectTarget.id);
    const reason = rejectReason.trim() || 'Student codes or identity could not be verified by class teacher.';
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
        applicantMessage: `Rejected by Class Teacher (${user.displayName}): ${reason}`,
        updatedAt: now,
      });
      await batch.commit();
      await recordAuditLog({
        schoolId: user.schoolId,
        actorUid: user.uid,
        actorName: user.displayName,
        actorRole: 'teacher',
        action: 'TEACHER_REJECTED_STUDENT_JOIN',
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
        <p className="text-xs font-semibold text-teal-700">Stage 1 of 3 · Teacher Verification</p>
        <h2 className="text-base font-bold font-display text-slate-900 mt-0.5">
          Student Join Approval Queue ({pendingStage1.length} pending)
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Verify each student&apos;s School, Class, Teacher, and Student codes. Approving forwards the request to the
          Academic Coordinator (Stage 2), who then forwards to the Principal (Stage 3).
        </p>
      </div>

      {pendingStage1.length === 0 ? (
        <EmptyState
          title="No Pending Student Requests"
          description="When students submit their 4 access codes selecting your Teacher Code, they will appear here for Stage 1 verification."
        />
      ) : (
        <div className="space-y-3">
          {pendingStage1.map((req) => (
            <div key={req.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">{req.applicantName}</h3>
                    <StatusText status="teacher_pending" />
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {req.applicantEmail}
                    {req.phone ? ` · ${req.phone}` : ''} · Ref{' '}
                    <span className="font-mono text-slate-700">{req.applicationNumber}</span>
                  </p>
                  {req.requestedClassInfo && (
                    <p className="text-xs text-slate-700 mt-1">Class: {req.requestedClassInfo}</p>
                  )}
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
                      onClick={() => handleApproveToCoordinator(req)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {processingId === req.id ? 'Forwarding…' : 'Approve & Forward to Coordinator'}
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

              {req.note && <p className="text-xs text-slate-600">Student note: {req.note}</p>}
            </div>
          ))}
        </div>
      )}

      {reviewedOrForwarded.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold font-display text-slate-900 mb-3">
            Forwarded &amp; Decided Requests ({reviewedOrForwarded.length})
          </h3>
          <div className="divide-y divide-slate-100">
            {reviewedOrForwarded.map((req) => (
              <div key={req.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {req.applicantName}{' '}
                    <span className="font-mono text-xs text-teal-700 ml-1">
                      {req.studentCode || req.accessCode}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {req.requestedClassInfo || req.classCode} · Ref{' '}
                    <span className="font-mono">{req.applicationNumber}</span>
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
              placeholder="Explain why the student code or class verification failed…"
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

