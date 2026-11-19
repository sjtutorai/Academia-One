import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  Check,
  FileSearch,
  HelpCircle,
  XCircle,
  ShieldCheck,
} from 'lucide-react';
import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, formatFirestoreDateTime } from '../../lib/firebase';
import { provisionSchoolTenant } from '../../lib/schoolProvisioning';
import { recordAuditLog } from '../../lib/audit';
import {
  Button,
  EmptyState,
  Modal,
  SkeletonTable,
  StatCard,
  StatusText,
  useToast,
} from '../../components/ui/Primitives';
import type {
  ApplicationStatusRecord,
  PlatformUser,
  SchoolApplication,
  SchoolApplicationStatus,
  SubscriptionPlan,
} from '../../types/models';

const STATUS_TABS: { id: 'all' | SchoolApplicationStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'under_review', label: 'Under Review' },
  { id: 'more_info_required', label: 'More Info' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

export function MainHeadApplicationsView({
  applications,
  plans,
  globalSearch,
  loading,
  actor,
}: {
  applications: SchoolApplication[];
  plans: SubscriptionPlan[];
  globalSearch: string;
  loading: boolean;
  actor: PlatformUser;
}) {
  const { pushToast } = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | SchoolApplicationStatus>('all');
  const [selectedApp, setSelectedApp] = useState<SchoolApplication | null>(null);
  const [selectedStatusRec, setSelectedStatusRec] = useState<ApplicationStatusRecord | null>(null);

  // Reviewer controls
  const [internalNotes, setInternalNotes] = useState('');
  const [applicantMessage, setApplicantMessage] = useState('');
  const [finalPlanId, setFinalPlanId] = useState('plan_standard');
  const [checklist, setChecklist] = useState({
    identityVerified: false,
    principalEmailConfirmed: false,
    capacityMatchesPlan: false,
  });
  const [processing, setProcessing] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const openReview = async (app: SchoolApplication) => {
    setSelectedApp(app);
    setInternalNotes(app.internalNotes || '');
    setApplicantMessage(app.applicantMessage || '');
    setFinalPlanId(app.requestedPlanId || plans[0]?.id || 'plan_standard');
    setChecklist({
      identityVerified: app.status === 'approved',
      principalEmailConfirmed: app.status === 'approved',
      capacityMatchesPlan: app.status === 'approved',
    });
    setSelectedStatusRec(null);
    try {
      const snap = await getDoc(doc(db, 'applicationStatuses', app.applicationNumber));
      if (snap.exists()) setSelectedStatusRec(snap.data() as ApplicationStatusRecord);
    } catch {
      // ignore optional status doc fetch error
    }
  };

  const filtered = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    return applications
      .filter((a) => {
        if (statusFilter !== 'all' && a.status !== statusFilter) return false;
        if (
          q &&
          !`${a.applicationNumber} ${a.schoolName} ${a.principalName} ${a.principalEmail} ${a.city || ''} ${a.affiliationBoard || ''}`
            .toLowerCase()
            .includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          ((b.createdAt as { seconds?: number })?.seconds || 0) -
          ((a.createdAt as { seconds?: number })?.seconds || 0),
      );
  }, [applications, statusFilter, globalSearch]);

  const counts = useMemo(() => {
    return {
      submitted: applications.filter((a) => a.status === 'submitted').length,
      underReview: applications.filter((a) => a.status === 'under_review').length,
      moreInfo: applications.filter((a) => a.status === 'more_info_required').length,
      approved: applications.filter((a) => a.status === 'approved').length,
    };
  }, [applications]);

  const handleTransitionStatus = async (
    nextStatus: 'under_review' | 'more_info_required' | 'rejected' | 'withdrawn',
  ) => {
    if (!selectedApp) return;
    if ((nextStatus === 'more_info_required' || nextStatus === 'rejected') && applicantMessage.trim().length < 5) {
      pushToast('error', 'Please enter a clear applicant-visible message explaining the decision or required clarification.');
      return;
    }

    setProcessing(true);
    try {
      const now = serverTimestamp();
      const batch = writeBatch(db);
      const nextLog = [
        ...(selectedApp.activityLog || []),
        {
          at: new Date().toISOString(),
          actor: actor.displayName,
          action: `STATUS_${nextStatus.toUpperCase()}`,
          note: applicantMessage.trim() || internalNotes.trim() || `Marked ${nextStatus.replace(/_/g, ' ')}.`,
        },
      ].slice(-50);

      const publicMsg =
        applicantMessage.trim() ||
        (nextStatus === 'under_review'
          ? 'Your school application is currently being reviewed by the Main Head verification team.'
          : nextStatus === 'withdrawn'
            ? 'This application has been marked withdrawn.'
            : '');

      batch.update(doc(db, 'schoolApplications', selectedApp.id), {
        status: nextStatus,
        internalNotes: internalNotes.trim().slice(0, 2000),
        applicantMessage: publicMsg.slice(0, 1000),
        decisionNote: applicantMessage.trim().slice(0, 500),
        reviewedBy: actor.uid,
        activityLog: nextLog,
        updatedAt: now,
      });

      // Public tracker NEVER receives internalReviewerNotes
      batch.update(doc(db, 'applicationStatuses', selectedApp.applicationNumber), {
        status: nextStatus,
        applicantMessage: publicMsg.slice(0, 1000),
        decisionNote: applicantMessage.trim().slice(0, 500),
        updatedAt: now,
      });

      await batch.commit();
      await recordAuditLog({
        schoolId: 'platform',
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: `APPLICATION_${nextStatus.toUpperCase()}`,
        targetType: 'schoolApplication',
        targetId: selectedApp.id,
        targetLabel: `${selectedApp.schoolName} (${selectedApp.applicationNumber})`,
        details: publicMsg,
      }).catch(() => undefined);

      pushToast('success', `Application ${selectedApp.applicationNumber} marked ${nextStatus.replace(/_/g, ' ')}.`);
      setSelectedApp(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to update application status.');
    } finally {
      setProcessing(false);
    }
  };

  const handleApproveAndProvision = async () => {
    if (!selectedApp) return;
    if (selectedApp.status === 'approved') {
      pushToast('info', 'This application is already approved and provisioned.');
      return;
    }

    setProcessing(true);
    try {
      const chosenPlan = plans.find((p) => p.id === finalPlanId) || {
        id: finalPlanId || 'plan_standard',
        name: 'Standard Academic',
        priceMonthly: 249,
        trialDays: 14,
      };

      const fullAddress = [
        selectedApp.address,
        selectedApp.city,
        selectedApp.stateRegion,
        selectedApp.country,
        selectedApp.postalCode,
      ]
        .filter(Boolean)
        .join(', ');

      const result = await provisionSchoolTenant({
        schoolName: selectedApp.schoolName,
        academicYear: selectedApp.academicYear || '2026-2027',
        address: fullAddress,
        schoolEmail: selectedApp.schoolEmail,
        schoolPhone: selectedApp.schoolPhone,
        schoolType: selectedApp.institutionType,
        board: selectedApp.affiliationBoard,
        logoDataUrl: selectedApp.logoDataUrl,
        principalName: selectedApp.principalName,
        principalEmail: selectedApp.principalEmail,
        plan: chosenPlan,
        source: 'public_application',
        actorUid: actor.uid,
        actorName: actor.displayName,
        application: selectedApp,
        decisionNote: applicantMessage.trim() || undefined,
      });

      pushToast(
        'success',
        `Approved ${selectedApp.schoolName}. Auto-issued School Code ${result.schoolCode} & bound Principal email.`,
      );
      setSelectedApp(null);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to approve and provision school.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <SkeletonTable rows={6} cols={6} />;

  return (
    <div className="space-y-6">
      {/* Top Queue KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="New Submissions" value={counts.submitted} tone="teal" subtext="Awaiting initial review" />
        <StatCard label="Under Review" value={counts.underReview} tone="amber" subtext="Active verification" />
        <StatCard label="More Info Requested" value={counts.moreInfo} tone="amber" subtext="Waiting on applicant" />
        <StatCard label="Approved Schools" value={counts.approved} subtext="Provisioned with School Code" />
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map((tab) => {
            const count =
              tab.id === 'all' ? applications.length : applications.filter((a) => a.status === tab.id).length;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                  statusFilter === tab.id ? 'bg-[#0B1528] text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          Approving an application auto-generates a unique School Code and activates Principal login.
        </p>
      </div>

      {/* Applications Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No school applications in this queue"
          description="Public 7-step school registration submissions from /register-school appear here for verification and approval."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">Application No.</th>
                <th className="py-3 px-4 font-semibold">School & Board</th>
                <th className="py-3 px-4 font-semibold">Principal Contact</th>
                <th className="py-3 px-4 font-semibold">Plan & Est. Size</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((app) => (
                <tr key={app.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4">
                    <p className="font-mono text-xs font-semibold text-slate-900">{app.applicationNumber}</p>
                    <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                      {formatFirestoreDateTime(app.createdAt)}
                    </p>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      {app.logoDataUrl && (
                        <img
                          src={app.logoDataUrl}
                          alt=""
                          className="w-8 h-8 rounded object-contain border border-slate-200 bg-white shrink-0"
                        />
                      )}
                      <div>
                        <p className="font-semibold text-slate-900">{app.schoolName}</p>
                        <p className="text-xs text-slate-500">
                          {app.affiliationBoard || app.institutionType || 'School'} · {[app.city, app.country].filter(Boolean).join(', ') || 'Location provided'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    <p className="font-medium text-slate-800">{app.principalName}</p>
                    <p className="text-slate-500">{app.principalEmail}</p>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    <p className="font-medium text-slate-800">
                      {plans.find((p) => p.id === app.requestedPlanId)?.name || app.requestedPlanId}
                    </p>
                    <p className="text-slate-500 tabular-nums">
                      {app.estimatedStudents} students · {app.estimatedTeachers} teachers
                    </p>
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={app.status} />
                    {app.approvedSchoolCode && (
                      <div className="flex items-center gap-1 mt-1">
                        <span className="font-mono text-[11px] text-teal-800 font-semibold">
                          {app.approvedSchoolCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(app.approvedSchoolCode || '');
                            setCopiedCode(app.approvedSchoolCode || null);
                            setTimeout(() => setCopiedCode(null), 1800);
                          }}
                          className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          aria-label="Copy school code"
                        >
                          {copiedCode === app.approvedSchoolCode ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button variant="secondary" size="sm" onClick={() => openReview(app)}>
                      <FileSearch className="w-3.5 h-3.5" />
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Full Application Review Modal */}
      <Modal
        open={Boolean(selectedApp)}
        onClose={() => setSelectedApp(null)}
        title={selectedApp ? `${selectedApp.schoolName}` : 'Review Application'}
        subtitle={
          selectedApp
            ? `Ref ${selectedApp.applicationNumber} · Submitted ${formatFirestoreDateTime(selectedApp.createdAt)}`
            : undefined
        }
        maxWidth="max-w-3xl"
      >
        {selectedApp && (
          <div className="space-y-5">
            {/* Status & Issued Code */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {selectedApp.logoDataUrl && (
                  <img
                    src={selectedApp.logoDataUrl}
                    alt={`${selectedApp.schoolName} logo`}
                    className="w-12 h-12 rounded-lg object-contain border border-slate-200 bg-white p-1"
                  />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <StatusText status={selectedApp.status} />
                    <span className="text-slate-300">·</span>
                    <span className="text-xs text-slate-500">{selectedApp.institutionType || 'School'}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {selectedApp.affiliationBoard || 'General Board'} · Est. {selectedApp.establishedYear || 'N/A'} · AY {selectedApp.academicYear}
                  </p>
                </div>
              </div>
              {selectedApp.approvedSchoolCode && (
                <div className="text-right">
                  <p className="text-[11px] text-slate-500">Issued School Code</p>
                  <p className="font-mono text-base font-bold text-teal-700">{selectedApp.approvedSchoolCode}</p>
                </div>
              )}
            </div>

            {/* Applicant Clarification Response if present */}
            {selectedStatusRec?.applicantResponseNote && (
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                <p className="text-xs font-semibold text-blue-900">Applicant Clarification Submitted</p>
                <p className="text-xs text-blue-800 mt-1 whitespace-pre-wrap">
                  {selectedStatusRec.applicantResponseNote}
                </p>
              </div>
            )}

            {/* Structured Summary Sections */}
            <div className="grid sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
                <p className="font-semibold text-slate-900">Institution & Campus</p>
                <p className="text-slate-600">Email: {selectedApp.schoolEmail}</p>
                <p className="text-slate-600">Phone: {selectedApp.schoolPhone || '—'}</p>
                {selectedApp.website && <p className="text-slate-600">Website: {selectedApp.website}</p>}
                <p className="text-slate-600">
                  Address: {[selectedApp.address, selectedApp.city, selectedApp.stateRegion, selectedApp.country, selectedApp.postalCode].filter(Boolean).join(', ')}
                </p>
                {selectedApp.district && <p className="text-slate-500">District: {selectedApp.district}</p>}
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
                <p className="font-semibold text-slate-900">Principal & Applicant</p>
                <p className="text-slate-700 font-medium">
                  {selectedApp.principalName} ({selectedApp.principalDesignation || 'Principal'})
                </p>
                <p className="text-slate-600 font-mono">{selectedApp.principalEmail}</p>
                <p className="text-slate-600">Phone: {selectedApp.principalPhone || '—'}</p>
                <p className="text-slate-500">
                  Applicant: {selectedApp.applicantName} ({selectedApp.applicantEmail})
                </p>
                <p className="text-slate-500">
                  Preferred Auth: {selectedApp.authMethod === 'google' ? 'Google Sign-In' : 'Email & Password'}
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
                <p className="font-semibold text-slate-900">Academic Scope</p>
                <p className="text-slate-600">Classes Offered: {selectedApp.classesOffered || 'Not specified'}</p>
                <p className="text-slate-600 tabular-nums">
                  Estimated: {selectedApp.estimatedStudents || 0} students · {selectedApp.estimatedTeachers || 0} teachers
                </p>
                <p className="text-slate-600">Medium: {selectedApp.mediumOfInstruction || 'English'}</p>
                <p className="text-slate-600">
                  Recognition / Affiliation Code: {selectedApp.externalRecognitionCode || 'None provided'}
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 space-y-1.5">
                <p className="font-semibold text-slate-900">Requested Plan & Compliance</p>
                <p className="text-slate-600">
                  Requested Plan: {plans.find((p) => p.id === selectedApp.requestedPlanId)?.name || selectedApp.requestedPlanId}
                </p>
                {selectedApp.workingDaysSummary && (
                  <p className="text-slate-600">Working Schedule: {selectedApp.workingDaysSummary}</p>
                )}
                <p className="text-emerald-700 font-medium">
                  Policy Consent Recorded: {selectedApp.consentPolicyVersion || 'v1.0'}
                </p>
                {selectedApp.organizationName && (
                  <p className="text-slate-500">Organization / Trust: {selectedApp.organizationName}</p>
                )}
              </div>
            </div>

            {/* Verification Checklist & Plan Confirmation */}
            {selectedApp.status !== 'approved' && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <ShieldCheck className="w-4 h-4 text-teal-700" />
                  Main Head Verification Checklist
                </div>
                <div className="grid sm:grid-cols-3 gap-2 text-xs text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checklist.identityVerified}
                      onChange={(e) => setChecklist({ ...checklist, identityVerified: e.target.checked })}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    School identity verified
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checklist.principalEmailConfirmed}
                      onChange={(e) => setChecklist({ ...checklist, principalEmailConfirmed: e.target.checked })}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    Principal email valid
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checklist.capacityMatchesPlan}
                      onChange={(e) => setChecklist({ ...checklist, capacityMatchesPlan: e.target.checked })}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    Capacity fits plan
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Confirmed Subscription Plan on Approval
                  </label>
                  <select
                    value={finalPlanId}
                    onChange={(e) => setFinalPlanId(e.target.value)}
                    className="w-full sm:w-80 text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (${p.priceMonthly}/mo · {p.maxStudents} students)
                      </option>
                    ))}
                    {plans.length === 0 && <option value="plan_standard">Standard Academic ($249/mo)</option>}
                  </select>
                </div>
              </div>
            )}

            {/* Internal Notes (Private) vs Applicant-Visible Message */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Internal Reviewer Notes (Main Head Only)
                </label>
                <textarea
                  rows={3}
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder="Private compliance or verification notes (never shown to applicants)…"
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Applicant-Visible Message / Decision Reason
                </label>
                <textarea
                  rows={3}
                  value={applicantMessage}
                  onChange={(e) => setApplicantMessage(e.target.value)}
                  placeholder="Visible on /application-status (required for Request Info or Reject)…"
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-teal-600"
                />
              </div>
            </div>

            {/* Chronological Activity Log */}
            {selectedApp.activityLog && selectedApp.activityLog.length > 0 && (
              <div className="pt-3 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-2">Application Timeline</p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto text-xs">
                  {selectedApp.activityLog.map((entry, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-2 text-slate-600">
                      <span>
                        <strong className="text-slate-800">{entry.action.replace(/_/g, ' ')}</strong> · {entry.actor}
                        {entry.note ? ` — ${entry.note}` : ''}
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                        {entry.at.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {selectedApp.status !== 'approved' ? (
              <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={processing}
                    onClick={() => handleTransitionStatus('under_review')}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    Keep Under Review
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={processing}
                    onClick={() => handleTransitionStatus('more_info_required')}
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    Request Info
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={processing}
                    onClick={() => handleTransitionStatus('rejected')}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </Button>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={processing}
                  onClick={handleApproveAndProvision}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {processing ? 'Provisioning…' : 'Approve & Issue School Code'}
                </Button>
              </div>
            ) : (
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-emerald-700">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <ClipboardCheck className="w-4 h-4" />
                  Provisioned as tenant {selectedApp.approvedSchoolId} ({selectedApp.approvedSchoolCode})
                </span>
                <Button variant="secondary" size="sm" onClick={() => setSelectedApp(null)}>
                  Close
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
