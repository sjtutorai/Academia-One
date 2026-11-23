import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  ClipboardCheck,
  BarChart3,
  Users,
  Bell,
  UserCircle2,
  Plus,
  KeyRound,
  Trash2,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
  Copy,
  Check,
  QrCode,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
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
  provisionAuthAccountSecondary,
} from '../../lib/firebase';
import { recordAuditLog } from '../../lib/audit';
import {
  deriveSchoolPrefix,
  formatPrincipalCode,
  sanitizePhoneDigits,
  sanitizeSchoolPrefix,
} from '../../lib/schoolCodes';
import { ROLE_LABELS } from '../../lib/permissions';
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
import {
  ChangeSchoolPasswordModal,
  type PasswordChangeTarget,
} from '../../components/main-head/ChangeSchoolPasswordModal';
import {
  MainHeadAccessCodesDirectory,
  SchoolCodesModal,
} from '../../components/main-head/SchoolCodesModal';
import {
  permanentlyDeleteSchoolCascade,
  permanentlyDeleteUserAccess,
  provisionSchoolTenant,
  upsertEmailDirectoryEntry,
} from '../../lib/schoolProvisioning';
import { MainHeadApplicationsView } from './MainHeadApplicationsView';
import { MainHeadAnalyticsView } from './MainHeadSubViews';
import type {
  SchoolClass,
  MemberAccessCode,
  School,
  SchoolApplication,
  SchoolCodeEntry,
  SchoolEnquiry,
  PlatformUser,
  UserRole,
} from '../../types/models';

const MAIN_HEAD_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/main-head/dashboard', icon: LayoutDashboard },
  { id: 'applications', label: 'Applications', path: '/main-head/applications', icon: ClipboardCheck },
  { id: 'schools', label: 'Schools', path: '/main-head/schools', icon: Building2 },
  { id: 'access-codes', label: 'Access Codes', path: '/main-head/access-codes', icon: KeyRound },
  { id: 'analytics', label: 'Analytics', path: '/main-head/analytics', icon: BarChart3 },
  { id: 'users', label: 'Platform Users', path: '/main-head/users', icon: Users },
  { id: 'notifications', label: 'Notifications', path: '/main-head/notifications', icon: Bell },
  { id: 'profile', label: 'Profile & Security', path: '/main-head/profile', icon: UserCircle2 },
];

