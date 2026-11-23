import * as XLSX from 'xlsx';
import {
  deriveClassSectionCode,
  expandSectionRange,
  normalizeGradeLevel,
  sanitizePhoneDigits,
  sortClassesInOrder,
} from './schoolCodes';
import type { SchoolClass, StudentProfile, TeacherProfile } from '../types/models';

export type ExcelImportKind = 'students' | 'teachers' | 'classes';

export interface AutoCreateClassDraft {
  gradeLevel: string;
  section: string;
  name: string;
  code: string;
  classTeacherRef?: string;
}

export interface ParsedStudentExcelRow {
  rowNumber: number;
  name: string;
  gradeLevel: string;
  section: string;
  classCode: string;
  className: string;
  matchedClassId: string;
  rollNumber: string;
  admissionNumber: string;
  email: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  errors: string[];
}

export interface ParsedTeacherExcelRow {
  rowNumber: number;
  name: string;
  email: string;
  staffId: string;
  phone: string;
  subjects: string[];
  qualifications: string;
  joiningDate: string;
  classTeacherOf: string;
  errors: string[];
}

export interface ParsedClassExcelRow {
  rowNumber: number;
  gradeLevel: string;
  section: string;
  name: string;
  code: string;
  classTeacherRef: string;
  errors: string[];
}

export interface ExcelParseResult {
  sheetName: string;
  totalRows: number;
  students: ParsedStudentExcelRow[];
  teachers: ParsedTeacherExcelRow[];
  classes: ParsedClassExcelRow[];
  classesToCreate: AutoCreateClassDraft[];
}

