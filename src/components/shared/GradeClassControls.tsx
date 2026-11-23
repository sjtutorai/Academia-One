import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Building2, Check, CheckSquare, Copy, GraduationCap, Layers, Square, X } from 'lucide-react';
import {
  formatStudentFourCodeMessage,
  groupClassesByGrade,
  summarizeClassesByGrade,
  type StudentFourCodePack,
} from '../../lib/schoolCodes';
import { MOTION_EASE } from '../../lib/motion';
import { Button, Modal, useToast } from '../ui/Primitives';
import type { SchoolClass } from '../../types/models';

// ============================================================================
// 1. Grade Dropdown -> Ordered Section Toggles Picker (Teachers & Coordinators)
// ============================================================================
export function GradeDropdownClassPicker({
  classes,
  selectedClassIds,
  onChange,
  label = 'Assigned Classes',
  helperText,
  disabled = false,
}: {
  classes: SchoolClass[];
  selectedClassIds: string[];
  onChange: (nextIds: string[]) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const gradeGroups = useMemo(() => groupClassesByGrade(classes), [classes]);
  const [activeGrade, setActiveGrade] = useState<string>(() => gradeGroups[0]?.gradeLevel || '');

  const resolvedGrade = useMemo(() => {
    if (gradeGroups.some((g) => g.gradeLevel === activeGrade)) return activeGrade;
    return gradeGroups[0]?.gradeLevel || '';
  }, [gradeGroups, activeGrade]);

  const currentGroup = useMemo(
    () => gradeGroups.find((g) => g.gradeLevel === resolvedGrade) || null,
    [gradeGroups, resolvedGrade],
  );

  const selectedSet = useMemo(() => new Set(selectedClassIds), [selectedClassIds]);

  const selectedSummaries = useMemo(() => {
    const selectedClasses = classes.filter((c) => selectedSet.has(c.id));
    return summarizeClassesByGrade(selectedClasses, classes);
  }, [classes, selectedSet]);

  if (gradeGroups.length === 0) {
    return (
      <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
        No classes or sections have been configured yet. Add classes first under Classes &amp; Subjects.
      </div>
    );
  }

  const currentSections = currentGroup?.sections || [];
  const allCurrentSelected =
    currentSections.length > 0 && currentSections.every((c) => selectedSet.has(c.id));
  const someCurrentSelected = currentSections.some((c) => selectedSet.has(c.id));

  const toggleSection = (classId: string) => {
    if (disabled) return;
    if (selectedSet.has(classId)) {
      onChange(selectedClassIds.filter((id) => id !== classId));
    } else {
      onChange([...selectedClassIds, classId]);
    }
  };

  const toggleAllInCurrentGrade = () => {
    if (disabled || !currentGroup) return;
    const idsInGrade = currentGroup.sections.map((c) => c.id);
    if (allCurrentSelected) {
      const drop = new Set(idsInGrade);
      onChange(selectedClassIds.filter((id) => !drop.has(id)));
    } else {
      const merged = new Set([...selectedClassIds, ...idsInGrade]);
      onChange(Array.from(merged));
    }
  };

  const removeGrade = (gradeLevel: string) => {
    if (disabled) return;
    const grp = gradeGroups.find((g) => g.gradeLevel === gradeLevel);
    if (!grp) return;
    const drop = new Set(grp.sections.map((c) => c.id));
    onChange(selectedClassIds.filter((id) => !drop.has(id)));
  };

  const selectAllSchool = () => {
    if (disabled) return;
    onChange(classes.map((c) => c.id));
  };

  const clearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-800">{label}</p>
          {helperText && <p className="text-[11px] text-slate-500 mt-0.5">{helperText}</p>}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            disabled={disabled}
            onClick={selectAllSchool}
            className="font-medium text-teal-700 hover:text-teal-900 disabled:opacity-40 cursor-pointer"
          >
            Select All Grades
          </button>
          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            disabled={disabled || selectedClassIds.length === 0}
            onClick={clearAll}
            className="font-medium text-slate-500 hover:text-red-600 disabled:opacity-40 cursor-pointer"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Step 1: Ordered Grade Dropdown + One-Click Select All for Grade */}
      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              1. Choose Grade / Class
            </label>
            <select
              value={resolvedGrade}
              disabled={disabled}
              onChange={(e) => setActiveGrade(e.target.value)}
              className="w-full px-3 py-2 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
            >
              {gradeGroups.map((group) => {
                const count = group.sections.filter((c) => selectedSet.has(c.id)).length;
                const statusSuffix =
                  count === 0
                    ? `(${group.sections.length} section${group.sections.length === 1 ? '' : 's'})`
                    : count === group.sections.length
                      ? `— All ${group.sections.length} selected`
                      : `— ${count} of ${group.sections.length} selected`;
                return (
                  <option key={group.gradeLevel} value={group.gradeLevel}>
                    {group.gradeLevel} {statusSuffix}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="sm:pt-5 shrink-0">
            <button
              type="button"
              disabled={disabled}
              onClick={toggleAllInCurrentGrade}
              className={`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                allCurrentSelected
                  ? 'bg-[#0F295C] text-white border-[#0F295C] hover:bg-[#173A7A]'
                  : someCurrentSelected
                    ? 'bg-teal-50 text-teal-800 border-teal-300 hover:bg-teal-100'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {allCurrentSelected ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5" />
                  All {resolvedGrade} Selected
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5" />
                  Select All {resolvedGrade}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Step 2: Ordered A-Z Sections inside Selected Grade */}
        {currentGroup && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-slate-600">
              2. Toggle Sections in {currentGroup.gradeLevel} (Ordered A–Z)
            </p>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentGroup.gradeLevel}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: MOTION_EASE.out }}
                className="grid grid-cols-2 sm:grid-cols-4 gap-2"
              >
                {currentGroup.sections.map((cl) => {
                  const isSel = selectedSet.has(cl.id);
                  return (
                    <button
                      key={cl.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleSection(cl.id)}
                      className={`px-3 py-2 text-xs rounded-lg border transition-all duration-150 flex items-center justify-between gap-2 cursor-pointer ${
                        isSel
                          ? 'bg-[#0F295C] text-white border-[#0F295C] shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-teal-400 hover:bg-teal-50/40'
                      }`}
                    >
                      <span className="font-semibold truncate">Section {cl.section}</span>
                      <span
                        className={`font-mono text-[11px] shrink-0 ${
                          isSel ? 'text-teal-200' : 'text-slate-400'
                        }`}
                      >
                        {cl.code}
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Selected Ordered Grade Summary */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-slate-500 tabular-nums">
          Selected Scope ({selectedClassIds.length} section{selectedClassIds.length === 1 ? '' : 's'} across{' '}
          {selectedSummaries.length} grade{selectedSummaries.length === 1 ? '' : 's'})
        </p>
        {selectedSummaries.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No classes selected yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedSummaries.map((item) => (
              <motion.div
                key={item.gradeLevel}
                initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, ease: MOTION_EASE.out }}
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-800"
              >
                <span className="font-semibold text-[#0F295C]">{item.gradeLevel}</span>
                <span className="text-slate-400" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-600">{item.sectionsLabel}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeGrade(item.gradeLevel)}
                    aria-label={`Remove ${item.gradeLevel}`}
                    className="text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 2. Animated Ordered Assigned Classes Panel (Coordinator & Teacher Dashboards)
// ============================================================================
export function AnimatedAssignedClassesPanel({
  assignedClasses,
  allSchoolClasses,
  emptyLabel = 'No classes assigned yet',
  title = 'Assigned Classes',
}: {
  assignedClasses: SchoolClass[];
  allSchoolClasses?: SchoolClass[];
  emptyLabel?: string;
  title?: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  const summaries = useMemo(
    () => summarizeClassesByGrade(assignedClasses, allSchoolClasses || assignedClasses),
    [assignedClasses, allSchoolClasses],
  );

  if (summaries.length === 0) {
    return (
      <div className="pt-3 border-t border-slate-100">
        <p className="text-xs font-medium text-slate-500">{title}</p>
        <p className="text-xs text-slate-400 mt-1">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="pt-4 border-t border-slate-100 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-teal-600" />
          {title}
        </p>
        <p className="text-xs text-slate-500 tabular-nums">
          {summaries.length} Grade{summaries.length === 1 ? '' : 's'} · {assignedClasses.length} Section
          {assignedClasses.length === 1 ? '' : 's'}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {summaries.map((group, idx) => (
          <motion.div
            key={group.gradeLevel}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.2,
              delay: prefersReducedMotion ? 0 : Math.min(idx * 0.04, 0.28),
              ease: MOTION_EASE.out,
            }}
            className="p-3 rounded-lg bg-slate-50/90 border border-slate-200/90 hover:border-teal-300 hover:bg-white transition-colors"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-bold font-display text-[#0F295C]">{group.gradeLevel}</p>
              <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                {group.assignedCount} sec
              </span>
            </div>
            <p className="text-xs text-teal-800 font-medium mt-1">
              {group.sectionsLabel}
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 3. Separate Standalone School Code Banner Card
// ============================================================================
export function SeparateSchoolCodeCard({
  schoolCode,
  schoolName,
  subtitle = 'Share this School Code separately with students and staff when they join your campus.',
}: {
  schoolCode: string;
  schoolName?: string;
  subtitle?: string;
}) {
  const { pushToast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!schoolCode) return;
    navigator.clipboard?.writeText(schoolCode);
    setCopied(true);
    pushToast('success', `School Code ${schoolCode} copied.`);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-start gap-3.5 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-[#0F295C] text-white flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-teal-700">
            School Code{schoolName ? ` · ${schoolName}` : ''}
          </p>
          <div className="flex flex-wrap items-baseline gap-2.5 mt-0.5">
            <span className="text-2xl font-bold font-mono tracking-wider text-[#0F295C] tabular-nums">
              {schoolCode || '—'}
            </span>
            <span className="text-xs text-slate-500">
              Required as Code 1 of 4 for student login
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
        </div>
      </div>

      <Button variant="primary" size="sm" onClick={handleCopy} disabled={!schoolCode} className="shrink-0">
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? 'School Code Copied' : 'Copy School Code'}
      </Button>
    </div>
  );
}

// ============================================================================
// 4. Student 4-Code Login Pack Modal (View & Copy Individual or All 4 Codes)
// ============================================================================
export function StudentFourCodesModal({
  pack,
  onClose,
}: {
  pack: StudentFourCodePack | null;
  onClose: () => void;
}) {
  const { pushToast } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyValue = (key: string, value: string, label: string) => {
    if (!value) return;
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    pushToast('success', `${label} copied.`);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  if (!pack) return null;

  const fullMessage = formatStudentFourCodeMessage(pack);
  const rows = [
    {
      key: 'school',
      step: '1',
      label: 'School Code',
      value: pack.schoolCode,
      meta: pack.schoolName || 'Campus Identifier',
    },
    {
      key: 'class',
      step: '2',
      label: 'Class & Section Code',
      value: pack.classCode,
      meta: pack.className || 'Assign a class to generate this code',
    },
    {
      key: 'teacher',
      step: '3',
      label: 'Class Teacher Code',
      value: pack.teacherCode,
      meta: pack.teacherName
        ? `Class Teacher: ${pack.teacherName}`
        : 'Assign a Class Teacher under Classes & Subjects',
    },
    {
      key: 'student',
      step: '4',
      label: 'Student Access Code',
      value: pack.studentCode,
      meta: pack.rollNumber ? `Roll #${pack.rollNumber}` : 'Unique Student Code',
    },
  ];

  return (
    <Modal
      open={Boolean(pack)}
      onClose={onClose}
      title={`Student Login Codes — ${pack.studentName}`}
      subtitle="Share all 4 codes with the student to complete Join School verification."
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
          {rows.map((row) => (
            <div key={row.key} className="p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">
                  {row.step}. {row.label}
                </p>
                <p
                  className={`text-sm font-mono font-bold mt-0.5 tabular-nums ${
                    row.value ? 'text-[#0F295C]' : 'text-amber-700'
                  }`}
                >
                  {row.value || 'Not assigned yet'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">{row.meta}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={!row.value}
                onClick={() => copyValue(row.key, row.value, row.label)}
              >
                {copiedKey === row.key ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-teal-600" />
              Ready-to-Share Message Preview
            </p>
          </div>
          <pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap leading-relaxed">
            {fullMessage}
          </pre>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => copyValue('all', fullMessage, 'All 4 Student Login Codes')}
          >
            {copiedKey === 'all' ? (
              <>
                <Check className="w-4 h-4" /> All 4 Codes Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> Copy All 4 Login Codes
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
