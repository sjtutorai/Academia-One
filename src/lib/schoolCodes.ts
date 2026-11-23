import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type {
  ClassSectionRange,
  MemberAccessCode,
  SchoolClass,
  SchoolCodeClassSlot,
  SchoolCodeEntry,
  StudentProfile,
  TeacherProfile,
} from '../types/models';

export const STANDARD_CLASSES: string[] = [
  'Pre-KG',
  'LKG',
  'UKG',
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
];

export const SECTION_LETTERS: string[] = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

export const DEFAULT_CLASS_SECTION_PLAN: ClassSectionRange[] = [
  { grade: 'Class 1', sectionFrom: 'A', sectionTo: 'G' },
  { grade: 'Class 2', sectionFrom: 'A', sectionTo: 'H' },
];

/**
 * Strictly allows digits 0-9 only for phone number inputs (no letters, words, or symbols).
 */
export function sanitizePhoneDigits(value: string, maxDigits = 15): string {
  return value.replace(/\D/g, '').slice(0, maxDigits);
}

/**
 * Validates that a phone number consists strictly of 10 to 15 numeric digits.
 */
export function isValidPhoneDigits(value: string, minDigits = 10, maxDigits = 15): boolean {
  const clean = value.trim();
  return new RegExp(`^\\d{${minDigits},${maxDigits}}$`).test(clean);
}

/**
 * Expands a section range like ('A', 'G') into ['A', 'B', 'C', 'D', 'E', 'F', 'G'].
 */
export function expandSectionRange(from: string, to: string): string[] {
  const f = (from || 'A').trim().toUpperCase().charCodeAt(0);
  const t = (to || from || 'A').trim().toUpperCase().charCodeAt(0);
  const start = Math.max(65, Math.min(90, Math.min(f, t)));
  const end = Math.max(65, Math.min(90, Math.max(f, t)));
  const out: string[] = [];
  for (let code = start; code <= end; code++) {
    out.push(String.fromCharCode(code));
  }
  return out;
}

/**
 * Formats a class section range label, e.g. "Section: A-G" or "Section: A".
 */
export function formatSectionRangeLabel(from: string, to: string): string {
  const sections = expandSectionRange(from, to);
  if (sections.length <= 1) return `Section: ${sections[0] || 'A'}`;
  return `Section: ${sections[0]}-${sections[sections.length - 1]}`;
}

/**
 * Formats an entire class section plan into a concise human-readable string:
 * e.g. "Class 1 Section: A-G, Class 2 Section: A-H"
 */
export function formatClassSectionPlanSummary(plan: ClassSectionRange[]): string {
  if (!plan || plan.length === 0) return '';
  return plan
    .map((item) => `${item.grade} ${formatSectionRangeLabel(item.sectionFrom, item.sectionTo)}`)
    .join(', ');
}

/**
 * Counts total individual class-section buckets across a ClassSectionRange list.
 */
export function countTotalClassSections(plan: ClassSectionRange[]): number {
  return plan.reduce((sum, row) => sum + expandSectionRange(row.sectionFrom, row.sectionTo).length, 0);
}

/**
 * Normalizes user or spreadsheet grade strings into canonical labels:
 * "10" / "Grade 10" / "Class 10" -> "Class 10", "lkg" -> "LKG", "pre-kg" -> "Pre-KG".
 */
export function normalizeGradeLevel(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const compact = cleaned.toLowerCase().replace(/[\s._-]+/g, '');
  if (compact === 'prekg' || compact === 'prek' || compact === 'playgroup' || compact === 'pg') return 'Pre-KG';
  if (compact === 'nursery' || compact === 'nur') return 'Nursery';
  if (compact === 'lkg' || compact === 'lowerkg' || compact === 'kg1' || compact === 'junior') return 'LKG';
  if (compact === 'ukg' || compact === 'upperkg' || compact === 'kg2' || compact === 'senior') return 'UKG';
  if (compact === 'kg' || compact === 'kindergarten') return 'UKG';

  const romanMap: Record<string, number> = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
    ix: 9,
    x: 10,
    xi: 11,
    xii: 12,
  };
  const stripped = cleaned.replace(/^(class|grade|std|standard)\s*/i, '').trim();
  const numMatch = /^(\d{1,2})(st|nd|rd|th)?$/i.exec(stripped);
  if (numMatch) {
    return `Class ${parseInt(numMatch[1], 10)}`;
  }
  const romanNum = romanMap[stripped.toLowerCase()];
  if (romanNum) {
    return `Class ${romanNum}`;
  }
  return cleaned;
}

/**
 * Derives a compact uppercase class code from a grade level and section (e.g., Class 10 + A -> C10A).
 */
