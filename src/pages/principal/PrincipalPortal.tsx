import React, { useMemo, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Sparkles,
  UserPlus,
  UserCog,
  Users,
  GraduationCap,
  BookOpen,
  DoorOpen,
  CalendarDays,
  FileSpreadsheet,
  ClipboardList,
  Megaphone,
  BarChart2,
  Settings,
  Bell,
  UserCircle2,
  Plus,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  auth,
  db,
  generateId,
  handleFirestoreError,
  OperationType,
  provisionAuthAccountSecondary,
} from '../../lib/firebase';
import { getSchoolAccessMode } from '../../lib/permissions';
import { recordAuditLog } from '../../lib/audit';
import { useAuth } from '../../contexts/AuthContext';
import { useSchoolData } from '../../hooks/useSchoolData';
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
import { upsertEmailDirectoryEntry, upsertMemberAccessCode } from '../../lib/schoolProvisioning';
import {
  deriveSchoolPrefix,
  formatGradeSummaryCompact,
  formatMemberRoleCode,
  formatPrincipalCode,
  groupClassesByGrade,
  sanitizePhoneDigits,
} from '../../lib/schoolCodes';
import {
  CoordinatorGradeOnlyPicker,
  TeacherSubjectClassPicker,
} from '../../components/shared/GradeClassControls';
import { PrincipalActivationGate } from './PrincipalActivationGate';
import {
  PrincipalSetupWizardView,
  PrincipalJoinRequestsView,
  PrincipalAccessCodesView,
} from './PrincipalOnboardingViews';
import {
  PrincipalStudentsView,
  PrincipalClassesSubjectsView,
  PrincipalRoomsView,
} from './PrincipalStudentsClasses';
import {
  PrincipalTimetableView,
  PrincipalExamsView,
  PrincipalHomeworkView,
  PrincipalAnnouncementsView,
  PrincipalReportsView,
  PrincipalSchoolSettingsView,
} from './PrincipalAcademicsOps';
import { ExcelImportModal } from '../../components/principal/ExcelImportModal';
import type { ExcelImportKind } from '../../lib/excelImport';
import type { CoordinatorPermissions, PlatformUser, School, Subject, TeacherProfile } from '../../types/models';

const PRINCIPAL_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/principal/dashboard', icon: LayoutDashboard },
  { id: 'setup', label: 'Campus Setup Wizard', path: '/principal/setup', icon: Sparkles },
  { id: 'access-codes', label: 'Access Codes', path: '/principal/access-codes', icon: KeyRound },
  { id: 'join-requests', label: 'Join Requests', path: '/principal/join-requests', icon: UserPlus },
  { id: 'coordinators', label: 'Coordinators', path: '/principal/coordinators', icon: UserCog },
  { id: 'teachers', label: 'Teachers', path: '/principal/teachers', icon: Users },
  { id: 'students', label: 'Students', path: '/principal/students', icon: GraduationCap },
  { id: 'classes', label: 'Classes & Subjects', path: '/principal/classes', icon: BookOpen },
  { id: 'rooms', label: 'Rooms', path: '/principal/rooms', icon: DoorOpen },
  { id: 'timetable', label: 'Timetable', path: '/principal/timetable', icon: CalendarDays },
  { id: 'examinations', label: 'Examinations', path: '/principal/examinations', icon: FileSpreadsheet },
  { id: 'homework', label: 'Homework', path: '/principal/homework', icon: ClipboardList },
  { id: 'announcements', label: 'Announcements', path: '/principal/announcements', icon: Megaphone },
  { id: 'reports', label: 'Reports', path: '/principal/reports', icon: BarChart2 },
  { id: 'settings', label: 'School Settings', path: '/principal/settings', icon: Settings },
  { id: 'notifications', label: 'Notifications', path: '/principal/notifications', icon: Bell },
  { id: 'profile', label: 'Profile', path: '/principal/profile', icon: UserCircle2 },
];

