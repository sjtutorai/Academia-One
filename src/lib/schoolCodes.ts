import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type {
  ClassSectionRange,
  SchoolCodeClassSlot,
  SchoolCodeEntry,
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
 * Expands a ClassSectionRange list into individual class-section records for Firestore creation.
 */
export function expandClassSectionPlan(
  plan: ClassSectionRange[],
): { gradeLevel: string; section: string; name: string; code: string }[] {
  const rows: { gradeLevel: string; section: string; name: string; code: string }[] = [];
  for (const item of plan) {
    const sections = expandSectionRange(item.sectionFrom, item.sectionTo);
    const shortGrade = item.grade
      .replace(/^Class\s+/i, '')
      .replace(/^Grade\s+/i, '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase();
    for (const sec of sections) {
      rows.push({
        gradeLevel: item.grade,
        section: sec,
        name: `${item.grade} - Section ${sec}`,
        code: `C${shortGrade}${sec}`.slice(0, 16),
      });
    }
  }
  return rows;
}

/**
 * Derives an uppercase alphabetic school prefix (2–5 chars) from the school name.
 * Examples:
 *  - "JSS Public School" -> "JSS"
 *  - "DPS International" -> "DPS"
 *  - "Northridge Preparatory Academy" -> "NPA"
 *  - "Oakwood Academy" -> "OA" or "OAK"
 */
export function deriveSchoolPrefix(schoolName: string): string {
  const cleaned = (schoolName || '')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .trim();
  if (!cleaned) return 'SCH';

  const stopWords = new Set(['of', 'the', 'and', 'for', 'in', 'at', 'by', 'to', 'a', 'an']);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'SCH';

  // If the first word is already an uppercase acronym of 2–5 letters (e.g. "JSS Public School")
  const firstWord = words[0];
  if (firstWord.length >= 2 && firstWord.length <= 5 && firstWord === firstWord.toUpperCase()) {
    return firstWord;
  }

  // Otherwise use initials of meaningful words if there are 2+ words
  const meaningful = words.filter((w) => !stopWords.has(w.toLowerCase()));
  const sourceWords = meaningful.length >= 2 ? meaningful : words;

  if (sourceWords.length >= 3) {
    return sourceWords
      .slice(0, 4)
      .map((w) => w[0].toUpperCase())
      .join('');
  }
  if (sourceWords.length === 2) {
    const initials = (sourceWords[0][0] + sourceWords[1][0]).toUpperCase();
    if (sourceWords[0].length >= 2) {
      return (sourceWords[0].slice(0, 2) + sourceWords[1][0]).toUpperCase();
    }
    return initials;
  }

  return sourceWords[0].slice(0, 4).toUpperCase().padEnd(2, 'X');
}

export function sanitizeSchoolPrefix(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
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
  mode: 'role_code' | 'legacy_school_code';
  enteredCode: string;
  canonicalCode: string;
  role?: 'principal' | 'coordinator' | 'teacher' | 'student';
  sequenceIndex?: number;
  roleTotalCount?: number;
  assignedClass?: SchoolCodeClassSlot | null;
  assignedRollNumber?: string;
  assignedCoordinatorClasses?: SchoolCodeClassSlot[];
}

export interface UnresolvedAccessCode {
  ok: false;
  error: string;
}

/**
 * Resolves any entered School / Role Access Code against Firestore `schoolCodes/{prefix}`:
 * - JSS0001       -> Principal of JSS
 * - JSSC01..06    -> Coordinator #1..#6 of JSS (also accepts JSSC0001)
 * - JSST01..20    -> Teacher #1..#20 of JSS (also accepts JSST0001)
 * - JSSS001..100  -> Student #1..#100 of JSS + auto-identified Class & Section (also accepts JSSS01 / JSSS0001)
 * - ACA-7482/NRP  -> Legacy direct school code fallback
 */
export async function resolveSchoolAccessCode(
  rawCodeInput: string,
): Promise<ResolvedAccessCode | UnresolvedAccessCode> {
  const raw = rawCodeInput.trim().toUpperCase().replace(/\s+/g, '');
  if (raw.length < 2) {
    return {
      ok: false,
      error: 'Enter your School Access Code (e.g., JSS0001, JSSC01, JSST01, or JSSS001).',
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

  // 1. Check structured Role Code: <LETTERS><DIGITS> (e.g., JSS0001, JSSC01, JSST01, JSSS001)
  const structuredMatch = /^([A-Z]{2,9})(\d{1,6})$/.exec(raw);
  if (structuredMatch) {
    const [, letters, digitsStr] = structuredMatch;
    const seqNum = parseInt(digitsStr, 10);

    if (!Number.isFinite(seqNum) || seqNum < 1) {
      return { ok: false, error: 'Code sequence number must start at 1 (e.g., 01 or 0001).' };
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
    error: `Code "${raw}" was not found. Confirm your exact role code from your school (e.g., JSS0001 for Principal, JSSC01 for Coordinator, JSST01 for Teacher, JSSS001 for Student).`,
  };
}