export function deriveClassSectionCode(gradeLevel: string, section: string): string {
  const normalizedGrade = normalizeGradeLevel(gradeLevel) || gradeLevel.trim();
  const shortGrade = normalizedGrade
    .replace(/^Class\s+/i, '')
    .replace(/^Grade\s+/i, '')
    .replace(/^Std\.?\s+/i, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  const cleanSec = (section || 'A').trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'A';
  return `C${shortGrade}${cleanSec}`.slice(0, 16);
}

/**
 * Returns a deterministic numeric sort rank for grade levels so Pre-KG, Nursery, LKG, UKG,
 * and Class 1 through Class 12 always appear in natural academic order.
 */
export function getGradeSortRank(gradeLevel: string): number {
  const normalized = normalizeGradeLevel(gradeLevel).toLowerCase();
  if (normalized === 'pre-kg') return 0;
  if (normalized === 'nursery') return 1;
  if (normalized === 'lkg') return 2;
  if (normalized === 'ukg') return 3;
  const numMatch = /(\d+)/.exec(normalized);
  if (numMatch) {
    return 10 + parseInt(numMatch[1], 10);
  }
  return 999;
}

/**
 * Sorts classes & sections in natural academic order: grade level ascending, then section A-Z / numeric.
 */
export function sortClassesInOrder<
  T extends { gradeLevel?: string; section?: string; code?: string; name?: string },
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const gradeA = a.gradeLevel || a.name || a.code || '';
    const gradeB = b.gradeLevel || b.name || b.code || '';
    const rankDiff = getGradeSortRank(gradeA) - getGradeSortRank(gradeB);
    if (rankDiff !== 0) return rankDiff;

    const normA = normalizeGradeLevel(gradeA);
    const normB = normalizeGradeLevel(gradeB);
    const gradeTextDiff = normA.localeCompare(normB, undefined, { numeric: true, sensitivity: 'base' });
    if (gradeTextDiff !== 0) return gradeTextDiff;

    const secA = (a.section || '').trim();
    const secB = (b.section || '').trim();
    const secDiff = secA.localeCompare(secB, undefined, { numeric: true, sensitivity: 'base' });
    if (secDiff !== 0) return secDiff;

    return (a.code || a.name || '').localeCompare(b.code || b.name || '', undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

/**
 * Expands a ClassSectionRange list into individual class-section records for Firestore creation,
 * ordered naturally by grade level and section.
 */
export function expandClassSectionPlan(
  plan: ClassSectionRange[],
): { gradeLevel: string; section: string; name: string; code: string }[] {
  const rows: { gradeLevel: string; section: string; name: string; code: string }[] = [];
  for (const item of plan) {
    const grade = normalizeGradeLevel(item.grade) || item.grade.trim();
    const sections = expandSectionRange(item.sectionFrom, item.sectionTo);
    for (const sec of sections) {
      rows.push({
        gradeLevel: grade,
        section: sec,
        name: `${grade} - Section ${sec}`,
        code: deriveClassSectionCode(grade, sec),
      });
    }
  }
  return sortClassesInOrder(rows);
}

/**
 * Derives the exact starting 3 uppercase alphabetic letters of the school name.
 * Examples:
 *  - "JSS Public School" -> "JSS"
 *  - "Oakwood Academy" -> "OAK"
 *  - "St. Xavier High" -> "STX"
 */
export function deriveSchoolPrefix(schoolName: string): string {
  const lettersOnly = (schoolName || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (!lettersOnly) return 'SCH';
  if (lettersOnly.length >= 3) return lettersOnly.slice(0, 3);
  return lettersOnly.padEnd(3, 'X');
}

export function sanitizeSchoolPrefix(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
}

const ACTIVATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates a Main Head Activation Code given to a manually-registered school's Principal
 * to unlock their initial setup wizard (e.g. MH-JSS-8K4P2X).
 */
export function generateActivationCode(schoolCode: string): string {
  const pfx = sanitizeSchoolPrefix(schoolCode || 'SCH').slice(0, 4) || 'SCH';
  let token = '';
  for (let i = 0; i < 6; i++) {
    token += ACTIVATION_ALPHABET[Math.floor(Math.random() * ACTIVATION_ALPHABET.length)];
  }
  return `MH-${pfx}-${token}`;
}

/**
 * Formats the Principal access code: e.g. JSS0001
 */
export function formatPrincipalCode(prefix: string): string {
  return `${prefix.toUpperCase()}0001`;
}

/**
 * Formats sequential role access codes based on total allocated count:
 * - 6 coordinators -> JSSC01 .. JSSC06
 * - 20 teachers    -> JSST01 .. JSST20
 * - 100 students   -> JSSS001 .. JSSS100
 */
export function formatMemberRoleCode(
  prefix: string,
  role: 'coordinator' | 'teacher' | 'student',
  sequenceIndex: number,
  totalCount: number,
): string {
  const roleLetter = role === 'coordinator' ? 'C' : role === 'teacher' ? 'T' : 'S';
  const digitsWidth = Math.max(2, String(Math.max(1, totalCount)).length);
  return `${prefix.toUpperCase()}${roleLetter}${String(sequenceIndex).padStart(digitsWidth, '0')}`;
}

export function formatRoleCodeRange(
  prefix: string,
  role: 'coordinator' | 'teacher' | 'student',
  totalCount: number,
): string {
  if (totalCount <= 0) return 'None allocated';
  const first = formatMemberRoleCode(prefix, role, 1, totalCount);
  if (totalCount === 1) return first;
  const last = formatMemberRoleCode(prefix, role, totalCount, totalCount);
  return `${first} – ${last}`;
}

/**
 * Maps a student's 1-based sequence index to their assigned class & section
 * evenly across the school's configured classSections list.
 */
export function resolveStudentClassForIndex(
  classSections: SchoolCodeClassSlot[],
  studentIndex: number,
  totalStudents: number,
): { slot: SchoolCodeClassSlot | null; rollNumber: string } {
  if (!classSections || classSections.length === 0) {
    return { slot: null, rollNumber: String(studentIndex).padStart(2, '0') };
  }
  const safeTotal = Math.max(studentIndex, totalStudents, 1);
  const clampedIdx = Math.max(1, Math.min(safeTotal, studentIndex));
  const bucketIdx = Math.min(
    classSections.length - 1,
    Math.floor(((clampedIdx - 1) * classSections.length) / safeTotal),
  );
  // Calculate student's roll number inside this class section
  const firstIndexInBucket = Math.ceil((bucketIdx * safeTotal) / classSections.length) + 1;
  const rollInClass = Math.max(1, clampedIdx - firstIndexInBucket + 1);
  return {
    slot: classSections[bucketIdx],
    rollNumber: String(rollInClass).padStart(2, '0'),
  };
}

/**
 * Maps a coordinator's 1-based sequence index to their assigned block of class sections.
 */
export function resolveCoordinatorClassesForIndex(
  classSections: SchoolCodeClassSlot[],
  coordIndex: number,
  totalCoordinators: number,
): SchoolCodeClassSlot[] {
  if (!classSections || classSections.length === 0) return [];
  const safeTotal = Math.max(1, totalCoordinators);
  const clampedIdx = Math.max(1, Math.min(safeTotal, coordIndex));
  const start = Math.floor(((clampedIdx - 1) * classSections.length) / safeTotal);
  const end = Math.floor((clampedIdx * classSections.length) / safeTotal);
  const slice = classSections.slice(start, Math.max(start + 1, end));
  return slice.length > 0 ? slice : [classSections[Math.min(clampedIdx - 1, classSections.length - 1)]];
}

export interface ResolvedAccessCode {
  ok: true;
  schoolEntry: SchoolCodeEntry;
  mode: 'role_code' | 'legacy_school_code' | 'named_member_code';
  enteredCode: string;
  canonicalCode: string;
  role?: 'principal' | 'coordinator' | 'teacher' | 'student';
  sequenceIndex?: number;
  roleTotalCount?: number;
  assignedClass?: SchoolCodeClassSlot | null;
  assignedRollNumber?: string;
  assignedCoordinatorClasses?: SchoolCodeClassSlot[];
  memberCodeRecord?: MemberAccessCode;
}

export interface UnresolvedAccessCode {
  ok: false;
  error: string;
}

export interface VerifiedStudentFourCodes {
  ok: true;
  schoolEntry: SchoolCodeEntry;
  schoolCode: string;
  classSlot: SchoolCodeClassSlot;
  classCode: string;
  teacherRecord: MemberAccessCode | null;
  teacherCode: string;
  teacherName: string;
  teacherId: string;
  teacherUid: string;
  studentRecord: MemberAccessCode | null;
  studentCode: string;
  studentName: string;
  rollNumber: string;
}

/**
 * Verifies the 4 required student join codes:
 * 1) School Code (e.g. JSS)
 * 2) Class Code (e.g. C1A)
 * 3) Teacher Code (e.g. JSST01)
 * 4) Student Code (e.g. JSSS001)
 */
export async function verifyStudentFourCodes(params: {
  schoolCode: string;
  classCode: string;
  teacherCode: string;
  studentCode: string;
}): Promise<VerifiedStudentFourCodes | UnresolvedAccessCode> {
  const sCode = params.schoolCode.trim().toUpperCase().replace(/\s+/g, '');
  const cCode = params.classCode.trim().toUpperCase().replace(/\s+/g, '');
  const tCode = params.teacherCode.trim().toUpperCase().replace(/\s+/g, '');
  const stCode = params.studentCode.trim().toUpperCase().replace(/\s+/g, '');

  if (sCode.length < 2) {
    return { ok: false, error: 'Enter a valid School Code.' };
  }
  if (cCode.length < 2) {
    return { ok: false, error: 'Enter your Class Code given by your school or teacher.' };
  }
  if (tCode.length < 4) {
    return { ok: false, error: 'Enter your Class Teacher Code.' };
  }
  if (stCode.length < 4) {
    return { ok: false, error: 'Enter your personal Student Code obtained from your teacher.' };
  }

  // 1. Verify School Code
  let schoolEntry: SchoolCodeEntry;
  try {
    const schoolSnap = await getDoc(doc(db, 'schoolCodes', sCode));
    if (!schoolSnap.exists()) {
      return { ok: false, error: `School Code "${sCode}" was not found. Confirm the 3-letter school code.` };
    }
    schoolEntry = schoolSnap.data() as SchoolCodeEntry;
    if (schoolEntry.status === 'suspended' || schoolEntry.status === 'archived') {
      return {
        ok: false,
        error: `"${schoolEntry.schoolName}" is currently not accepting new registrations (${schoolEntry.status}).`,
      };
    }
  } catch {
    return { ok: false, error: 'Unable to verify School Code right now. Please try again.' };
  }

  // 2. Verify Class Code against schoolEntry.classSections
  const classSections = schoolEntry.classSections || [];
  const normalizeClassCode = (slot: SchoolCodeClassSlot) => {
    if (slot.classCode) return slot.classCode.trim().toUpperCase();
    const shortGrade = slot.gradeLevel
      .replace(/^Class\s+/i, '')
      .replace(/^Grade\s+/i, '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase();
    return `C${shortGrade}${slot.section.toUpperCase()}`;
  };

  let matchedClass = classSections.find((slot) => {
    const derived = normalizeClassCode(slot);
    return (
      derived === cCode ||
      slot.classId.toUpperCase() === cCode ||
      `${slot.gradeLevel}${slot.section}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === cCode
    );
  });

  // 3. Verify Teacher Code in memberAccessCodes/{tCode}
  let teacherRecord: MemberAccessCode | null = null;
  try {
    const teacherSnap = await getDoc(doc(db, 'memberAccessCodes', tCode));
    if (teacherSnap.exists()) {
      const rec = teacherSnap.data() as MemberAccessCode;
      if (rec.status === 'revoked') {
        return { ok: false, error: `Teacher Code "${tCode}" has been revoked by the school.` };
      }
      if (rec.schoolId !== schoolEntry.schoolId) {
        return {
          ok: false,
          error: `Teacher Code "${tCode}" does not belong to ${schoolEntry.schoolName} (${sCode}).`,
        };
      }
      if (rec.role !== 'teacher') {
        return { ok: false, error: `"${tCode}" is registered as a ${rec.role} code, not a Teacher Code.` };
      }
      teacherRecord = rec;
    }
  } catch {
    // fallback check below
  }

  if (!teacherRecord) {
    // Allow structured school teacher code fallback only if school prefix matches e.g. JSST01
    const tMatch = new RegExp(`^${schoolEntry.code}T(\\d{1,5})$`).exec(tCode);
    if (!tMatch) {
      return {
        ok: false,
        error: `Teacher Code "${tCode}" was not found for ${schoolEntry.schoolName}. Ask your class teacher for their exact Teacher Code.`,
      };
    }
  }

  // 4. Verify Student Code in memberAccessCodes/{stCode}
  let studentRecord: MemberAccessCode | null = null;
  try {
    const studentSnap = await getDoc(doc(db, 'memberAccessCodes', stCode));
    if (studentSnap.exists()) {
      const rec = studentSnap.data() as MemberAccessCode;
      if (rec.status === 'revoked') {
        return { ok: false, error: `Student Code "${stCode}" has been revoked.` };
      }
      if (rec.schoolId !== schoolEntry.schoolId) {
        return {
          ok: false,
          error: `Student Code "${stCode}" does not belong to ${schoolEntry.schoolName} (${sCode}).`,
        };
      }
      if (rec.role !== 'student') {
        return { ok: false, error: `"${stCode}" is registered as a ${rec.role} code, not a Student Code.` };
      }
      if (rec.classCode && rec.classCode.toUpperCase() !== cCode) {
        return {
          ok: false,
          error: `Student Code "${stCode}" is assigned to Class Code ${rec.classCode}, not ${cCode}.`,
        };
      }
      if (rec.teacherCode && rec.teacherCode.toUpperCase() !== tCode) {
        return {
          ok: false,
          error: `Student Code "${stCode}" is assigned to Teacher Code ${rec.teacherCode}, not ${tCode}.`,
        };
      }
      studentRecord = rec;
    }
  } catch {
    // fallback check below
  }

  if (!studentRecord) {
    const sMatch = new RegExp(`^${schoolEntry.code}S(\\d{1,6})$`).exec(stCode);
    const maxStudents = schoolEntry.studentCount ?? 1000;
    if (!sMatch || parseInt(sMatch[1], 10) < 1 || parseInt(sMatch[1], 10) > maxStudents) {
      return {
        ok: false,
        error: `Student Code "${stCode}" was not found for ${schoolEntry.schoolName}. Obtain your personal Student Code from your class teacher.`,
      };
    }
  }

  // If class wasn't matched from schoolEntry.classSections, try studentRecord or teacherRecord class metadata
  if (!matchedClass && studentRecord?.classId) {
    matchedClass = {
      classId: studentRecord.classId,
      classCode: studentRecord.classCode || cCode,
      className: studentRecord.className || cCode,
      gradeLevel: studentRecord.className?.split(' - ')[0] || cCode,
      section: studentRecord.className?.split('Section ')[1] || 'A',
    };
  }
  if (!matchedClass && classSections.length > 0) {
    const available = classSections.slice(0, 8).map(normalizeClassCode).join(', ');
    return {
      ok: false,
      error: `Class Code "${cCode}" was not found in ${schoolEntry.schoolName}. Available class codes include: ${available}.`,
    };
  }
  if (!matchedClass) {
    matchedClass = {
      classId: '',
      classCode: cCode,
      className: cCode,
      gradeLevel: cCode,
      section: 'A',
    };
  }

  return {
    ok: true,
    schoolEntry,
    schoolCode: schoolEntry.code,
    classSlot: {
      ...matchedClass,
      classCode: normalizeClassCode(matchedClass),
    },
    classCode: normalizeClassCode(matchedClass),
    teacherRecord,
    teacherCode: tCode,
    teacherName: teacherRecord?.memberName || studentRecord?.teacherName || `Teacher (${tCode})`,
    teacherId: teacherRecord?.linkedProfileId || studentRecord?.teacherId || '',
    teacherUid: teacherRecord?.linkedUid || '',
    studentRecord,
    studentCode: stCode,
    studentName: studentRecord?.memberName || '',
    rollNumber: studentRecord?.rollNumber || '',
  };
}

/**
 * Resolves any entered School / Role Access Code against Firestore `memberAccessCodes/{raw}`
 * and `schoolCodes/{prefix}`:
 * - Named member codes: JSSC01 (Shubhangi), JSST01, JSSS001
 * - JSS0001       -> Principal of JSS
 * - JSSC01..06    -> Coordinator #1..#6 of JSS
 * - JSST01..20    -> Teacher #1..#20 of JSS
 * - JSSS001..100  -> Student #1..#100 of JSS
 * - ACA-7482/NRP  -> Legacy direct school code fallback
 */
export async function resolveSchoolAccessCode(
  rawCodeInput: string,
): Promise<ResolvedAccessCode | UnresolvedAccessCode> {
  const raw = rawCodeInput.trim().toUpperCase().replace(/\s+/g, '');
  if (raw.length < 2) {
    return {
      ok: false,
      error: 'Enter your School Access Code.',
    };
  }

  const checkSuspended = (entry: SchoolCodeEntry): UnresolvedAccessCode | null => {
    if (entry.status === 'suspended' || entry.status === 'archived') {
      return {
        ok: false,
        error: `"${entry.schoolName}" is currently not accepting new registrations (${entry.status}).`,
      };
    }
    return null;
  };

  // 0. Check named memberAccessCodes/{raw} first (e.g. JSSC01 for Shubhangi, JSST01 for teacher)
  try {
    const memberSnap = await getDoc(doc(db, 'memberAccessCodes', raw));
    if (memberSnap.exists()) {
      const memberRec = memberSnap.data() as MemberAccessCode;
      if (memberRec.status === 'revoked') {
        return {
          ok: false,
          error: `Access code "${raw}" has been revoked by ${memberRec.schoolName}.`,
        };
      }
      const schoolSnap = await getDoc(doc(db, 'schoolCodes', memberRec.schoolCode));
      if (schoolSnap.exists()) {
        const schoolEntry = schoolSnap.data() as SchoolCodeEntry;
        const blocked = checkSuspended(schoolEntry);
        if (blocked) return blocked;
        const assignedSlot: SchoolCodeClassSlot | null = memberRec.classId
          ? {
              classId: memberRec.classId,
              classCode: memberRec.classCode || '',
              className: memberRec.className || '',
              gradeLevel: memberRec.className?.split(' - ')[0] || '',
              section: memberRec.className?.split('Section ')[1] || '',
            }
          : null;
        return {
          ok: true,
          schoolEntry,
          mode: 'named_member_code',
          enteredCode: raw,
          canonicalCode: memberRec.code,
          role: memberRec.role,
          assignedClass: assignedSlot,
          assignedRollNumber: memberRec.rollNumber || undefined,
          memberCodeRecord: memberRec,
        };
      }
    }
  } catch {
    // Fall through to structured schoolCodes lookup
  }

  // 1. Check structured Role Code: <LETTERS><DIGITS> (e.g., JSS0001, JSSC01, JSST01, JSSS001)
  const structuredMatch = /^([A-Z]{2,9})(\d{1,6})$/.exec(raw);
  if (structuredMatch) {
    const [, letters, digitsStr] = structuredMatch;
    const seqNum = parseInt(digitsStr, 10);

    if (!Number.isFinite(seqNum) || seqNum < 1) {
      return { ok: false, error: 'Code sequence number must start at 1.' };
    }

    // 1a. First check if `letters` directly matches a school prefix -> Principal login code (e.g., JSS0001)
    try {
      const principalSnap = await getDoc(doc(db, 'schoolCodes', letters));
      if (principalSnap.exists()) {
        const entry = principalSnap.data() as SchoolCodeEntry;
        const blocked = checkSuspended(entry);
        if (blocked) return blocked;

        if (seqNum !== 1) {
          return {
            ok: false,
            error: `Principal code for ${entry.schoolName} is ${formatPrincipalCode(entry.code)}. For staff or students, add C (Coordinator), T (Teacher), or S (Student) after ${entry.code}.`,
          };
        }
        return {
          ok: true,
          schoolEntry: entry,
          mode: 'role_code',
          enteredCode: raw,
          canonicalCode: formatPrincipalCode(entry.code),
          role: 'principal',
          sequenceIndex: 1,
          roleTotalCount: 1,
        };
      }
    } catch {
      // fall through to role-letter check
    }

    // 1b. Check if the last letter of `letters` is a role indicator: C (Coordinator), T (Teacher), S (Student)
    const lastChar = letters[letters.length - 1];
    const basePrefix = letters.slice(0, -1);
    if (basePrefix.length >= 2 && (lastChar === 'C' || lastChar === 'T' || lastChar === 'S')) {
      try {
        const roleSnap = await getDoc(doc(db, 'schoolCodes', basePrefix));
        if (roleSnap.exists()) {
          const entry = roleSnap.data() as SchoolCodeEntry;
          const blocked = checkSuspended(entry);
          if (blocked) return blocked;

          const role: 'coordinator' | 'teacher' | 'student' =
            lastChar === 'C' ? 'coordinator' : lastChar === 'T' ? 'teacher' : 'student';

          const maxCount =
            role === 'coordinator'
              ? entry.coordinatorCount ?? 20
              : role === 'teacher'
                ? entry.teacherCount ?? 100
                : entry.studentCount ?? 1000;

          if (maxCount <= 0) {
            return {
              ok: false,
              error: `No ${role} codes are allocated for ${entry.schoolName}. Ask your Principal to update allocations.`,
            };
          }

          if (seqNum > maxCount) {
            const validRange = formatRoleCodeRange(entry.code, role, maxCount);
            return {
              ok: false,
              error: `${raw} exceeds ${entry.schoolName}'s ${role} allocation (${maxCount} ${role}${maxCount > 1 ? 's' : ''}). Valid range: ${validRange}.`,
            };
          }

          const canonicalCode = formatMemberRoleCode(entry.code, role, seqNum, maxCount);
          const classSections = entry.classSections || [];

          if (role === 'student') {
            const { slot, rollNumber } = resolveStudentClassForIndex(classSections, seqNum, maxCount);
            return {
              ok: true,
              schoolEntry: entry,
              mode: 'role_code',
              enteredCode: raw,
              canonicalCode,
              role: 'student',
              sequenceIndex: seqNum,
              roleTotalCount: maxCount,
              assignedClass: slot,
              assignedRollNumber: rollNumber,
            };
          }

          if (role === 'coordinator') {
            const coordClasses = resolveCoordinatorClassesForIndex(classSections, seqNum, maxCount);
            return {
              ok: true,
              schoolEntry: entry,
              mode: 'role_code',
              enteredCode: raw,
              canonicalCode,
              role: 'coordinator',
              sequenceIndex: seqNum,
              roleTotalCount: maxCount,
              assignedCoordinatorClasses: coordClasses,
            };
          }

          return {
            ok: true,
            schoolEntry: entry,
            mode: 'role_code',
            enteredCode: raw,
            canonicalCode,
            role: 'teacher',
            sequenceIndex: seqNum,
            roleTotalCount: maxCount,
          };
        }
      } catch {
        // fall through to exact code check
      }
    }
  }

  // 2. Fallback: Exact direct match on `schoolCodes/{raw}` (for legacy school codes like ACA-7482 or NRP)
  try {
    const exactSnap = await getDoc(doc(db, 'schoolCodes', raw));
    if (exactSnap.exists()) {
      const entry = exactSnap.data() as SchoolCodeEntry;
      const blocked = checkSuspended(entry);
      if (blocked) return blocked;
      return {
        ok: true,
        schoolEntry: entry,
        mode: 'legacy_school_code',
        enteredCode: raw,
        canonicalCode: entry.code,
      };
    }
  } catch {
    return {
      ok: false,
      error: 'Unable to verify your School Access Code right now. Please try again.',
    };
  }

  return {
    ok: false,
    error: `Code "${raw}" was not found. Confirm your exact role code with your school.`,
  };
}

export interface GradeClassGroup {
  gradeLevel: string;
  sections: SchoolClass[];
}

export interface GradeGroupSummary {
  gradeLevel: string;
  sections: SchoolClass[];
  totalInSchool: number;
  assignedCount: number;
  isAllSections: boolean;
  sectionsLabel: string;
}

/**
 * Groups school classes by normalized grade level in natural academic order (Pre-KG..Class 12)
 * with sections sorted A-Z inside each grade.
 */
export function groupClassesByGrade(classes: SchoolClass[]): GradeClassGroup[] {
  const ordered = sortClassesInOrder(classes);
  const map = new Map<string, SchoolClass[]>();
  for (const cl of ordered) {
    const rawGrade = cl.gradeLevel || cl.name?.split(' - ')[0] || cl.code || 'Other';
    const grade = normalizeGradeLevel(rawGrade) || rawGrade.trim();
    const list = map.get(grade) || [];
    list.push(cl);
    map.set(grade, list);
  }
  return Array.from(map.entries())
    .sort(([gradeA], [gradeB]) => {
      const rankDiff = getGradeSortRank(gradeA) - getGradeSortRank(gradeB);
      if (rankDiff !== 0) return rankDiff;
      return gradeA.localeCompare(gradeB, undefined, { numeric: true, sensitivity: 'base' });
    })
    .map(([gradeLevel, sections]) => ({
      gradeLevel,
      sections: sortClassesInOrder(sections),
    }));
}

function formatOrderedSectionList(sections: SchoolClass[], isAllInSchool: boolean, totalInSchool: number): string {
  const names = sections.map((s) => (s.section || '').trim().toUpperCase() || s.code).filter(Boolean);
  if (names.length === 0) return 'No sections';

  // Detect contiguous single-letter A-Z range (e.g. A..G)
  const isContiguousAlpha =
    names.length >= 3 &&
    names.every((n) => /^[A-Z]$/.test(n)) &&
    names.every((n, i) => i === 0 || n.charCodeAt(0) === names[i - 1].charCodeAt(0) + 1);

  if (isAllInSchool && totalInSchool > 1) {
    if (isContiguousAlpha) {
      return `All Sections (${names[0]}–${names[names.length - 1]})`;
    }
    if (names.length <= 5) {
      return `All Sections (${names.join(', ')})`;
    }
    return `All ${names.length} Sections`;
  }

  if (isAllInSchool && totalInSchool === 1) {
    return `All (Section ${names[0]})`;
  }

  if (names.length === 1) {
    return `Section ${names[0]}`;
  }
  if (isContiguousAlpha) {
    return `Sections ${names[0]}–${names[names.length - 1]}`;
  }
  return `Sections ${names.join(', ')}`;
}

/**
 * Summarizes assigned classes into compact grade-level groups, automatically identifying
 * when all sections of a grade in the school are assigned.
 */
export function summarizeClassesByGrade(
  assignedClasses: SchoolClass[],
  allSchoolClasses?: SchoolClass[],
): GradeGroupSummary[] {
  const schoolGroups = groupClassesByGrade(
    allSchoolClasses && allSchoolClasses.length > 0 ? allSchoolClasses : assignedClasses,
  );
  const schoolCountByGrade = new Map<string, number>();
  for (const g of schoolGroups) {
    schoolCountByGrade.set(g.gradeLevel, g.sections.length);
  }

  const assignedGroups = groupClassesByGrade(assignedClasses);
  return assignedGroups.map((group) => {
    const totalInSchool = schoolCountByGrade.get(group.gradeLevel) ?? group.sections.length;
    const assignedCount = group.sections.length;
    const isAllSections = totalInSchool > 0 && assignedCount >= totalInSchool;
    return {
      gradeLevel: group.gradeLevel,
      sections: group.sections,
      totalInSchool,
      assignedCount,
      isAllSections,
      sectionsLabel: formatOrderedSectionList(group.sections, isAllSections, totalInSchool),
    };
  });
}

/**
 * Concise single-line grade summary for staff tables, e.g. "Class 1 (All A–G) · Class 9 (D–G)".
 */
export function formatGradeSummaryCompact(
  assignedClasses: SchoolClass[],
  allSchoolClasses?: SchoolClass[],
): string {
  const summaries = summarizeClassesByGrade(assignedClasses, allSchoolClasses);
  if (summaries.length === 0) return 'Unassigned';
  return summaries
    .map((s) => {
      const compactSec = s.sectionsLabel
        .replace(/^All Sections \((.+)\)$/, 'All $1')
        .replace(/^All \(Section (.+)\)$/, 'Sec $1')
        .replace(/^Sections /, '')
        .replace(/^Section /, 'Sec ');
      return `${s.gradeLevel} (${compactSec})`;
    })
    .join(' · ');
}

export interface StudentFourCodePack {
  studentName: string;
  rollNumber?: string;
  schoolName: string;
  schoolCode: string;
  className: string;
  classCode: string;
  teacherName: string;
  teacherCode: string;
  studentCode: string;
}

/**
 * Builds the complete 4-code student login bundle (School Code, Class Code,
 * Class Teacher Code, and Student Access Code) from live school roster data.
 */
export function buildStudentFourCodePack(params: {
  schoolCode: string;
  schoolName: string;
  student?: Partial<StudentProfile> | null;
  namedCode?: Partial<MemberAccessCode> | null;
  classes: SchoolClass[];
  teachers: TeacherProfile[];
}): StudentFourCodePack {
  const { schoolCode, schoolName, student, namedCode, classes, teachers } = params;
  const studentName = student?.name || namedCode?.memberName || 'Student';
  const rollNumber = student?.rollNumber || namedCode?.rollNumber || '';
  const studentCode = (student?.accessCode || namedCode?.code || '').trim().toUpperCase();

  const matchedClass =
    classes.find((c) => c.id === student?.classId || c.id === namedCode?.classId) ||
    classes.find(
      (c) =>
        namedCode?.classCode &&
        c.code.trim().toUpperCase() === namedCode.classCode.trim().toUpperCase(),
    ) ||
    null;

  const classCode = (
    matchedClass?.code ||
    namedCode?.classCode ||
    (student?.className && student?.section
      ? deriveClassSectionCode(student.className.split(' - ')[0], student.section)
      : '')
  )
    .trim()
    .toUpperCase();

  const className =
    matchedClass?.name ||
    student?.className ||
    namedCode?.className ||
    '';

  const matchedTeacher =
    teachers.find((t) => matchedClass?.classTeacherId && t.id === matchedClass.classTeacherId) ||
    teachers.find((t) => namedCode?.teacherId && t.id === namedCode.teacherId) ||
    teachers.find((t) => matchedClass?.id && t.classTeacherOfClassId === matchedClass.id) ||
    teachers.find((t) => matchedClass?.id && (t.assignedClassIds || []).includes(matchedClass.id)) ||
    null;

  const teacherCode = (matchedTeacher?.accessCode || matchedTeacher?.staffId || namedCode?.teacherCode || '')
    .trim()
    .toUpperCase();
  const teacherName = matchedTeacher?.name || matchedClass?.classTeacherName || namedCode?.teacherName || '';

  return {
    studentName,
    rollNumber,
    schoolName: schoolName || namedCode?.schoolName || 'School',
    schoolCode: (schoolCode || namedCode?.schoolCode || '').trim().toUpperCase(),
    className,
    classCode,
    teacherName,
    teacherCode,
    studentCode,
  };
}

/**
 * Formats the 4 student login codes into a clean, ready-to-share message for WhatsApp, SMS, or email.
 */
export function formatStudentFourCodeMessage(pack: StudentFourCodePack): string {
  const lines = [
    `${pack.schoolName} — Student Login Codes`,
    `Student: ${pack.studentName}${pack.rollNumber ? ` (Roll #${pack.rollNumber})` : ''}`,
    pack.className ? `Class: ${pack.className}` : null,
    '',
    `1. School Code: ${pack.schoolCode || 'Not set'}`,
    `2. Class & Section Code: ${pack.classCode || 'Not assigned'}`,
    `3. Class Teacher Code: ${pack.teacherCode || 'Not assigned'}${pack.teacherName ? ` (${pack.teacherName})` : ''}`,
    `4. Student Access Code: ${pack.studentCode || 'Not assigned'}`,
    '',
    'Sign in and open Join School to enter these 4 codes.',
  ].filter((line): line is string => line !== null);
  return lines.join('\n');
}