export default function PrincipalPortal() {
  const { activeUser, activeSchool, schoolLoading, schoolLoadError, reloadSchool, refreshProfile, isPreviewMode } =
    useAuth();
  const navigate = useNavigate();
  const schoolId = activeUser?.schoolId || '';
  const data = useSchoolData(schoolId, true);
  const access = getSchoolAccessMode(activeSchool);
  const [globalSearch, setGlobalSearch] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [excelImportState, setExcelImportState] = useState<{ open: boolean; tab: ExcelImportKind }>({
    open: false,
    tab: 'students',
  });

  const openExcelImport = (tab: ExcelImportKind = 'students') => {
    setExcelImportState({ open: true, tab });
  };

  if (!activeUser) return null;

  // Lock Main Head-registered schools into the Activation Code + Full Setup Wizard until completed
  if (
    !isPreviewMode &&
    activeSchool &&
    activeSchool.source === 'admin_manual' &&
    (!activeSchool.activationVerified || !activeSchool.setupCompleted)
  ) {
    return <PrincipalActivationGate school={activeSchool} actor={activeUser} />;
  }

  const schoolPrefix = activeSchool?.code || deriveSchoolPrefix(activeSchool?.name || '');
  const breadcrumbLabel = activeSchool?.code || activeSchool?.name || (schoolLoading ? 'Loading…' : 'Campus');

  const handleRetrySchool = async () => {
    setRetrying(true);
    try {
      await refreshProfile().catch(() => undefined);
      reloadSchool();
    } finally {
      setTimeout(() => setRetrying(false), 600);
    }
  };

  const schoolUnavailableView = schoolLoading ? (
    <SkeletonTable rows={6} cols={4} />
  ) : (
    <div className="max-w-xl mx-auto mt-6 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 text-center space-y-4 shadow-sm">
      <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
        <AlertTriangle className="w-5 h-5" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-bold font-display text-slate-900">School Workspace Unavailable</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          {schoolLoadError ||
            'Your assigned school record could not be loaded. It may still be syncing or may have been removed by the Main Head administrator.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
        <Button variant="primary" size="sm" onClick={handleRetrySchool} disabled={retrying}>
          <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Refreshing…' : 'Retry Loading School'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/register-school')}>
          Register a School
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate('/principal/profile')}>
          Account &amp; Profile
        </Button>
      </div>
    </div>
  );

  return (
    <DashboardShell
      title={activeSchool?.name || 'School Administration'}
      breadcrumb={`SJ Academia One / Principal / ${breadcrumbLabel}`}
      navItems={PRINCIPAL_NAV}
      onGlobalSearch={setGlobalSearch}
      globalSearchPlaceholder="Search students, teachers, classes…"
    >
      <Routes>
        <Route path="notifications" element={<NotificationsAndPreferencesView />} />
        <Route path="profile" element={<ProfileSecurityView />} />
        {!activeSchool ? (
          <Route path="*" element={schoolUnavailableView} />
        ) : (
          <>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            <PrincipalOverview
              school={activeSchool}
              data={data}
              canWrite={access.canWrite}
              onOpenExcelImport={() => openExcelImport('students')}
            />
          }
        />
        <Route
          path="setup"
          element={
            <PrincipalSetupWizardView
              school={activeSchool}
              existingClasses={data.classes}
              existingRooms={data.rooms}
              actor={activeUser}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="access-codes"
          element={
            <PrincipalAccessCodesView
              school={activeSchool}
              classes={data.classes}
              teachers={data.teachers}
              students={data.students}
              coordinators={data.schoolUsers.filter((u) => u.role === 'coordinator')}
              actor={activeUser}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="join-requests"
          element={
            <PrincipalJoinRequestsView
              school={activeSchool}
              classes={data.classes}
              subjects={data.subjects}
              actor={activeUser}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="coordinators"
          element={
            <PrincipalCoordinatorsView
              coordinators={data.schoolUsers.filter((u) => u.role === 'coordinator')}
              classes={data.classes}
              schoolId={schoolId}
              schoolCode={schoolPrefix}
              schoolName={activeSchool?.name || ''}
              actor={activeUser}
              canWrite={access.canWrite}
              loading={data.loading}
            />
          }
        />
        <Route
          path="teachers"
          element={
            <PrincipalTeachersView
              teachers={data.teachers}
              classes={data.classes}
              subjects={data.subjects}
              schoolId={schoolId}
              schoolCode={schoolPrefix}
              schoolName={activeSchool?.name || ''}
              actor={activeUser}
              canWrite={access.canWrite}
              globalSearch={globalSearch}
              loading={data.loading}
              onOpenExcelImport={() => openExcelImport('teachers')}
            />
          }
        />
        <Route
          path="students"
          element={
            <PrincipalStudentsView
              students={data.students}
              classes={data.classes}
              teachers={data.teachers}
              schoolId={schoolId}
              schoolCode={schoolPrefix}
              schoolName={activeSchool?.name || ''}
              allocatedStudents={activeSchool?.allocatedStudents}
              academicYear={activeSchool?.academicYear || '2026-2027'}
              actor={activeUser}
              canWrite={access.canWrite}
              globalSearch={globalSearch}
              loading={data.loading}
              onOpenExcelImport={() => openExcelImport('students')}
            />
          }
        />
        <Route
          path="classes"
          element={
            <PrincipalClassesSubjectsView
              classes={data.classes}
              subjects={data.subjects}
              teachers={data.teachers}
              students={data.students}
              rooms={data.rooms}
              schoolId={schoolId}
              schoolCode={schoolPrefix}
              schoolName={activeSchool?.name || ''}
              academicYear={activeSchool?.academicYear || '2026-2027'}
              actor={activeUser}
              canWrite={access.canWrite}
              onOpenExcelImport={() => openExcelImport('classes')}
            />
          }
        />
        <Route
          path="rooms"
          element={
            <PrincipalRoomsView
              rooms={data.rooms}
              classes={data.classes}
              examinations={data.examinations}
              schoolId={schoolId}
              actor={activeUser}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="timetable"
          element={
            <PrincipalTimetableView
              timetable={data.timetable}
              classes={data.classes}
              subjects={data.subjects}
              teachers={data.teachers}
              rooms={data.rooms}
              schoolId={schoolId}
              actor={activeUser}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="examinations"
          element={
            <PrincipalExamsView
              examinations={data.examinations}
              classes={data.classes}
              subjects={data.subjects}
              rooms={data.rooms}
              students={data.students}
              schoolId={schoolId}
              academicYear={activeSchool?.academicYear || '2026-2027'}
              actor={activeUser}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="homework"
          element={
            <PrincipalHomeworkView
              homework={data.homework}
              submissions={data.submissions}
              classes={data.classes}
              teachers={data.teachers}
              schoolId={schoolId}
              actor={activeUser}
              canWrite={access.canWrite}
            />
          }
        />
        <Route
          path="announcements"
          element={
            <PrincipalAnnouncementsView
              announcements={data.announcements}
              classes={data.classes}
              schoolId={schoolId}
              actor={activeUser}
              canWrite={access.canWrite}
            />
          }
        />
        <Route path="reports" element={<PrincipalReportsView data={data} />} />
        <Route
          path="settings"
          element={
            <PrincipalSchoolSettingsView
              school={activeSchool}
              actor={activeUser}
              canWrite={access.canWrite}
            />
          }
        />
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </>
        )}
      </Routes>
      {activeSchool && (
        <ExcelImportModal
          open={excelImportState.open}
          onClose={() => setExcelImportState((prev) => ({ ...prev, open: false }))}
          defaultTab={excelImportState.tab}
          school={activeSchool}
          classes={data.classes}
          students={data.students}
          teachers={data.teachers}
          actor={activeUser}
          canWrite={access.canWrite}
        />
      )}
    </DashboardShell>
  );
}

// ============================================================================
// Principal Overview
// ============================================================================
function PrincipalOverview({
  school,
  data,
  canWrite,
  onOpenExcelImport,
}: {
  school: School | null;
  data: ReturnType<typeof useSchoolData>;
  canWrite: boolean;
  onOpenExcelImport: () => void;
}) {
  const navigate = useNavigate();
  const [copiedCode, setCopiedCode] = useState(false);
  const coordinatorsCount = data.schoolUsers.filter((u) => u.role === 'coordinator').length;

  const attendanceSummary = useMemo(() => {
    let present = 0;
    let total = 0;
    data.attendance.forEach((rec) => {
      rec.entries.forEach((e) => {
        total += 1;
        if (e.status === 'present' || e.status === 'late') present += 1;
      });
    });
    const pct = total > 0 ? Math.round((present / total) * 100) : 0;

    const byClass = data.classes.map((c) => {
      const recs = data.attendance.filter((r) => r.classId === c.id);
      let cPres = 0;
      let cTot = 0;
      recs.forEach((r) =>
        r.entries.forEach((e) => {
          cTot += 1;
          if (e.status === 'present' || e.status === 'late') cPres += 1;
        }),
      );
      return {
        name: c.code,
        AttendancePct: cTot > 0 ? Math.round((cPres / cTot) * 100) : 0,
        Students: data.students.filter((s) => s.classId === c.id && s.status === 'active').length,
      };
    });
    return { pct, byClass };
  }, [data.attendance, data.classes, data.students]);

  if (data.loading) return <SkeletonTable rows={5} cols={4} />;

  const needsSetup = Boolean(school && (!school.setupCompleted || data.classes.length === 0));

  return (
    <div className="space-y-6">
      {/* School Code & Post-Approval Setup Strip */}
      {school && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-teal-700">
              {needsSetup ? 'Complete Post-Approval Campus Setup' : 'Active Campus School Code'}
            </p>
            <div className="flex flex-wrap items-center gap-2.5 mt-1">
              <span className="font-mono text-base font-bold text-[#0F295C]">{formatPrincipalCode(school.code)}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(formatPrincipalCode(school.code));
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 1800);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCode ? 'Copied' : 'Copy Principal Code'}
              </button>
              <span className="text-slate-300">·</span>
              <span className="text-xs text-slate-500">
                Prefix <strong className="font-mono text-slate-700">{school.code}</strong> · Role codes for Coordinators, Teachers &amp; Students
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onOpenExcelImport} disabled={!canWrite}>
              <FileSpreadsheet className="w-3.5 h-3.5" /> Import Excel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/principal/access-codes')}>
              <KeyRound className="w-3.5 h-3.5" /> Access Codes
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/principal/join-requests')}>
              <UserPlus className="w-3.5 h-3.5" /> Join Requests
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate('/principal/setup')}>
              <Sparkles className="w-3.5 h-3.5" /> {needsSetup ? 'Launch Setup Wizard' : 'Campus Setup Wizard'}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Students" value={data.students.filter((s) => s.status === 'active').length} tone="blue" subtext="Active enrollment" />
        <StatCard label="Total Teachers" value={data.teachers.filter((t) => t.status === 'active').length} tone="green" subtext="Assigned faculty" />
        <StatCard label="Coordinators" value={coordinatorsCount} tone="yellow" subtext="Scoped academic leads" />
        <StatCard label="Classes & Sections" value={data.classes.length} tone="red" subtext={`${data.rooms.length} campus rooms`} />
        <StatCard label="Attendance Rate" value={`${attendanceSummary.pct}%`} tone="green" subtext={`${data.attendance.length} submitted registers`} />
        <StatCard label="Upcoming Exams" value={data.examinations.filter((e) => e.status === 'scheduled').length} tone="blue" subtext="Scheduled assessments" />
        <StatCard label="Active Homework" value={data.homework.filter((h) => h.status === 'published').length} tone="yellow" subtext={`${data.submissions.length} submissions received`} />
        <StatCard label="Announcements" value={data.announcements.length} tone="red" subtext={`${data.announcements.filter((a) => a.audience === 'principal_flag').length} coordinator flags`} />
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-sm font-bold font-display text-slate-900">Class-Wise Attendance & Enrollment</h3>
          <p className="text-xs text-slate-500 mb-4">Percentage of present/late entries across submitted class registers</p>
          {attendanceSummary.byClass.length === 0 ? (
            <EmptyState title="No classes configured" description="Create your first class and section to view attendance analytics." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attendanceSummary.byClass}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="AttendancePct" name="Attendance %" fill="#2563EB" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-sm font-bold font-display text-slate-900 mb-3">Recent School Notices & Flags</h3>
          {data.announcements.length === 0 ? (
            <p className="text-xs text-slate-500">No announcements published yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.announcements.slice(0, 5).map((a) => (
                <div key={a.id} className="py-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={`font-semibold ${a.audience === 'principal_flag' ? 'text-amber-700' : 'text-teal-700'}`}>
                      {a.audience.replace(/_/g, ' ')}
                    </span>
                    <span className="text-slate-400">{a.authorName}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mt-0.5">{a.title}</p>
                  <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">{a.body}</p>
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
// Coordinator Management (Scope + Explicit Permissions)
// ============================================================================
function PrincipalCoordinatorsView({
  coordinators,
  classes,
  schoolId,
  schoolName,
  schoolCode,
  actor,
  canWrite,
  loading,
}: {
  coordinators: PlatformUser[];
  classes: ReturnType<typeof useSchoolData>['classes'];
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  actor: PlatformUser;
  canWrite: boolean;
  loading: boolean;
}) {
  const { pushToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    email: '',
    phone: '',
    tempPassword: '',
    assignedClassIds: [] as string[],
    perms: {
      canEditAttendance: false,
      canEditMarks: false,
      canAssignTeachers: false,
      canPublishNotices: true,
      canCoordinateExams: true,
    } as CoordinatorPermissions,
  });

  const openNew = () => {
    setEditing(null);
    const firstGradeIds = groupClassesByGrade(classes)[0]?.sections.map((c) => c.id) || [];
    setForm({
      displayName: '',
      username: '',
      email: '',
      phone: '',
      tempPassword: '',
      assignedClassIds: firstGradeIds,
      perms: {
        canEditAttendance: false,
        canEditMarks: false,
        canAssignTeachers: false,
        canPublishNotices: true,
        canCoordinateExams: true,
      },
    });
    setModalOpen(true);
  };

  const openEdit = (u: PlatformUser) => {
    setEditing(u);
    setForm({
      displayName: u.displayName,
      username: u.username,
      email: u.email,
      phone: u.phone || '',
      tempPassword: '',
      assignedClassIds: u.assignedClassIds || [],
      perms: {
        canEditAttendance: Boolean(u.coordinatorPermissions?.canEditAttendance),
        canEditMarks: Boolean(u.coordinatorPermissions?.canEditMarks),
        canAssignTeachers: Boolean(u.coordinatorPermissions?.canAssignTeachers),
        canPublishNotices: u.coordinatorPermissions?.canPublishNotices !== false,
        canCoordinateExams: u.coordinatorPermissions?.canCoordinateExams !== false,
      },
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'users', editing.uid), {
          displayName: form.displayName.trim().slice(0, 120),
          phone: form.phone.trim().slice(0, 32),
          assignedClassIds: form.assignedClassIds,
          coordinatorPermissions: form.perms,
          updatedAt: serverTimestamp(),
        });
        await upsertEmailDirectoryEntry({
          email: editing.email,
          schoolId,
          schoolName,
          role: 'coordinator',
          displayName: form.displayName.trim(),
          assignedClassIds: form.assignedClassIds,
          coordinatorPermissions: form.perms,
          createdBy: actor.uid,
        }).catch(() => undefined);
        await recordAuditLog({
          schoolId,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'UPDATE_COORDINATOR_PERMISSIONS',
          targetType: 'user',
          targetId: editing.uid,
          targetLabel: form.displayName.trim(),
        });
        pushToast('success', 'Coordinator scope and permissions updated.');
      } else {
        const cleanEmail = form.email.trim().toLowerCase();
        const coordCode = formatMemberRoleCode(
          schoolCode,
          'coordinator',
          coordinators.length + 1,
          Math.max(coordinators.length + 1, 10),
        );
        const res = await provisionAuthAccountSecondary(
          cleanEmail,
          form.tempPassword.trim() || `Coord#${Math.random().toString(36).slice(2, 9)}`,
        );
        await setDoc(doc(db, 'users', res.uid), {
          uid: res.uid,
          username: (form.username.trim() || cleanEmail.split('@')[0]).slice(0, 64),
          email: cleanEmail,
          displayName: form.displayName.trim().slice(0, 120),
          role: 'coordinator',
          schoolId,
          status: 'active',
          mustChangePassword: true,
          phone: form.phone.trim().slice(0, 32),
          accessCode: coordCode,
          classId: '',
          section: '',
          assignedClassIds: form.assignedClassIds,
          assignedSubjectIds: [],
          coordinatorPermissions: form.perms,
          isDemo: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await upsertEmailDirectoryEntry({
          email: cleanEmail,
          schoolId,
          schoolName,
          role: 'coordinator',
          displayName: form.displayName.trim(),
          accessCode: coordCode,
          assignedClassIds: form.assignedClassIds,
          coordinatorPermissions: form.perms,
          createdBy: actor.uid,
        }).catch(() => undefined);
        await upsertMemberAccessCode({
          code: coordCode,
          schoolId,
          schoolCode,
          schoolName,
          role: 'coordinator',
          memberName: form.displayName.trim(),
          email: cleanEmail,
          status: 'active',
          linkedUid: res.uid,
          createdBy: actor.uid,
        }).catch(() => undefined);
        await recordAuditLog({
          schoolId,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'CREATE_COORDINATOR',
          targetType: 'user',
          targetId: res.uid,
          targetLabel: `${cleanEmail} (${coordCode})`,
        }).catch(() => undefined);
        pushToast('success', `Coordinator ${form.displayName.trim()} created with Code ${coordCode}. ${res.warning || ''}`);
      }
      setModalOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to save coordinator.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonTable rows={4} cols={5} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-slate-500">
          Coordinators only see assigned classes. Edit rights for attendance, marks, or teacher allocation must be explicitly granted.
        </p>
        <Button variant="primary" size="sm" onClick={openNew} disabled={!canWrite}>
          <Plus className="w-4 h-4" />
          Add Coordinator
        </Button>
      </div>

      {coordinators.length === 0 ? (
        <EmptyState
          title="No coordinators assigned"
          description="Create an academic coordinator to supervise attendance, exams, and homework for specific grades."
          actionLabel="Add Coordinator"
          onAction={openNew}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">Coordinator</th>
                <th className="py-3 px-4 font-semibold">Assigned Classes</th>
                <th className="py-3 px-4 font-semibold">Granted Permissions</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coordinators.map((c) => {
                const assignedCls = classes.filter((cl) => (c.assignedClassIds || []).includes(cl.id));
                const classSummary = formatGradeSummaryCompact(assignedCls, classes);
                const granted = Object.entries(c.coordinatorPermissions || {})
                  .filter(([, v]) => Boolean(v))
                  .map(([k]) => k.replace(/^can/, ''));
                return (
                  <tr key={c.uid} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">
                        {c.displayName}{' '}
                        {c.accessCode && (
                          <span className="ml-1.5 font-mono text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">
                            {c.accessCode}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">{c.email} · @{c.username}</p>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-700 max-w-xs">{classSummary}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">{granted.join(' · ') || 'Read-Only'}</td>
                    <td className="py-3 px-4"><StatusText status={c.status} /></td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => openEdit(c)} disabled={!canWrite}>
                          Permissions
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canWrite}
                          onClick={async () => {
                            const nextStatus = c.status === 'active' ? 'inactive' : 'active';
                            await updateDoc(doc(db, 'users', c.uid), { status: nextStatus, updatedAt: serverTimestamp() });
                            pushToast('success', `Coordinator ${nextStatus}.`);
                          }}
                        >
                          {c.status === 'active' ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Configure ${editing.displayName}` : 'Add Academic Coordinator'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
              <input type="text" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone (Numbers only)</label>
              <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={15} value={form.phone} onChange={(e) => setForm({ ...form, phone: sanitizePhoneDigits(e.target.value) })} placeholder="9876543210" className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 rounded-lg" />
            </div>
          </div>
          {!editing && (
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Username *</label>
                <input type="text" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email *</label>
                <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Temp Password</label>
                <input type="password" value={form.tempPassword} onChange={(e) => setForm({ ...form, tempPassword: e.target.value })} placeholder="Auto-generated if blank" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
              </div>
            </div>
          )}

          <CoordinatorGradeOnlyPicker
            classes={classes}
            selectedClassIds={form.assignedClassIds}
            onChange={(nextIds) => setForm({ ...form, assignedClassIds: nextIds })}
            label="Assigned Classes (Whole Grades)"
            helperText="Coordinators supervise whole grades. Selecting a class automatically includes every section in that grade."
          />

          <div className="pt-3 border-t border-slate-200 space-y-2">
            <p className="text-xs font-semibold text-slate-700">Explicit Permission Grants</p>
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
                  checked={form.perms[key]}
                  onChange={(e) => setForm({ ...form, perms: { ...form.perms, [key]: e.target.checked } })}
                  className="rounded border-slate-300 text-teal-600"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save Coordinator'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// Teacher Management
// ============================================================================
function PrincipalTeachersView({
  teachers,
  classes,
  subjects,
  schoolId,
  schoolCode,
  schoolName,
  actor,
  canWrite,
  globalSearch,
  loading,
  onOpenExcelImport,
}: {
  teachers: TeacherProfile[];
  classes: ReturnType<typeof useSchoolData>['classes'];
  subjects: Subject[];
  schoolId: string;
  schoolCode: string;
  schoolName: string;
  actor: PlatformUser;
  canWrite: boolean;
  globalSearch: string;
  loading: boolean;
  onOpenExcelImport?: () => void;
}) {
  const { pushToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TeacherProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    staffId: '',
    name: '',
    email: '',
    phone: '',
    subjectsCsv: '',
    qualifications: '',
    joiningDate: new Date().toISOString().slice(0, 10),
    assignedClassIds: [] as string[],
    classTeacherOfClassId: '',
    status: 'active' as TeacherProfile['status'],
    tempPassword: '',
  });

  const filtered = teachers.filter((t) => {
    const q = globalSearch.trim().toLowerCase();
    return !q || `${t.name} ${t.staffId} ${t.email} ${(t.subjects || []).join(' ')}`.toLowerCase().includes(q);
  });

  const computeNextTeacherCode = () => {
    const used = new Set(
      teachers.flatMap((t) => [t.staffId, t.accessCode || '']).map((v) => v.trim().toUpperCase()).filter(Boolean),
    );
    let seq = teachers.length + 1;
    let candidate = formatMemberRoleCode(schoolCode, 'teacher', seq, Math.max(seq, 10));
    while (used.has(candidate.toUpperCase()) && seq < teachers.length + 500) {
      seq += 1;
      candidate = formatMemberRoleCode(schoolCode, 'teacher', seq, Math.max(seq, 10));
    }
    return candidate;
  };

  const openNew = () => {
    setEditing(null);
    setSelectedSubjectIds([]);
    setForm({
      staffId: computeNextTeacherCode(),
      name: '',
      email: '',
      phone: '',
      subjectsCsv: '',
      qualifications: '',
      joiningDate: new Date().toISOString().slice(0, 10),
      assignedClassIds: [],
      classTeacherOfClassId: '',
      status: 'active',
      tempPassword: '',
    });
    setModalOpen(true);
  };

  const openEdit = (t: TeacherProfile) => {
    setEditing(t);
    const mappedSubjectIds = subjects.filter((s) => s.teacherId === t.id).map((s) => s.id);
    setSelectedSubjectIds(mappedSubjectIds);
    setForm({
      staffId: t.staffId,
      name: t.name,
      email: t.email,
      phone: t.phone || '',
      subjectsCsv: (t.subjects || []).join(', '),
      qualifications: t.qualifications || '',
      joiningDate: t.joiningDate || '',
      assignedClassIds: t.assignedClassIds || [],
      classTeacherOfClassId: t.classTeacherOfClassId || '',
      status: t.status,
      tempPassword: '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    try {
      const cleanName = form.name.trim().slice(0, 120);
      const selectedSubjectsObjs = subjects.filter((s) => selectedSubjectIds.includes(s.id));
      const manualSubjects = form.subjectsCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const subjectsList = Array.from(
        new Set([...selectedSubjectsObjs.map((s) => s.name), ...manualSubjects]),
      ).slice(0, 20);
      const finalAssignedClassIds = Array.from(
        new Set([
          ...form.assignedClassIds,
          ...selectedSubjectsObjs.map((s) => s.classId),
          ...(form.classTeacherOfClassId ? [form.classTeacherOfClassId] : []),
        ]),
      ).filter(Boolean);

      if (editing) {
        const immutableStaffId = editing.staffId || form.staffId.trim().slice(0, 32);
        await updateDoc(doc(db, 'teachers', editing.id), {
          staffId: immutableStaffId,
          name: cleanName,
          email: form.email.trim().toLowerCase().slice(0, 160),
          phone: form.phone.trim().slice(0, 32),
          subjects: subjectsList,
          qualifications: form.qualifications.trim().slice(0, 160),
          joiningDate: form.joiningDate.slice(0, 32),
          assignedClassIds: finalAssignedClassIds,
          classTeacherOfClassId: form.classTeacherOfClassId,
          status: form.status,
          updatedAt: serverTimestamp(),
        });

        // Sync subject-level assignments in Firestore
        const previouslyAssignedSubIds = new Set(
          subjects.filter((s) => s.teacherId === editing.id).map((s) => s.id),
        );
        const nextSubSet = new Set(selectedSubjectIds);
        for (const subId of selectedSubjectIds) {
          const existingSub = subjects.find((s) => s.id === subId);
          if (existingSub && (existingSub.teacherId !== editing.id || existingSub.teacherName !== cleanName)) {
            await updateDoc(doc(db, 'subjects', subId), {
              teacherId: editing.id,
              teacherName: cleanName,
              updatedAt: serverTimestamp(),
            }).catch(() => undefined);
          }
        }
        for (const prevSubId of previouslyAssignedSubIds) {
          if (!nextSubSet.has(prevSubId)) {
            await updateDoc(doc(db, 'subjects', prevSubId), {
              teacherId: '',
              teacherName: '',
              updatedAt: serverTimestamp(),
            }).catch(() => undefined);
          }
        }

        if (editing.classTeacherOfClassId && editing.classTeacherOfClassId !== form.classTeacherOfClassId) {
          await updateDoc(doc(db, 'classes', editing.classTeacherOfClassId), {
            classTeacherId: '',
            classTeacherName: '',
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
        }
        if (form.classTeacherOfClassId) {
          await updateDoc(doc(db, 'classes', form.classTeacherOfClassId), {
            classTeacherId: editing.id,
            classTeacherName: cleanName,
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
        }
        if (editing.userId) {
          const primaryCls =
            classes.find((c) => c.id === form.classTeacherOfClassId) ||
            classes.find((c) => finalAssignedClassIds.includes(c.id));
          await updateDoc(doc(db, 'users', editing.userId), {
            displayName: cleanName,
            classId: primaryCls?.id || '',
            section: primaryCls?.section || '',
            assignedClassIds: finalAssignedClassIds,
            assignedSubjectIds: selectedSubjectIds.slice(0, 50),
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
        }
        await upsertEmailDirectoryEntry({
          email: form.email.trim().toLowerCase(),
          schoolId,
          schoolName,
          role: 'teacher',
          displayName: cleanName,
          linkedProfileId: editing.id,
          assignedClassIds: finalAssignedClassIds,
          createdBy: actor.uid,
        }).catch(() => undefined);
        pushToast('success', `Updated ${cleanName}.`);
      } else {
        const id = generateId('tch');
        const cleanEmail = form.email.trim().toLowerCase();
        const teacherCode = (form.staffId.trim() || computeNextTeacherCode()).slice(0, 32);
        const primaryCls =
          classes.find((c) => c.id === form.classTeacherOfClassId) ||
          classes.find((c) => finalAssignedClassIds.includes(c.id));
        const prov = await provisionAuthAccountSecondary(
          cleanEmail,
          form.tempPassword.trim() || `Teach#${Math.random().toString(36).slice(2, 9)}`,
        );
        await setDoc(doc(db, 'users', prov.uid), {
          uid: prov.uid,
          username: cleanEmail.split('@')[0].slice(0, 64),
          email: cleanEmail,
          displayName: cleanName,
          role: 'teacher',
          schoolId,
          status: 'active',
          mustChangePassword: true,
          phone: form.phone.trim().slice(0, 32),
          accessCode: teacherCode,
          classId: primaryCls?.id || '',
          section: primaryCls?.section || '',
          assignedClassIds: finalAssignedClassIds,
          assignedSubjectIds: selectedSubjectIds.slice(0, 50),
          coordinatorPermissions: {},
          isDemo: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'teachers', id), {
          id,
          schoolId,
          userId: prov.uid,
          staffId: teacherCode,
          name: cleanName,
          email: cleanEmail,
          phone: form.phone.trim().slice(0, 32),
          subjects: subjectsList,
          qualifications: form.qualifications.trim().slice(0, 160),
          joiningDate: form.joiningDate.slice(0, 32),
          assignedClassIds: finalAssignedClassIds,
          classTeacherOfClassId: form.classTeacherOfClassId,
          accessCode: teacherCode,
          status: form.status,
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        for (const subId of selectedSubjectIds) {
          await updateDoc(doc(db, 'subjects', subId), {
            teacherId: id,
            teacherName: cleanName,
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
        }
        await upsertEmailDirectoryEntry({
          email: cleanEmail,
          schoolId,
          schoolName,
          role: 'teacher',
          displayName: cleanName,
          accessCode: teacherCode,
          linkedProfileId: id,
          assignedClassIds: finalAssignedClassIds,
          createdBy: actor.uid,
        }).catch(() => undefined);
        await upsertMemberAccessCode({
          code: teacherCode,
          schoolId,
          schoolCode,
          schoolName,
          role: 'teacher',
          memberName: cleanName,
          email: cleanEmail,
          classId: primaryCls?.id || '',
          classCode: primaryCls?.code || '',
          className: primaryCls?.name || '',
          teacherId: id,
          teacherCode,
          teacherName: cleanName,
          status: 'active',
          linkedProfileId: id,
          linkedUid: prov.uid,
          createdBy: actor.uid,
        }).catch(() => undefined);
        if (form.classTeacherOfClassId) {
          await updateDoc(doc(db, 'classes', form.classTeacherOfClassId), {
            classTeacherId: id,
            classTeacherName: cleanName,
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
        }
        await updateDoc(doc(db, 'schools', schoolId), {
          teacherCount: teachers.length + 1,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
        await recordAuditLog({
          schoolId,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'CREATE_TEACHER',
          targetType: 'teacher',
          targetId: id,
          targetLabel: `${cleanName} (${teacherCode})`,
        }).catch(() => undefined);
        pushToast('success', `Teacher ${cleanName} added with Code ${teacherCode}. ${prov.warning || ''}`);
      }
      setModalOpen(false);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to save teacher.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonTable rows={5} cols={6} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-slate-500">Manage faculty profiles, subject assignments, class-teacher duties, and secure login resets.</p>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenExcelImport && (
            <Button variant="secondary" size="sm" onClick={onOpenExcelImport} disabled={!canWrite}>
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Import Excel
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={openNew} disabled={!canWrite}>
            <Plus className="w-4 h-4" />
            Add Teacher
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No teachers found" description="Add faculty profiles to assign classes, subjects, and timetables." actionLabel="Add Teacher" onAction={openNew} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">Staff ID &amp; Name</th>
                <th className="py-3 px-4 font-semibold">Subjects</th>
                <th className="py-3 px-4 font-semibold">Assigned Classes</th>
                <th className="py-3 px-4 font-semibold">Joining Date</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((t) => {
                const teacherSubjects = subjects.filter((s) => s.teacherId === t.id);
                const subjectSummary = Array.from(
                  new Set([...teacherSubjects.map((s) => s.name), ...(t.subjects || [])]),
                );
                const assignedIds = new Set([
                  ...(t.assignedClassIds || []),
                  ...teacherSubjects.map((s) => s.classId),
                  ...(t.classTeacherOfClassId ? [t.classTeacherOfClassId] : []),
                ]);
                return (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{t.name}</p>
                      <p className="text-xs text-slate-500 font-mono">{t.staffId} · {t.email}</p>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">{subjectSummary.join(', ') || '—'}</td>
                    <td className="py-3 px-4 text-xs text-slate-700 max-w-xs">
                      <p className="font-medium">
                        {formatGradeSummaryCompact(
                          classes.filter((c) => assignedIds.has(c.id)),
                          classes,
                        )}
                      </p>
                      {t.classTeacherOfClassId && (
                        <p className="text-[11px] text-teal-700 mt-0.5">
                          Class Teacher: {classes.find((c) => c.id === t.classTeacherOfClassId)?.name || t.classTeacherOfClassId}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 tabular-nums">{t.joiningDate || '—'}</td>
                    <td className="py-3 px-4"><StatusText status={t.status} /></td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => openEdit(t)} disabled={!canWrite}>Edit</Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            await sendPasswordResetEmail(auth, t.email).catch(() => undefined);
                            pushToast('success', `Password reset link sent to ${t.email}.`);
                          }}
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.name}` : 'Add Teacher Profile'} maxWidth="max-w-2xl">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1">
                <span>Staff ID *</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              </label>
              <input
                type="text"
                readOnly
                value={form.staffId}
                title="Staff ID is system-assigned and cannot be modified."
                className="w-full px-3 py-2 text-sm font-mono bg-slate-100 text-slate-600 border border-slate-200 rounded-lg cursor-not-allowed select-all"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
              <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email *</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone (Numbers only)</label>
              <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={15} value={form.phone} onChange={(e) => setForm({ ...form, phone: sanitizePhoneDigits(e.target.value) })} placeholder="9876543210" className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subject Specialties</label>
              <input type="text" value={form.subjectsCsv} onChange={(e) => setForm({ ...form, subjectsCsv: e.target.value })} placeholder="Mathematics, Physics" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Qualifications</label>
              <input type="text" value={form.qualifications} onChange={(e) => setForm({ ...form, qualifications: e.target.value })} placeholder="M.Sc., B.Ed." className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TeacherProfile['status'] })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="active">Active</option>
                <option value="on_leave">On Leave</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Class Teacher Of <span className="font-normal text-slate-400">(Optional — links this teacher&apos;s code to student login packs)</span>
            </label>
            <select
              value={form.classTeacherOfClassId}
              onChange={(e) => {
                const nextClassId = e.target.value;
                const nextAssigned =
                  nextClassId && !form.assignedClassIds.includes(nextClassId)
                    ? [...form.assignedClassIds, nextClassId]
                    : form.assignedClassIds;
                setForm({ ...form, classTeacherOfClassId: nextClassId, assignedClassIds: nextAssigned });
              }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-teal-600"
            >
              <option value="">None (Subject Teacher Only)</option>
              {groupClassesByGrade(classes).map((grp) => (
                <optgroup key={grp.gradeLevel} label={grp.gradeLevel}>
                  {grp.sections.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.name} ({cl.code})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <TeacherSubjectClassPicker
            classes={classes}
            subjects={subjects}
            editingTeacherId={editing?.id}
            selectedSubjectIds={selectedSubjectIds}
            onChangeSubjectIds={setSelectedSubjectIds}
            selectedClassIds={form.assignedClassIds}
            onChangeClassIds={(nextIds) => setForm({ ...form, assignedClassIds: nextIds })}
          />
          {!editing && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Temporary Password (optional)</label>
              <input type="password" value={form.tempPassword} onChange={(e) => setForm({ ...form, tempPassword: e.target.value })} placeholder="Auto-generated if left blank" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save Teacher'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