export default function MainHeadPortal() {
  const { activeUser } = useAuth();

  const [schools, setSchools] = useState<School[]>([]);
  const [schoolCodes, setSchoolCodes] = useState<SchoolCodeEntry[]>([]);
  const [memberCodes, setMemberCodes] = useState<MemberAccessCode[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [applications, setApplications] = useState<SchoolApplication[]>([]);
  const [enquiries, setEnquiries] = useState<SchoolEnquiry[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState('');

  useEffect(() => {
    let settled = 0;
    const done = () => {
      settled += 1;
      if (settled >= 3) setLoading(false);
    };
    const u1 = onSnapshot(collection(db, 'schools'), (s) => { setSchools(s.docs.map((d) => d.data() as School)); done(); }, () => done());
    const u2 = onSnapshot(collection(db, 'schoolEnquiries'), (s) => { setEnquiries(s.docs.map((d) => d.data() as SchoolEnquiry)); done(); }, () => done());
    const u3 = onSnapshot(collection(db, 'users'), (s) => { setUsers(s.docs.map((d) => d.data() as PlatformUser)); done(); }, () => done());
    const u4 = onSnapshot(collection(db, 'schoolApplications'), (s) => {
      setApplications(s.docs.map((d) => d.data() as SchoolApplication));
    }, () => undefined);
    const u5 = onSnapshot(collection(db, 'schoolCodes'), (s) => {
      setSchoolCodes(s.docs.map((d) => d.data() as SchoolCodeEntry));
    }, () => undefined);
    const u6 = onSnapshot(collection(db, 'memberAccessCodes'), (s) => {
      setMemberCodes(s.docs.map((d) => d.data() as MemberAccessCode));
    }, () => undefined);
    const u7 = onSnapshot(collection(db, 'classes'), (s) => {
      setClasses(s.docs.map((d) => d.data() as SchoolClass));
    }, () => undefined);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, []);

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
              enquiries={enquiries}
              memberCodes={memberCodes}
              loading={loading}
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
              schoolCodes={schoolCodes}
              memberCodes={memberCodes}
              classes={classes}
              users={users}
              enquiries={enquiries}
              globalSearch={globalSearch}
              loading={loading}
              actor={activeUser!}
            />
          }
        />
        <Route
          path="access-codes"
          element={
            <MainHeadAccessCodesDirectory
              schools={schools}
              schoolCodes={schoolCodes}
              classes={classes}
              memberCodes={memberCodes}
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
  enquiries,
  memberCodes,
  loading,
}: {
  schools: School[];
  applications: SchoolApplication[];
  enquiries: SchoolEnquiry[];
  memberCodes: MemberAccessCode[];
  loading: boolean;
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

      {/* Quick Operations Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-teal-700">Platform Governance</p>
          <h2 className="text-sm font-bold text-slate-900 mt-0.5">
            Register schools, inspect access codes, and manage active tenants
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {schools.length} registered school{schools.length === 1 ? '' : 's'} · {memberCodes.length} issued member access code{memberCodes.length === 1 ? '' : 's'} across the platform.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate('/main-head/access-codes')}>
            <KeyRound className="w-3.5 h-3.5" />
            View All Access Codes
          </Button>
          <Button variant="navy" size="sm" onClick={() => navigate('/main-head/schools')}>
            <Plus className="w-3.5 h-3.5" />
            Register School
          </Button>
        </div>
      </div>

      {/* 6 Focused Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Schools" value={schools.length} tone="blue" subtext="All modules included free" />
        <StatCard label="Active Campuses" value={metrics.active} tone="green" subtext="Full operational access" />
        <StatCard label="Pending Applications" value={pendingApps.length} tone="yellow" subtext="Awaiting Main Head review" />
        <StatCard label="Suspended Schools" value={metrics.suspended} tone="red" subtext="Access paused" />
        <StatCard label="Total Teachers" value={metrics.teachers} tone="blue" subtext="Across registered campuses" />
        <StatCard label="Total Students" value={metrics.students} tone="green" subtext={`${enquiries.filter((e) => e.status === 'new').length} new enquiries`} />
      </div>

      {/* Chart + School Codes Snapshot */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold font-display text-slate-900">School Enrollment &amp; Staff Overview</h3>
              <p className="text-xs text-slate-500">Live Firestore counts per registered school</p>
            </div>
          </div>
          {chartData.length === 0 ? (
            <EmptyState
              title="No schools registered yet"
              description="Register a new school or approve an application to view campus enrollment metrics."
              actionLabel="Register School"
              onAction={() => navigate('/main-head/schools')}
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip />
                  <Bar dataKey="Students" fill="#2563EB" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Teachers" fill="#16A34A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold font-display text-slate-900">Registered Schools &amp; Codes</h3>
            <button
              type="button"
              onClick={() => navigate('/main-head/access-codes')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
            >
              All Codes →
            </button>
          </div>
          {schools.length === 0 ? (
            <p className="text-xs text-slate-500">School codes and activation codes will appear here once schools are registered.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {schools.slice(0, 6).map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{s.name}</p>
                    <p className="text-slate-500 font-mono truncate mt-0.5">
                      Code: <strong className="text-[#0F295C]">{s.code}</strong>
                      {s.activationCode ? ` · Act: ${s.activationCode}` : ''}
                    </p>
                  </div>
                  <StatusText status={s.status} />
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
  schoolCodes,
  memberCodes,
  classes,
  users,
  enquiries,
  globalSearch,
  loading,
  actor,
}: {
  schools: School[];
  schoolCodes: SchoolCodeEntry[];
  memberCodes: MemberAccessCode[];
  classes: SchoolClass[];
  users: PlatformUser[];
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
  const [codesModalSchool, setCodesModalSchool] = useState<School | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<PasswordChangeTarget | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'suspend' | 'activate' | 'archive' | 'delete';
    school: School;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [handoffInfo, setHandoffInfo] = useState<{
    schoolName: string;
    schoolCode: string;
    principalCode: string;
    activationCode: string;
    principalEmail: string;
    tempPassword: string;
    note?: string;
  } | null>(null);

  const copyText = (key: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 1800);
  };

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
    setCodeManuallyEdited(false);
    setForm({
      name: prefill?.schoolName || '',
      code: prefill ? deriveSchoolPrefix(prefill.schoolName) : '',
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
    setCodeManuallyEdited(true);
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
    const trimmedName = form.name.trim();
    const derivedCode = sanitizeSchoolPrefix(form.code.trim() || deriveSchoolPrefix(trimmedName));
    if (trimmedName.length < 2 || derivedCode.length < 2) {
      pushToast('error', 'School name (min 2 letters) and unique school code are required.');
      return;
    }

    const cleanPrincipalEmail = form.principalEmail.trim().toLowerCase();
    const cleanSchoolEmail = form.email.trim().toLowerCase();
    const targetPrincipalEmail = cleanPrincipalEmail || cleanSchoolEmail;
    const rawTempPassword = form.tempPassword.trim();
    if (!editingSchool) {
      if (targetPrincipalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetPrincipalEmail)) {
        pushToast('error', 'Enter a valid Principal email address.');
        return;
      }
      if (rawTempPassword && rawTempPassword.length < 6) {
        pushToast('error', 'Temporary password must be at least 6 characters long.');
        return;
      }
    }

    setSaving(true);
    try {
      const cleanCode = derivedCode.slice(0, 12);
      if (editingSchool) {
        const nextPrincipalName = form.principalName.trim() || editingSchool.principalName || `${trimmedName} Principal`;
        const nextPrincipalEmail = targetPrincipalEmail || editingSchool.principalEmail || '';
        await updateDoc(doc(db, 'schools', editingSchool.id), {
          name: trimmedName.slice(0, 140),
          code: cleanCode.slice(0, 24),
          address: form.address.trim().slice(0, 300),
          email: cleanSchoolEmail.slice(0, 160),
          phone: form.phone.trim().slice(0, 32),
          academicYear: (form.academicYear.trim() || '2026-2027').slice(0, 24),
          status: form.status,
          principalName: nextPrincipalName.slice(0, 120),
          principalEmail: nextPrincipalEmail.slice(0, 160),
          subscriptionPlanId: form.subscriptionPlanId || 'plan_free',
          updatedAt: serverTimestamp(),
        });

        // Keep emailDirectory and matching user account synchronized with Principal Email
        if (nextPrincipalEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextPrincipalEmail)) {
          const pCode = formatPrincipalCode(cleanCode);
          await upsertEmailDirectoryEntry({
            email: nextPrincipalEmail,
            schoolId: editingSchool.id,
            schoolName: trimmedName,
            role: 'principal',
            displayName: nextPrincipalName,
            accessCode: pCode,
            createdBy: actor.uid,
            status: 'active',
          }).catch(() => undefined);

          const matchingUser = users.find(
            (u) => u.email?.trim().toLowerCase() === nextPrincipalEmail && u.role !== 'main_head',
          );
          if (matchingUser) {
            await updateDoc(doc(db, 'users', matchingUser.uid), {
              role: 'principal',
              schoolId: editingSchool.id,
              status: 'active',
              accessCode: pCode,
              updatedAt: serverTimestamp(),
            }).catch(() => undefined);
            await updateDoc(doc(db, 'schools', editingSchool.id), {
              principalUid: matchingUser.uid,
              updatedAt: serverTimestamp(),
            }).catch(() => undefined);
          }
        }

        await recordAuditLog({
          schoolId: editingSchool.id,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          action: 'UPDATE_SCHOOL',
          targetType: 'school',
          targetId: editingSchool.id,
          targetLabel: trimmedName,
        }).catch(() => undefined);
        pushToast('success', `Updated ${trimmedName}.`);
        setModalOpen(false);
      } else {
        const plan = {
          id: 'plan_free',
          name: 'Free Unlimited',
          priceMonthly: 0,
          trialDays: 0,
        };
        let principalUid = '';
        let provisionNote = '';
        const effectivePrincipalEmail = targetPrincipalEmail || `principal@${cleanCode.toLowerCase()}.edu`;
        const effectivePrincipalName = form.principalName.trim() || `${trimmedName} Principal`;
        const cleanUsernameCandidate = form.principalUsername
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, '');
        const safePrincipalUsername =
          cleanUsernameCandidate.length >= 3
            ? cleanUsernameCandidate.slice(0, 64)
            : `principal.${cleanCode.toLowerCase()}`.slice(0, 64);

        const provisioned = await provisionSchoolTenant({
          schoolName: trimmedName,
          schoolCode: cleanCode,
          schoolPrefix: cleanCode,
          academicYear: form.academicYear.trim() || '2026-2027',
          address: form.address.trim(),
          schoolEmail: cleanSchoolEmail || effectivePrincipalEmail,
          schoolPhone: form.phone.trim(),
          principalName: effectivePrincipalName,
          principalEmail: effectivePrincipalEmail,
          principalUsername: safePrincipalUsername,
          plan,
          source: 'admin_manual',
          actorUid: actor.uid,
          actorName: actor.displayName,
        });

        // If a real user account with this email already exists in Firestore, promote THAT real UID to Principal
        const existingPrincipalUser = users.find(
          (u) => u.email?.trim().toLowerCase() === effectivePrincipalEmail && u.role !== 'main_head',
        );

        if (existingPrincipalUser) {
          principalUid = existingPrincipalUser.uid;
          await updateDoc(doc(db, 'users', principalUid), {
            displayName: effectivePrincipalName.slice(0, 120),
            role: 'principal',
            schoolId: provisioned.schoolId,
            status: 'active',
            accessCode: provisioned.principalCode,
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
          await updateDoc(doc(db, 'schools', provisioned.schoolId), {
            principalUid,
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
          if (rawTempPassword) {
            provisionNote = `An account for ${effectivePrincipalEmail} already existed and has been promoted to Principal. Sign in using its existing password (or click "Password" on the school row to reset it).`;
          }
        } else if (targetPrincipalEmail && rawTempPassword) {
          // Provision new Principal login account when email + temporary password are supplied
          try {
            const res = await provisionAuthAccountSecondary(effectivePrincipalEmail, rawTempPassword);
            if (res.warning) provisionNote = res.warning;
            if (res.createdInAuth) {
              principalUid = res.uid;
              await setDoc(doc(db, 'users', principalUid), {
                uid: principalUid,
                username: safePrincipalUsername,
                email: effectivePrincipalEmail,
                displayName: effectivePrincipalName.slice(0, 120),
                role: 'principal',
                schoolId: provisioned.schoolId,
                status: 'active',
                mustChangePassword: true,
                phone: form.phone.trim().slice(0, 32),
                accessCode: provisioned.principalCode,
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
            } else {
              provisionNote = `School created and ${effectivePrincipalEmail} is bound as Principal. Because this email already exists in Authentication, the Principal should sign in with their existing password (or Google) to enter the Principal Activation screen.`;
            }
          } catch (authErr) {
            provisionNote =
              authErr instanceof Error
                ? `School created, but Principal password provisioning noted: ${authErr.message}. The Principal can still sign in via Google or Sign Up with ${effectivePrincipalEmail}.`
                : 'School created. Principal can sign in with Google or register using the bound email.';
          }
        }

        setModalOpen(false);
        setHandoffInfo({
          schoolName: trimmedName,
          schoolCode: provisioned.schoolCode,
          principalCode: provisioned.principalCode,
          activationCode: provisioned.activationCode,
          principalEmail: effectivePrincipalEmail,
          tempPassword: existingPrincipalUser ? '' : rawTempPassword,
          note: provisionNote,
        });
        pushToast(
          'success',
          `Registered ${trimmedName} (${provisioned.schoolCode}). Activation Code: ${provisioned.activationCode}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save school.';
      pushToast('error', msg);
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
        const res = await permanentlyDeleteSchoolCascade({
          school,
          actorUid: actor.uid,
          actorName: actor.displayName,
        });
        pushToast(
          'success',
          `Permanently deleted "${school.name}" and ${res.deletedDocs} linked Firestore document(s).`,
        );
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
        }).catch(() => undefined);
        pushToast('success', `School "${school.name}" marked ${nextStatus}.`);
      }
      setConfirmAction(null);
      setDetailSchool(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Action failed.');
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
                    statusFilter === st ? 'bg-[#0F295C] text-white' : 'text-slate-600 hover:bg-slate-100'
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
                    <th className="py-3 px-4 font-semibold">School &amp; Codes</th>
                    <th className="py-3 px-4 font-semibold">Principal</th>
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
                        <p className="font-semibold text-slate-900">{s.name}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs">
                          <span className="font-mono font-bold text-[#0F295C]">Code: {s.code}</span>
                          {s.activationCode && (
                            <span className="font-mono text-blue-700">· Act: {s.activationCode}</span>
                          )}
                          <span className="text-slate-400">· AY {s.academicYear}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-xs font-medium text-slate-800">{s.principalName || 'Unassigned'}</p>
                        <p className="text-xs text-slate-500">{s.principalEmail || '—'}</p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">{s.teacherCount || 0}</td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">{s.studentCount || 0}</td>
                      <td className="py-3 px-4"><StatusText status={s.status} /></td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setCodesModalSchool(s)}
                          >
                            <QrCode className="w-3.5 h-3.5 text-teal-700" />
                            Codes
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setPasswordTarget({
                                kind: 'school',
                                title: s.name,
                                subtitle: `School Code ${s.code} · Principal: ${s.principalName || 'Unassigned'}`,
                                email: s.principalEmail || s.email || '',
                                uid: s.principalUid,
                                schoolId: s.id,
                                schoolName: s.name,
                                school: s,
                              })
                            }
                          >
                            <KeyRound className="w-3.5 h-3.5 text-[#2563EB]" />
                            Password
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDetailSchool(s)}>Details</Button>
                          <Button variant="secondary" size="sm" onClick={() => openEditSchool(s)}>Edit</Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setConfirmAction({ type: 'delete', school: s })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remove
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
                onChange={(e) => {
                  const nextName = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    name: nextName,
                    code: !editingSchool && !codeManuallyEdited ? deriveSchoolPrefix(nextName) : prev.code,
                  }));
                }}
                placeholder="Enter official school name"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">3-Letter School Code *</label>
              <input
                type="text"
                required
                value={form.code}
                onChange={(e) => {
                  setCodeManuallyEdited(true);
                  setForm((prev) => ({ ...prev, code: sanitizeSchoolPrefix(e.target.value) }));
                }}
                placeholder="Enter school code"
                className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg"
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

          <div className="pt-4 border-t border-slate-200 space-y-3">
            <p className="text-xs font-semibold text-slate-900">
              {editingSchool ? 'Principal Account Binding' : 'Initial Principal Provisioning'}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Principal Full Name"
                value={form.principalName}
                onChange={(e) => setForm({ ...form, principalName: e.target.value })}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              {!editingSchool && (
                <input
                  type="text"
                  placeholder="Principal Username"
                  value={form.principalUsername}
                  onChange={(e) => setForm({ ...form, principalUsername: e.target.value })}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              )}
              <input
                type="email"
                placeholder="Principal Login Email"
                value={form.principalEmail}
                onChange={(e) => setForm({ ...form, principalEmail: e.target.value })}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              {!editingSchool && (
                <input
                  type="password"
                  placeholder="Temporary Password (min 6 chars)"
                  value={form.tempPassword}
                  onChange={(e) => setForm({ ...form, tempPassword: e.target.value })}
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              )}
            </div>
          </div>

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
              {detailSchool.activationCode && (
                <div className="col-span-2 p-3.5 bg-blue-50/70 border border-blue-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold text-blue-800">
                      Main Head Activation Code ({detailSchool.setupCompleted ? 'Setup Completed' : 'Awaiting School Activation & Setup'})
                    </p>
                    <p className="font-mono text-sm font-bold text-[#0F295C] tracking-wider mt-0.5">
                      {detailSchool.activationCode}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyText('detail_activation', detailSchool.activationCode || '')}
                  >
                    {copiedField === 'detail_activation' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedField === 'detail_activation' ? 'Copied' : 'Copy Code'}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200">
              <Button
                variant="navy"
                size="sm"
                onClick={() => {
                  const s = detailSchool;
                  setDetailSchool(null);
                  setCodesModalSchool(s);
                }}
              >
                <QrCode className="w-3.5 h-3.5" />
                View All Codes
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const s = detailSchool;
                  setDetailSchool(null);
                  setPasswordTarget({
                    kind: 'school',
                    title: s.name,
                    subtitle: `School Code ${s.code} · Principal: ${s.principalName || 'Unassigned'}`,
                    email: s.principalEmail || s.email || '',
                    uid: s.principalUid,
                    schoolId: s.id,
                    schoolName: s.name,
                    school: s,
                  });
                }}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Change School Password
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleResetPrincipalAccess(detailSchool)}>
                Send Reset Link
              </Button>
              {detailSchool.status !== 'active' ? (
                <Button variant="success" size="sm" onClick={() => setConfirmAction({ type: 'activate', school: detailSchool })}>
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
                Remove School
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <SchoolCodesModal
        school={codesModalSchool}
        schoolCodeEntry={
          codesModalSchool
            ? schoolCodes.find((sc) => sc.schoolId === codesModalSchool.id || sc.code === codesModalSchool.code)
            : undefined
        }
        classes={classes}
        memberCodes={memberCodes}
        onClose={() => setCodesModalSchool(null)}
      />

      <ChangeSchoolPasswordModal
        target={passwordTarget}
        actor={actor}
        onClose={() => setPasswordTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={executeConfirmAction}
        busy={saving}
        danger={confirmAction?.type === 'delete' || confirmAction?.type === 'suspend'}
        title={
          confirmAction?.type === 'delete'
            ? `Permanently Delete ${confirmAction.school.name}?`
            : `${confirmAction?.type === 'activate' ? 'Activate' : 'Suspend'} ${confirmAction?.school.name}?`
        }
        description={
          confirmAction?.type === 'delete'
            ? 'This permanently removes the school, its access codes, classes, staff, students, and linked user profiles directly from Firestore.'
            : 'Changing school status immediately updates login access for all users assigned to this school.'
        }
        warning={
          confirmAction?.type === 'delete'
            ? `Permanent cascade deletion: ${confirmAction.school.studentCount || 0} students, ${confirmAction.school.teacherCount || 0} teachers, and all tenant records for schoolId "${confirmAction.school.id}" will be erased.`
            : undefined
        }
        confirmLabel={confirmAction?.type === 'delete' ? 'Permanently Delete All' : 'Confirm Action'}
      />

      {/* Credentials & Activation Code Handoff Modal */}
      <Modal
        open={Boolean(handoffInfo)}
        onClose={() => setHandoffInfo(null)}
        title="School Registered — Activation Handoff"
        subtitle="Share these credentials and the Main Head Activation Code with the school's Principal."
        maxWidth="max-w-lg"
      >
        {handoffInfo && (
          <div className="space-y-4 text-sm">
            <div className="p-4 bg-[#0F295C] text-white rounded-xl space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-blue-200 font-semibold">
                Main Head Activation Code (Required on First Login)
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xl font-bold font-mono tracking-wider text-yellow-300 tabular-nums">
                  {handoffInfo.activationCode}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copyText('handoff_activation', handoffInfo.activationCode)}
                >
                  {copiedField === 'handoff_activation' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedField === 'handoff_activation' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-blue-100">
                When the Principal logs in, they will enter this code and complete the full school registration setup (classes, rooms, named coordinators, teachers & students) to generate member codes.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-slate-500">School Name</p>
                <p className="font-semibold text-slate-900 mt-0.5">{handoffInfo.schoolName}</p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-slate-500">3-Letter School Code</p>
                <p className="font-mono font-bold text-slate-900 mt-0.5">{handoffInfo.schoolCode}</p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-slate-500">Principal Login Email</p>
                <p className="font-mono text-slate-900 mt-0.5 break-all">{handoffInfo.principalEmail}</p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-slate-500">Temporary Password</p>
                <p className="font-mono text-slate-900 mt-0.5">
                  {handoffInfo.tempPassword || 'Sign in with Google / Reset Password'}
                </p>
              </div>
            </div>

            {handoffInfo.note && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {handoffInfo.note}
              </p>
            )}

            <div className="flex justify-between items-center gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const summary = [
                    `School: ${handoffInfo.schoolName}`,
                    `School Code: ${handoffInfo.schoolCode}`,
                    `Main Head Activation Code: ${handoffInfo.activationCode}`,
                    `Principal Email: ${handoffInfo.principalEmail}`,
                    handoffInfo.tempPassword ? `Temporary Password: ${handoffInfo.tempPassword}` : '',
                  ]
                    .filter(Boolean)
                    .join('\n');
                  copyText('handoff_all', summary);
                }}
              >
                {copiedField === 'handoff_all' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedField === 'handoff_all' ? 'Copied All Details' : 'Copy All Handoff Details'}
              </Button>
              <Button variant="primary" size="sm" onClick={() => setHandoffInfo(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>
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
  const [passwordTarget, setPasswordTarget] = useState<PasswordChangeTarget | null>(null);
  const [deletingUser, setDeletingUser] = useState<PlatformUser | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
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
              roleFilter === r ? 'bg-[#0F295C] text-white' : 'text-slate-600 hover:bg-slate-100'
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
                      onClick={() => {
                        const sc = schools.find((s) => s.id === u.schoolId);
                        setPasswordTarget({
                          kind: 'user',
                          title: u.displayName,
                          subtitle: `${ROLE_LABELS[u.role]} · ${sc?.name || u.schoolId}`,
                          email: u.email,
                          uid: u.uid,
                          schoolId: u.schoolId || 'platform',
                          schoolName: sc?.name,
                          user: u,
                        });
                      }}
                    >
                      <KeyRound className="w-3.5 h-3.5 text-[#2563EB]" />
                      Password
                    </Button>
                    {u.role !== 'main_head' &&
                      u.email.trim().toLowerCase() !== 'sjtutorai@gmail.com' &&
                      u.uid !== actor.uid && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setDeletingUser(u)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove Access
                        </Button>
                      )}
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

      <ChangeSchoolPasswordModal
        target={passwordTarget}
        actor={actor}
        onClose={() => setPasswordTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deletingUser)}
        onClose={() => setDeletingUser(null)}
        busy={deletingBusy}
        danger
        title={deletingUser ? `Remove Access & Delete ${deletingUser.displayName}?` : ''}
        description="This immediately signs the user out and permanently deletes their profile, email directory binding, linked teacher/student records, join requests, and access codes from Firestore."
        warning={
          deletingUser
            ? `Permanent Firestore Deletion: ${deletingUser.email} (${ROLE_LABELS[deletingUser.role]}) will be removed from console.firebase.google.com immediately.`
            : undefined
        }
        confirmLabel="Remove Access & Delete"
        onConfirm={async () => {
          if (!deletingUser) return;
          setDeletingBusy(true);
          try {
            const res = await permanentlyDeleteUserAccess({
              user: deletingUser,
              actorUid: actor.uid,
              actorName: actor.displayName,
            });
            pushToast(
              'success',
              `Removed access for ${deletingUser.displayName} and deleted ${res.deletedDocs} Firestore document(s).`,
            );
            setDeletingUser(null);
          } catch (err) {
            pushToast('error', err instanceof Error ? err.message : 'Unable to delete user access.');
          } finally {
            setDeletingBusy(false);
          }
        }}
      />
    </div>
  );
}