function normalizeHeaderKey(header: string): string {
  return String(header || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getField(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const val = row[normalizeHeaderKey(alias)];
    if (val !== undefined && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

function parseCombinedClassAndSection(
  rawClass: string,
  rawSection: string,
): { gradeLevel: string; section: string } {
  const cleanClass = rawClass.trim();
  const cleanSec = rawSection
    .trim()
    .replace(/^section\s*/i, '')
    .replace(/^sec\.?\s*/i, '')
    .toUpperCase();

  if (cleanClass && cleanSec) {
    return {
      gradeLevel: normalizeGradeLevel(cleanClass) || cleanClass,
      section: cleanSec.slice(0, 16),
    };
  }

  if (!cleanClass) {
    return { gradeLevel: '', section: cleanSec || 'A' };
  }

  // Handle "Class 10 - Section A", "Grade 5 - B", "10 - A", "10/B"
  const dashMatch = /^(.+?)\s*[-–/|]\s*(?:section\s*|sec\.?\s*)?([A-Za-z0-9]{1,8})$/i.exec(cleanClass);
  if (dashMatch) {
    return {
      gradeLevel: normalizeGradeLevel(dashMatch[1]) || dashMatch[1].trim(),
      section: dashMatch[2].toUpperCase(),
    };
  }

  // Handle "Class 10 Section B" or "Grade 8 B"
  const spaceSecMatch = /^((?:class|grade|std\.?|standard)?\s*(?:\d{1,2}|pre-?kg|lkg|ukg|nursery))\s+(?:section\s+|sec\.?\s*)?([A-Za-z])$/i.exec(
    cleanClass,
  );
  if (spaceSecMatch) {
    return {
      gradeLevel: normalizeGradeLevel(spaceSecMatch[1]) || spaceSecMatch[1].trim(),
      section: spaceSecMatch[2].toUpperCase(),
    };
  }

  // Handle compact code like "C10A", "G10B", "10A"
  const compactMatch = /^[CG]?(\d{1,2})([A-Za-z])$/i.exec(cleanClass);
  if (compactMatch) {
    return {
      gradeLevel: `Class ${parseInt(compactMatch[1], 10)}`,
      section: compactMatch[2].toUpperCase(),
    };
  }

  return {
    gradeLevel: normalizeGradeLevel(cleanClass) || cleanClass,
    section: cleanSec || 'A',
  };
}

/**
 * Generates and downloads a formatted Excel (.xlsx) template for Principals.
 */
export function downloadPrincipalExcelTemplate(kind: ExcelImportKind, sampleClassCode = 'C1A'): void {
  const wb = XLSX.utils.book_new();

  if (kind === 'students') {
    const rows = [
      {
        'Student Name': 'Aarav Sharma',
        Class: 'Class 1',
        Section: 'A',
        'Class Code': sampleClassCode,
        'Roll Number': '01',
        'Admission Number': 'ADM-2026-001',
        Email: 'aarav.sharma@school.edu',
        'Guardian Name': 'Rajesh Sharma',
        'Guardian Phone': '9876543210',
        'Guardian Email': 'rajesh.sharma@mail.com',
      },
      {
        'Student Name': 'Ananya Verma',
        Class: 'Class 1',
        Section: 'B',
        'Class Code': 'C1B',
        'Roll Number': '01',
        'Admission Number': 'ADM-2026-002',
        Email: 'ananya.verma@school.edu',
        'Guardian Name': 'Meera Verma',
        'Guardian Phone': '9876543211',
        'Guardian Email': 'meera.verma@mail.com',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 24 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 18 },
      { wch: 26 },
      { wch: 22 },
      { wch: 16 },
      { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, 'AcademiaOne_Students_Template.xlsx');
    return;
  }

  if (kind === 'teachers') {
    const rows = [
      {
        'Teacher Name': 'Kavita Nair',
        Email: 'kavita.nair@school.edu',
        'Staff ID': 'STF-101',
        Phone: '9876543220',
        Subjects: 'Mathematics, Science',
        Qualifications: 'M.Sc., B.Ed.',
        'Joining Date': new Date().toISOString().slice(0, 10),
        'Class Teacher Of': sampleClassCode,
      },
      {
        'Teacher Name': 'Suresh Kulkarni',
        Email: 'suresh.kulkarni@school.edu',
        'Staff ID': 'STF-102',
        Phone: '9876543221',
        Subjects: 'English, Social Studies',
        Qualifications: 'M.A., B.Ed.',
        'Joining Date': new Date().toISOString().slice(0, 10),
        'Class Teacher Of': 'C1B',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 24 },
      { wch: 26 },
      { wch: 12 },
      { wch: 15 },
      { wch: 26 },
      { wch: 18 },
      { wch: 14 },
      { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Teachers');
    XLSX.writeFile(wb, 'AcademiaOne_Teachers_Template.xlsx');
    return;
  }

  const rows = [
    { Class: 'Class 1', Section: 'A-C', 'Class Code': '', 'Class Teacher': '' },
    { Class: 'Class 2', Section: 'A', 'Class Code': 'C2A', 'Class Teacher': 'Kavita Nair' },
    { Class: 'Class 2', Section: 'B', 'Class Code': 'C2B', 'Class Teacher': '' },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Classes');
  XLSX.writeFile(wb, 'AcademiaOne_Classes_Template.xlsx');
}

/**
 * Parses an uploaded Excel (.xlsx, .xls) or CSV (.csv) file and returns validated rows
 * plus any missing Class & Section definitions to auto-create in natural grade order.
 */
export async function parseExcelFileForImport(
  file: File,
  kind: ExcelImportKind,
  context: {
    existingClasses: SchoolClass[];
    existingStudents: StudentProfile[];
    existingTeachers: TeacherProfile[];
    schoolCode: string;
  },
): Promise<ExcelParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0] || 'Sheet1';
  const sheet = workbook.Sheets[sheetName];
  const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const normalizedRows: Record<string, string>[] = rawJson
    .map((row) => {
      const out: Record<string, string> = {};
      Object.entries(row).forEach(([k, v]) => {
        out[normalizeHeaderKey(k)] = String(v ?? '').trim();
      });
      return out;
    })
    .filter((row) => Object.values(row).some((val) => val !== ''));

  const classByCode = new Map<string, SchoolClass>();
  const classByGradeSec = new Map<string, SchoolClass>();
  context.existingClasses.forEach((c) => {
    classByCode.set(c.code.trim().toUpperCase(), c);
    const normKey = `${normalizeGradeLevel(c.gradeLevel).toLowerCase()}::${c.section.trim().toUpperCase()}`;
    classByGradeSec.set(normKey, c);
  });

  const classesToCreateMap = new Map<string, AutoCreateClassDraft>();
  const currentYear = new Date().getFullYear();

  if (kind === 'students') {
    const existingAdmSet = new Set(context.existingStudents.map((s) => s.admissionNumber.trim().toLowerCase()));
    const seenAdm = new Set<string>();
    const rollCounters = new Map<string, number>();

    context.existingStudents.forEach((s) => {
      const key = `${normalizeGradeLevel(s.className.split(' - ')[0] || '').toLowerCase()}::${s.section.toUpperCase()}`;
      rollCounters.set(key, (rollCounters.get(key) || 0) + 1);
    });

    const parsedStudents: ParsedStudentExcelRow[] = normalizedRows.map((row, idx) => {
      const errors: string[] = [];
      const rowNumber = idx + 2;

      const name = getField(row, ['studentname', 'fullname', 'name', 'student']);
      const rawClass = getField(row, ['class', 'grade', 'gradelevel', 'standard', 'std', 'classname']);
      const rawSection = getField(row, ['section', 'sec', 'division', 'div']);
      const rawClassCode = getField(row, ['classcode', 'code', 'sectioncode']).toUpperCase();
      let rollNumber = getField(row, ['rollnumber', 'rollno', 'roll', 'srno', 'sno']);
      let admissionNumber = getField(row, ['admissionnumber', 'admissionno', 'admno', 'adm', 'studentid', 'id']);
      const email = getField(row, ['email', 'studentemail', 'emailaddress', 'mail']).toLowerCase();
      const guardianName = getField(row, ['guardianname', 'parentname', 'fathername', 'mothername', 'guardian']);
      const guardianPhone = sanitizePhoneDigits(
        getField(row, ['guardianphone', 'parentphone', 'phone', 'mobile', 'contact', 'phonenumber', 'mobilenumber']),
      );
      const guardianEmail = getField(row, ['guardianemail', 'parentemail']).toLowerCase();

      if (name.length < 2) {
        errors.push('Student Name is required (min 2 characters)');
      }

      // Resolve Class & Section
      let matchedCls: SchoolClass | undefined;
      if (rawClassCode && classByCode.has(rawClassCode)) {
        matchedCls = classByCode.get(rawClassCode);
      }

      let gradeLevel = '';
      let section = '';
      let classCode = rawClassCode;
      let className = '';

      if (matchedCls) {
        gradeLevel = matchedCls.gradeLevel;
        section = matchedCls.section;
        classCode = matchedCls.code;
        className = matchedCls.name;
      } else {
        const parsed = parseCombinedClassAndSection(rawClass || rawClassCode, rawSection);
        gradeLevel = parsed.gradeLevel;
        section = parsed.section;
        if (!gradeLevel) {
          errors.push('Class or Class Code is required');
        } else {
          const normKey = `${gradeLevel.toLowerCase()}::${section.toUpperCase()}`;
          matchedCls = classByGradeSec.get(normKey);
          if (matchedCls) {
            classCode = matchedCls.code;
            className = matchedCls.name;
          } else {
            classCode = rawClassCode || deriveClassSectionCode(gradeLevel, section);
            className = `${gradeLevel} - Section ${section}`;
            if (!classesToCreateMap.has(normKey)) {
              classesToCreateMap.set(normKey, {
                gradeLevel,
                section,
                name: className,
                code: classCode,
              });
            }
          }
        }
      }

      if (!admissionNumber) {
        admissionNumber = `${context.schoolCode}-${currentYear}-${String(context.existingStudents.length + idx + 1).padStart(4, '0')}`;
      }
      const admLower = admissionNumber.toLowerCase();
      if (existingAdmSet.has(admLower)) {
        errors.push(`Admission No "${admissionNumber}" already exists`);
      } else if (seenAdm.has(admLower)) {
        errors.push(`Duplicate Admission No "${admissionNumber}" in spreadsheet`);
      } else {
        seenAdm.add(admLower);
      }

      if (!rollNumber) {
        const counterKey = `${gradeLevel.toLowerCase()}::${section.toUpperCase()}`;
        const nextRoll = (rollCounters.get(counterKey) || 0) + 1;
        rollCounters.set(counterKey, nextRoll);
        rollNumber = String(nextRoll).padStart(2, '0');
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('Invalid Student Email format');
      }

      return {
        rowNumber,
        name: name.slice(0, 120),
        gradeLevel,
        section: section.slice(0, 16),
        classCode,
        className,
        matchedClassId: matchedCls?.id || '',
        rollNumber: rollNumber.slice(0, 24),
        admissionNumber: admissionNumber.slice(0, 32),
        email: email.slice(0, 160),
        guardianName: guardianName.slice(0, 120),
        guardianPhone: guardianPhone.slice(0, 32),
        guardianEmail: guardianEmail.slice(0, 160),
        errors,
      };
    });

    return {
      sheetName,
      totalRows: normalizedRows.length,
      students: parsedStudents,
      teachers: [],
      classes: [],
      classesToCreate: sortClassesInOrder(Array.from(classesToCreateMap.values())),
    };
  }

  if (kind === 'teachers') {
    const existingEmailSet = new Set(context.existingTeachers.map((t) => t.email.trim().toLowerCase()));
    const seenEmails = new Set<string>();

    const parsedTeachers: ParsedTeacherExcelRow[] = normalizedRows.map((row, idx) => {
      const errors: string[] = [];
      const rowNumber = idx + 2;

      const name = getField(row, ['teachername', 'fullname', 'name', 'faculty', 'staffname']);
      let email = getField(row, ['email', 'teacheremail', 'emailaddress', 'mail']).toLowerCase();
      const staffId =
        getField(row, ['staffid', 'employeeid', 'empid', 'teacherid', 'id']) ||
        `STF-${String(context.existingTeachers.length + idx + 101)}`;
      const phone = sanitizePhoneDigits(getField(row, ['phone', 'mobile', 'contact', 'phonenumber']));
      const subjectsRaw = getField(row, ['subjects', 'subject', 'department', 'specialization']);
      const subjects = subjectsRaw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);
      const qualifications = getField(row, ['qualifications', 'qualification', 'degree', 'education']);
      const joiningDate =
        getField(row, ['joiningdate', 'joindate', 'dateofjoining']) || new Date().toISOString().slice(0, 10);
      const classTeacherOf = getField(row, ['classteacherof', 'assignedclass', 'classcode', 'class', 'homeroomclass']);

      if (name.length < 2) {
        errors.push('Teacher Name is required (min 2 characters)');
      }

      if (!email) {
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '.')
          .replace(/^\.+|\.+$/g, '');
        if (slug) {
          email = `${slug}.${idx + 1}@${context.schoolCode.toLowerCase()}.school.edu`;
        } else {
          errors.push('Email address is required');
        }
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('Invalid email format');
      }

      if (email) {
        if (existingEmailSet.has(email)) {
          errors.push(`Teacher email "${email}" already exists`);
        } else if (seenEmails.has(email)) {
          errors.push(`Duplicate email "${email}" in spreadsheet`);
        } else {
          seenEmails.add(email);
        }
      }

      return {
        rowNumber,
        name: name.slice(0, 120),
        email: email.slice(0, 160),
        staffId: staffId.slice(0, 32),
        phone: phone.slice(0, 32),
        subjects,
        qualifications: qualifications.slice(0, 160),
        joiningDate: joiningDate.slice(0, 32),
        classTeacherOf,
        errors,
      };
    });

    return {
      sheetName,
      totalRows: normalizedRows.length,
      students: [],
      teachers: parsedTeachers,
      classes: [],
      classesToCreate: [],
    };
  }

  // Classes & Sections import (supports single sections or ranges like "A-D" or comma-separated "A, B, C")
  const parsedClasses: ParsedClassExcelRow[] = [];
  const seenKeys = new Set<string>();

  normalizedRows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const rawGrade = getField(row, ['class', 'grade', 'gradelevel', 'standard', 'std', 'name']);
    const rawSection = getField(row, ['section', 'sections', 'sec', 'division', 'div']);
    const rawCode = getField(row, ['classcode', 'code', 'sectioncode']).toUpperCase();
    const classTeacherRef = getField(row, ['classteacher', 'teacher', 'teachername', 'teacheremail', 'staffid']);

    if (!rawGrade) {
      parsedClasses.push({
        rowNumber,
        gradeLevel: '',
        section: '',
        name: '',
        code: rawCode,
        classTeacherRef,
        errors: ['Class / Grade is required'],
      });
      return;
    }

    const gradeLevel = normalizeGradeLevel(rawGrade) || rawGrade;

    // Expand section ranges ("A-D") or lists ("A, B, C")
    let sectionsList: string[] = [];
    const rangeMatch = /^([A-Za-z])\s*[-–]\s*([A-Za-z])$/.exec(rawSection);
    if (rangeMatch) {
      sectionsList = expandSectionRange(rangeMatch[1], rangeMatch[2]);
    } else if (rawSection.includes(',')) {
      sectionsList = rawSection
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (rawSection) {
      sectionsList = [rawSection.replace(/^section\s*/i, '').trim().toUpperCase()];
    } else {
      const parsed = parseCombinedClassAndSection(rawGrade, '');
      sectionsList = [parsed.section || 'A'];
    }

    sectionsList.forEach((sec) => {
      const errors: string[] = [];
      const code = sectionsList.length === 1 && rawCode ? rawCode : deriveClassSectionCode(gradeLevel, sec);
      const name = `${gradeLevel} - Section ${sec}`;
      const normKey = `${gradeLevel.toLowerCase()}::${sec.toUpperCase()}`;

      if (classByGradeSec.has(normKey) || classByCode.has(code)) {
        errors.push(`Class ${name} (${code}) already exists`);
      } else if (seenKeys.has(normKey)) {
        errors.push(`Duplicate ${name} in spreadsheet`);
      } else {
        seenKeys.add(normKey);
        classesToCreateMap.set(normKey, {
          gradeLevel,
          section: sec,
          name,
          code,
          classTeacherRef,
        });
      }

      parsedClasses.push({
        rowNumber,
        gradeLevel,
        section: sec,
        name,
        code,
        classTeacherRef,
        errors,
      });
    });
  });

  return {
    sheetName,
    totalRows: normalizedRows.length,
    students: [],
    teachers: [],
    classes: sortClassesInOrder(parsedClasses),
    classesToCreate: sortClassesInOrder(Array.from(classesToCreateMap.values())),
  };
}
