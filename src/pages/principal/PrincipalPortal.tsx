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
import { upsertEmailDirectoryEntry } from '../../lib/schoolProvisioning';
import {
  PrincipalSetupWizardView,
  PrincipalJoinRequestsView,
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
import type { CoordinatorPermissions, PlatformUser, School, TeacherProfile } from '../../types/models';

const PRINCIPAL_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/principal/dashboard', icon: LayoutDashboard },
  { id: 'setup', label: 'Campus Setup Wizard', path: '/principal/setup', icon: Sparkles },
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
  const { activeUser, activeSchool } = useAuth();
  const schoolId = activeUser?.schoolId || '';
  const data = useSchoolData(schoolId, true);
  const access = getSchoolAccessMode(activeSchool);
  const [globalSearch, setGlobalSearch] = useState('');

  if (!activeUser) return null;

  return (
    <DashboardShell
      title={activeSchool?.name || 'School Administration'}
      breadcrumb={`AcademiaOne / Principal / ${activeSchool?.code || schoolId}`}
      navItems={PRINCIPAL_NAV}
      onGlobalSearch={setGlobalSearch}
      globalSearchPlaceholder="Search students, teachers, classes…"
    >
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<PrincipalOverview school={activeSchool} data={data} />} />
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
          path="join-requests"
          element={
            <PrincipalJoinRequestsView
              school={activeSchool}
              classes={data.classes}
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
              schoolId={schoolId}
              schoolName={activeSchool?.name || ''}
              actor={activeUser}
              canWrite={access.canWrite}
              globalSearch={globalSearch}
              loading={data.loading}
            />
          }
        />
        <Route
          path="students"
          element={
            <PrincipalStudentsView
              students={data.students}
              classes={data.classes}
              schoolId={schoolId}
              academicYear={activeSchool?.academicYear || '2026-2027'}
              actor={activeUser}
              canWrite={access.canWrite}
              globalSearch={globalSearch}
              loading={data.loading}
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
              academicYear={activeSchool?.academicYear || '2026-2027'}
              actor={activeUser}
              canWrite={access.canWrite}
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
        <Route path="notifications" element={<NotificationsAndPreferencesView />} />
        <Route path="profile" element={<ProfileSecurityView />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardShell>
  );
}

// ============================================================================
// Principal Overview
// ============================================================================
function PrincipalOverview({
  school,
  data,
}: {
  school: School | null;
  data: ReturnType<typeof useSchoolData>;
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
              <span className="font-mono text-base font-bold text-[#0B1528]">{school.code}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(school.code);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 1800);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCode ? 'Copied' : 'Copy Code'}
              </button>
              <span className="text-slate-300">·</span>
              <span className="text-xs text-slate-500">
                Share with staff & students to request access via /join-school
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
        <StatCard label="Total Students" value={data.students.filter((s) => s.status === 'active').length} subtext="Active enrollment" />
        <StatCard label="Total Teachers" value={data.teachers.filter((t) => t.status === 'active').length} subtext="Assigned faculty" />
        <StatCard label="Coordinators" value={coordinatorsCount} subtext="Scoped academic leads" />
        <StatCard label="Classes & Sections" value={data.classes.length} subtext={`${data.rooms.length} campus rooms`} />
        <StatCard label="Attendance Rate" value={`${attendanceSummary.pct}%`} tone="teal" subtext={`${data.attendance.length} submitted registers`} />
        <StatCard label="Upcoming Exams" value={data.examinations.filter((e) => e.status === 'scheduled').length} subtext="Scheduled assessments" />
        <StatCard label="Active Homework" value={data.homework.filter((h) => h.status === 'published').length} subtext={`${data.submissions.length} submissions received`} />
        <StatCard label="Announcements" value={data.announcements.length} subtext={`${data.announcements.filter((a) => a.audience === 'principal_flag').length} coordinator flags`} />
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
                  <Bar dataKey="AttendancePct" name="Attendance %" fill="#0D9488" radius={[4, 4, 0, 0]} />
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
  actor,
  canWrite,
  loading,
}: {
  coordinators: PlatformUser[];
  classes: ReturnType<typeof useSchoolData>['classes'];
  schoolId: string;
  schoolName: string;
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
    setForm({
      displayName: '',
      username: '',
      email: '',
      phone: '',
      tempPassword: '',
      assignedClassIds: classes.slice(0, 2).map((c) => c.id),
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
          assignedClassIds: form.assignedClassIds,
          coordinatorPermissions: form.perms,
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
          targetLabel: cleanEmail,
        });
        pushToast('success', `Coordinator created & registered for Email/Google login. ${res.warning || ''}`);
      }
      setModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'users');
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
                const classNames = (c.assignedClassIds || [])
                  .map((id) => classes.find((cl) => cl.id === id)?.code || id)
                  .join(', ');
                const granted = Object.entries(c.coordinatorPermissions || {})
                  .filter(([, v]) => Boolean(v))
                  .map(([k]) => k.replace(/^can/, ''));
                return (
                  <tr key={c.uid} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{c.displayName}</p>
                      <p className="text-xs text-slate-500">{c.email} · @{c.username}</p>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-700">{classNames || 'None'}</td>
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
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
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

          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">Assigned Classes Scope</p>
            <div className="flex flex-wrap gap-2">
              {classes.map((cl) => {
                const selected = form.assignedClassIds.includes(cl.id);
                return (
                  <button
                    key={cl.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        assignedClassIds: selected
                          ? form.assignedClassIds.filter((x) => x !== cl.id)
                          : [...form.assignedClassIds, cl.id],
                      })
                    }
                    className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer ${
                      selected ? 'bg-[#0B1528] text-white border-[#0B1528]' : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {cl.code} · {cl.name}
                  </button>
                );
              })}
            </div>
          </div>

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
  schoolId,
  schoolName,
  actor,
  canWrite,
  globalSearch,
  loading,
}: {
  teachers: TeacherProfile[];
  classes: ReturnType<typeof useSchoolData>['classes'];
  schoolId: string;
  schoolName: string;
  actor: PlatformUser;
  canWrite: boolean;
  globalSearch: string;
  loading: boolean;
}) {
  const { pushToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TeacherProfile | null>(null);
  const [saving, setSaving] = useState(false);
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

  const openNew = () => {
    setEditing(null);
    setForm({
      staffId: `STF-${Math.floor(100 + Math.random() * 900)}`,
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
      const subjectsList = form.subjectsCsv.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
      if (editing) {
        await updateDoc(doc(db, 'teachers', editing.id), {
          staffId: form.staffId.trim().slice(0, 32),
          name: form.name.trim().slice(0, 120),
          email: form.email.trim().toLowerCase().slice(0, 160),
          phone: form.phone.trim().slice(0, 32),
          subjects: subjectsList,
          qualifications: form.qualifications.trim().slice(0, 160),
          joiningDate: form.joiningDate.slice(0, 32),
          assignedClassIds: form.assignedClassIds,
          classTeacherOfClassId: form.classTeacherOfClassId,
          status: form.status,
          updatedAt: serverTimestamp(),
        });
        await upsertEmailDirectoryEntry({
          email: form.email.trim().toLowerCase(),
          schoolId,
          schoolName,
          role: 'teacher',
          displayName: form.name.trim(),
          linkedProfileId: editing.id,
          assignedClassIds: form.assignedClassIds,
          createdBy: actor.uid,
        }).catch(() => undefined);
        pushToast('success', `Updated ${form.name.trim()}.`);
      } else {
        const id = generateId('tch');
        const cleanEmail = form.email.trim().toLowerCase();
        const prov = await provisionAuthAccountSecondary(
          cleanEmail,
          form.tempPassword.trim() || `Teach#${Math.random().toString(36).slice(2, 9)}`,
        );
        await setDoc(doc(db, 'users', prov.uid), {
          uid: prov.uid,
          username: cleanEmail.split('@')[0].slice(0, 64),
          email: cleanEmail,
          displayName: form.name.trim().slice(0, 120),
          role: 'teacher',
          schoolId,
          status: 'active',
          mustChangePassword: true,
          phone: form.phone.trim().slice(0, 32),
          classId: '',
          section: '',
          assignedClassIds: form.assignedClassIds,
          assignedSubjectIds: [],
          coordinatorPermissions: {},
          isDemo: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'teachers', id), {
          id,
          schoolId,
          userId: prov.uid,
          staffId: form.staffId.trim().slice(0, 32),
          name: form.name.trim().slice(0, 120),
          email: cleanEmail,
          phone: form.phone.trim().slice(0, 32),
          subjects: subjectsList,
          qualifications: form.qualifications.trim().slice(0, 160),
          joiningDate: form.joiningDate.slice(0, 32),
          assignedClassIds: form.assignedClassIds,
          classTeacherOfClassId: form.classTeacherOfClassId,
          status: form.status,
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await upsertEmailDirectoryEntry({
          email: cleanEmail,
          schoolId,
          schoolName,
          role: 'teacher',
          displayName: form.name.trim(),
          linkedProfileId: id,
          assignedClassIds: form.assignedClassIds,
          createdBy: actor.uid,
        }).catch(() => undefined);
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
          targetLabel: form.name.trim(),
        });
        pushToast('success', `Teacher added & registered for Email/Google login. ${prov.warning || ''}`);
      }
      setModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'teachers');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonTable rows={5} cols={6} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-slate-500">Manage faculty profiles, subject assignments, class-teacher duties, and secure login resets.</p>
        <Button variant="primary" size="sm" onClick={openNew} disabled={!canWrite}>
          <Plus className="w-4 h-4" />
          Add Teacher
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No teachers found" description="Add faculty profiles to assign classes, subjects, and timetables." actionLabel="Add Teacher" onAction={openNew} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">Staff ID & Name</th>
                <th className="py-3 px-4 font-semibold">Subjects</th>
                <th className="py-3 px-4 font-semibold">Assigned Classes</th>
                <th className="py-3 px-4 font-semibold">Joining Date</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-900">{t.name}</p>
                    <p className="text-xs text-slate-500 font-mono">{t.staffId} · {t.email}</p>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">{(t.subjects || []).join(', ') || '—'}</td>
                  <td className="py-3 px-4 text-xs font-mono text-slate-600">
                    {(t.assignedClassIds || []).map((id) => classes.find((c) => c.id === id)?.code || id).join(', ') || 'Unassigned'}
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.name}` : 'Add Teacher Profile'} maxWidth="max-w-2xl">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Staff ID *</label>
              <input type="text" required value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })} className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
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
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subjects (comma-separated)</label>
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
            <p className="text-xs font-medium text-slate-700 mb-1.5">Assigned Classes</p>
            <div className="flex flex-wrap gap-2">
              {classes.map((cl) => {
                const sel = form.assignedClassIds.includes(cl.id);
                return (
                  <button
                    key={cl.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        assignedClassIds: sel ? form.assignedClassIds.filter((x) => x !== cl.id) : [...form.assignedClassIds, cl.id],
                      })
                    }
                    className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer ${sel ? 'bg-[#0B1528] text-white border-[#0B1528]' : 'bg-white text-slate-700 border-slate-300'}`}
                  >
                    {cl.code}
                  </button>
                );
              })}
            </div>
          </div>
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
