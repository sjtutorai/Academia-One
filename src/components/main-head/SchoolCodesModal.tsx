import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Search,
  Building2,
  BookOpen,
  Users,
} from 'lucide-react';
import {
  formatPrincipalCode,
  formatRoleCodeRange,
} from '../../lib/schoolCodes';
import { exportToCsv } from '../../lib/csv';
import { Button, EmptyState, Modal, StatusText } from '../ui/Primitives';
import type {
  SchoolClass,
  MemberAccessCode,
  School,
  SchoolCodeEntry,
} from '../../types/models';

interface SchoolCodesPanelProps {
  school: School;
  schoolCodeEntry?: SchoolCodeEntry;
  classes: SchoolClass[];
  memberCodes: MemberAccessCode[];
}

export function SchoolCodesPanel({
  school,
  schoolCodeEntry,
  classes,
  memberCodes,
}: SchoolCodesPanelProps) {
  const [roleFilter, setRoleFilter] = useState<'all' | 'coordinator' | 'teacher' | 'student'>('all');
  const [search, setSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = (key: string, val: string) => {
    if (!val) return;
    navigator.clipboard?.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const schoolPrefix = (school.code || school.schoolPrefix || '').toUpperCase();
  const principalCode = schoolCodeEntry?.principalCode || formatPrincipalCode(schoolPrefix || 'SCH');
  const coordAlloc = schoolCodeEntry?.coordinatorCount ?? school.allocatedCoordinators ?? 0;
  const teacherAlloc = schoolCodeEntry?.teacherCount ?? school.allocatedTeachers ?? 0;
  const studentAlloc = schoolCodeEntry?.studentCount ?? school.allocatedStudents ?? 0;

  const schoolClasses = useMemo(() => {
    const live = classes.filter((c) => c.schoolId === school.id);
    if (live.length > 0) {
      return live.map((c) => ({
        id: c.id,
        classCode: c.code,
        className: c.name,
        gradeLevel: c.gradeLevel,
        section: c.section,
        classTeacherName: c.classTeacherName || '',
      }));
    }
    return (schoolCodeEntry?.classSections || []).map((slot) => ({
      id: slot.classId,
      classCode: slot.classCode || `${slot.gradeLevel}-${slot.section}`,
      className: slot.className,
      gradeLevel: slot.gradeLevel,
      section: slot.section,
      classTeacherName: '',
    }));
  }, [classes, school.id, schoolCodeEntry]);

  const schoolMemberCodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return memberCodes
      .filter((m) => m.schoolId === school.id)
      .filter((m) => (roleFilter === 'all' ? true : m.role === roleFilter))
      .filter((m) => {
        if (!q) return true;
        return `${m.memberName} ${m.code} ${m.email || ''} ${m.classCode || ''} ${m.className || ''} ${m.teacherCode || ''} ${m.teacherName || ''}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [memberCodes, school.id, roleFilter, search]);

  const roleCounts = useMemo(() => {
    const list = memberCodes.filter((m) => m.schoolId === school.id);
    return {
      all: list.length,
      coordinator: list.filter((m) => m.role === 'coordinator').length,
      teacher: list.filter((m) => m.role === 'teacher').length,
      student: list.filter((m) => m.role === 'student').length,
    };
  }, [memberCodes, school.id]);

  const handleExportCsv = () => {
    exportToCsv(
      `${schoolPrefix || 'school'}_access_codes.csv`,
      [
        'School Name',
        'School Code',
        'Activation Code',
        'Role',
        'Member Name',
        'Member Code',
        'Class Code',
        'Class Name',
        'Teacher Code',
        'Teacher Name',
        'Email',
        'Status',
      ],
      [
        [
          school.name,
          schoolPrefix,
          school.activationCode || '',
          'principal',
          school.principalName || 'Principal',
          principalCode,
          '',
          '',
          '',
          '',
          school.principalEmail || '',
          school.status,
        ],
        ...schoolMemberCodes.map((m) => [
          school.name,
          m.schoolCode || schoolPrefix,
          school.activationCode || '',
          m.role,
          m.memberName,
          m.code,
          m.classCode || '',
          m.className || '',
          m.teacherCode || '',
          m.teacherName || '',
          m.email || '',
          m.status,
        ]),
      ],
    );
  };

  return (
    <div className="space-y-5">
      {/* Core School & Activation Codes */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">School Code (Prefix)</p>
            <p className="text-base font-bold font-mono text-[#0F295C] tracking-wider mt-0.5">
              {schoolPrefix || '—'}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => copyText('school_code', schoolPrefix)}>
            {copiedKey === 'school_code' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        </div>

        <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-blue-800">Main Head Activation Code</p>
            <p className="text-sm font-bold font-mono text-[#0F295C] tracking-wider mt-0.5 truncate">
              {school.activationCode || 'Not Required (Public App)'}
            </p>
          </div>
          {school.activationCode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copyText('activation_code', school.activationCode || '')}
            >
              {copiedKey === 'activation_code' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-teal-50/60 border border-teal-200 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-teal-800">Principal Code</p>
            <p className="text-base font-bold font-mono text-teal-900 tracking-wider mt-0.5">
              {principalCode}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => copyText('principal_code', principalCode)}>
            {copiedKey === 'principal_code' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* Role Code Allocations */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
        <div className="p-3 rounded-lg bg-white border border-slate-200">
          <p className="text-slate-500">Coordinator Code Range</p>
          <p className="font-mono font-bold text-slate-900 mt-0.5 tabular-nums">
            {coordAlloc > 0 ? formatRoleCodeRange(schoolPrefix || 'SCH', 'coordinator', coordAlloc) : `${schoolPrefix}C01+`}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-white border border-slate-200">
          <p className="text-slate-500">Teacher Code Range</p>
          <p className="font-mono font-bold text-slate-900 mt-0.5 tabular-nums">
            {teacherAlloc > 0 ? formatRoleCodeRange(schoolPrefix || 'SCH', 'teacher', teacherAlloc) : `${schoolPrefix}T01+`}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-white border border-slate-200">
          <p className="text-slate-500">Student Code Range</p>
          <p className="font-mono font-bold text-slate-900 mt-0.5 tabular-nums">
            {studentAlloc > 0 ? formatRoleCodeRange(schoolPrefix || 'SCH', 'student', studentAlloc) : `${schoolPrefix}S001+`}
          </p>
        </div>
      </div>

      {/* Class Codes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-teal-700" />
            Class Codes ({schoolClasses.length})
          </h4>
        </div>
        {schoolClasses.length === 0 ? (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
            No classes have been configured for this school yet. Class codes appear here once the Principal creates classes or completes campus setup.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
            {schoolClasses.map((cls) => (
              <button
                key={cls.id}
                type="button"
                onClick={() => copyText(`cls_${cls.id}`, cls.classCode)}
                className="text-left p-2.5 rounded-lg border border-slate-200 hover:border-teal-600 bg-white transition-colors cursor-pointer"
                title="Click to copy Class Code"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-xs font-bold text-[#0F295C]">{cls.classCode}</span>
                  {copiedKey === `cls_${cls.id}` ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3 text-slate-400" />
                  )}
                </div>
                <p className="text-[11px] text-slate-600 truncate mt-0.5">{cls.className}</p>
                {cls.classTeacherName && (
                  <p className="text-[10px] text-slate-400 truncate">{cls.classTeacherName}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Named Member Access Codes (Coordinators, Teachers, Students) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-[#2563EB]" />
            Issued Member Codes ({roleCounts.all})
          </h4>
          <Button variant="secondary" size="sm" onClick={handleExportCsv}>
            <Download className="w-3.5 h-3.5" />
            Export Codes CSV
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            {(
              [
                { id: 'all', label: `All (${roleCounts.all})` },
                { id: 'coordinator', label: `Coordinators (${roleCounts.coordinator})` },
                { id: 'teacher', label: `Teachers (${roleCounts.teacher})` },
                { id: 'student', label: `Students (${roleCounts.student})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setRoleFilter(t.id)}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  roleFilter === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, class…"
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        {schoolMemberCodes.length === 0 ? (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-4 text-center">
            No named Coordinator, Teacher, or Student codes match this filter yet. They appear automatically as soon as the school adds staff and students.
          </p>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Member</th>
                  <th className="py-2.5 px-3 font-semibold">Role</th>
                  <th className="py-2.5 px-3 font-semibold">Access Code</th>
                  <th className="py-2.5 px-3 font-semibold">Class / Teacher Codes</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Copy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schoolMemberCodes.map((m) => (
                  <tr key={m.code} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3">
                      <p className="font-semibold text-slate-900">{m.memberName}</p>
                      {m.email && <p className="text-[11px] text-slate-500">{m.email}</p>}
                    </td>
                    <td className="py-2.5 px-3 capitalize font-medium text-slate-700">{m.role}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-[#0F295C]">{m.code}</td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                      {m.classCode ? <span>Class: {m.classCode}</span> : <span>—</span>}
                      {m.teacherCode ? <span className="ml-2">Teacher: {m.teacherCode}</span> : null}
                    </td>
                    <td className="py-2.5 px-3">
                      <StatusText status={m.status} />
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const text =
                            m.role === 'student'
                              ? `School: ${m.schoolCode || schoolPrefix} | Class: ${m.classCode || '—'} | Teacher: ${m.teacherCode || '—'} | Student: ${m.code}`
                              : m.code;
                          copyText(`member_${m.code}`, text);
                        }}
                      >
                        {copiedKey === `member_${m.code}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {m.role === 'student' ? 'Copy 4 Codes' : 'Copy'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function SchoolCodesModal({
  school,
  schoolCodeEntry,
  classes,
  memberCodes,
  onClose,
}: {
  school: School | null;
  schoolCodeEntry?: SchoolCodeEntry;
  classes: SchoolClass[];
  memberCodes: MemberAccessCode[];
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(school)}
      onClose={onClose}
      title={school ? `${school.name} — All Access Codes` : ''}
      subtitle={
        school
          ? `School Code ${school.code} · View Activation Code, Principal Code, Class Codes, and Named Member Codes`
          : ''
      }
      maxWidth="max-w-4xl"
    >
      {school && (
        <SchoolCodesPanel
          school={school}
          schoolCodeEntry={schoolCodeEntry}
          classes={classes}
          memberCodes={memberCodes}
        />
      )}
    </Modal>
  );
}

export function MainHeadAccessCodesDirectory({
  schools,
  schoolCodes,
  classes,
  memberCodes,
}: {
  schools: School[];
  schoolCodes: SchoolCodeEntry[];
  classes: SchoolClass[];
  memberCodes: MemberAccessCode[];
}) {
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>(schools[0]?.id || '');

  const activeSchool = useMemo(
    () => schools.find((s) => s.id === selectedSchoolId) || schools[0] || null,
    [schools, selectedSchoolId],
  );

  if (schools.length === 0) {
    return (
      <EmptyState
        title="No schools registered yet"
        description="Register a school or approve a school application to inspect its School Code, Activation Code, Class Codes, and Member Access Codes."
      />
    );
  }

  const activeCodeEntry = activeSchool
    ? schoolCodes.find((sc) => sc.schoolId === activeSchool.id || sc.code === activeSchool.code)
    : undefined;

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0F295C] flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold font-display text-slate-900">
              Platform School &amp; Member Access Codes
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select any registered school to inspect its School Code, Main Head Activation Code, Principal Code, Class Codes, and Coordinator/Teacher/Student Codes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Building2 className="w-4 h-4 text-slate-400" />
          <select
            value={activeSchool?.id || ''}
            onChange={(e) => setSelectedSchoolId(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold bg-white text-slate-900 min-w-[220px]"
          >
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeSchool && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <SchoolCodesPanel
            school={activeSchool}
            schoolCodeEntry={activeCodeEntry}
            classes={classes}
            memberCodes={memberCodes}
          />
        </div>
      )}
    </div>
  );
}
