import * as XLSX from 'xlsx';
import {
  deriveClassSectionCode,
  expandSectionRange,
  normalizeGradeLevel,
  sanitizePhoneDigits,
  sortClassesInOrder,
} from './schoolCodes';
import { buildDefaultPeriodSchedule } from './geoAttendance';
import type {
  DayOfWeek,
  PeriodTimingSlot,
  Room,
  SchoolClass,
  StudentProfile,
  Subject,
  TeacherProfile,
} from '../types/models';

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
    XLSX.writeFile(wb, 'SJ_Academia_One_Students_Template.xlsx');
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
    XLSX.writeFile(wb, 'SJ_Academia_One_Teachers_Template.xlsx');
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
  XLSX.writeFile(wb, 'SJ_Academia_One_Classes_Template.xlsx');
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

// ============================================================================
// Excel Timetable Analyzer & Template Generator (Tabular + Matrix Formats)
// ============================================================================
export interface ParsedTimetableExcelRow {
  rowNumber: number;
  gradeLevel: string;
  section: string;
  classCode: string;
  className: string;
  matchedClassId: string;
  dayOfWeek: DayOfWeek;
  periodNumber: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  subjectName: string;
  matchedSubjectId: string;
  teacherName: string;
  matchedTeacherId: string;
  roomName: string;
  matchedRoomId: string;
  errors: string[];
}

export interface TimetableExcelParseResult {
  sheetName: string;
  detectedFormat: 'tabular' | 'matrix';
  totalRows: number;
  periods: ParsedTimetableExcelRow[];
  classesToCreate: AutoCreateClassDraft[];
}

const DAY_ALIASES: Record<string, DayOfWeek> = {
  mon: 'Monday',
  monday: 'Monday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',
  fri: 'Friday',
  friday: 'Friday',
  sat: 'Saturday',
  saturday: 'Saturday',
};

