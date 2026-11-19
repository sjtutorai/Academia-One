import React, { useMemo, useState } from 'react';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Download, Plus, CreditCard, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { db, generateId, handleFirestoreError, OperationType, formatFirestoreDateTime } from '../../lib/firebase';
import { recordAuditLog } from '../../lib/audit';
import { exportToCsv } from '../../lib/csv';
import { getPaymentGatewayStatus } from '../../lib/payments';
import { getFcmIntegrationStatus } from '../../lib/notifications';
import { Button, ConfirmDialog, EmptyState, Modal, StatusText, useToast } from '../../components/ui/Primitives';
import type {
  School,
  SubscriptionPlan,
  SchoolSubscription,
  PlatformUser,
  PlatformSettings,
  AuditLog,
} from '../../types/models';

const PIE_COLORS = ['#0B1528', '#0D9488', '#2563EB', '#D97706'];

// ============================================================================
// Subscriptions Management View
// ============================================================================
export function MainHeadSubscriptionsView({
  schools,
  plans,
  subscriptions,
  actor,
}: {
  schools: School[];
  plans: SubscriptionPlan[];
  subscriptions: SchoolSubscription[];
  actor: PlatformUser;
}) {
  const { pushToast } = useToast();
  const paymentStatus = getPaymentGatewayStatus();

  const [editingSub, setEditingSub] = useState<SchoolSubscription | null>(null);
  const [planId, setPlanId] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<SchoolSubscription['status']>('active');
  const [paymentRef, setPaymentRef] = useState('');
  const [amount, setAmount] = useState('0');
  const [saving, setSaving] = useState(false);

  const openManage = (sub: SchoolSubscription) => {
    setEditingSub(sub);
    setPlanId(sub.planId);
    setEndDate(sub.endDate);
    setStatus(sub.status);
    setPaymentRef(sub.paymentReference || '');
    setAmount(String(sub.amount || 0));
  };

  const handleSaveSub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSub) return;
    setSaving(true);
    try {
      const plan = plans.find((p) => p.id === planId);
      const nextHistory = [
        ...(editingSub.renewalHistory || []),
        {
          date: new Date().toISOString().slice(0, 10),
          planName: plan?.name || editingSub.planName,
          amount: Number(amount) || 0,
          paymentMode: 'manual' as const,
          reference: paymentRef.trim() || 'MANUAL-RECORD',
          recordedBy: actor.displayName,
        },
      ].slice(-25);

      await updateDoc(doc(db, 'schoolSubscriptions', editingSub.id), {
        planId,
        planName: plan?.name || editingSub.planName,
        status,
        endDate,
        paymentMode: 'manual',
        paymentStatus: status === 'trial' ? 'trial' : status === 'expired' ? 'overdue' : 'paid_manual',
        paymentReference: paymentRef.trim().slice(0, 120),
        amount: Number(amount) || 0,
        renewalHistory: nextHistory,
        updatedAt: serverTimestamp(),
      });

      const schoolSubStatus =
        status === 'cancelled' ? 'expired' : status;
      await updateDoc(doc(db, 'schools', editingSub.schoolId), {
        subscriptionPlanId: planId,
        subscriptionStatus: schoolSubStatus,
        subscriptionEnd: endDate,
        updatedAt: serverTimestamp(),
      });

      await recordAuditLog({
        schoolId: editingSub.schoolId,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'UPDATE_SUBSCRIPTION',
        targetType: 'schoolSubscription',
        targetId: editingSub.id,
        targetLabel: editingSub.schoolName || editingSub.schoolId,
        details: `Plan=${plan?.name || planId}, Status=${status}, Manual Ref=${paymentRef || 'N/A'}`,
      });

      pushToast('success', 'Subscription updated and manual payment recorded.');
      setEditingSub(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `schoolSubscriptions/${editingSub.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Payment Gateway Transparency Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
            <CreditCard className="w-4 h-4" />
            Online Payment Gateway: {paymentStatus.provider}
          </div>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
            {paymentStatus.setupSteps[0]} {paymentStatus.setupSteps[2]}
          </p>
        </div>
        <span className="text-xs font-mono text-slate-500 shrink-0">
          Mode: {paymentStatus.mode}
        </span>
      </div>

      {subscriptions.length === 0 ? (
        <EmptyState
          title="No school subscriptions found"
          description="Register a school or seed the demo schools to manage active and trial subscriptions."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">School</th>
                <th className="py-3 px-4 font-semibold">Plan</th>
                <th className="py-3 px-4 font-semibold">Term</th>
                <th className="py-3 px-4 font-semibold">Payment Type</th>
                <th className="py-3 px-4 font-semibold text-right">Amount</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subscriptions.map((sub) => (
                <tr key={sub.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    {sub.schoolName || schools.find((s) => s.id === sub.schoolId)?.name || sub.schoolId}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">{sub.planName}</td>
                  <td className="py-3 px-4 text-xs text-slate-600 tabular-nums">
                    {sub.startDate} → {sub.endDate}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    <p className="font-medium text-slate-800">
                      {sub.paymentMode === 'manual' ? 'Manual Record' : 'Online (Pending Setup)'}
                    </p>
                    <p className="text-slate-500 font-mono text-[11px]">{sub.paymentReference || '—'}</p>
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">${sub.amount}</td>
                  <td className="py-3 px-4"><StatusText status={sub.status} /></td>
                  <td className="py-3 px-4 text-right">
                    <Button variant="secondary" size="sm" onClick={() => openManage(sub)}>
                      Renew / Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(editingSub)}
        onClose={() => setEditingSub(null)}
        title={`Manage Subscription · ${editingSub?.schoolName || ''}`}
        subtitle="Setting status to Grace Read-Only preserves all school data without deletion."
      >
        {editingSub && (
          <form onSubmit={handleSaveSub} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Subscription Plan</label>
                <select
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (${p.priceMonthly}/mo)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Subscription Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SchoolSubscription['status'])}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="grace_readonly">Grace Read-Only</option>
                  <option value="expired">Expired (Read-Only)</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Manual Payment ($)</label>
                <input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Invoice / Reference</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="INV-2026-009"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {editingSub.renewalHistory && editingSub.renewalHistory.length > 0 && (
              <div className="pt-3 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-2">Renewal History</p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto text-xs text-slate-600">
                  {editingSub.renewalHistory.map((h, i) => (
                    <div key={i} className="flex items-center justify-between py-1 border-b border-slate-100">
                      <span>{h.date} · {h.planName} ({h.reference})</span>
                      <span className="font-mono tabular-nums">${h.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditingSub(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Record Manual Update'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
// Plans Configuration View
// ============================================================================
export function MainHeadPlansView({
  plans,
  actor,
}: {
  plans: SubscriptionPlan[];
  actor: PlatformUser;
}) {
  const { pushToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [form, setForm] = useState({
    name: '',
    tier: 'standard' as SubscriptionPlan['tier'],
    priceMonthly: '199',
    billingInterval: 'monthly' as SubscriptionPlan['billingInterval'],
    trialDays: '14',
    maxStudents: '1000',
    maxTeachers: '80',
    storageGb: '50',
    description: '',
    modulesCsv: 'attendance, timetable, homework, examinations, materials, reports',
  });

  const openNew = () => {
    setEditing(null);
    setForm({
      name: '',
      tier: 'standard',
      priceMonthly: '199',
      billingInterval: 'monthly',
      trialDays: '14',
      maxStudents: '1000',
      maxTeachers: '80',
      storageGb: '50',
      description: '',
      modulesCsv: 'attendance, timetable, homework, examinations, materials, reports',
    });
    setModalOpen(true);
  };

  const openEdit = (p: SubscriptionPlan) => {
    setEditing(p);
    setForm({
      name: p.name,
      tier: p.tier,
      priceMonthly: String(p.priceMonthly),
      billingInterval: p.billingInterval,
      trialDays: String(p.trialDays),
      maxStudents: String(p.maxStudents),
      maxTeachers: String(p.maxTeachers),
      storageGb: String(p.storageGb),
      description: p.description || '',
      modulesCsv: p.enabledModules.join(', '),
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = editing?.id || generateId('plan');
    const modules = form.modulesCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    const payload = {
      id,
      name: form.name.trim().slice(0, 80),
      tier: form.tier,
      priceMonthly: Math.max(0, Number(form.priceMonthly) || 0),
      billingInterval: form.billingInterval,
      trialDays: Math.max(0, Number(form.trialDays) || 0),
      maxStudents: Math.max(10, Number(form.maxStudents) || 100),
      maxTeachers: Math.max(1, Number(form.maxTeachers) || 10),
      storageGb: Math.max(1, Number(form.storageGb) || 5),
      enabledModules: modules.length > 0 ? modules : ['attendance', 'timetable'],
      status: 'active',
      description: form.description.trim().slice(0, 300),
      updatedAt: serverTimestamp(),
    };

    try {
      if (editing) {
        await updateDoc(doc(db, 'subscriptionPlans', id), payload);
      } else {
        await setDoc(doc(db, 'subscriptionPlans', id), { ...payload, createdAt: serverTimestamp() });
      }
      await recordAuditLog({
        schoolId: 'platform',
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: editing ? 'UPDATE_PLAN' : 'CREATE_PLAN',
        targetType: 'subscriptionPlan',
        targetId: id,
        targetLabel: payload.name,
      });
      pushToast('success', `Saved plan "${payload.name}".`);
      setModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `subscriptionPlans/${id}`);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Configure tiers, capacity limits, and enabled modules reflected on the public website.</p>
        <Button variant="primary" size="sm" onClick={openNew}>
          <Plus className="w-4 h-4" />
          New Plan
        </Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
        {plans.map((p) => (
          <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-teal-700 uppercase">{p.tier}</span>
                <StatusText status={p.status} />
              </div>
              <h3 className="text-base font-bold font-display text-slate-900 mt-1">{p.name}</h3>
              <p className="text-2xl font-bold font-display tabular-nums text-slate-900 mt-2">
                ${p.priceMonthly}<span className="text-xs font-normal text-slate-500">/{p.billingInterval}</span>
              </p>
              <p className="text-xs text-slate-500 mt-2">{p.description}</p>
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5 text-xs text-slate-600 tabular-nums">
                <p>Students limit: <strong>{p.maxStudents.toLocaleString()}</strong></p>
                <p>Teachers limit: <strong>{p.maxTeachers.toLocaleString()}</strong></p>
                <p>Storage: <strong>{p.storageGb} GB</strong> · Trial: <strong>{p.trialDays}d</strong></p>
                <p className="text-[11px] text-slate-500 pt-1">Modules: {p.enabledModules.join(' · ')}</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="w-full mt-4" onClick={() => openEdit(p)}>
              Edit Plan
            </Button>
          </div>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.name}` : 'Create Subscription Plan'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Plan Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tier</label>
              <select
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value as SubscriptionPlan['tier'] })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="free">Free</option>
                <option value="basic">Basic</option>
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Price ($)</label>
              <input type="number" min={0} value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Billing Interval</label>
              <select value={form.billingInterval} onChange={(e) => setForm({ ...form, billingInterval: e.target.value as SubscriptionPlan['billingInterval'] })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Trial Days</label>
              <input type="number" min={0} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Max Students</label>
              <input type="number" min={10} value={form.maxStudents} onChange={(e) => setForm({ ...form, maxStudents: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Max Teachers</label>
              <input type="number" min={1} value={form.maxTeachers} onChange={(e) => setForm({ ...form, maxTeachers: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Storage (GB)</label>
              <input type="number" min={1} value={form.storageGb} onChange={(e) => setForm({ ...form, storageGb: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Enabled Modules (comma-separated)</label>
            <input type="text" value={form.modulesCsv} onChange={(e) => setForm({ ...form, modulesCsv: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Save Plan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// Platform Analytics View with CSV Export
// ============================================================================
export function MainHeadAnalyticsView({
  schools,
  plans,
  subscriptions,
}: {
  schools: School[];
  plans: SubscriptionPlan[];
  subscriptions: SchoolSubscription[];
}) {
  const [planFilter, setPlanFilter] = useState('all');

  const filteredSchools = useMemo(
    () => (planFilter === 'all' ? schools : schools.filter((s) => s.subscriptionPlanId === planFilter)),
    [schools, planFilter],
  );

  const planDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    filteredSchools.forEach((s) => {
      const label = plans.find((p) => p.id === s.subscriptionPlanId)?.name || s.subscriptionPlanId;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [filteredSchools, plans]);

  const statusBreakdown = useMemo(() => {
    const statuses = ['active', 'trial', 'suspended', 'archived'] as const;
    return statuses.map((st) => ({
      status: st.charAt(0).toUpperCase() + st.slice(1),
      Count: filteredSchools.filter((s) => s.status === st).length,
    }));
  }, [filteredSchools]);

  const handleExport = () => {
    exportToCsv(
      'academiaone_platform_analytics.csv',
      ['School ID', 'Name', 'Code', 'Status', 'Plan', 'Subscription End', 'Teachers', 'Students', 'Demo'],
      filteredSchools.map((s) => [
        s.id,
        s.name,
        s.code,
        s.status,
        plans.find((p) => p.id === s.subscriptionPlanId)?.name || s.subscriptionPlanId,
        s.subscriptionEnd || '',
        s.teacherCount || 0,
        s.studentCount || 0,
        Boolean(s.isDemo),
      ]),
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium text-slate-600">Filter by Plan:</span>
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="all">All Subscription Plans</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <Button variant="secondary" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4" />
          Download CSV Report
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-sm font-bold font-display text-slate-900">Active vs Trial vs Suspended Schools</h3>
          <p className="text-xs text-slate-500 mb-4">Aggregated directly from live Firestore tenant records</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="Count" fill="#0D9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-sm font-bold font-display text-slate-900">Subscription Plan Distribution</h3>
          <p className="text-xs text-slate-500 mb-4">Total revenue recorded manually: ${subscriptions.reduce((a, b) => a + (b.amount || 0), 0).toLocaleString()}</p>
          {planDistribution.length === 0 ? (
            <p className="text-xs text-slate-500 py-16 text-center">No schools match this filter.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={planDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                    {planDistribution.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Audit Logs View
// ============================================================================
export function MainHeadAuditLogsView({ auditLogs }: { auditLogs: AuditLog[] }) {
  const [filter, setFilter] = useState('');
  const filtered = auditLogs.filter((l) =>
    !filter.trim() || `${l.action} ${l.actorName} ${l.targetLabel || ''} ${l.details || ''}`.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter audit entries by actor, action, or target…"
          className="w-full sm:w-80 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            exportToCsv(
              'academiaone_audit_logs.csv',
              ['Timestamp', 'Actor', 'Role', 'Action', 'Target', 'School ID', 'Details'],
              filtered.map((l) => [
                formatFirestoreDateTime(l.createdAt),
                l.actorName,
                l.actorRole,
                l.action,
                l.targetLabel || l.targetId,
                l.schoolId,
                l.details || '',
              ]),
            )
          }
        >
          <Download className="w-4 h-4" />
          Export Audit CSV
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <th className="py-3 px-4 font-semibold">Timestamp</th>
              <th className="py-3 px-4 font-semibold">Actor</th>
              <th className="py-3 px-4 font-semibold">Action</th>
              <th className="py-3 px-4 font-semibold">Target</th>
              <th className="py-3 px-4 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/70">
                <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">{formatFirestoreDateTime(l.createdAt)}</td>
                <td className="py-3 px-4 font-medium text-slate-900">{l.actorName} <span className="text-slate-400">({l.actorRole})</span></td>
                <td className="py-3 px-4 font-mono text-teal-800">{l.action}</td>
                <td className="py-3 px-4 text-slate-700">{l.targetLabel || l.targetId}</td>
                <td className="py-3 px-4 text-slate-500 max-w-xs truncate">{l.details || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Platform Settings View
// ============================================================================
export function MainHeadSettingsView({
  settings,
  actor,
  onResetDemo,
  seeding,
}: {
  settings: PlatformSettings;
  actor: PlatformUser;
  onResetDemo: () => void;
  seeding: boolean;
}) {
  const { pushToast } = useToast();
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const paymentStatus = getPaymentGatewayStatus();
  const fcmStatus = getFcmIntegrationStatus();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'platformSettings', 'global'), {
        platformName: form.platformName.trim().slice(0, 80),
        supportEmail: form.supportEmail.trim().slice(0, 160),
        supportPhone: (form.supportPhone || '').trim().slice(0, 32),
        allowPublicRegistration: Boolean(form.allowPublicRegistration),
        defaultTrialDays: Number(form.defaultTrialDays) || 14,
        sessionTimeoutMinutes: Number(form.sessionTimeoutMinutes) || 60,
        paymentGatewayStatus: paymentStatus.mode,
        fcmStatus: fcmStatus.configured ? 'configured' : 'pending_configuration',
        updatedBy: actor.uid,
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        schoolId: 'platform',
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'UPDATE_PLATFORM_SETTINGS',
        targetType: 'platformSettings',
        targetId: 'global',
        targetLabel: form.platformName,
      });
      pushToast('success', 'Platform settings updated.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'platformSettings/global');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <form onSubmit={handleSave} className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-bold font-display text-slate-900">Branding, Onboarding & Security Defaults</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Platform Brand Name</label>
            <input type="text" value={form.platformName} onChange={(e) => setForm({ ...form, platformName: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Support Email</label>
            <input type="email" value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Support Phone</label>
            <input type="text" value={form.supportPhone || ''} onChange={(e) => setForm({ ...form, supportPhone: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Default Trial (Days)</label>
            <input type="number" min={0} max={90} value={form.defaultTrialDays} onChange={(e) => setForm({ ...form, defaultTrialDays: Number(e.target.value) })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Session Timeout (Min)</label>
            <input type="number" min={15} max={1440} value={form.sessionTimeoutMinutes} onChange={(e) => setForm({ ...form, sessionTimeoutMinutes: Number(e.target.value) })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
          </div>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-slate-700 pt-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.allowPublicRegistration}
            onChange={(e) => setForm({ ...form, allowPublicRegistration: e.target.checked })}
            className="rounded border-slate-300 text-teal-600"
          />
          Enable public School Registration / Enquiry form on landing page
        </label>
        <div className="flex justify-end pt-3">
          <Button type="submit" variant="navy" disabled={saving}>
            {saving ? 'Saving…' : 'Save Platform Settings'}
          </Button>
        </div>
      </form>

      <div className="lg:col-span-5 space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-bold font-display text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-600" />
            External Integrations Status
          </h3>
          <div className="text-xs space-y-2.5 text-slate-600">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="font-semibold text-slate-900">Online Payment Gateway</p>
              <p className="mt-0.5">{paymentStatus.provider}</p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="font-semibold text-slate-900">Background Push Notifications (FCM)</p>
              <p className="mt-0.5">{fcmStatus.label}</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-sm font-bold font-display text-slate-900">Demo Environment Reset</h3>
          <p className="text-xs text-slate-500 mt-1">
            Restore Northridge Preparatory Academy and Crestview International School to clean demo state without affecting custom schools.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setConfirmReset(true)} disabled={seeding}>
            <RefreshCw className="w-3.5 h-3.5" />
            Re-Seed Demo Schools
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          onResetDemo();
        }}
        title="Reset Demo Schools?"
        description="This resets Northridge Preparatory Academy and Crestview International School demo records back to their initial baseline."
        confirmLabel="Reset Demo Data"
      />
    </div>
  );
}
