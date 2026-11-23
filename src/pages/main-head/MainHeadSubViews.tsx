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
import { exportToCsv } from '../../lib/csv';
import { Button } from '../../components/ui/Primitives';
import type { School } from '../../types/models';

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
      ['School ID', 'Name', 'Code', 'Status', 'Access Tier', 'Teachers', 'Students'],
      filteredSchools.map((s) => [
        s.id,
        s.name,
        s.code,
        s.status,
        'Free Unlimited',
        s.teacherCount || 0,
        s.studentCount || 0,
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
