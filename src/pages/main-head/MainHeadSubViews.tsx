import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
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
import { formatFirestoreDateTime } from '../../lib/firebase';
import { exportToCsv } from '../../lib/csv';
import { Button } from '../../components/ui/Primitives';
import type { School, AuditLog } from '../../types/models';

const PIE_COLORS = ['#2563EB', '#EA4335', '#EAB308', '#16A34A'];

// ============================================================================
// Platform Analytics View with CSV Export (100% Free Schools Model)
// ============================================================================
export function MainHeadAnalyticsView({
  schools,
}: {
  schools: School[];
}) {
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredSchools = useMemo(
    () => (statusFilter === 'all' ? schools : schools.filter((s) => s.status === statusFilter)),
    [schools, statusFilter],
  );

  const statusBreakdown = useMemo(() => {
    const statuses = ['active', 'trial', 'suspended', 'archived'] as const;
    return statuses.map((st) => ({
      status: st.charAt(0).toUpperCase() + st.slice(1),
      Count: filteredSchools.filter((s) => s.status === st).length,
    }));
  }, [filteredSchools]);

  const boardDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    filteredSchools.forEach((s) => {
      const label = s.board || s.schoolType || 'Standard Campus';
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [filteredSchools]);

  const handleExport = () => {
    exportToCsv(
      'academiaone_platform_analytics.csv',
      ['School ID', 'Name', 'Code', 'Status', 'Access Tier', 'Teachers', 'Students', 'Demo'],
      filteredSchools.map((s) => [
        s.id,
        s.name,
        s.code,
        s.status,
        'Free Unlimited',
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
          <span className="font-medium text-slate-600">Filter by Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="all">All Registered Schools</option>
            <option value="active">Active Campuses</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <Button variant="secondary" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4" />
          Download CSV Report
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-sm font-bold font-display text-slate-900">Campus Status Breakdown</h3>
          <p className="text-xs text-slate-500 mb-4">Aggregated directly from live Firestore tenant records</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="Count" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-sm font-bold font-display text-slate-900">Schools by Education Board</h3>
          <p className="text-xs text-slate-500 mb-4">All registered campuses receive 100% free unlimited access</p>
          {boardDistribution.length === 0 ? (
            <p className="text-xs text-slate-500 py-16 text-center">No schools match this filter.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={boardDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                    {boardDistribution.map((_, idx) => (
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
    !filter.trim() ||
    `${l.action} ${l.actorName} ${l.targetLabel || ''} ${l.details || ''}`.toLowerCase().includes(filter.toLowerCase()),
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
                <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                  {formatFirestoreDateTime(l.createdAt)}
                </td>
                <td className="py-3 px-4 font-medium text-slate-900">
                  {l.actorName} <span className="text-slate-400">({l.actorRole})</span>
                </td>
                <td className="py-3 px-4 font-mono text-[#2563EB] font-medium">{l.action}</td>
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
