import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  ClipboardCheck,
  BarChart3,
  Users,
  Bell,
  FileClock,
  UserCircle2,
  Plus,
  RefreshCw,
  Eye,
  KeyRound,
  Trash2,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  auth,
  db,
  generateId,
  handleFirestoreError,
  OperationType,
  provisionAuthAccountSecondary,
  formatFirestoreDateTime,
} from '../../lib/firebase';
import { DEMO_ACCOUNTS, seedDemoEcosystem } from '../../lib/demoSeed';
import { recordAuditLog } from '../../lib/audit';
import { sanitizePhoneDigits } from '../../lib/schoolCodes';
import { ROLE_HOME_ROUTES, ROLE_LABELS } from '../../lib/permissions';
import { useAuth } from '../../contexts/AuthContext';
import { DashboardShell, type NavItem } from '../../components/DashboardShell';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  PaginationBar,
  SkeletonTable,
  StatCard,
  StatusText,
  useToast,
} from '../../components/ui/Primitives';
import { NotificationsAndPreferencesView } from '../../components/shared/NotificationsAndPreferencesView';
import { ProfileSecurityView } from '../../components/shared/ProfileSecurityView';
import { provisionSchoolTenant } from '../../lib/schoolProvisioning';
import { MainHeadApplicationsView } from './MainHeadApplicationsView';
import {
  MainHeadAnalyticsView,
  MainHeadAuditLogsView,
} from './MainHeadSubViews';
import type {
  School,
  SchoolApplication,
  SchoolEnquiry,
  PlatformUser,
  AuditLog,
  UserRole,
} from '../../types/models';

const MAIN_HEAD_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/main-head/dashboard', icon: LayoutDashboard },
  { id: 'applications', label: 'Applications', path: '/main-head/applications', icon: ClipboardCheck },
  { id: 'schools', label: 'Schools', path: '/main-head/schools', icon: Building2 },
  { id: 'analytics', label: 'Analytics', path: '/main-head/analytics', icon: BarChart3 },
  { id: 'users', label: 'Platform Users', path: '/main-head/users', icon: Users },
  { id: 'notifications', label: 'Notifications', path: '/main-head/notifications', icon: Bell },
  { id: 'audit', label: 'Audit Logs', path: '/main-head/audit-logs', icon: FileClock },
  { id: 'profile', label: 'Profile', path: '/main-head/profile', icon: UserCircle2 },
];