function parseDayOfWeek(raw: string): DayOfWeek | null {
  const clean = String(raw || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return null;
  if (DAY_ALIASES[clean]) return DAY_ALIASES[clean];
  for (const [key, day] of Object.entries(DAY_ALIASES)) {
    if (clean.startsWith(key)) return day;
  }
  return null;
}

function normalizeTimeValue(raw: string, fallback: string): string {
  const clean = String(raw || '').trim();
  if (!clean) return fallback;
  const hhmm = /^(\d{1,2})[:.](\d{2})(?:\s*(am|pm))?$/i.exec(clean);
  if (hhmm) {
    let h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    const mer = (hhmm[3] || '').toLowerCase();
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  // Handle Excel serial time decimal (e.g. 0.354166 = 08:30)
  const numeric = Number(clean);
  if (!Number.isNaN(numeric) && numeric > 0 && numeric < 1) {
    const totalMins = Math.round(numeric * 24 * 60);
    const h = Math.floor(totalMins / 60) % 24;
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return fallback;
}

function splitSubjectAndTeacherCell(raw: string): { subject: string; teacher: string; isBreak: boolean } {
  const clean = raw.trim();
  if (!clean || clean === '-' || clean === '—' || clean.toLowerCase() === 'free') {
    return { subject: '', teacher: '', isBreak: false };
  }
  if (/^(break|recess|lunch|short break|lunch break|interval)$/i.test(clean)) {
    return { subject: clean, teacher: '', isBreak: true };
  }
  // Format: "Mathematics (Mr. Sharma)" or "Mathematics - Mr. Sharma" or "Mathematics / Sharma"
  const parenMatch = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(clean);
  if (parenMatch) {
    return { subject: parenMatch[1].trim(), teacher: parenMatch[2].trim(), isBreak: false };
  }
  const sepMatch = /^(.+?)\s*(?:[-–|/])\s*(.+)$/.exec(clean);
  if (sepMatch) {
    return { subject: sepMatch[1].trim(), teacher: sepMatch[2].trim(), isBreak: false };
  }
  return { subject: clean, teacher: '', isBreak: false };
}

export function downloadTimetableExcelTemplate(
  periodSchedule?: PeriodTimingSlot[],
  sampleClassCode = 'C1A',
): void {
  const schedule = periodSchedule && periodSchedule.length > 0 ? periodSchedule : buildDefaultPeriodSchedule(6);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Tabular format (recommended for multi-class school timetables)
  const tabularRows = [
    {
      Class: 'Class 1',
      Section: 'A',
      'Class Code': sampleClassCode,
      Day: 'Monday',
      Period: 1,
      'Start Time': schedule[0]?.startTime || '08:30',
      'End Time': schedule[0]?.endTime || '09:15',
      Subject: 'Mathematics',
      Teacher: 'Teacher Sharma',
      Room: 'Room 101',
    },
    {
      Class: 'Class 1',
      Section: 'A',
      'Class Code': sampleClassCode,
      Day: 'Monday',
      Period: 2,
      'Start Time': schedule[1]?.startTime || '09:15',
      'End Time': schedule[1]?.endTime || '10:00',
      Subject: 'English',
      Teacher: 'Kavita Nair',
      Room: 'Room 101',
    },
    {
      Class: 'Class 1',
      Section: 'A',
      'Class Code': sampleClassCode,
      Day: 'Tuesday',
      Period: 1,
      'Start Time': schedule[0]?.startTime || '08:30',
      'End Time': schedule[0]?.endTime || '09:15',
      Subject: 'Science',
      Teacher: 'Suresh Kulkarni',
      Room: 'Science Lab',
    },
  ];
  const ws1 = XLSX.utils.json_to_sheet(tabularRows);
  ws1['!cols'] = [
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 8 },
    { wch: 11 },
    { wch: 11 },
    { wch: 20 },
    { wch: 20 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Timetable_Rows');

  // Sheet 2: Grid/Matrix format example (teaching periods only; breaks are separate)
  const teachingSlots = schedule.filter((s) => !s.isBreak && s.periodNumber > 0);
  const gridRow: Record<string, string> = {
    Class: 'Class 1',
    Section: 'A',
    Day: 'Monday',
  };
  teachingSlots.slice(0, 6).forEach((slot) => {
    gridRow[`Period ${slot.periodNumber}`] =
      slot.periodNumber === 1
        ? 'Mathematics (Teacher Sharma)'
        : slot.periodNumber === 2
          ? 'English'
          : 'Science';
  });
  const ws2 = XLSX.utils.json_to_sheet([gridRow]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Timetable_Grid_Example');

  XLSX.writeFile(wb, 'SJ_Academia_One_Timetable_Template.xlsx');
}

/**
 * Analyzes an uploaded Excel (.xlsx/.xls/.csv) timetable file.
 * Automatically detects Tabular format (Class | Section | Day | Period | Subject | Teacher | Room)
 * OR Matrix/Grid format (Class | Section | Day | Period 1 | Period 2 | ...),
 * resolves Class/Section, Subject, Teacher, Room, and applies configured school period timings.
 */
export async function parseTimetableExcelFile(
  file: File,
  context: {
    existingClasses: SchoolClass[];
    existingSubjects: Subject[];
    existingTeachers: TeacherProfile[];
    existingRooms: Room[];
    periodSchedule?: PeriodTimingSlot[];
    fallbackClassId?: string;
  },
): Promise<TimetableExcelParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0] || 'Sheet1';
  const sheet = workbook.Sheets[sheetName];
  const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const schedule =
    context.periodSchedule && context.periodSchedule.length > 0
      ? context.periodSchedule
      : buildDefaultPeriodSchedule(8);

  const slotByPeriod = new Map<number, PeriodTimingSlot>();
  schedule.forEach((s) => {
    if (!s.isBreak && s.periodNumber > 0) {
      slotByPeriod.set(s.periodNumber, s);
    }
  });

  const classByCode = new Map<string, SchoolClass>();
  const classByGradeSec = new Map<string, SchoolClass>();
  context.existingClasses.forEach((c) => {
    classByCode.set(c.code.trim().toUpperCase(), c);
    classByGradeSec.set(`${normalizeGradeLevel(c.gradeLevel).toLowerCase()}::${c.section.trim().toUpperCase()}`, c);
  });

  const teacherByLookup = new Map<string, TeacherProfile>();
  context.existingTeachers.forEach((t) => {
    teacherByLookup.set(t.name.trim().toLowerCase(), t);
    if (t.email) teacherByLookup.set(t.email.trim().toLowerCase(), t);
    if (t.staffId) teacherByLookup.set(t.staffId.trim().toLowerCase(), t);
    if (t.accessCode) teacherByLookup.set(t.accessCode.trim().toLowerCase(), t);
  });

  const roomByLookup = new Map<string, Room>();
  context.existingRooms.forEach((r) => {
    roomByLookup.set(r.name.trim().toLowerCase(), r);
    if (r.roomNumber) roomByLookup.set(r.roomNumber.trim().toLowerCase(), r);
  });

  const classesToCreateMap = new Map<string, AutoCreateClassDraft>();
  const fallbackClass = context.existingClasses.find((c) => c.id === context.fallbackClassId);

  const resolveClass = (rawClass: string, rawSection: string, rawCode: string) => {
    const cleanCode = rawCode.trim().toUpperCase();
    let matchedCls = cleanCode ? classByCode.get(cleanCode) : undefined;
    if (!matchedCls && !rawClass && !rawSection && !cleanCode) {
      // Try parsing from sheet name (e.g., "Class 9 A" or "C9A")
      const fromSheet = parseCombinedClassAndSection(sheetName, '');
      if (fromSheet.gradeLevel && /\d|kg|nursery/i.test(fromSheet.gradeLevel)) {
        const key = `${fromSheet.gradeLevel.toLowerCase()}::${fromSheet.section.toUpperCase()}`;
        matchedCls = classByGradeSec.get(key);
      }
      if (!matchedCls && fallbackClass) {
        matchedCls = fallbackClass;
      }
    }

    if (matchedCls) {
      return {
        gradeLevel: matchedCls.gradeLevel,
        section: matchedCls.section,
        classCode: matchedCls.code,
        className: matchedCls.name,
        matchedClassId: matchedCls.id,
      };
    }

    const parsed = parseCombinedClassAndSection(rawClass || cleanCode, rawSection);
    if (!parsed.gradeLevel) {
      return {
        gradeLevel: '',
        section: parsed.section || 'A',
        classCode: cleanCode,
        className: '',
        matchedClassId: '',
      };
    }
    const normKey = `${parsed.gradeLevel.toLowerCase()}::${parsed.section.toUpperCase()}`;
    const existing = classByGradeSec.get(normKey);
    if (existing) {
      return {
        gradeLevel: existing.gradeLevel,
        section: existing.section,
        classCode: existing.code,
        className: existing.name,
        matchedClassId: existing.id,
      };
    }
    const derivedCode = cleanCode || deriveClassSectionCode(parsed.gradeLevel, parsed.section);
    const derivedName = `${parsed.gradeLevel} - Section ${parsed.section}`;
    if (!classesToCreateMap.has(normKey)) {
      classesToCreateMap.set(normKey, {
        gradeLevel: parsed.gradeLevel,
        section: parsed.section,
        name: derivedName,
        code: derivedCode,
      });
    }
    return {
      gradeLevel: parsed.gradeLevel,
      section: parsed.section,
      classCode: derivedCode,
      className: derivedName,
      matchedClassId: '',
    };
  };

  const matchTeacher = (rawTeacher: string, matchedSubject?: Subject): TeacherProfile | undefined => {
    const clean = rawTeacher.trim().toLowerCase();
    if (clean) {
      const exact = teacherByLookup.get(clean);
      if (exact) return exact;
      const partial = context.existingTeachers.find(
        (t) => t.name.toLowerCase().includes(clean) || clean.includes(t.name.toLowerCase()),
      );
      if (partial) return partial;
    }
    if (matchedSubject?.teacherId) {
      return context.existingTeachers.find((t) => t.id === matchedSubject.teacherId);
    }
    return undefined;
  };

  const matchRoom = (rawRoom: string, matchedClassId: string): Room | undefined => {
    const clean = rawRoom.trim().toLowerCase();
    if (clean) {
      const exact = roomByLookup.get(clean);
      if (exact) return exact;
      const partial = context.existingRooms.find((r) => r.name.toLowerCase().includes(clean));
      if (partial) return partial;
    }
    if (matchedClassId) {
      const cls = context.existingClasses.find((c) => c.id === matchedClassId);
      if (cls?.roomId) return context.existingRooms.find((r) => r.id === cls.roomId);
    }
    return undefined;
  };

  // Detect whether spreadsheet is Matrix/Grid format (has columns like "Period 1", "P1", "1", "P2")
  const firstRowKeys = rawJson.length > 0 ? Object.keys(rawJson[0]) : [];
  const periodColumns: { originalKey: string; periodNumber: number; headerStart?: string; headerEnd?: string }[] = [];
  firstRowKeys.forEach((origKey) => {
    const k = origKey.trim();
    const match = /^(?:period|per|p|slot)\s*#?\s*(\d{1,2})\b/i.exec(k);
    if (match) {
      const pNum = parseInt(match[1], 10);
      if (pNum >= 1 && pNum <= 12) {
        const timeMatch = /(\d{1,2}:\d{2})\s*[-–to]+\s*(\d{1,2}:\d{2})/i.exec(k);
        periodColumns.push({
          originalKey: origKey,
          periodNumber: pNum,
          headerStart: timeMatch?.[1],
          headerEnd: timeMatch?.[2],
        });
      }
    }
  });

  const isMatrixFormat = periodColumns.length >= 2;
  const periods: ParsedTimetableExcelRow[] = [];

  if (isMatrixFormat) {
    let carryClass = '';
    let carrySection = '';
    let carryCode = '';

    rawJson.forEach((rawRow, idx) => {
      const rowNumber = idx + 2;
      const normalized: Record<string, string> = {};
      Object.entries(rawRow).forEach(([k, v]) => {
        normalized[normalizeHeaderKey(k)] = String(v ?? '').trim();
      });
      if (!Object.values(normalized).some(Boolean)) return;

      const rawClass = getField(normalized, ['class', 'grade', 'gradelevel', 'standard', 'classname']);
      const rawSection = getField(normalized, ['section', 'sec', 'division']);
      const rawCode = getField(normalized, ['classcode', 'code']);
      if (rawClass) carryClass = rawClass;
      if (rawSection) carrySection = rawSection;
      if (rawCode) carryCode = rawCode;

      const rawDay = getField(normalized, ['day', 'dayofweek', 'weekday']);
      const dayOfWeek = parseDayOfWeek(rawDay);
      const clsInfo = resolveClass(rawClass || carryClass, rawSection || carrySection, rawCode || carryCode);

      periodColumns.forEach((col) => {
        const cellVal = String(rawRow[col.originalKey] ?? '').trim();
        if (!cellVal) return;
        const parsedCell = splitSubjectAndTeacherCell(cellVal);
        if (!parsedCell.subject) return;

        const errors: string[] = [];
        if (!clsInfo.gradeLevel) errors.push('Class/Section could not be detected');
        if (!dayOfWeek) errors.push(`Invalid or missing Day "${rawDay}"`);

        const slotCfg = slotByPeriod.get(col.periodNumber);
        const startTime = normalizeTimeValue(col.headerStart || '', slotCfg?.startTime || '08:30');
        const endTime = normalizeTimeValue(col.headerEnd || '', slotCfg?.endTime || '09:15');
        const isBreak = parsedCell.isBreak || Boolean(slotCfg?.isBreak);

        const matchedSub =
          !isBreak && clsInfo.matchedClassId
            ? context.existingSubjects.find(
                (s) =>
                  s.classId === clsInfo.matchedClassId &&
                  s.name.trim().toLowerCase() === parsedCell.subject.toLowerCase(),
              )
            : undefined;
        const matchedTeacher = isBreak ? undefined : matchTeacher(parsedCell.teacher, matchedSub);
        const matchedRoom = isBreak ? undefined : matchRoom('', clsInfo.matchedClassId);

        periods.push({
          rowNumber,
          gradeLevel: clsInfo.gradeLevel,
          section: clsInfo.section,
          classCode: clsInfo.classCode,
          className: clsInfo.className,
          matchedClassId: clsInfo.matchedClassId,
          dayOfWeek: dayOfWeek || 'Monday',
          periodNumber: col.periodNumber,
          startTime,
          endTime,
          isBreak,
          subjectName: isBreak ? 'Break / Recess' : matchedSub?.name || parsedCell.subject.slice(0, 100),
          matchedSubjectId: matchedSub?.id || '',
          teacherName: isBreak ? '' : matchedTeacher?.name || parsedCell.teacher.slice(0, 120),
          matchedTeacherId: matchedTeacher?.id || '',
          roomName: isBreak ? '' : matchedRoom?.name || '',
          matchedRoomId: matchedRoom?.id || '',
          errors,
        });
      });
    });

    return {
      sheetName,
      detectedFormat: 'matrix',
      totalRows: rawJson.length,
      periods,
      classesToCreate: sortClassesInOrder(Array.from(classesToCreateMap.values())),
    };
  }

  // Tabular format: Class | Section | Day | Period | Start Time | End Time | Subject | Teacher | Room
  rawJson.forEach((rawRow, idx) => {
    const rowNumber = idx + 2;
    const row: Record<string, string> = {};
    Object.entries(rawRow).forEach(([k, v]) => {
      row[normalizeHeaderKey(k)] = String(v ?? '').trim();
    });
    if (!Object.values(row).some(Boolean)) return;

    const errors: string[] = [];
    const rawClass = getField(row, ['class', 'grade', 'gradelevel', 'standard', 'std', 'classname']);
    const rawSection = getField(row, ['section', 'sec', 'division', 'div']);
    const rawCode = getField(row, ['classcode', 'code', 'sectioncode']);
    const rawDay = getField(row, ['day', 'dayofweek', 'weekday']);
    const rawPeriod = getField(row, ['period', 'periodnumber', 'periodno', 'slot', 'p']);
    const rawStart = getField(row, ['starttime', 'start', 'from', 'fromtime']);
    const rawEnd = getField(row, ['endtime', 'end', 'to', 'totime']);
    const rawSubject = getField(row, ['subject', 'subjectname', 'course', 'activity']);
    const rawTeacher = getField(row, ['teacher', 'teachername', 'faculty', 'instructor', 'staffid']);
    const rawRoom = getField(row, ['room', 'roomname', 'roomno', 'classroom', 'venue']);
    const rawBreak = getField(row, ['isbreak', 'break', 'recess']);

    const clsInfo = resolveClass(rawClass, rawSection, rawCode);
    if (!clsInfo.gradeLevel) {
      errors.push('Class & Section is required');
    }

    const dayOfWeek = parseDayOfWeek(rawDay);
    if (!dayOfWeek) {
      errors.push(`Invalid Day "${rawDay || '(blank)'}" (use Monday–Saturday)`);
    }

    const periodNumber = Math.max(1, Math.min(12, parseInt(rawPeriod.replace(/[^0-9]/g, ''), 10) || 1));
    const slotCfg = slotByPeriod.get(periodNumber);
    const startTime = normalizeTimeValue(rawStart, slotCfg?.startTime || '08:30');
    const endTime = normalizeTimeValue(rawEnd, slotCfg?.endTime || '09:15');

    const isBreak =
      /^(true|yes|1|break|recess|lunch)$/i.test(rawBreak) ||
      /^(break|recess|lunch|short break|lunch break|interval)$/i.test(rawSubject) ||
      (!rawSubject && Boolean(slotCfg?.isBreak));

    if (!isBreak && !rawSubject) {
      errors.push('Subject name is required');
    }

    const matchedSub =
      !isBreak && clsInfo.matchedClassId
        ? context.existingSubjects.find(
            (s) =>
              s.classId === clsInfo.matchedClassId &&
              s.name.trim().toLowerCase() === rawSubject.toLowerCase(),
          )
        : undefined;
    const matchedTeacher = isBreak ? undefined : matchTeacher(rawTeacher, matchedSub);
    const matchedRoom = isBreak ? undefined : matchRoom(rawRoom, clsInfo.matchedClassId);

    periods.push({
      rowNumber,
      gradeLevel: clsInfo.gradeLevel,
      section: clsInfo.section,
      classCode: clsInfo.classCode,
      className: clsInfo.className,
      matchedClassId: clsInfo.matchedClassId,
      dayOfWeek: dayOfWeek || 'Monday',
      periodNumber,
      startTime,
      endTime,
      isBreak,
      subjectName: isBreak ? 'Break / Recess' : matchedSub?.name || rawSubject.slice(0, 100),
      matchedSubjectId: matchedSub?.id || '',
      teacherName: isBreak ? '' : matchedTeacher?.name || rawTeacher.slice(0, 120),
      matchedTeacherId: matchedTeacher?.id || '',
      roomName: isBreak ? '' : matchedRoom?.name || rawRoom.slice(0, 80),
      matchedRoomId: matchedRoom?.id || '',
      errors,
    });
  });

  return {
    sheetName,
    detectedFormat: 'tabular',
    totalRows: rawJson.length,
    periods,
    classesToCreate: sortClassesInOrder(Array.from(classesToCreateMap.values())),
  };
}

