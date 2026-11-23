import React, { useMemo, useRef, useState } from 'react';
import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import { db, generateId } from '../../lib/firebase';
import { emailToKey } from '../../lib/schoolProvisioning';
import {
  deriveClassSectionCode,
  formatMemberRoleCode,
  normalizeGradeLevel,
  sortClassesInOrder,
} from '../../lib/schoolCodes';
import {
  downloadPrincipalExcelTemplate,
  parseExcelFileForImport,
  type ExcelImportKind,
  type ExcelParseResult,
} from '../../lib/excelImport';
import { Button, Modal, useToast } from '../ui/Primitives';
import type {
  PlatformUser,
  School,
  SchoolClass,
  SchoolCodeClassSlot,
  StudentProfile,
  TeacherProfile,
} from '../../types/models';

interface ExcelImportModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: ExcelImportKind;
  school: School;
  classes: SchoolClass[];
  students: StudentProfile[];
  teachers: TeacherProfile[];
  actor: PlatformUser;
  canWrite: boolean;
}

export function ExcelImportModal({
  open,
  onClose,
  defaultTab = 'students',
  school,
  classes,
  students,
  teachers,
  actor,
  canWrite,
}: ExcelImportModalProps) {
  const { pushToast } = useToast();
  const [activeTab, setActiveTab] = useState<ExcelImportKind>(defaultTab);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ExcelParseResult | null>(null);
  const [parseError, setParseError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync tab when defaultTab prop changes on open
  React.useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
      setResult(null);
      setFileName('');
      setParseError('');
    }
  }, [open, defaultTab]);

  const handleSwitchTab = (tab: ExcelImportKind) => {
    setActiveTab(tab);
    setResult(null);
    setFileName('');
    setParseError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    setParseError('');
    setFileName(file.name);
    try {
      const parsed = await parseExcelFileForImport(file, activeTab, {
        existingClasses: classes,
        existingStudents: students,
        existingTeachers: teachers,
        schoolCode: school.code || 'SCH',
      });
      setResult(parsed);
      if (parsed.totalRows === 0) {
        setParseError('The uploaded spreadsheet has no data rows. Download the template and add records below the header row.');
      }
    } catch (err) {
      setResult(null);
      setParseError(err instanceof Error ? err.message : 'Unable to read this spreadsheet file.');
    } finally {
      setParsing(false);
    }
  };

  const summary = useMemo(() => {
    if (!result) return { valid: 0, invalid: 0 };
    if (activeTab === 'students') {
      const valid = result.students.filter((r) => r.errors.length === 0).length;
      return { valid, invalid: result.students.length - valid };
    }
    if (activeTab === 'teachers') {
      const valid = result.teachers.filter((r) => r.errors.length === 0).length;
      return { valid, invalid: result.teachers.length - valid };
    }
    const valid = result.classes.filter((r) => r.errors.length === 0).length;
    return { valid, invalid: result.classes.length - valid };
  }, [result, activeTab]);

  const syncClassSectionsToSchoolCode = async (allClasses: SchoolClass[]) => {
    const ordered = sortClassesInOrder(allClasses);
    const slots: SchoolCodeClassSlot[] = ordered.slice(0, 200).map((c) => ({
      classId: c.id,
      classCode: c.code,
      className: c.name,
      gradeLevel: c.gradeLevel,
      section: c.section,
    }));
    await updateDoc(doc(db, 'schoolCodes', school.code), {
      classSections: slots,
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  };

  const commitImport = async () => {
    if (!result || !canWrite || summary.valid === 0) return;
    setImporting(true);
    try {
      const now = serverTimestamp();
      const schoolPrefix = school.code || 'SCH';
      const academicYear = school.academicYear || '2026-2027';
      const today = new Date().toISOString().slice(0, 10);

      // Helper to resolve teacher by name/email/staffId
      const findTeacherByRef = (ref: string): TeacherProfile | undefined => {
        const clean = ref.trim().toLowerCase();
        if (!clean) return undefined;
        return teachers.find(
          (t) =>
            t.name.trim().toLowerCase() === clean ||
            t.email.trim().toLowerCase() === clean ||
            t.staffId.trim().toLowerCase() === clean ||
            (t.accessCode || '').trim().toLowerCase() === clean,
        );
      };

      // Step A: Auto-create any missing classes & sections (always unlimited capacity in UI, capacity: 500 in Firestore)
      const createdClasses: SchoolClass[] = [];
      const createdClassByNormKey = new Map<string, SchoolClass>();
      if (result.classesToCreate.length > 0) {
        const CHUNK = 150;
        for (let i = 0; i < result.classesToCreate.length; i += CHUNK) {
          const slice = result.classesToCreate.slice(i, i + CHUNK);
          const batch = writeBatch(db);
          slice.forEach((draft) => {
            const clsId = generateId('cls');
            const matchedTeacher = draft.classTeacherRef ? findTeacherByRef(draft.classTeacherRef) : undefined;
            const clsPayload: SchoolClass = {
              id: clsId,
              schoolId: school.id,
              name: draft.name,
              gradeLevel: draft.gradeLevel,
              section: draft.section,
              code: draft.code || deriveClassSectionCode(draft.gradeLevel, draft.section),
              academicYear,
              capacity: 500,
              classTeacherId: matchedTeacher?.id || '',
              classTeacherName: matchedTeacher?.name || '',
              roomId: '',
              roomName: '',
              status: 'active',
              createdBy: actor.uid,
            };
            batch.set(doc(db, 'classes', clsId), {
              ...clsPayload,
              createdAt: now,
              updatedAt: now,
            });
            createdClasses.push(clsPayload);
            const normKey = `${normalizeGradeLevel(draft.gradeLevel).toLowerCase()}::${draft.section.toUpperCase()}`;
            createdClassByNormKey.set(normKey, clsPayload);
          });
          await batch.commit();
        }
      }

      const mergedClasses = sortClassesInOrder([...classes, ...createdClasses]);
      if (createdClasses.length > 0) {
        await syncClassSectionsToSchoolCode(mergedClasses);
      }

      if (activeTab === 'classes') {
        pushToast(
          'success',
          `Imported ${createdClasses.length} class section${createdClasses.length === 1 ? '' : 's'} in grade order.`,
        );
        onClose();
        return;
      }

      if (activeTab === 'students') {
        const validRows = result.students.filter((r) => r.errors.length === 0);
        const usedCodes = new Set<string>(
          students.map((s) => (s.accessCode || '').trim().toUpperCase()).filter(Boolean),
        );
        const nextTotalStudents = students.length + validRows.length;
        const nextAllocatedStudents = Math.max(school.allocatedStudents || 0, nextTotalStudents, 100);
        let seqCounter = students.length + 1;

        const CHUNK = 80; // ~3 writes per student (students + memberAccessCodes + optional emailDirectory)
        for (let i = 0; i < validRows.length; i += CHUNK) {
          const slice = validRows.slice(i, i + CHUNK);
          const batch = writeBatch(db);

          slice.forEach((row) => {
            const normKey = `${normalizeGradeLevel(row.gradeLevel).toLowerCase()}::${row.section.toUpperCase()}`;
            const cls =
              mergedClasses.find((c) => c.id === row.matchedClassId) ||
              createdClassByNormKey.get(normKey) ||
              mergedClasses.find(
                (c) =>
                  c.code.toUpperCase() === row.classCode.toUpperCase() ||
                  (`${normalizeGradeLevel(c.gradeLevel).toLowerCase()}::${c.section.toUpperCase()}` === normKey),
              );
            if (!cls) return;

            let studentCode = formatMemberRoleCode(schoolPrefix, 'student', seqCounter, nextAllocatedStudents);
            while (usedCodes.has(studentCode)) {
              seqCounter += 1;
              studentCode = formatMemberRoleCode(schoolPrefix, 'student', seqCounter, Math.max(seqCounter, nextAllocatedStudents));
            }
            usedCodes.add(studentCode);
            seqCounter += 1;

            const classTeacher =
              teachers.find((t) => t.id === cls.classTeacherId || t.classTeacherOfClassId === cls.id) ||
              teachers.find((t) => (t.assignedClassIds || []).includes(cls.id));

            const stuId = generateId('stu');
            batch.set(doc(db, 'students', stuId), {
              id: stuId,
              schoolId: school.id,
              userId: '',
              admissionNumber: row.admissionNumber,
              rollNumber: row.rollNumber,
              name: row.name,
              email: row.email,
              classId: cls.id,
              className: cls.name,
              section: cls.section,
              academicYear,
              guardianName: row.guardianName,
              guardianPhone: row.guardianPhone,
              guardianEmail: row.guardianEmail,
              accessCode: studentCode,
              status: 'active',
              history: [{ date: today, event: `Imported via Excel into ${cls.name}`, academicYear }],
              createdBy: actor.uid,
              createdAt: now,
              updatedAt: now,
            });

            batch.set(doc(db, 'memberAccessCodes', studentCode), {
              code: studentCode,
              schoolId: school.id,
              schoolCode: schoolPrefix,
              schoolName: school.name,
              role: 'student',
              memberName: row.name,
              email: row.email,
              classId: cls.id,
              classCode: cls.code,
              className: cls.name,
              teacherId: classTeacher?.id || '',
              teacherCode: classTeacher?.accessCode || classTeacher?.staffId || '',
              teacherName: classTeacher?.name || cls.classTeacherName || '',
              rollNumber: row.rollNumber,
              status: 'active',
              linkedProfileId: stuId,
              linkedUid: '',
              createdBy: actor.uid,
              createdAt: now,
              updatedAt: now,
            });

            if (row.email) {
              const emailKey = emailToKey(row.email);
              batch.set(doc(db, 'emailDirectory', emailKey), {
                emailKey,
                email: row.email,
                schoolId: school.id,
                schoolName: school.name,
                role: 'student',
                displayName: row.name,
                accessCode: studentCode,
                linkedProfileId: stuId,
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
        }

        await updateDoc(doc(db, 'schools', school.id), {
          studentCount: nextTotalStudents,
          allocatedStudents: nextAllocatedStudents,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);

        await updateDoc(doc(db, 'schoolCodes', schoolPrefix), {
          studentCount: nextAllocatedStudents,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);

        pushToast(
          'success',
          `Imported ${validRows.length} student${validRows.length === 1 ? '' : 's'} with named access codes${
            createdClasses.length > 0 ? ` and created ${createdClasses.length} new class section(s)` : ''
          }.`,
        );
        onClose();
        return;
      }

      if (activeTab === 'teachers') {
        const validRows = result.teachers.filter((r) => r.errors.length === 0);
        const usedCodes = new Set<string>(
          teachers.map((t) => (t.accessCode || '').trim().toUpperCase()).filter(Boolean),
        );
        const nextTotalTeachers = teachers.length + validRows.length;
        const nextAllocatedTeachers = Math.max(school.allocatedTeachers || 0, nextTotalTeachers, 20);
        let seqCounter = teachers.length + 1;

        const CHUNK = 80;
        for (let i = 0; i < validRows.length; i += CHUNK) {
          const slice = validRows.slice(i, i + CHUNK);
          const batch = writeBatch(db);

          slice.forEach((row) => {
            let teacherCode = formatMemberRoleCode(schoolPrefix, 'teacher', seqCounter, nextAllocatedTeachers);
            while (usedCodes.has(teacherCode)) {
              seqCounter += 1;
              teacherCode = formatMemberRoleCode(schoolPrefix, 'teacher', seqCounter, Math.max(seqCounter, nextAllocatedTeachers));
            }
            usedCodes.add(teacherCode);
            seqCounter += 1;

            const matchedCls = row.classTeacherOf
              ? mergedClasses.find(
                  (c) =>
                    c.code.toLowerCase() === row.classTeacherOf.trim().toLowerCase() ||
                    c.name.toLowerCase() === row.classTeacherOf.trim().toLowerCase(),
                )
              : undefined;

            const tchId = generateId('tch');
            batch.set(doc(db, 'teachers', tchId), {
              id: tchId,
              schoolId: school.id,
              userId: '',
              staffId: row.staffId,
              name: row.name,
              email: row.email,
              phone: row.phone,
              subjects: row.subjects,
              qualifications: row.qualifications,
              joiningDate: row.joiningDate,
              assignedClassIds: matchedCls ? [matchedCls.id] : [],
              classTeacherOfClassId: matchedCls?.id || '',
              accessCode: teacherCode,
              status: 'active',
              createdBy: actor.uid,
              createdAt: now,
              updatedAt: now,
            });

            batch.set(doc(db, 'memberAccessCodes', teacherCode), {
              code: teacherCode,
              schoolId: school.id,
              schoolCode: schoolPrefix,
              schoolName: school.name,
              role: 'teacher',
              memberName: row.name,
              email: row.email,
              classId: matchedCls?.id || '',
              classCode: matchedCls?.code || '',
              className: matchedCls?.name || '',
              teacherId: tchId,
              teacherCode,
              teacherName: row.name,
              rollNumber: '',
              status: 'active',
              linkedProfileId: tchId,
              linkedUid: '',
              createdBy: actor.uid,
              createdAt: now,
              updatedAt: now,
            });

            if (row.email) {
              const emailKey = emailToKey(row.email);
              batch.set(doc(db, 'emailDirectory', emailKey), {
                emailKey,
                email: row.email,
                schoolId: school.id,
                schoolName: school.name,
                role: 'teacher',
                displayName: row.name,
                accessCode: teacherCode,
                linkedProfileId: tchId,
                classId: matchedCls?.id || '',
                section: matchedCls?.section || '',
                assignedClassIds: matchedCls ? [matchedCls.id] : [],
                status: 'active',
                createdBy: actor.uid,
                createdAt: now,
                updatedAt: now,
              });
            }

            if (matchedCls) {
              batch.update(doc(db, 'classes', matchedCls.id), {
                classTeacherId: tchId,
                classTeacherName: row.name,
                updatedAt: now,
              });
            }
          });

          await batch.commit();
        }

        await updateDoc(doc(db, 'schools', school.id), {
          teacherCount: nextTotalTeachers,
          allocatedTeachers: nextAllocatedTeachers,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);

        await updateDoc(doc(db, 'schoolCodes', schoolPrefix), {
          teacherCount: nextAllocatedTeachers,
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);

        pushToast('success', `Imported ${validRows.length} teacher${validRows.length === 1 ? '' : 's'} with named access codes.`);
        onClose();
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Unable to complete Excel import.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import Data from Excel"
      subtitle="Upload .xlsx, .xls, or .csv files to bulk import students, teachers, or classes & sections."
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-3">
          {(
            [
              { id: 'students', label: 'Students' },
              { id: 'teachers', label: 'Teachers' },
              { id: 'classes', label: 'Classes & Sections' },
            ] as { id: ExcelImportKind; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSwitchTab(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#0B1528] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Step 1: Download Excel Template */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="text-xs text-slate-600 space-y-1 max-w-md">
            <p className="font-semibold text-slate-900 flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              Step 1: Download the Excel (.xlsx) Template
            </p>
            {activeTab === 'students' && (
              <p>
                Columns: Student Name, Class, Section, Class Code, Roll Number, Admission Number, Email, Guardian Name, Guardian Phone. Missing classes &amp; sections are auto-created with no student limit.
              </p>
            )}
            {activeTab === 'teachers' && (
              <p>
                Columns: Teacher Name, Email, Staff ID, Phone, Subjects, Qualifications, Joining Date, Class Teacher Of.
              </p>
            )}
            {activeTab === 'classes' && (
              <p>
                Columns: Class, Section (single letter or range like A-D), Class Code, Class Teacher. Sections have unlimited student capacity.
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => downloadPrincipalExcelTemplate(activeTab, classes[0]?.code || 'C1A')}
          >
            <Download className="w-3.5 h-3.5" />
            Download Excel Template
          </Button>
        </div>

        {/* Step 2: Upload Excel / CSV File */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Step 2: Upload Excel (.xlsx, .xls) or CSV File
          </label>
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-4 bg-white hover:border-teal-500 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
              className="block w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 hover:file:bg-slate-100 cursor-pointer"
            />
            {fileName && (
              <p className="text-[11px] text-slate-500 mt-2">
                Selected file: <span className="font-semibold text-slate-800">{fileName}</span>
                {result ? ` · Sheet "${result.sheetName}"` : ''}
              </p>
            )}
          </div>
        </div>

        {parsing && (
          <p className="text-xs text-teal-700 font-medium">Reading spreadsheet rows…</p>
        )}

        {parseError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {/* Step 3: Live Validation Preview */}
        {result && result.totalRows > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-emerald-700">
                  {summary.valid} valid ready to import
                </span>
                {summary.invalid > 0 && (
                  <span className="font-semibold text-red-600">
                    {summary.invalid} skipped due to errors
                  </span>
                )}
              </div>
              {activeTab === 'students' && result.classesToCreate.length > 0 && (
                <span className="text-[11px] font-medium text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-lg">
                  Auto-creating {result.classesToCreate.length} new class section{result.classesToCreate.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            <div className="border border-slate-200 rounded-xl max-h-64 overflow-y-auto divide-y divide-slate-100 text-xs">
              {activeTab === 'students' &&
                result.students.map((r) => (
                  <div key={r.rowNumber} className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        Row {r.rowNumber}: {r.name || '(Missing Name)'}
                        <span className="font-normal text-slate-500">
                          {' '}· {r.className || 'Missing Class'} · Roll #{r.rollNumber} · {r.admissionNumber}
                        </span>
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

              {activeTab === 'teachers' &&
                result.teachers.map((r) => (
                  <div key={r.rowNumber} className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        Row {r.rowNumber}: {r.name || '(Missing Name)'}
                        <span className="font-normal text-slate-500">
                          {' '}· {r.staffId} · {r.email}
                          {r.classTeacherOf ? ` · Class Teacher: ${r.classTeacherOf}` : ''}
                        </span>
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

              {activeTab === 'classes' &&
                result.classes.map((r, idx) => (
                  <div key={`${r.rowNumber}-${r.code}-${idx}`} className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        Row {r.rowNumber}: {r.name || '(Missing Class)'}
                        <span className="font-mono text-teal-700 ml-1.5">{r.code}</span>
                        {r.classTeacherRef && (
                          <span className="font-normal text-slate-500"> · Teacher: {r.classTeacherRef}</span>
                        )}
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

            <div className="flex justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setResult(null);
                  setFileName('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Clear File
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={importing || !canWrite || summary.valid === 0}
                onClick={commitImport}
              >
                <Upload className="w-3.5 h-3.5" />
                {importing
                  ? 'Importing…'
                  : `Import ${summary.valid} Valid ${
                      activeTab === 'students' ? 'Student' : activeTab === 'teachers' ? 'Teacher' : 'Class'
                    }${summary.valid === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