export default function MainHeadPortal() {
  const { activeUser, enterDemoPreview } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [schools, setSchools] = useState<School[]>([]);
  const [applications, setApplications] = useState<SchoolApplication[]>([]);
  const [enquiries, setEnquiries] = useState<SchoolEnquiry[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState('');
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    let settled = 0;
    const done = () => {
      settled += 1;
      if (settled >= 4) setLoading(false);
    };
    const u1 = onSnapshot(collection(db, 'schools'), (s) => { setSchools(s.docs.map((d) => d.data() as School)); done(); }, () => done());
    const u4 = onSnapshot(collection(db, 'schoolEnquiries'), (s) => { setEnquiries(s.docs.map((d) => d.data() as SchoolEnquiry)); done(); }, () => done());
    const u5 = onSnapshot(collection(db, 'users'), (s) => { setUsers(s.docs.map((d) => d.data() as PlatformUser)); done(); }, () => done());
    const u6 = onSnapshot(collection(db, 'auditLogs'), (s) => {
      const logs = s.docs.map((d) => d.data() as AuditLog);
      logs.sort((a, b) => ((b.createdAt as { seconds?: number })?.seconds || 0) - ((a.createdAt as { seconds?: number })?.seconds || 0));
      setAuditLogs(logs);
      done();
    }, () => done());
    const u7 = onSnapshot(collection(db, 'schoolApplications'), (s) => {
      setApplications(s.docs.map((d) => d.data() as SchoolApplication));
    }, () => undefined);
    return () => { u1(); u4(); u5(); u6(); u7(); };
  }, []);

  const handleSeedDemo = async () => {
    if (!activeUser) return;
    setSeeding(true);
    try {
      await seedDemoEcosystem(activeUser.uid, activeUser.displayName);
      pushToast('success', 'Seeded 2 isolated demo schools (Northridge & Crestview) with full academic records.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to seed demo data.');
    } finally {
      setSeeding(false);
    }
  };

  const handlePreviewDemoRole = (demoUid: string) => {
    const found = users.find((u) => u.uid === demoUid);
    const fallback = DEMO_ACCOUNTS.find((a) => a.uid === demoUid);
    const persona: PlatformUser | null =
      found ||
      (fallback
        ? {
            uid: fallback.uid,
            username: fallback.username,
            email: fallback.email,
            displayName: fallback.displayName,
            role: fallback.role,
            schoolId: fallback.schoolId,
            status: 'active',
            mustChangePassword: false,
            classId: 'classId' in fallback ? fallback.classId : '',
            section: 'section' in fallback ? fallback.section : '',
            assignedClassIds: 'assignedClassIds' in fallback ? fallback.assignedClassIds : [],
            assignedSubjectIds: 'assignedSubjectIds' in fallback ? fallback.assignedSubjectIds : [],
            isDemo: true,
          }
        : null);
    if (!persona) return;
    enterDemoPreview(persona);
    navigate(ROLE_HOME_ROUTES[persona.role]);
  };

  return (
    <DashboardShell
      title="Platform Owner Console"
      breadcrumb="AcademiaOne / Main Head"
      navItems={MAIN_HEAD_NAV}
      onGlobalSearch={setGlobalSearch}
      globalSearchPlaceholder="Search schools, applications, users…"
    >
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route
          path="dashboard"
          element={
            <MainHeadOverview
              schools={schools}
              applications={applications}
              auditLogs={auditLogs}
              enquiries={enquiries}
              loading={loading}
              seeding={seeding}
              onSeedDemo={handleSeedDemo}
              onPreviewRole={handlePreviewDemoRole}
            />
          }
        />
        <Route
          path="applications"
          element={
            <MainHeadApplicationsView
              applications={applications}
              globalSearch={globalSearch}
              loading={loading}
              actor={activeUser!}
            />
          }
        />
        <Route
          path="schools"
          element={
            <MainHeadSchoolsView
              schools={schools}
              enquiries={enquiries}
              globalSearch={globalSearch}
              loading={loading}
              actor={activeUser!}
            />
          }
        />
        <Route
          path="analytics"
          element={<MainHeadAnalyticsView schools={schools} />}
        />
        <Route
          path="users"
          element={
            <MainHeadUsersView
              users={users}
              schools={schools}
              globalSearch={globalSearch}
              loading={loading}
              actor={activeUser!}
            />
          }
        />
        <Route path="notifications" element={<NotificationsAndPreferencesView />} />
        <Route path="audit-logs" element={<MainHeadAuditLogsView auditLogs={auditLogs} />} />
        <Route path="profile" element={<ProfileSecurityView />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </DashboardShell>
  );
}

