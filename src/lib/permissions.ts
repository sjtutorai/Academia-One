import type {
  UserRole,
  School,
  TimetablePeriod,
  Examination,
  PlatformUser,
} from '../types/models';

export const ROLE_LABELS: Record<UserRole, string> = {
  main_head: 'Main Head',
  principal: 'Principal',
  coordinator: 'Coordinator',
  teacher: 'Teacher',
  student: 'Student',
};

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  main_head: '/main-head/dashboard',
  principal: '/principal/dashboard',
  coordinator: '/coordinator/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
};

export const ROLE_PERMISSION_MATRIX: Record<UserRole, string[]> = {
  main_head: [
    'Manage all schools (create, edit, suspend, archive, delete)',
    'Create & reset Principal credentials (no plaintext viewing)',
    'Create & edit subscription plans and school subscriptions',
    'Inspect platform-wide analytics, users, enquiries, settings, and audit logs',
  ],
  principal: [
    'Full school administration strictly within own schoolId',
    'Manage Coordinators (with granular permission controls), Teachers, and Students',
    'Manage Classes, Sections, Subjects, Rooms, Weekly Timetables, Exams, Homework, Announcements',
    'Bulk CSV import/export, student promotion/transfer, and school reports',
  ],
  coordinator: [
    'Read-only or permitted scope over assigned classes/sections only',
    'Monitor teacher/student attendance, timetables, exam schedules, and homework completion',
    'Flag issues for Principal and publish permitted academic notices',
    'Edit attendance/marks only when explicitly granted by Principal',
  ],
  teacher: [
    'View only Principal-assigned classes and subjects',
    'Mark daily attendance (draft/submit) with edit audit trail',
    'Create homework, review submissions with feedback, enter bounded exam marks, upload learning materials',
    'Publish class announcements and view personal timetable',
  ],
  student: [
    'View own class/section weekly and daily timetable',
    'View & submit online homework and read teacher feedback',
    'View published exam schedules and published results only',
    'View personal attendance calendar (read-only) and download class learning resources',
  ],
};

export function getSchoolAccessMode(school: School | null): {
  canWrite: boolean;
  bannerMessage: string | null;
  blocked: boolean;
} {
  if (!school) return { canWrite: true, bannerMessage: null, blocked: false };
  if (school.status === 'suspended' || school.status === 'archived') {
    return {
      canWrite: false,
      blocked: true,
      bannerMessage: `School account "${school.name}" is currently ${school.status}. Contact platform support or your Main Head administrator to restore access.`,
    };
  }
  if (school.subscriptionStatus === 'grace_readonly' || school.subscriptionStatus === 'expired') {
    return {
      canWrite: false,
      blocked: false,
      bannerMessage: `Subscription for ${school.name} is in read-only grace mode (${school.subscriptionStatus}). Existing records remain preserved; contact Main Head to renew.`,
    };
  }
  return { canWrite: true, bannerMessage: null, blocked: false };
}

export function assertSameSchool(user: PlatformUser, targetSchoolId: string): void {
  if (user.role === 'main_head') return;
  if (!user.schoolId || user.schoolId !== targetSchoolId) {
    throw new Error('Cross-school access denied: tenant boundary violation.');
  }
}

export function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && startB < endA;
}

export function detectTimetableConflicts(
  candidate: Omit<TimetablePeriod, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>,
  existingPeriods: TimetablePeriod[],
  ignorePeriodId?: string,
): string[] {
  const conflicts: string[] = [];
  if (candidate.startTime >= candidate.endTime) {
    conflicts.push('End time must be later than start time.');
  }
  for (const p of existingPeriods) {
    if (ignorePeriodId && p.id === ignorePeriodId) continue;
    if (p.schoolId !== candidate.schoolId) continue;
    if (p.dayOfWeek !== candidate.dayOfWeek) continue;
    if (!timesOverlap(candidate.startTime, candidate.endTime, p.startTime, p.endTime)) continue;

    if (p.classId === candidate.classId) {
      conflicts.push(`Class overlap with Period ${p.periodNumber} (${p.startTime}–${p.endTime}).`);
    }
    if (!candidate.isBreak && !p.isBreak && candidate.teacherId && p.teacherId === candidate.teacherId) {
      conflicts.push(`Teacher ${candidate.teacherName || 'assigned'} is already booked in ${p.className || p.classId} (${p.startTime}–${p.endTime}).`);
    }
    if (!candidate.isBreak && !p.isBreak && candidate.roomId && p.roomId === candidate.roomId) {
      conflicts.push(`Room ${candidate.roomName || candidate.roomId} is already occupied by ${p.className || p.classId} (${p.startTime}–${p.endTime}).`);
    }
  }
  return conflicts;
}

export function detectExamConflicts(
  candidate: {
    schoolId: string;
    classId: string;
    date: string;
    startTime: string;
    endTime: string;
    roomId?: string;
    roomCapacity?: number;
    classStudentCount?: number;
  },
  existingExams: Examination[],
  ignoreExamId?: string,
): string[] {
  const conflicts: string[] = [];
  if (candidate.startTime >= candidate.endTime) {
    conflicts.push('Exam end time must be later than start time.');
  }
  if (
    candidate.roomCapacity !== undefined &&
    candidate.classStudentCount !== undefined &&
    candidate.classStudentCount > candidate.roomCapacity
  ) {
    conflicts.push(
      `Room capacity warning: class has ${candidate.classStudentCount} students, exceeding room capacity of ${candidate.roomCapacity}.`,
    );
  }
  for (const ex of existingExams) {
    if (ignoreExamId && ex.id === ignoreExamId) continue;
    if (ex.schoolId !== candidate.schoolId || ex.status === 'cancelled') continue;
    if (ex.date !== candidate.date) continue;
    if (!timesOverlap(candidate.startTime, candidate.endTime, ex.startTime, ex.endTime)) continue;

    if (ex.classId === candidate.classId) {
      conflicts.push(`Class already has "${ex.name} (${ex.subjectName})" scheduled ${ex.startTime}–${ex.endTime}.`);
    }
    if (candidate.roomId && ex.roomId === candidate.roomId) {
      conflicts.push(`Room "${ex.roomName || ex.roomId}" is already booked for "${ex.name}" (${ex.startTime}–${ex.endTime}).`);
    }
  }
  return conflicts;
}

export function computeLetterGrade(obtained: number, maxMarks: number, passingMarks: number): string {
  if (obtained < passingMarks) return 'F';
  const pct = maxMarks > 0 ? (obtained / maxMarks) * 100 : 0;
  if (pct >= 92) return 'A+';
  if (pct >= 84) return 'A';
  if (pct >= 76) return 'B+';
  if (pct >= 68) return 'B';
  if (pct >= 58) return 'C+';
  if (pct >= 48) return 'C';
  return 'D';
}
