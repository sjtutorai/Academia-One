import React, { useMemo, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  Award,
  ClipboardCheck,
  FolderOpen,
  Megaphone,
  Bell,
  UserCircle2,
  Upload,
  FileText,
  Download,
  Clock,
} from 'lucide-react';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { db, generateId, handleFirestoreError, OperationType, formatFirestoreDate } from '../../lib/firebase';
import { getSchoolAccessMode } from '../../lib/permissions';
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
  DayOfWeek,
  Homework,
  LearningMaterial,
  PlatformUser,
  StudentProfile,
} from '../../types/models';

const STUDENT_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/student/dashboard', icon: LayoutDashboard },
  { id: 'timetable', label: 'My Timetable', path: '/student/timetable', icon: CalendarDays },
  { id: 'homework', label: 'My Homework', path: '/student/homework', icon: ClipboardList },
  { id: 'exams', label: 'Exams & Results', path: '/student/exams', icon: Award },
  { id: 'attendance', label: 'Attendance', path: '/student/attendance', icon: ClipboardCheck },
  { id: 'materials', label: 'Resources', path: '/student/materials', icon: FolderOpen },
  { id: 'announcements', label: 'Announcements', path: '/student/announcements', icon: Megaphone },
  { id: 'notifications', label: 'Notifications', path: '/student/notifications', icon: Bell },
  { id: 'profile', label: 'Profile', path: '/student/profile', icon: UserCircle2 },
];

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getTodayDayName(): DayOfWeek {
  const map: DayOfWeek[] = ['Monday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return map[new Date().getDay()] || 'Monday';
}

export default function StudentPortal() {
  const { activeUser, activeSchool, isPreviewMode } = useAuth();
  const schoolId = activeUser?.schoolId || '';
  // Pass studentUidFilter for real student sessions so Firestore queries satisfy strict student list rules
  const data = useSchoolData(
    schoolId,
    false,
    !isPreviewMode && activeUser?.role === 'student' ? activeUser.uid : undefined,
  );
  const access = getSchoolAccessMode(activeSchool);
  const [globalSearch, setGlobalSearch] = useState('');

  const studentProfile = useMemo<StudentProfile | undefined>(() => {
    if (!activeUser) return undefined;
    return data.students.find(
      (s) => s.userId === activeUser.uid || (s.email && s.email.toLowerCase() === activeUser.email.toLowerCase()),
    );
  }, [data.students, activeUser]);

  const myClassId = studentProfile?.classId || activeUser?.classId || '';
  const myClass = data.classes.find((c) => c.id === myClassId);

  const scopedData = useMemo<SchoolDataBundle>(() => {
    const isMyClass = (cid?: string) => Boolean(myClassId && cid === myClassId);
    const isMe = (studentId?: string, studentUid?: string) =>
      Boolean(
        (studentUid && activeUser && studentUid === activeUser.uid) ||
          (studentId && studentProfile && studentId === studentProfile.id),
      );

    return {
      ...data,
      classes: myClass ? [myClass] : [],
      subjects: data.subjects.filter((s) => isMyClass(s.classId)),
      timetable: data.timetable.filter((p) => isMyClass(p.classId) && p.status === 'published'),
      attendance: data.attendance.filter((a) => isMyClass(a.classId)),
      homework: data.homework.filter((h) => isMyClass(h.classId) && h.status !== 'draft'),
      submissions: data.submissions.filter((sub) => isMe(sub.studentId, sub.studentUid)),
      examinations: data.examinations.filter((ex) => isMyClass(ex.classId) && ex.schedulePublished),
      examResults: data.examResults.filter((r) => isMe(r.studentId, r.studentUid) && r.status === 'published'),
      materials: data.materials.filter((m) => isMyClass(m.classId) && m.status === 'published'),
      announcements: data.announcements.filter(
        (a) =>
          a.status === 'published' &&
          (a.audience === 'school_wide' ||
            (a.audience === 'role_specific' && a.targetRole === 'student') ||
            (a.audience === 'class_specific' && isMyClass(a.targetClassId))),
      ),
    };
  }, [data, myClassId, myClass, activeUser, studentProfile]);

  // Personal attendance history extracted strictly for this student
  const personalAttendance = useMemo(() => {
    const records: { date: string; status: 'present' | 'absent' | 'late' | 'excused'; className: string }[] = [];
    scopedData.attendance.forEach((rec) => {
      const entry = rec.entries.find(
        (e) =>
          (studentProfile && e.studentId === studentProfile.id) ||
          (activeUser && e.studentName.toLowerCase() === activeUser.displayName.toLowerCase()),
      );
      if (entry) {
        records.push({
          date: rec.date,
          status: entry.status,
          className: rec.className || myClass?.name || '',
        });
      }
    });
    return records.sort((a, b) => b.date.localeCompare(a.date));
  }, [scopedData.attendance, studentProfile, activeUser, myClass?.name]);

  if (!activeUser) return null;

  const isUnassigned = !schoolId || schoolId === 'unassigned';

  return (
    <DashboardShell
      title="Student Portal"
      breadcrumb={
        isUnassigned
          ? 'Pending School Enrollment'
          : `${activeSchool?.name || 'School'} · ${myClass?.name || 'Enrolled Class'}`
      }
      navItems={STUDENT_NAV}
      onGlobalSearch={setGlobalSearch}
      globalSearchPlaceholder="Search homework, resources, notices…"
    >
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            isUnassigned ? (
              <UnassignedStudentView user={activeUser} />
            ) : (
              <StudentOverview
                user={activeUser}
                studentProfile={studentProfile}
                classNameLabel={myClass?.name || 'Assigned Class'}
                data={scopedData}
                personalAttendance={personalAttendance}
              />
            )
          }
        />
        <Route
          path="timetable"
          element={
            isUnassigned ? (
              <UnassignedStudentView user={activeUser} />
            ) : (
              <StudentTimetableView data={scopedData} classNameLabel={myClass?.name || ''} />
            )
          }
        />
        <Route
          path="homework"
          element={
            isUnassigned ? (
              <UnassignedStudentView user={activeUser} />
            ) : (
              <StudentHomeworkView
                user={activeUser}
                studentProfile={studentProfile}
                data={scopedData}
                canWrite={access.canWrite}
                search={globalSearch}
              />
            )
          }
        />
        <Route
          path="exams"
          element={
            isUnassigned ? (
              <UnassignedStudentView user={activeUser} />
            ) : (
              <StudentExamsResultsView data={scopedData} />
            )
          }
        />
        <Route
          path="attendance"
          element={
            isUnassigned ? (
              <UnassignedStudentView user={activeUser} />
            ) : (
              <StudentAttendanceView personalAttendance={personalAttendance} />
            )
          }
        />
        <Route
          path="materials"
          element={
            isUnassigned ? (
              <UnassignedStudentView user={activeUser} />
            ) : (
              <StudentMaterialsView data={scopedData} search={globalSearch} />
            )
          }
        />
        <Route
          path="announcements"
          element={
            isUnassigned ? (
              <UnassignedStudentView user={activeUser} />
            ) : (
              <StudentAnnouncementsView data={scopedData} search={globalSearch} />
            )
          }
        />
        <Route path="notifications" element={<NotificationsAndPreferencesView />} />
        <Route path="profile" element={<ProfileSecurityView />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardShell>
  );
}

// ============================================================================
// Pending Enrollment View (for Self-Registered Accounts)
// ============================================================================
function UnassignedStudentView({ user }: { user: PlatformUser }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-2xl">
      <p className="text-xs font-semibold text-teal-700">Account Active · Awaiting School Link</p>
      <h2 className="text-xl font-bold font-display text-slate-900 mt-1">
        Welcome to AcademiaOne, {user.displayName}
      </h2>
      <p className="text-sm text-slate-600 mt-3 leading-relaxed">
        Your account ({user.email}) is verified and active, but it has not yet been enrolled in a school tenant or class section.
        Share your registered email with your school Principal so they can link you to your campus and class roster.
      </p>
      <p className="text-xs text-slate-500 mt-4">
        In the meantime, you can configure your push & in-app notification preferences or update your profile details from the sidebar.
      </p>
    </div>
  );
}