// ============================================================================
// Overview Page
// ============================================================================
function MainHeadOverview({
  schools,
  applications,
  auditLogs,
  enquiries,
  loading,
  seeding,
  onSeedDemo,
  onPreviewRole,
}: {
  schools: School[];
  applications: SchoolApplication[];
  auditLogs: AuditLog[];
  enquiries: SchoolEnquiry[];
  loading: boolean;
  seeding: boolean;
  onSeedDemo: () => void;
  onPreviewRole: (uid: string) => void;
}) {
  const navigate = useNavigate();
  const pendingApps = applications.filter((a) => a.status === 'submitted' || a.status === 'under_review' || a.status === 'more_info_required');

  const metrics = useMemo(() => {
    const active = schools.filter((s) => s.status === 'active' || s.status === 'trial').length;
    const suspended = schools.filter((s) => s.status === 'suspended').length;
    const teachers = schools.reduce((acc, s) => acc + (s.teacherCount || 0), 0);
    const students = schools.reduce((acc, s) => acc + (s.studentCount || 0), 0);
    return { active, suspended, teachers, students };
  }, [schools]);

  const chartData = schools.map((s) => ({
    name: s.code || s.name.slice(0, 10),
    Teachers: s.teacherCount || 0,
    Students: s.studentCount || 0,
  }));

  if (loading) return <SkeletonTable rows={6} cols={4} />;

  return (
    <div className="space-y-6">
      {/* Pending School Applications Alert Strip */}
      {pendingApps.length > 0 && (
        <div className="bg-teal-50/70 border border-teal-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-teal-800">
              {pendingApps.length} School Registration Application{pendingApps.length > 1 ? 's' : ''} Pending Review
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              Review submitted institutions, verify Principal emails, and auto-issue unique School Codes.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => navigate('/main-head/applications')}>
            <ClipboardCheck className="w-4 h-4" />
            Review Applications
          </Button>
        </div>
      )}

      {/* Demo Seed Banner if Empty OR Demo Role Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-teal-700">Demo & Evaluation Sandbox</p>
          <h2 className="text-sm font-bold text-slate-900 mt-0.5">
            {schools.length === 0
              ? 'Initialize two isolated demo schools to test all five portals immediately'
              : 'Demo schools active — inspect any tenant role or safely reset demo records'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Northridge Preparatory Academy (NRP) and Crestview International School (CVI) demonstrate full tenant isolation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={onSeedDemo} disabled={seeding}>
            <RefreshCw className={`w-3.5 h-3.5 ${seeding ? 'animate-spin' : ''}`} />
            {schools.length === 0 ? 'Seed 2 Demo Schools' : 'Reset Demo Data'}
          </Button>
          <Button variant="navy" size="sm" onClick={() => navigate('/main-head/schools')}>
            <Plus className="w-3.5 h-3.5" />
            Register School
          </Button>
        </div>
      </div>

      {/* 6 Focused Overview Cards (100% Free Platform) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Schools" value={schools.length} subtext="All modules included free" />
        <StatCard label="Active Campuses" value={metrics.active} tone="teal" subtext="Full operational access" />
        <StatCard label="Pending Applications" value={pendingApps.length} tone="amber" subtext="Awaiting Main Head review" />
        <StatCard label="Suspended Schools" value={metrics.suspended} tone="red" subtext="Access paused" />
        <StatCard label="Total Teachers" value={metrics.teachers} subtext="Across registered campuses" />
        <StatCard label="Total Students" value={metrics.students} subtext={`${enquiries.filter((e) => e.status === 'new').length} new enquiries`} />
      </div>

      {/* Quick Role Inspector (Only for Demo Testing by Main Head) */}
      {schools.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <h3 className="text-sm font-bold font-display text-slate-900">
                Inspect Demo Role Portals (Tenant Isolation Check)
              </h3>
              <p className="text-xs text-slate-500">
                Enter any seeded school portal to verify Principal, Coordinator, Teacher, and Student isolation in real time.
              </p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {DEMO_ACCOUNTS.slice(0, 4).map((acc) => (
              <button
                key={acc.uid}
                type="button"
                onClick={() => onPreviewRole(acc.uid)}
                className="text-left p-3.5 rounded-lg border border-slate-200 hover:border-teal-600 hover:bg-teal-50/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-teal-700">{ROLE_LABELS[acc.role]}</span>
                  <Eye className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <p className="text-sm font-semibold text-slate-900 mt-1 truncate">{acc.displayName}</p>
                <p className="text-[11px] text-slate-500 truncate">{acc.schoolName}</p>
              </button>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Second tenant (Crestview International):</span>
            {DEMO_ACCOUNTS.slice(4).map((acc) => (
              <button
                key={acc.uid}
                type="button"
                onClick={() => onPreviewRole(acc.uid)}
                className="px-2.5 py-1 rounded border border-slate-200 hover:border-teal-600 text-slate-700 font-medium cursor-pointer"
              >
                {ROLE_LABELS[acc.role]}: {acc.displayName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chart + Recent Activity */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold font-display text-slate-900">School Enrollment & Staff Overview</h3>
              <p className="text-xs text-slate-500">Live Firestore counts per registered tenant (demo schools labeled)</p>
            </div>
          </div>
          {chartData.length === 0 ? (
            <EmptyState
              title="No schools registered yet"
              description="Seed the two demo schools or register a new institution to view growth metrics."
              actionLabel="Seed Demo Schools"
              onAction={onSeedDemo}
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip />
                  <Bar dataKey="Students" fill="#0B1528" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Teachers" fill="#0D9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold font-display text-slate-900">Recent Platform Activity</h3>
            <button
              type="button"
              onClick={() => navigate('/main-head/audit-logs')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
            >
              View Audit Log
            </button>
          </div>
          {auditLogs.length === 0 ? (
            <p className="text-xs text-slate-500">Sensitive platform actions will be recorded here automatically.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {auditLogs.slice(0, 6).map((log) => (
                <div key={log.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-900 truncate">{log.action.replace(/_/g, ' ')}</span>
                    <span className="text-slate-400 tabular-nums shrink-0">{formatFirestoreDateTime(log.createdAt)}</span>
                  </div>
                  <p className="text-xs text-slate-600 truncate mt-0.5">
                    {log.actorName} · {log.targetLabel || log.targetId}
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
// Schools Management + Public Enquiries View
// ============================================================================
function MainHeadSchoolsView({
  schools,
  enquiries,
  globalSearch,
  loading,
  actor,
}: {
  schools: School[];
  enquiries: SchoolEnquiry[];
  globalSearch: string;
  loading: boolean;
  actor: PlatformUser;
}) {
  const { pushToast } = useToast();
  const [subTab, setSubTab] = useState<'schools' | 'enquiries'>('schools');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'students'>('name');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [detailSchool, setDetailSchool] = useState<School | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'suspend' | 'activate' | 'archive' | 'delete';
    school: School;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    code: '',
    address: '',
    email: '',
    phone: '',
    academicYear: '2026-2027',
    status: 'active' as School['status'],
    subscriptionPlanId: 'plan_standard',
    principalName: '',
    principalUsername: '',
    principalEmail: '',
    tempPassword: '',
  });

  const filtered = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    return schools
      .filter((s) => {
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (q && !`${s.name} ${s.code} ${s.principalName || ''} ${s.principalEmail || ''}`.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) =>
        sortBy === 'name'
          ? a.name.localeCompare(b.name)
          : (b.studentCount || 0) - (a.studentCount || 0),
      );
  }, [schools, statusFilter, globalSearch, sortBy]);

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openAddSchool = (prefill?: SchoolEnquiry) => {
    setEditingSchool(null);
    setForm({
      name: prefill?.schoolName || '',
      code: prefill ? prefill.schoolName.replace(/[^A-Z]/gi, '').slice(0, 4).toUpperCase() : '',
      address: '',
      email: prefill?.email || '',
      phone: prefill?.phone || '',
      academicYear: '2026-2027',
      status: 'active',
      subscriptionPlanId: 'plan_free',
      principalName: prefill?.contactName || '',
      principalUsername: prefill ? `principal.${prefill.schoolName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}` : '',
      principalEmail: prefill?.email || '',
      tempPassword: '',
    });
    setModalOpen(true);
  };

  const openEditSchool = (s: School) => {
    setEditingSchool(s);
    setForm({
      name: s.name,
      code: s.code,
      address: s.address || '',
      email: s.email || '',
      phone: s.phone || '',
      academicYear: s.academicYear,
      status: s.status,
      subscriptionPlanId: 'plan_free',
      principalName: s.principalName || '',
      principalUsername: s.principalUsername || '',
      principalEmail: s.principalEmail || '',
      tempPassword: '',
    });
    setModalOpen(true);
  };

  const handleSaveSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2 || form.code.trim().length < 2) {
      pushToast('error', 'School name and unique code are required.');
      return;
    }
    setSaving(true);
    try {
      const cleanCode = form.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (editingSchool) {
        await updateDoc(doc(db, 'schools', editingSchool.id), {
          name: form.name.trim().slice(0, 140),
          code: cleanCode.slice(0, 24),
          address: form.address.trim().slice(0, 300),
          email: form.email.trim().slice(0, 160),
          phone: form.phone.trim().slice(0, 32),
          academicYear: form.academicYear.trim().slice(0, 24),
          status: form.status,
          subscriptionPlanId: form.subscriptionPlanId,
          updatedAt: serverTimestamp(),
        });
        await recordAuditLog({
          schoolId: editingSchool.id,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'UPDATE_SCHOOL',
          targetType: 'school',
          targetId: editingSchool.id,
          targetLabel: form.name.trim(),
        });
        pushToast('success', `Updated ${form.name.trim()}.`);
      } else {
        const plan = {
          id: 'plan_free',
          name: 'Free Unlimited',
          priceMonthly: 0,
          trialDays: 0,
        };
        let principalUid = '';
        let provisionNote = '';
        const cleanPrincipalEmail = form.principalEmail.trim().toLowerCase();

        // Shared provisioning service creates School + SchoolCode + Subscription + EmailDirectory entry
        const provisioned = await provisionSchoolTenant({
          schoolName: form.name.trim(),
          schoolCode: cleanCode || undefined,
          academicYear: form.academicYear.trim() || '2026-2027',
          address: form.address.trim(),
          schoolEmail: form.email.trim() || cleanPrincipalEmail || 'office@school.edu',
          schoolPhone: form.phone.trim(),
          principalName: form.principalName.trim() || `${form.name.trim()} Principal`,
          principalEmail: cleanPrincipalEmail || form.email.trim() || 'principal@school.edu',
          principalUsername: form.principalUsername.trim() || undefined,
          plan,
          source: 'admin_manual',
          actorUid: actor.uid,
          actorName: actor.displayName,
        });

        // Optional immediate secondary auth provisioning if Principal email + password supplied
        if (cleanPrincipalEmail && form.tempPassword.trim()) {
          const res = await provisionAuthAccountSecondary(cleanPrincipalEmail, form.tempPassword.trim());
          principalUid = res.uid;
          if (res.warning) provisionNote = res.warning;
          await setDoc(doc(db, 'users', principalUid), {
            uid: principalUid,
            username: (form.principalUsername.trim() || `principal.${provisioned.schoolCode.toLowerCase()}`).slice(0, 64),
            email: cleanPrincipalEmail,
            displayName: (form.principalName.trim() || `${form.name.trim()} Principal`).slice(0, 120),
            role: 'principal',
            schoolId: provisioned.schoolId,
            status: 'active',
            mustChangePassword: true,
            phone: form.phone.trim().slice(0, 32),
            classId: '',
            section: '',
            assignedClassIds: [],
            assignedSubjectIds: [],
            coordinatorPermissions: {},
            isDemo: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await updateDoc(doc(db, 'schools', provisioned.schoolId), {
            principalUid,
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
        }

        pushToast(
          'success',
          `Registered ${form.name.trim()} with School Code ${provisioned.schoolCode}. ${provisionNote}`,
        );
      }
      setModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'schools');
    } finally {
      setSaving(false);
    }
  };

  const executeConfirmAction = async () => {
    if (!confirmAction) return;
    setSaving(true);
    const { type, school } = confirmAction;
    try {
      if (type === 'delete') {
        await deleteDoc(doc(db, 'schools', school.id));
        await recordAuditLog({
          schoolId: school.id,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'DELETE_SCHOOL',
          targetType: 'school',
          targetId: school.id,
          targetLabel: school.name,
        });
        pushToast('success', `Deleted school "${school.name}".`);
      } else {
        const nextStatus = type === 'activate' ? 'active' : type === 'suspend' ? 'suspended' : 'archived';
        await updateDoc(doc(db, 'schools', school.id), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
        await recordAuditLog({
          schoolId: school.id,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: `SCHOOL_${nextStatus.toUpperCase()}`,
          targetType: 'school',
          targetId: school.id,
          targetLabel: school.name,
        });
        pushToast('success', `School "${school.name}" marked ${nextStatus}.`);
      }
      setConfirmAction(null);
      setDetailSchool(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `schools/${school.id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPrincipalAccess = async (school: School) => {
    if (!school.principalEmail) {
      pushToast('warning', 'No Principal email is assigned to this school.');
      return;
    }
    await sendPasswordResetEmail(auth, school.principalEmail).catch(() => undefined);
    if (school.principalUid) {
      await updateDoc(doc(db, 'users', school.principalUid), {
        mustChangePassword: true,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }
    await recordAuditLog({
      schoolId: school.id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      action: 'REISSUE_PRINCIPAL_ACCESS',
      targetType: 'user',
      targetId: school.principalUid || school.id,
      targetLabel: school.principalEmail,
      details: 'Dispatched secure reset link and enforced password replacement on next sign-in.',
    });
    pushToast('success', `Password reset link issued to ${school.principalEmail}.`);
  };

  if (loading) return <SkeletonTable rows={5} cols={6} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('schools')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              subTab === 'schools' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Registered Schools ({schools.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('enquiries')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              subTab === 'enquiries' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Public Enquiries ({enquiries.filter((e) => e.status === 'new').length} new)
          </button>
        </div>

        <Button variant="primary" size="sm" onClick={() => openAddSchool()}>
          <Plus className="w-4 h-4" />
          Add School
        </Button>
      </div>

      {subTab === 'schools' ? (
        <>
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {['all', 'active', 'trial', 'suspended', 'archived'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => { setStatusFilter(st); setPage(1); }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
                    statusFilter === st ? 'bg-[#0B1528] text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {st === 'all' ? 'All Statuses' : st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'students')}
                className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
              >
                <option value="name">School Name</option>
                <option value="students">Student Count</option>
              </select>
            </div>
          </div>

          {paged.length === 0 ? (
            <EmptyState
              title="No matching schools found"
              description="Adjust your search or status filters, or register a new tenant school."
              actionLabel="Register School"
              onAction={() => openAddSchool()}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                    <th className="py-3 px-4 font-semibold">School</th>
                    <th className="py-3 px-4 font-semibold">Principal</th>
                    <th className="py-3 px-4 font-semibold">Access Tier</th>
                    <th className="py-3 px-4 font-semibold text-right">Teachers</th>
                    <th className="py-3 px-4 font-semibold text-right">Students</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paged.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-900">
                          {s.name} {s.isDemo && <span className="text-[11px] font-normal text-slate-400">· Demo</span>}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">{s.code} · AY {s.academicYear}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-xs font-medium text-slate-800">{s.principalName || 'Unassigned'}</p>
                        <p className="text-xs text-slate-500">{s.principalEmail || '—'}</p>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <p className="font-medium text-teal-700">Free Unlimited</p>
                        <p className="text-slate-500">All modules included</p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">{s.teacherCount || 0}</td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">{s.studentCount || 0}</td>
                      <td className="py-3 px-4"><StatusText status={s.status} /></td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button variant="ghost" size="sm" onClick={() => setDetailSchool(s)}>Details</Button>
                          <Button variant="secondary" size="sm" onClick={() => openEditSchool(s)}>Edit</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <PaginationBar page={page} totalPages={totalPages} totalItems={filtered.length} onPageChange={setPage} />
        </>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {enquiries.length === 0 ? (
            <EmptyState
              title="No public school enquiries yet"
              description="Submissions from the landing page registration form will appear here."
            />
          ) : (
            enquiries.map((enq) => (
              <div key={enq.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs">
                    <StatusText status={enq.status} />
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500 tabular-nums">{enq.estimatedStudents || 0} est. students</span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mt-1">{enq.schoolName}</h3>
                  <p className="text-xs text-slate-600">{enq.contactName} · {enq.email} {enq.phone ? `· ${enq.phone}` : ''}</p>
                  {enq.message && <p className="text-xs text-slate-500 mt-1.5">{enq.message}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="primary" size="sm" onClick={() => openAddSchool(enq)}>
                    Convert to School
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      await updateDoc(doc(db, 'schoolEnquiries', enq.id), { status: 'contacted' });
                      pushToast('success', 'Marked enquiry as contacted.');
                    }}
                  >
                    Mark Contacted
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Add / Edit School Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingSchool ? `Edit ${editingSchool.name}` : 'Register New School'}
        subtitle="Creates an isolated tenant school and optional initial Principal account (temporary credentials require replacement on login)."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveSchool} className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">School Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">School Code *</label>
              <input
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="e.g. OAK"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Academic Year</label>
              <input
                type="text"
                value={form.academicYear}
                onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Campus Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as School['status'] })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="active">Active (Free Unlimited)</option>
                <option value="suspended">Suspended</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Contact Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Contact Phone (Numbers only)</label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={15}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: sanitizePhoneDigits(e.target.value) })}
                placeholder="9876543210"
                className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Campus Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          {!editingSchool && (
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <p className="text-xs font-semibold text-slate-900">Initial Principal Provisioning (Optional)</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Principal Full Name"
                  value={form.principalName}
                  onChange={(e) => setForm({ ...form, principalName: e.target.value })}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Principal Username"
                  value={form.principalUsername}
                  onChange={(e) => setForm({ ...form, principalUsername: e.target.value })}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="email"
                  placeholder="Principal Email"
                  value={form.principalEmail}
                  onChange={(e) => setForm({ ...form, principalEmail: e.target.value })}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="password"
                  placeholder="Temporary Password (never stored)"
                  value={form.tempPassword}
                  onChange={(e) => setForm({ ...form, tempPassword: e.target.value })}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : editingSchool ? 'Save School' : 'Create School'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* School Details Modal */}
      <Modal
        open={Boolean(detailSchool)}
        onClose={() => setDetailSchool(null)}
        title={detailSchool?.name || ''}
        subtitle={detailSchool ? `Code: ${detailSchool.code} · Academic Year ${detailSchool.academicYear}` : ''}
        maxWidth="max-w-xl"
      >
        {detailSchool && (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-slate-500">Status</p>
                <div className="mt-1"><StatusText status={detailSchool.status} /></div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-slate-500">Subscription Term</p>
                <p className="font-medium text-slate-900 mt-1 tabular-nums">
                  {detailSchool.subscriptionStart || '—'} to {detailSchool.subscriptionEnd || '—'}
                </p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-slate-500">Assigned Principal</p>
                <p className="font-semibold text-slate-900 mt-1">{detailSchool.principalName || 'Unassigned'}</p>
                <p className="text-slate-500">{detailSchool.principalEmail || '—'}</p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-slate-500">Population</p>
                <p className="font-semibold text-slate-900 mt-1 tabular-nums">
                  {detailSchool.teacherCount || 0} teachers · {detailSchool.studentCount || 0} students
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200">
              <Button variant="secondary" size="sm" onClick={() => handleResetPrincipalAccess(detailSchool)}>
                <KeyRound className="w-3.5 h-3.5" />
                Reissue Principal Reset
              </Button>
              {detailSchool.status !== 'active' ? (
                <Button variant="primary" size="sm" onClick={() => setConfirmAction({ type: 'activate', school: detailSchool })}>
                  <PlayCircle className="w-3.5 h-3.5" />
                  Activate
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setConfirmAction({ type: 'suspend', school: detailSchool })}>
                  <PauseCircle className="w-3.5 h-3.5" />
                  Suspend
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={() => setConfirmAction({ type: 'delete', school: detailSchool })}>
                <Trash2 className="w-3.5 h-3.5" />
                Delete School
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={executeConfirmAction}
        busy={saving}
        danger={confirmAction?.type === 'delete' || confirmAction?.type === 'suspend'}
        title={
          confirmAction?.type === 'delete'
            ? `Delete ${confirmAction.school.name}?`
            : `${confirmAction?.type === 'activate' ? 'Activate' : 'Suspend'} ${confirmAction?.school.name}?`
        }
        description={
          confirmAction?.type === 'delete'
            ? 'Deleting a school removes the tenant registration record. Ensure backups are exported first.'
            : 'Changing school status immediately updates login access for all users assigned to this school.'
        }
        warning={
          confirmAction?.type === 'delete'
            ? `Dependency warning: ${confirmAction.school.studentCount || 0} students and ${confirmAction.school.teacherCount || 0} teachers are associated with schoolId "${confirmAction.school.id}".`
            : undefined
        }
        confirmLabel={confirmAction?.type === 'delete' ? 'Permanently Delete' : 'Confirm Action'}
      />
    </div>
  );
}

// ============================================================================
// Platform Users Management View
// ============================================================================
function MainHeadUsersView({
  users,
  schools,
  globalSearch,
  loading,
  actor,
}: {
  users: PlatformUser[];
  schools: School[];
  globalSearch: string;
  loading: boolean;
  actor: PlatformUser;
}) {
  const { pushToast } = useToast();
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('student');
  const [editSchool, setEditSchool] = useState('unassigned');
  const [editStatus, setEditStatus] = useState<PlatformUser['status']>('active');

  const filtered = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    const q = globalSearch.trim().toLowerCase();
    if (q && !`${u.displayName} ${u.email} ${u.username}`.toLowerCase().includes(q)) return false;
    return true;
  });

  if (loading) return <SkeletonTable rows={6} cols={5} />;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-2">
        {(['all', 'main_head', 'principal', 'coordinator', 'teacher', 'student'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRoleFilter(r)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
              roleFilter === r ? 'bg-[#0B1528] text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {r === 'all' ? 'All Roles' : ROLE_LABELS[r]}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <th className="py-3 px-4 font-semibold">User</th>
              <th className="py-3 px-4 font-semibold">Role</th>
              <th className="py-3 px-4 font-semibold">School Scope</th>
              <th className="py-3 px-4 font-semibold">Status</th>
              <th className="py-3 px-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((u) => (
              <tr key={u.uid} className="hover:bg-slate-50/70">
                <td className="py-3 px-4">
                  <p className="font-semibold text-slate-900">{u.displayName}</p>
                  <p className="text-xs text-slate-500">{u.email} · @{u.username}</p>
                </td>
                <td className="py-3 px-4 text-xs font-medium text-slate-700">{ROLE_LABELS[u.role]}</td>
                <td className="py-3 px-4 text-xs text-slate-600">
                  {schools.find((s) => s.id === u.schoolId)?.name || u.schoolId}
                </td>
                <td className="py-3 px-4"><StatusText status={u.status} /></td>
                <td className="py-3 px-4 text-right">
                  <div className="inline-flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditing(u);
                        setEditRole(u.role);
                        setEditSchool(u.schoolId);
                        setEditStatus(u.status);
                      }}
                    >
                      Manage
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await sendPasswordResetEmail(auth, u.email).catch(() => undefined);
                        pushToast('success', `Password reset link dispatched to ${u.email}.`);
                      }}
                    >
                      Reset Access
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Manage ${editing?.displayName || ''}`} maxWidth="max-w-md">
        {editing && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {(['main_head', 'principal', 'coordinator', 'teacher', 'student'] as UserRole[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Assigned School</label>
              <select
                value={editSchool}
                onChange={(e) => setEditSchool(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="platform">Platform (Main Head)</option>
                <option value="unassigned">Unassigned</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Account Status</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as PlatformUser['status'])}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  await updateDoc(doc(db, 'users', editing.uid), {
                    role: editRole,
                    schoolId: editSchool,
                    status: editStatus,
                    updatedAt: serverTimestamp(),
                  });
                  await recordAuditLog({
                    schoolId: editSchool,
                    actorUid: actor.uid,
                    actorName: actor.displayName,
                    actorRole: actor.role,
                    action: 'UPDATE_USER_ACCESS',
                    targetType: 'user',
                    targetId: editing.uid,
                    targetLabel: editing.email,
                    details: `Updated role=${editRole}, school=${editSchool}, status=${editStatus}`,
                  });
                  pushToast('success', 'User access updated.');
                  setEditing(null);
                }}
              >
                <CheckCircle2 className="w-4 h-4" />
                Save Access
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
