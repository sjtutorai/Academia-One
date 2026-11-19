import React, { useMemo, useState } from 'react';
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { Plus, Upload, Download, ArrowRightLeft, History, AlertCircle, CheckCircle2 } from 'lucide-react';
import { db, generateId, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  downloadStudentTemplateCsv,
  exportToCsv,
  parseCsvText,
  validateStudentImportRows,
  type ParsedCsvRow,
} from '../../lib/csv';
import { recordAuditLog } from '../../lib/audit';
import { emailToKey, upsertEmailDirectoryEntry } from '../../lib/schoolProvisioning';
import { sanitizePhoneDigits } from '../../lib/schoolCodes';
import {
  Button,
  EmptyState,
  Modal,
  PaginationBar,
  SkeletonTable,
  StatusText,
  useToast,
} from '../../components/ui/Primitives';
import type {
  PlatformUser,
  Room,
  SchoolClass,
  StudentProfile,
  Subject,
  TeacherProfile,
  Examination,
} from '../../types/models';

// ============================================================================
// Students Management + Validated Bulk CSV Import/Export + Transfer/Promote
// ============================================================================
export function PrincipalStudentsView({
  students,
  classes,
  schoolId,
  academicYear,
  actor,
  canWrite,
  globalSearch,
  loading,
}: {
  students: StudentProfile[];
  classes: SchoolClass[];
  schoolId: string;
  academicYear: string;
  actor: PlatformUser;
  canWrite: boolean;
  globalSearch: string;
  loading: boolean;
}) {
  const { pushToast } = useToast();
  const [classFilter, setClassFilter] = useState('all');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StudentProfile | null>(null);
  const [historyStudent, setHistoryStudent] = useState<StudentProfile | null>(null);
  const [transferStudent, setTransferStudent] = useState<StudentProfile | null>(null);
  const [targetClassId, setTargetClassId] = useState('');
  const [transferType, setTransferType] = useState<'transfer' | 'promote'>('transfer');

  // Bulk CSV Import Wizard State
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<ParsedCsvRow[]>([]);
  const [importingCsv, setImportingCsv] = useState(false);

  const [form, setForm] = useState({
    admissionNumber: '',
    rollNumber: '',
    name: '',
    email: '',
    classId: '',
    guardianName: '',
    guardianPhone: '',
    guardianEmail: '',
    status: 'active' as StudentProfile['status'],
  });

  const filtered = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    return students.filter((s) => {
      if (classFilter !== 'all' && s.classId !== classFilter) return false;
      if (q && !`${s.name} ${s.admissionNumber} ${s.rollNumber} ${s.className}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [students, classFilter, globalSearch]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openNew = () => {
    setEditing(null);
    setForm({
      admissionNumber: `ADM-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 899)}`,
      rollNumber: String(students.length + 1).padStart(2, '0'),
      name: '',
      email: '',
      classId: classes[0]?.id || '',
      guardianName: '',
      guardianPhone: '',
      guardianEmail: '',
      status: 'active',
    });
    setModalOpen(true);
  };

  const openEdit = (st: StudentProfile) => {
    setEditing(st);
    setForm({
      admissionNumber: st.admissionNumber,
      rollNumber: st.rollNumber,
      name: st.name,
      email: st.email || '',
      classId: st.classId,
      guardianName: st.guardianName || '',
      guardianPhone: st.guardianPhone || '',
      guardianEmail: st.guardianEmail || '',
      status: st.status,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const cls = classes.find((c) => c.id === form.classId);
    if (!cls) {
      pushToast('error', 'Select a valid class/section.');
      return;
    }
    const dupAdm = students.find(
      (s) => s.admissionNumber.toLowerCase() === form.admissionNumber.trim().toLowerCase() && s.id !== editing?.id,
    );
    if (dupAdm) {
      pushToast('error', `Admission number "${form.admissionNumber}" already exists in this school.`);
      return;
    }

    try {
      if (editing) {
        await updateDoc(doc(db, 'students', editing.id), {
          admissionNumber: form.admissionNumber.trim().slice(0, 32),
          rollNumber: form.rollNumber.trim().slice(0, 24),
          name: form.name.trim().slice(0, 120),
          email: form.email.trim().toLowerCase().slice(0, 160),
          classId: cls.id,
          className: cls.name,
          section: cls.section,
          guardianName: form.guardianName.trim().slice(0, 120),
          guardianPhone: form.guardianPhone.trim().slice(0, 32),
          guardianEmail: form.guardianEmail.trim().slice(0, 160),
          status: form.status,
          updatedAt: serverTimestamp(),
        });
        const cleanStudentEmail = form.email.trim().toLowerCase().slice(0, 160);
        if (cleanStudentEmail) {
          await upsertEmailDirectoryEntry({
            email: cleanStudentEmail,
            schoolId,
            role: 'student',
            displayName: form.name.trim(),
            linkedProfileId: editing.id,
            classId: cls.id,
            section: cls.section,
            createdBy: actor.uid,
          }).catch(() => undefined);
        }
        pushToast('success', `Updated student ${form.name.trim()}.`);
      } else {
        const id = generateId('stu');
        const cleanStudentEmail = form.email.trim().toLowerCase().slice(0, 160);
        await setDoc(doc(db, 'students', id), {
          id,
          schoolId,
          userId: '',
          admissionNumber: form.admissionNumber.trim().slice(0, 32),
          rollNumber: form.rollNumber.trim().slice(0, 24),
          name: form.name.trim().slice(0, 120),
          email: cleanStudentEmail,
          classId: cls.id,
          className: cls.name,
          section: cls.section,
          academicYear,
          guardianName: form.guardianName.trim().slice(0, 120),
          guardianPhone: form.guardianPhone.trim().slice(0, 32),
          guardianEmail: form.guardianEmail.trim().slice(0, 160),
          status: form.status,
          history: [{ date: new Date().toISOString().slice(0, 10), event: `Enrolled in ${cls.name}`, academicYear }],
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (cleanStudentEmail) {
          await upsertEmailDirectoryEntry({
            email: cleanStudentEmail,
            schoolId,
            role: 'student',
            displayName: form.name.trim(),
            linkedProfileId: id,
            classId: cls.id,
            section: cls.section,
            createdBy: actor.uid,
          }).catch(() => undefined);
        }
        await updateDoc(doc(db, 'schools', schoolId), {
          studentCount: students.length + 1,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
        pushToast('success', `Registered student ${form.name.trim()}.`);
      }
      setModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'students');
    }
  };

  const handleTransferOrPromote = async () => {
    if (!transferStudent || !targetClassId || !canWrite) return;
    const nextCls = classes.find((c) => c.id === targetClassId);
    if (!nextCls) return;

    const eventText =
      transferType === 'promote'
        ? `Promoted from ${transferStudent.className} to ${nextCls.name}`
        : `Transferred from ${transferStudent.className} to ${nextCls.name}`;

    const nextHistory = [
      ...(transferStudent.history || []),
      {
        date: new Date().toISOString().slice(0, 10),
        event: eventText,
        fromClass: transferStudent.className,
        toClass: nextCls.name,
        academicYear,
      },
    ].slice(-40);

    await updateDoc(doc(db, 'students', transferStudent.id), {
      classId: nextCls.id,
      className: nextCls.name,
      section: nextCls.section,
      status: transferType === 'promote' ? 'promoted' : 'active',
      history: nextHistory,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      schoolId,
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      action: transferType === 'promote' ? 'PROMOTE_STUDENT' : 'TRANSFER_STUDENT',
      targetType: 'student',
      targetId: transferStudent.id,
      targetLabel: transferStudent.name,
      details: eventText,
    });
    pushToast('success', eventText);
    setTransferStudent(null);
  };

  const handleCsvFileUpload = async (file: File) => {
    const text = await file.text();
    const { rows } = parseCsvText(text);
    const existingAdm = new Set(students.map((s) => s.admissionNumber.toLowerCase()));
    const validCodes = new Set(classes.map((c) => c.code.toUpperCase()));
    const validated = validateStudentImportRows(
      rows,
      {
        admissionNumber: 'admissionNumber',
        rollNumber: 'rollNumber',
        name: 'name',
        email: 'email',
        classCode: 'classCode',
        guardianName: 'guardianName',
        guardianPhone: 'guardianPhone',
      },
      existingAdm,
      validCodes,
    );
    setCsvPreview(validated);
  };

  const commitValidCsvRows = async () => {
    const validRows = csvPreview.filter((r) => r.errors.length === 0);
    if (validRows.length === 0 || !canWrite) return;
    setImportingCsv(true);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      validRows.forEach((r) => {
        const cls = classes.find((c) => c.code.toUpperCase() === (r.raw.classCode || '').trim().toUpperCase()) || classes[0];
        if (!cls) return;
        const id = generateId('stu');
        const cleanCsvEmail = (r.raw.email || '').trim().toLowerCase().slice(0, 160);
        batch.set(doc(db, 'students', id), {
          id,
          schoolId,
          userId: '',
          admissionNumber: r.raw.admissionNumber.trim().slice(0, 32),
          rollNumber: r.raw.rollNumber.trim().slice(0, 24),
          name: r.raw.name.trim().slice(0, 120),
          email: cleanCsvEmail,
          classId: cls.id,
          className: cls.name,
          section: cls.section,
          academicYear,
          guardianName: (r.raw.guardianName || '').trim().slice(0, 120),
          guardianPhone: (r.raw.guardianPhone || '').trim().slice(0, 32),
          guardianEmail: '',
          status: 'active',
          history: [{ date: new Date().toISOString().slice(0, 10), event: `Bulk CSV import into ${cls.name}`, academicYear }],
          createdBy: actor.uid,
          createdAt: now,
          updatedAt: now,
        });
        if (cleanCsvEmail) {
          const emailKey = emailToKey(cleanCsvEmail);
          batch.set(doc(db, 'emailDirectory', emailKey), {
            emailKey,
            email: cleanCsvEmail,
            schoolId,
            schoolName: '',
            role: 'student',
            displayName: r.raw.name.trim().slice(0, 120),
            linkedProfileId: id,
            classId: cls.id,
            section: cls.section,
            assignedClassIds: [],
            status: 'active',
            createdBy: actor.uid,
            createdAt: now,
            updatedAt: now,
          });
        }
      });
      await batch.commit();
      await updateDoc(doc(db, 'schools', schoolId), {
        studentCount: students.length + validRows.length,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
      await recordAuditLog({
        schoolId,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'BULK_CSV_STUDENT_IMPORT',
        targetType: 'students',
        targetId: schoolId,
        targetLabel: `${validRows.length} students imported`,
      });
      pushToast('success', `Imported ${validRows.length} validated students.`);
      setCsvPreview([]);
      setCsvOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'students/bulkImport');
    } finally {
      setImportingCsv(false);
    }
  };

  if (loading) return <SkeletonTable rows={6} cols={6} />;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <select
          value={classFilter}
          onChange={(e) => { setClassFilter(e.target.value); setPage(1); }}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white"
        >
          <option value="all">All Classes ({students.length})</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportToCsv(
                `students_${schoolId}.csv`,
                ['Admission No', 'Roll No', 'Name', 'Class', 'Section', 'Academic Year', 'Guardian', 'Guardian Phone', 'Status'],
                filtered.map((s) => [s.admissionNumber, s.rollNumber, s.name, s.className, s.section, s.academicYear, s.guardianName || '', s.guardianPhone || '', s.status]),
              )
            }
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCsvOpen(true)} disabled={!canWrite}>
            <Upload className="w-3.5 h-3.5" />
            Bulk CSV Import
          </Button>
          <Button variant="primary" size="sm" onClick={openNew} disabled={!canWrite}>
            <Plus className="w-4 h-4" />
            Register Student
          </Button>
        </div>
      </div>

      {paged.length === 0 ? (
        <EmptyState title="No students enrolled" description="Register an individual student or upload a validated CSV roster." actionLabel="Register Student" onAction={openNew} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">Adm / Roll</th>
                <th className="py-3 px-4 font-semibold">Student Name</th>
                <th className="py-3 px-4 font-semibold">Class & Section</th>
                <th className="py-3 px-4 font-semibold">Guardian Contact</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.map((st) => (
                <tr key={st.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums">
                    <p className="font-semibold text-slate-900">{st.admissionNumber}</p>
                    <p className="text-slate-500">Roll #{st.rollNumber}</p>
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-900">{st.name}</p>
                    <p className="text-xs text-slate-500">{st.email || '—'}</p>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">{st.className} · AY {st.academicYear}</td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    <p>{st.guardianName || '—'}</p>
                    <p className="text-slate-500">{st.guardianPhone || ''}</p>
                  </td>
                  <td className="py-3 px-4"><StatusText status={st.status} /></td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setHistoryStudent(st)} title="Student History">
                        <History className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => {
                          setTransferStudent(st);
                          setTargetClassId(classes.find((c) => c.id !== st.classId)?.id || st.classId);
                        }}
                        title="Transfer / Promote"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => openEdit(st)} disabled={!canWrite}>
                        Edit
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

      {/* Individual Student Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.name}` : 'Register Student'} maxWidth="max-w-xl">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Admission No *</label>
              <input type="text" required value={form.admissionNumber} onChange={(e) => setForm({ ...form, admissionNumber: e.target.value })} className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Roll No *</label>
              <input type="text" required value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Class *</label>
              <select required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Student Full Name *</label>
              <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Student Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Guardian Name</label>
              <input type="text" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Guardian Phone (Numbers only)</label>
              <input type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={15} value={form.guardianPhone} onChange={(e) => setForm({ ...form, guardianPhone: sanitizePhoneDigits(e.target.value) })} placeholder="9876543210" className="w-full px-3 py-2 text-sm tabular-nums border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StudentProfile['status'] })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="active">Active</option>
                <option value="promoted">Promoted</option>
                <option value="transferred">Transferred</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Save Student</Button>
          </div>
        </form>
      </Modal>

      {/* Bulk CSV Import Modal */}
      <Modal
        open={csvOpen}
        onClose={() => { setCsvOpen(false); setCsvPreview([]); }}
        title="Bulk CSV Student Import Wizard"
        subtitle="Download template, validate duplicates & class codes row-by-row, then confirm import."
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-xs text-slate-600">
              <p className="font-semibold text-slate-900">Step 1: Use the validated template</p>
              <p className="mt-0.5">Columns: admissionNumber, rollNumber, name, email, classCode, guardianName, guardianPhone</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => downloadStudentTemplateCsv(classes[0]?.code || 'G10A')}>
              <Download className="w-3.5 h-3.5" />
              Download CSV Template
            </Button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Step 2: Upload .csv Spreadsheet</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleCsvFileUpload(file);
              }}
              className="block w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-white hover:file:bg-slate-50"
            />
          </div>

          {csvPreview.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-900">
                  Validation Preview: {csvPreview.filter((r) => r.errors.length === 0).length} valid ·{' '}
                  {csvPreview.filter((r) => r.errors.length > 0).length} errors
                </span>
              </div>
              <div className="border border-slate-200 rounded-lg max-h-60 overflow-y-auto divide-y divide-slate-100 text-xs">
                {csvPreview.map((r) => (
                  <div key={r.rowNumber} className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">
                        Row {r.rowNumber}: {r.raw.name || '(Unnamed)'} · {r.raw.admissionNumber || 'No Adm#'} · {r.raw.classCode}
                      </p>
                      {r.errors.length > 0 && (
                        <p className="text-red-600 mt-0.5 flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          {r.errors.join(' · ')}
                        </p>
                      )}
                    </div>
                    {r.errors.length === 0 && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setCsvPreview([])}>Clear</Button>
                <Button
                  variant="primary"
                  disabled={importingCsv || csvPreview.filter((r) => r.errors.length === 0).length === 0}
                  onClick={commitValidCsvRows}
                >
                  {importingCsv ? 'Importing…' : `Import ${csvPreview.filter((r) => r.errors.length === 0).length} Valid Students`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Transfer / Promote Modal */}
      <Modal open={Boolean(transferStudent)} onClose={() => setTransferStudent(null)} title={`Transfer / Promote · ${transferStudent?.name || ''}`} maxWidth="max-w-md">
        {transferStudent && (
          <div className="space-y-4">
            <p className="text-xs text-slate-600">
              Current placement: <strong>{transferStudent.className}</strong>. Historical records are preserved automatically.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setTransferType('transfer')} className={`flex-1 py-2 text-xs font-medium rounded-lg border cursor-pointer ${transferType === 'transfer' ? 'bg-[#0B1528] text-white border-[#0B1528]' : 'border-slate-300'}`}>
                Transfer Section
              </button>
              <button type="button" onClick={() => setTransferType('promote')} className={`flex-1 py-2 text-xs font-medium rounded-lg border cursor-pointer ${transferType === 'promote' ? 'bg-[#0B1528] text-white border-[#0B1528]' : 'border-slate-300'}`}>
                Promote Next Grade
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Destination Class</label>
              <select value={targetClassId} onChange={(e) => setTargetClassId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setTransferStudent(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleTransferOrPromote}>Confirm Move</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Student History Modal */}
      <Modal open={Boolean(historyStudent)} onClose={() => setHistoryStudent(null)} title={`Academic History · ${historyStudent?.name || ''}`} maxWidth="max-w-md">
        {historyStudent && (
          <div className="space-y-3 text-xs">
            {(historyStudent.history || []).length === 0 ? (
              <p className="text-slate-500">No historical transitions recorded yet.</p>
            ) : (
              (historyStudent.history || []).map((h, i) => (
                <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="font-semibold text-slate-900">{h.event}</p>
                  <p className="text-slate-500 mt-0.5 tabular-nums">{h.date} · AY {h.academicYear || historyStudent.academicYear}</p>
                </div>
              ))
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
// Classes, Sections & Subjects Management
// ============================================================================
export function PrincipalClassesSubjectsView({
  classes,
  subjects,
  teachers,
  students,
  rooms,
  schoolId,
  academicYear,
  actor,
  canWrite,
}: {
  classes: SchoolClass[];
  subjects: Subject[];
  teachers: TeacherProfile[];
  students: StudentProfile[];
  rooms: Room[];
  schoolId: string;
  academicYear: string;
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [classModal, setClassModal] = useState(false);
  const [subModal, setSubModal] = useState(false);
  const [classForm, setClassForm] = useState({
    gradeLevel: '10',
    section: 'C',
    code: 'G10C',
    capacity: '32',
    classTeacherId: '',
    roomId: '',
  });
  const [subForm, setSubForm] = useState({
    name: '',
    code: '',
    classId: classes[0]?.id || '',
    teacherId: '',
  });

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const cleanCode = classForm.code.trim().toUpperCase();
    const dup = classes.find((c) => c.code.toUpperCase() === cleanCode && c.academicYear === academicYear);
    if (dup) {
      pushToast('error', `Duplicate class code "${cleanCode}" already exists in ${academicYear}.`);
      return;
    }
    const id = generateId('cls');
    const teacher = teachers.find((t) => t.id === classForm.classTeacherId);
    const room = rooms.find((r) => r.id === classForm.roomId);
    try {
      await setDoc(doc(db, 'classes', id), {
        id,
        schoolId,
        name: `Grade ${classForm.gradeLevel.trim()} - Section ${classForm.section.trim().toUpperCase()}`,
        gradeLevel: classForm.gradeLevel.trim(),
        section: classForm.section.trim().toUpperCase(),
        code: cleanCode,
        academicYear,
        capacity: Math.max(1, Number(classForm.capacity) || 30),
        classTeacherId: teacher?.id || '',
        classTeacherName: teacher?.name || '',
        roomId: room?.id || '',
        roomName: room?.name || '',
        status: 'active',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', `Created class ${cleanCode}.`);
      setClassModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `classes/${id}`);
    }
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const cls = classes.find((c) => c.id === subForm.classId);
    if (!cls) return;
    const teacher = teachers.find((t) => t.id === subForm.teacherId);
    const id = generateId('sub');
    try {
      await setDoc(doc(db, 'subjects', id), {
        id,
        schoolId,
        name: subForm.name.trim().slice(0, 100),
        code: subForm.code.trim().toUpperCase().slice(0, 24),
        classId: cls.id,
        className: cls.name,
        teacherId: teacher?.id || '',
        teacherName: teacher?.name || '',
        status: 'active',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', `Added subject ${subForm.name.trim()}.`);
      setSubModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `subjects/${id}`);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold font-display text-slate-900">Classes & Sections</h2>
            <p className="text-xs text-slate-500">Duplicate class/section codes within {academicYear} are prevented automatically.</p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setClassModal(true)} disabled={!canWrite}>
            <Plus className="w-4 h-4" />
            Add Class / Section
          </Button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map((c) => {
            const enrolled = students.filter((s) => s.classId === c.id && s.status === 'active').length;
            const classSubjects = subjects.filter((s) => s.classId === c.id);
            return (
              <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-teal-700">{c.code}</span>
                  <span className="text-xs text-slate-500 tabular-nums">{enrolled} / {c.capacity} seats</span>
                </div>
                <h3 className="text-base font-bold font-display text-slate-900 mt-1">{c.name}</h3>
                <p className="text-xs text-slate-600 mt-1">Class Teacher: {c.classTeacherName || 'Unassigned'}</p>
                <p className="text-xs text-slate-500">Room: {c.roomName || 'Unassigned'}</p>
                <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
                  Subjects ({classSubjects.length}): {classSubjects.map((s) => s.name).join(', ') || 'None yet'}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Subjects Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold font-display text-slate-900">Subjects & Faculty Allocation</h2>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canWrite || classes.length === 0}
            onClick={() => {
              setSubForm({ name: '', code: '', classId: classes[0]?.id || '', teacherId: teachers[0]?.id || '' });
              setSubModal(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Add Subject
          </Button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-3 px-4 font-semibold">Code</th>
                <th className="py-3 px-4 font-semibold">Subject</th>
                <th className="py-3 px-4 font-semibold">Class</th>
                <th className="py-3 px-4 font-semibold">Assigned Teacher</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subjects.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{s.code}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{s.name}</td>
                  <td className="py-3 px-4 text-xs text-slate-700">{s.className}</td>
                  <td className="py-3 px-4 text-xs text-slate-700">{s.teacherName || 'Unassigned'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={classModal} onClose={() => setClassModal(false)} title="Create Class & Section" maxWidth="max-w-md">
        <form onSubmit={handleCreateClass} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Grade *</label>
              <input type="text" required value={classForm.gradeLevel} onChange={(e) => setClassForm({ ...classForm, gradeLevel: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Section *</label>
              <input type="text" required value={classForm.section} onChange={(e) => setClassForm({ ...classForm, section: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Code *</label>
              <input type="text" required value={classForm.code} onChange={(e) => setClassForm({ ...classForm, code: e.target.value.toUpperCase() })} className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Capacity</label>
              <input type="number" min={5} max={200} value={classForm.capacity} onChange={(e) => setClassForm({ ...classForm, capacity: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Homeroom</label>
              <select value={classForm.roomId} onChange={(e) => setClassForm({ ...classForm, roomId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="">None</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.capacity} seats)</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Class Teacher</label>
            <select value={classForm.classTeacherId} onChange={(e) => setClassForm({ ...classForm, classTeacherId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              <option value="">Unassigned</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setClassModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Create Class</Button>
          </div>
        </form>
      </Modal>

      <Modal open={subModal} onClose={() => setSubModal(false)} title="Add Subject" maxWidth="max-w-md">
        <form onSubmit={handleCreateSubject} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subject Name *</label>
              <input type="text" required value={subForm.name} onChange={(e) => setSubForm({ ...subForm, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subject Code *</label>
              <input type="text" required value={subForm.code} onChange={(e) => setSubForm({ ...subForm, code: e.target.value.toUpperCase() })} placeholder="CHEM-10" className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Class *</label>
            <select required value={subForm.classId} onChange={(e) => setSubForm({ ...subForm, classId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Assigned Teacher</label>
            <select value={subForm.teacherId} onChange={(e) => setSubForm({ ...subForm, teacherId: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
              <option value="">Unassigned</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setSubModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Add Subject</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// Room Management
// ============================================================================
export function PrincipalRoomsView({
  rooms,
  classes,
  examinations,
  schoolId,
  actor,
  canWrite,
}: {
  rooms: Room[];
  classes: SchoolClass[];
  examinations: Examination[];
  schoolId: string;
  actor: PlatformUser;
  canWrite: boolean;
}) {
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    roomNumber: '',
    name: '',
    building: 'Main Block',
    capacity: '35',
    roomType: 'classroom' as Room['roomType'],
  });

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    const id = generateId('rm');
    try {
      await setDoc(doc(db, 'rooms', id), {
        id,
        schoolId,
        roomNumber: form.roomNumber.trim().slice(0, 32),
        name: form.name.trim().slice(0, 80),
        building: form.building.trim().slice(0, 80),
        capacity: Math.max(1, Number(form.capacity) || 30),
        roomType: form.roomType,
        available: true,
        status: 'active',
        createdBy: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      pushToast('success', `Room "${form.name.trim()}" added.`);
      setOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `rooms/${id}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Manage classrooms, labs, and exam halls with automatic capacity & overlap warnings.</p>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={!canWrite}>
          <Plus className="w-4 h-4" />
          Add Room
        </Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rooms.map((r) => {
          const homeroomFor = classes.filter((c) => c.roomId === r.id);
          const examBookings = examinations.filter((e) => e.roomId === r.id && e.status === 'scheduled');
          return (
            <div key={r.id} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-500">#{r.roomNumber} · {r.building}</span>
                <StatusText status={r.status} />
              </div>
              <h3 className="text-base font-bold font-display text-slate-900 mt-1">{r.name}</h3>
              <p className="text-xs text-slate-600 mt-1 tabular-nums">
                Type: {r.roomType.replace(/_/g, ' ')} · Capacity: <strong>{r.capacity}</strong>
              </p>
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                <p>Assigned Classes: {homeroomFor.map((c) => c.code).join(', ') || 'None'}</p>
                <p>Scheduled Exam Bookings: {examBookings.length}</p>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Create Campus Room" maxWidth="max-w-md">
        <form onSubmit={handleAddRoom} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Room Number *</label>
              <input type="text" required value={form.roomNumber} onChange={(e) => setForm({ ...form, roomNumber: e.target.value })} placeholder="304" className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Capacity *</label>
              <input type="number" min={1} max={1000} required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Room Name *</label>
            <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chemistry Lab 304" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Building / Block *</label>
              <input type="text" required value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Room Type</label>
              <select value={form.roomType} onChange={(e) => setForm({ ...form, roomType: e.target.value as Room['roomType'] })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="classroom">Classroom</option>
                <option value="science_lab">Science Lab</option>
                <option value="computer_lab">Computer Lab</option>
                <option value="exam_hall">Exam Hall</option>
                <option value="auditorium">Auditorium</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Create Room</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