// ============================================================================
// 1. Student Overview (Mobile-First & Welcoming)
// ============================================================================
function StudentOverview({
  user,
  studentProfile,
  classNameLabel,
  data,
  personalAttendance,
}: {
  user: PlatformUser;
  studentProfile?: StudentProfile;
  classNameLabel: string;
  data: SchoolDataBundle;
  personalAttendance: { date: string; status: 'present' | 'absent' | 'late' | 'excused'; className: string }[];
}) {
  if (data.loading) return <SkeletonTable rows={5} cols={4} />;

  const today = getTodayDayName();
  const todayPeriods = data.timetable
    .filter((p) => p.dayOfWeek === today)
    .sort((a, b) => a.periodNumber - b.periodNumber);
  const nextClass = todayPeriods.find((p) => !p.isBreak);

  const presentOrLate = personalAttendance.filter((a) => a.status === 'present' || a.status === 'late').length;
  const attendancePct =
    personalAttendance.length > 0 ? Math.round((presentOrLate / personalAttendance.length) * 100) : 100;

  const submittedHwIds = new Set(data.submissions.map((s) => s.homeworkId));
  const pendingHomework = data.homework.filter((h) => h.status === 'published' && !submittedHwIds.has(h.id));
  const upcomingExams = data.examinations
    .filter((ex) => ex.status === 'scheduled')
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      <div className="bg-[#0F295C] text-white rounded-xl overflow-hidden shadow-xs">
        <div className="brand-spectrum-bar w-full" />
        <div className="p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#FACC15]">
              {classNameLabel}
              {studentProfile?.rollNumber ? ` · Roll #${studentProfile.rollNumber}` : ''}
              {studentProfile?.admissionNumber ? ` · ${studentProfile.admissionNumber}` : ''}
            </p>
            <h2 className="text-xl font-bold font-display mt-1">Hello, {user.displayName}</h2>
            <p className="text-xs text-blue-100/80 mt-1">
              {today}'s schedule has {todayPeriods.filter((p) => !p.isBreak).length} classes · {pendingHomework.length} homework items pending.
            </p>
          </div>
          {nextClass && (
            <div className="bg-blue-950/70 border border-blue-800/80 rounded-lg px-4 py-3 text-xs">
              <p className="text-[#4ADE80] flex items-center gap-1.5 font-medium">
                <Clock className="w-3.5 h-3.5" /> Next Class ({today})
              </p>
              <p className="font-semibold text-white mt-1">
                {nextClass.subjectName} · {nextClass.startTime}–{nextClass.endTime}
              </p>
              <p className="text-blue-200/75 mt-0.5">
                {nextClass.teacherName || 'Instructor'} · {nextClass.roomName || 'Room TBD'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Attendance Rate"
          value={`${attendancePct}%`}
          subtext={`${presentOrLate} of ${personalAttendance.length} recorded days`}
          tone={attendancePct >= 85 ? 'green' : 'yellow'}
        />
        <StatCard
          label="Pending Homework"
          value={pendingHomework.length}
          subtext={`${data.submissions.length} submitted`}
          tone={pendingHomework.length > 0 ? 'red' : 'green'}
        />
        <StatCard
          label="Upcoming Exams"
          value={upcomingExams.length}
          subtext="Published dates"
          tone="blue"
        />
        <StatCard
          label="Published Results"
          value={data.examResults.length}
          subtext={`${data.materials.length} study resources`}
          tone="yellow"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Timetable */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold font-display text-slate-900 mb-3">Today's Timetable ({today})</h3>
          {todayPeriods.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">No classes scheduled today.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {todayPeriods.map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {p.isBreak ? 'Break / Recess' : p.subjectName}
                    </p>
                    {!p.isBreak && (
                      <p className="text-xs text-slate-500">
                        {p.teacherName || 'Instructor'} · {p.roomName || 'Room TBD'}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {p.startTime}–{p.endTime}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Homework & Recent Notices */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold font-display text-slate-900 mb-3">Recent Announcements</h3>
          {data.announcements.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">No recent announcements.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.announcements.slice(0, 4).map((an) => (
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
// 2. Daily & Weekly Timetable
// ============================================================================
function StudentTimetableView({ data, classNameLabel }: { data: SchoolDataBundle; classNameLabel: string }) {
  const [viewMode, setViewMode] = useState<'weekly' | 'daily'>('weekly');
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(getTodayDayName());

  const daysToRender = viewMode === 'daily' ? [selectedDay] : DAYS.slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold font-display text-slate-900">My Class Timetable — {classNameLabel}</h2>
          <p className="text-xs text-slate-500">Published periods, instructors, and room assignments for your section.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('daily')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              viewMode === 'daily' ? 'bg-[#0B1528] text-white' : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            Daily View
          </button>
          <button
            type="button"
            onClick={() => setViewMode('weekly')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
              viewMode === 'weekly' ? 'bg-[#0B1528] text-white' : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            Weekly Grid
          </button>
        </div>
      </div>

      {viewMode === 'daily' && (
        <div className="flex flex-wrap gap-1.5">
          {DAYS.slice(0, 5).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setSelectedDay(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                selectedDay === d
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      <div className={`grid grid-cols-1 ${viewMode === 'weekly' ? 'md:grid-cols-2 xl:grid-cols-3' : ''} gap-4`}>
        {daysToRender.map((day) => {
          const periods = data.timetable
            .filter((p) => p.dayOfWeek === day)
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
                          {p.isBreak ? 'Break / Recess' : `P${p.periodNumber} · ${p.subjectName}`}
                        </p>
                        {!p.isBreak && (
                          <p className="text-[11px] text-slate-500">
                            {p.teacherName || 'Instructor'} · {p.roomName || 'Room TBD'}
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
  );
}

// ============================================================================
// 3. Homework & Online Submissions
// ============================================================================
function StudentHomeworkView({
  user,
  studentProfile,
  data,
  canWrite,
  search,
}: {
  user: PlatformUser;
  studentProfile?: StudentProfile;
  data: SchoolDataBundle;
  canWrite: boolean;
  search: string;
}) {
  const { pushToast } = useToast();
  const [submittingHw, setSubmittingHw] = useState<Homework | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileType, setFileType] = useState('');
  const [fileSizeKb, setFileSizeKb] = useState(0);
  const [saving, setSaving] = useState(false);

  const q = search.trim().toLowerCase();
  const visibleHw = data.homework
    .filter((h) => !q || h.title.toLowerCase().includes(q) || h.subjectName.toLowerCase().includes(q))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const openSubmit = (hw: Homework) => {
    const existing = data.submissions.find((s) => s.homeworkId === hw.id);
    setSubmittingHw(hw);
    setSubmissionText(existing?.submissionText || '');
    setFileName(existing?.fileName || '');
    setFileType(existing?.fileType || '');
    setFileSizeKb(existing?.fileSizeKb || 0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      pushToast('error', 'Submission file must be 10 MB or smaller.');
      return;
    }
    const ext = file.name.split('.').pop()?.toUpperCase() || '';
    if (!['PDF', 'DOC', 'DOCX', 'PNG', 'JPG', 'JPEG', 'TXT'].includes(ext)) {
      pushToast('error', 'Allowed formats: PDF, DOC, DOCX, PNG, JPG, TXT.');
      return;
    }
    setFileName(file.name);
    setFileType(ext);
    setFileSizeKb(Math.max(1, Math.round(file.size / 1024)));
  };

  const handleSubmitWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submittingHw) return;
    if (!submissionText.trim() && !fileName) {
      pushToast('error', 'Add a written answer or attach a file before submitting.');
      return;
    }
    setSaving(true);
    const existing = data.submissions.find((s) => s.homeworkId === submittingHw.id);
    const nowIso = new Date().toISOString();
    const isLate = nowIso.slice(0, 10) > submittingHw.dueDate;

    try {
      if (existing) {
        await updateDoc(doc(db, 'homeworkSubmissions', existing.id), {
          fileName: fileName || '',
          fileType: fileType || '',
          fileSizeKb,
          submissionText: submissionText.trim(),
          submittedAt: nowIso,
          isLate,
          reviewStatus: 'submitted',
          updatedAt: serverTimestamp(),
        });
      } else {
        const id = generateId('sub');
        await setDoc(doc(db, 'homeworkSubmissions', id), {
          id,
          schoolId: user.schoolId,
          homeworkId: submittingHw.id,
          classId: submittingHw.classId,
          studentId: studentProfile?.id || user.uid,
          studentUid: user.uid,
          studentName: user.displayName,
          fileName: fileName || '',
          fileType: fileType || '',
          fileSizeKb,
          submissionText: submissionText.trim(),
          submittedAt: nowIso,
          isLate,
          reviewStatus: 'submitted',
          feedback: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      pushToast('success', existing ? 'Homework submission updated.' : 'Homework submitted to teacher.');
      setSubmittingHw(null);
    } catch (err) {
      pushToast('error', 'Unable to submit homework.');
      handleFirestoreError(err, OperationType.WRITE, 'homeworkSubmissions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold font-display text-slate-900">My Homework & Submissions</h2>
        <p className="text-xs text-slate-500">Track assignments, upload online submissions, and review teacher feedback.</p>
      </div>

      {visibleHw.length === 0 ? (
        <EmptyState title="No Homework Assigned" description="Assignments published by your teachers will appear here." />
      ) : (
        <div className="space-y-3">
          {visibleHw.map((hw) => {
            const sub = data.submissions.find((s) => s.homeworkId === hw.id);
            const pastDue = new Date().toISOString().slice(0, 10) > hw.dueDate;
            return (
              <div key={hw.id} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-teal-700">
                      {hw.subjectName} · {hw.teacherName || 'Teacher'} · Due {hw.dueDate}
                    </p>
                    <h3 className="text-sm font-bold text-slate-900 mt-0.5">{hw.title}</h3>
                  </div>
                  <StatusText status={sub ? sub.reviewStatus : pastDue ? 'overdue' : 'pending'} />
                </div>

                {hw.instructions && <p className="text-sm text-slate-600 mt-2 leading-relaxed">{hw.instructions}</p>}

                {sub && (
                  <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                    <p className="font-semibold text-slate-800">
                      Your Submission {sub.fileName ? `· ${sub.fileName} (${sub.fileSizeKb || 0} KB)` : ''}
                      {sub.isLate ? ' · Submitted Late' : ''}
                    </p>
                    {sub.submissionText && <p className="text-slate-600">{sub.submissionText}</p>}
                    {sub.feedback && (
                      <p className="text-teal-800 font-medium pt-1">Teacher Feedback: {sub.feedback}</p>
                    )}
                  </div>
                )}

                {canWrite && hw.allowOnlineSubmission !== false && hw.status === 'published' && (
                  <div className="mt-4 flex items-center justify-end">
                    <Button variant={sub ? 'secondary' : 'primary'} size="sm" onClick={() => openSubmit(hw)}>
                      <Upload className="w-4 h-4" />
                      {sub ? 'Replace Submission' : 'Submit Homework'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(submittingHw)}
        onClose={() => setSubmittingHw(null)}
        title={`Submit Homework — ${submittingHw?.title || ''}`}
        subtitle={`Due ${submittingHw?.dueDate || ''}`}
      >
        <form onSubmit={handleSubmitWork} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Written Response / Summary</label>
            <textarea
              rows={4}
              value={submissionText}
              onChange={(e) => setSubmissionText(e.target.value)}
              placeholder="Write your answer or notes for your teacher…"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Attach File (PDF, DOCX, PNG, JPG · max 10 MB)</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
              onChange={handleFileChange}
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-slate-50"
            />
            {fileName && (
              <p className="text-[11px] text-teal-700 mt-1">
                Attached: {fileName} ({fileType} · {fileSizeKb} KB)
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setSubmittingHw(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Submitting…' : 'Submit Work'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// 4. Published Examinations & Results (Strictly Published Only)
// ============================================================================
function StudentExamsResultsView({ data }: { data: SchoolDataBundle }) {
  const chartData = data.examResults.map((r) => ({
    subject: r.subjectName || r.examName || 'Exam',
    percentage: r.maxMarks > 0 ? Math.round((r.obtainedMarks / r.maxMarks) * 100) : 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold font-display text-slate-900">Examinations & Published Results</h2>
        <p className="text-xs text-slate-500">
          Only finalized schedules and results officially published by your school appear here.
        </p>
      </div>

      {/* Published Exam Schedule */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-bold font-display text-slate-900">Published Exam Schedule</h3>
        </div>
        {data.examinations.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No examination schedules have been published yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Exam</th>
                  <th className="py-2.5 px-4 font-semibold">Subject</th>
                  <th className="py-2.5 px-4 font-semibold">Date & Time</th>
                  <th className="py-2.5 px-4 font-semibold">Room</th>
                  <th className="py-2.5 px-4 font-semibold">Max Marks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.examinations.map((ex) => (
                  <tr key={ex.id}>
                    <td className="py-3 px-4 font-semibold text-slate-900">{ex.name}</td>
                    <td className="py-3 px-4 text-slate-700">{ex.subjectName}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                      {ex.date} · {ex.startTime}–{ex.endTime}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">{ex.roomName || 'Assigned Hall'}</td>
                    <td className="py-3 px-4 tabular-nums text-slate-700">{ex.maxMarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Published Results Table + Performance Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-bold font-display text-slate-900">My Published Results</h3>
          </div>
          {data.examResults.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No exam results have been published yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Exam · Subject</th>
                    <th className="py-2.5 px-4 font-semibold">Score</th>
                    <th className="py-2.5 px-4 font-semibold">Grade</th>
                    <th className="py-2.5 px-4 font-semibold">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.examResults.map((res) => (
                    <tr key={res.id}>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-900">{res.subjectName || 'Subject'}</p>
                        <p className="text-xs text-slate-500">{res.examName || res.examId}</p>
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold tabular-nums text-slate-900">
                        {res.obtainedMarks} / {res.maxMarks}
                      </td>
                      <td className="py-3 px-4 font-bold text-teal-700">{res.grade || '—'}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">{res.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold font-display text-slate-900 mb-3">Subject Performance (%)</h3>
          {chartData.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">Score chart appears once results are published.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="subject" tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip />
                  <Bar dataKey="percentage" fill="#16A34A" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5. Personal Attendance Log (Strictly Read-Only)
// ============================================================================
function StudentAttendanceView({
  personalAttendance,
}: {
  personalAttendance: { date: string; status: 'present' | 'absent' | 'late' | 'excused'; className: string }[];
}) {
  const present = personalAttendance.filter((a) => a.status === 'present').length;
  const late = personalAttendance.filter((a) => a.status === 'late').length;
  const absent = personalAttendance.filter((a) => a.status === 'absent').length;
  const pct = personalAttendance.length > 0 ? Math.round(((present + late) / personalAttendance.length) * 100) : 100;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold font-display text-slate-900">My Attendance Record</h2>
        <p className="text-xs text-slate-500">Read-only daily attendance history recorded by your class teachers.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Attendance Rate" value={`${pct}%`} tone={pct >= 85 ? 'teal' : 'amber'} />
        <StatCard label="Present Days" value={present} tone="teal" />
        <StatCard label="Late Arrivals" value={late} tone={late > 0 ? 'amber' : 'default'} />
        <StatCard label="Absent Days" value={absent} tone={absent > 0 ? 'red' : 'default'} />
      </div>

      {personalAttendance.length === 0 ? (
        <EmptyState
          title="No Attendance Marked Yet"
          description="Your daily attendance entries will appear here as teachers submit class registers."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-3 px-4 font-semibold">Date</th>
                  <th className="py-3 px-4 font-semibold">Class</th>
                  <th className="py-3 px-4 font-semibold">Recorded Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {personalAttendance.map((row, idx) => (
                  <tr key={`${row.date}_${idx}`}>
                    <td className="py-3 px-4 font-mono text-xs text-slate-700">{row.date}</td>
                    <td className="py-3 px-4 text-slate-700">{row.className}</td>
                    <td className="py-3 px-4">
                      <StatusText status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 6. Learning Resources
// ============================================================================
function StudentMaterialsView({ data, search }: { data: SchoolDataBundle; search: string }) {
  const [previewMat, setPreviewMat] = useState<LearningMaterial | null>(null);
  const q = search.trim().toLowerCase();
  const visible = data.materials.filter(
    (m) =>
      !q ||
      m.title.toLowerCase().includes(q) ||
      m.subjectName.toLowerCase().includes(q) ||
      (m.topic || '').toLowerCase().includes(q),
  );

  const downloadNote = (mat: LearningMaterial) => {
    const content = [
      `${mat.title}`,
      `Subject: ${mat.subjectName}`,
      `Topic: ${mat.topic || 'General'}`,
      `Teacher: ${mat.teacherName || 'Faculty'}`,
      '',
      mat.description || '',
      '',
      mat.contentPreview || 'Study material metadata exported from AcademiaOne.',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mat.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_notes.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold font-display text-slate-900">Learning Resources & Study Notes</h2>
        <p className="text-xs text-slate-500">Study materials uploaded by teachers for your enrolled class.</p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No Study Resources Available"
          description="Notes, PDFs, and slides uploaded for your class will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((mat) => (
            <div key={mat.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-teal-700">
                  {mat.subjectName} · {mat.fileType} · {formatFirestoreDate(mat.createdAt)}
                </p>
                <h3 className="text-sm font-bold text-slate-900 mt-0.5">{mat.title}</h3>
                {mat.topic && <p className="text-xs text-slate-500 mt-0.5">Topic: {mat.topic}</p>}
                {mat.description && <p className="text-xs text-slate-600 mt-2">{mat.description}</p>}
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="text-xs text-slate-500 truncate max-w-[180px]">
                  {mat.fileName} ({mat.fileSizeKb || 0} KB)
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPreviewMat(mat)}>
                    <FileText className="w-3.5 h-3.5" />
                    Preview
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => downloadNote(mat)}>
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(previewMat)}
        onClose={() => setPreviewMat(null)}
        title={previewMat?.title || ''}
        subtitle={`${previewMat?.subjectName || ''} · ${previewMat?.fileName || ''}`}
      >
        {previewMat && (
          <div className="space-y-4">
            {previewMat.description && <p className="text-sm text-slate-700">{previewMat.description}</p>}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
              {previewMat.contentPreview || 'Use the Download button to save this resource.'}
            </div>
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={() => downloadNote(previewMat)}>
                <Download className="w-4 h-4" />
                Download Study Notes
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
// 7. Student Announcements
// ============================================================================
function StudentAnnouncementsView({ data, search }: { data: SchoolDataBundle; search: string }) {
  const q = search.trim().toLowerCase();
  const visible = data.announcements.filter(
    (a) => !q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold font-display text-slate-900">School & Class Announcements</h2>
        <p className="text-xs text-slate-500">Official notices published for your school and class section.</p>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No Announcements" description="School-wide and class announcements will appear here." />
      ) : (
        <div className="space-y-3">
          {visible.map((an) => (
            <div key={an.id} className="bg-white border border-slate-200 rounded-xl p-5">
              <p className="text-xs font-medium text-teal-700">{an.audience.replace('_', ' ')}</p>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">{an.title}</h3>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">{an.body}</p>
              <p className="text-xs text-slate-400 mt-3">
                {an.authorName} · {formatFirestoreDate(an.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
