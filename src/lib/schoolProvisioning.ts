import { doc, getDoc, writeBatch, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, generateId, handleFirestoreError, OperationType } from './firebase';
import { recordAuditLog } from './audit';
import {
  deriveSchoolPrefix,
  expandClassSectionPlan,
  formatPrincipalCode,
  formatRoleCodeRange,
  sanitizePhoneDigits,
  sanitizeSchoolPrefix,
} from './schoolCodes';
import type {
  ClassSectionRange,
  CoordinatorPermissions,
  EmailDirectoryEntry,
  SchoolApplication,
  SchoolCodeClassSlot,
  SubscriptionPlan,
} from '../types/models';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LETTER_SUFFIXES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function emailToKey(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .slice(0, 120);
}

export async function hashVerificationEmail(email: string): Promise<string> {
  const clean = email.trim().toLowerCase();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(`academiaone_v1:${clean}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback deterministic hash if SubtleCrypto is unavailable
  let h = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    h ^= clean.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16)}`;
}

function randomToken(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function generateApplicationNumber(prefix: 'SCH' | 'JOIN'): string {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${randomToken(6)}`;
}

/**
 * Generates a unique, strictly alphabetic uppercase school prefix (e.g. "JSS", "DPS", "NPA")
 * so that role-based codes (JSS0001, JSSC01, JSST01, JSSS001) parse unambiguously.
 */
export async function generateUniqueSchoolPrefix(
  schoolName: string,
  preferredPrefix?: string,
): Promise<string> {
  const cleanedPreferred = sanitizeSchoolPrefix(preferredPrefix || '');
  const base = cleanedPreferred.length >= 2 ? cleanedPreferred : deriveSchoolPrefix(schoolName);

  const candidates: string[] = [base];
  const shortBase = base.slice(0, 5);
  for (let i = 0; i < LETTER_SUFFIXES.length; i++) {
    candidates.push(`${shortBase}${LETTER_SUFFIXES[i]}`);
  }

  for (const candidate of candidates) {
    try {
      const snap = await getDoc(doc(db, 'schoolCodes', candidate));
      if (!snap.exists()) return candidate;
    } catch {
      return candidate;
    }
  }

  // Fallback: 4 random uppercase letters
  let fallback = '';
  for (let i = 0; i < 4; i++) {
    fallback += LETTER_SUFFIXES[Math.floor(Math.random() * LETTER_SUFFIXES.length)];
  }
  return fallback;
}

export async function generateUniqueSchoolCode(schoolName = 'Academia School', preferredPrefix?: string): Promise<string> {
  return generateUniqueSchoolPrefix(schoolName, preferredPrefix);
}

export async function upsertEmailDirectoryEntry(params: {
  email: string;
  schoolId: string;
  schoolName?: string;
  role: EmailDirectoryEntry['role'];
  displayName?: string;
  linkedProfileId?: string;
  classId?: string;
  section?: string;
  assignedClassIds?: string[];
  coordinatorPermissions?: CoordinatorPermissions;
  createdBy: string;
  status?: 'active' | 'inactive';
}): Promise<string> {
  const cleanEmail = params.email.trim().toLowerCase();
  const emailKey = emailToKey(cleanEmail);
  const payload: Record<string, unknown> = {
    emailKey,
    email: cleanEmail,
    schoolId: params.schoolId,
    schoolName: (params.schoolName || '').slice(0, 140),
    role: params.role,
    displayName: (params.displayName || '').slice(0, 120),
    linkedProfileId: params.linkedProfileId || '',
    classId: params.classId || '',
    section: params.section || '',
    assignedClassIds: params.assignedClassIds || [],
    status: params.status || 'active',
    createdBy: params.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (params.coordinatorPermissions) {
    payload.coordinatorPermissions = params.coordinatorPermissions;
  }

  try {
    await setDoc(doc(db, 'emailDirectory', emailKey), payload);
    return emailKey;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `emailDirectory/${emailKey}`);
  }
}

export interface ProvisionSchoolParams {
  schoolName: string;
  schoolCode?: string;
  schoolPrefix?: string;
  academicYear: string;
  address: string;
  schoolEmail: string;
  schoolPhone?: string;
  schoolType?: string;
  board?: string;
  logoDataUrl?: string;
  principalName: string;
  principalEmail: string;
  principalUid?: string;
  principalUsername?: string;
  classSectionPlan?: ClassSectionRange[];
  estimatedCoordinators?: number;
  estimatedTeachers?: number;
  estimatedStudents?: number;
  plan: Pick<SubscriptionPlan, 'id' | 'name' | 'priceMonthly' | 'trialDays'>;
  source: 'public_application' | 'admin_manual';
  actorUid: string;
  actorName: string;
  application?: SchoolApplication;
  decisionNote?: string;
}

/**
 * Shared idempotent school provisioning service used by BOTH:
 * 1) Main Head approving a public School Application
 * 2) Main Head manually registering a school in the protected dashboard
 */
export async function provisionSchoolTenant(params: ProvisionSchoolParams): Promise<{
  schoolId: string;
  schoolCode: string;
  principalCode: string;
  subscriptionId: string;
  provisionedClassCount: number;
}> {
  // Idempotency guard when approving an existing public application
  if (params.application) {
    const appSnap = await getDoc(doc(db, 'schoolApplications', params.application.id));
    if (appSnap.exists()) {
      const current = appSnap.data() as SchoolApplication;
      if (current.status === 'approved' && current.approvedSchoolId && current.approvedSchoolCode) {
        return {
          schoolId: current.approvedSchoolId,
          schoolCode: current.approvedSchoolCode,
          principalCode: formatPrincipalCode(current.approvedSchoolCode),
          subscriptionId: `sub_${current.approvedSchoolId}`,
          provisionedClassCount: 0,
        };
      }
    }
  }

  const schoolId = generateId('school');
  const preferredPrefix = params.schoolCode || params.schoolPrefix || params.application?.schoolPrefix;
  const schoolCode = await generateUniqueSchoolPrefix(params.schoolName, preferredPrefix);
  const principalCode = formatPrincipalCode(schoolCode);
  const subscriptionId = generateId('sub');
  const now = serverTimestamp();

  const allocatedCoordinators = Math.max(
    0,
    Math.min(
      5000,
      Math.round(params.estimatedCoordinators ?? params.application?.estimatedCoordinators ?? 6),
    ),
  );
  const allocatedTeachers = Math.max(
    0,
    Math.min(
      20000,
      Math.round(params.estimatedTeachers ?? params.application?.estimatedTeachers ?? 20),
    ),
  );
  const allocatedStudents = Math.max(
    0,
    Math.min(
      100000,
      Math.round(params.estimatedStudents ?? params.application?.estimatedStudents ?? 100),
    ),
  );

  const classSectionPlan = params.classSectionPlan || params.application?.classSectionPlan || [];
  const expandedClasses = expandClassSectionPlan(classSectionPlan).slice(0, 200);
  const plannedClassRecords = expandedClasses.map((row) => {
    const classId = generateId('cls');
    return {
      classId,
      ...row,
    };
  });
  const classSections: SchoolCodeClassSlot[] = plannedClassRecords.map((row) => ({
    classId: row.classId,
    className: row.name,
    gradeLevel: row.gradeLevel,
    section: row.section,
  }));

  const startIso = new Date().toISOString().slice(0, 10);
  const endDateObj = new Date(Date.now() + 3650 * 86400000);
  const endIso = endDateObj.toISOString().slice(0, 10);
  const initialStatus = 'active' as const;

  const cleanPrincipalEmail = params.principalEmail.trim().toLowerCase();
  const principalUsername =
    params.principalUsername ||
    cleanPrincipalEmail.split('@')[0].replace(/[^a-z0-9._-]/g, '').slice(0, 48) ||
    `principal_${schoolId.slice(-5)}`;

  const batch = writeBatch(db);

  // 1. Create School Tenant
  batch.set(doc(db, 'schools', schoolId), {
    id: schoolId,
    name: params.schoolName.trim().slice(0, 140),
    code: schoolCode,
    address: (params.address || '').trim().slice(0, 300),
    email: params.schoolEmail.trim().toLowerCase().slice(0, 160),
    phone: sanitizePhoneDigits(params.schoolPhone || '') || (params.schoolPhone || '').trim().slice(0, 32),
    academicYear: params.academicYear.trim().slice(0, 24),
    status: initialStatus,
    principalUid: params.principalUid || '',
    principalUsername,
    principalName: params.principalName.trim().slice(0, 120),
    principalEmail: cleanPrincipalEmail,
    subscriptionPlanId: params.plan.id,
    subscriptionStatus: initialStatus,
    subscriptionStart: startIso,
    subscriptionEnd: endIso,
    coordinatorCount: 0,
    teacherCount: 0,
    studentCount: 0,
    allocatedCoordinators,
    allocatedTeachers,
    allocatedStudents,
    settings: {
      allowOnlineHomeworkSubmission: true,
      attendanceEditWindowHours: 24,
      gradingScale: 'A+ to F Standard',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    },
    source: params.source,
    schoolType: (params.schoolType || '').slice(0, 64),
    board: (params.board || '').slice(0, 120),
    logoDataUrl: (params.logoDataUrl || '').slice(0, 200000),
    setupCompleted: false,
    isDemo: false,
    createdBy: params.actorUid,
    createdAt: now,
    updatedAt: now,
  });

  // 2. Register Exact-Key School Code Lookup with Role Code Allocations & Class-Section Map
  batch.set(doc(db, 'schoolCodes', schoolCode), {
    code: schoolCode,
    schoolId,
    schoolName: params.schoolName.trim().slice(0, 140),
    status: initialStatus,
    principalCode,
    coordinatorCount: allocatedCoordinators,
    teacherCount: allocatedTeachers,
    studentCount: allocatedStudents,
    classSections,
    createdAt: now,
    updatedAt: now,
  });

  // 3. Create School Subscription Record
  batch.set(doc(db, 'schoolSubscriptions', subscriptionId), {
    id: subscriptionId,
    schoolId,
    schoolName: params.schoolName.trim().slice(0, 140),
    planId: params.plan.id,
    planName: params.plan.name,
    status: initialStatus,
    startDate: startIso,
    endDate: endIso,
    paymentMode: 'manual',
    paymentStatus: 'paid_manual',
    paymentReference:
      params.source === 'public_application'
        ? `APPROVED-${params.application?.applicationNumber || schoolCode}`
        : 'FREE-UNLIMITED',
    amount: params.plan.priceMonthly,
    renewalHistory: [],
    createdBy: params.actorUid,
    createdAt: now,
    updatedAt: now,
  });

  // 4. Bind Principal Email in Email Directory (enables Email/Password AND Google login)
  const principalEmailKey = emailToKey(cleanPrincipalEmail);
  batch.set(doc(db, 'emailDirectory', principalEmailKey), {
    emailKey: principalEmailKey,
    email: cleanPrincipalEmail,
    schoolId,
    schoolName: params.schoolName.trim().slice(0, 140),
    role: 'principal',
    displayName: params.principalName.trim().slice(0, 120),
    linkedProfileId: '',
    classId: '',
    section: '',
    assignedClassIds: [],
    status: 'active',
    createdBy: params.actorUid,
    createdAt: now,
    updatedAt: now,
  });

  const codeSummaryText = [
    `Principal: ${principalCode}`,
    allocatedCoordinators > 0
      ? `Coordinators: ${formatRoleCodeRange(schoolCode, 'coordinator', allocatedCoordinators)}`
      : null,
    allocatedTeachers > 0
      ? `Teachers: ${formatRoleCodeRange(schoolCode, 'teacher', allocatedTeachers)}`
      : null,
    allocatedStudents > 0
      ? `Students: ${formatRoleCodeRange(schoolCode, 'student', allocatedStudents)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // 5. If approving a public application, mark both application & public status tracker Approved atomically
  if (params.application) {
    const nextLog = [
      ...(params.application.activityLog || []),
      {
        at: new Date().toISOString(),
        actor: params.actorName,
        action: 'APPROVED_AND_PROVISIONED',
        note: `Issued Prefix ${schoolCode} (${codeSummaryText}). ${params.decisionNote || ''}`.trim(),
      },
    ].slice(-50);

    batch.update(doc(db, 'schoolApplications', params.application.id), {
      status: 'approved',
      requestedPlanId: params.plan.id,
      decisionNote: (
        params.decisionNote || `Approved and provisioned with School Prefix ${schoolCode} (${principalCode}).`
      ).slice(0, 500),
      applicantMessage: (
        params.decisionNote ||
        `Your school registration is approved! Access Codes — ${codeSummaryText}. Sign in with ${cleanPrincipalEmail} (Email/Password or Google) to launch your Principal Portal.`
      ).slice(0, 1000),
      approvedSchoolId: schoolId,
      approvedSchoolCode: schoolCode,
      reviewedBy: params.actorUid,
      activityLog: nextLog,
      updatedAt: now,
    });

    batch.update(doc(db, 'applicationStatuses', params.application.applicationNumber), {
      schoolId,
      status: 'approved',
      schoolCode,
      decisionNote: (params.decisionNote || `Approved by Main Head. Principal Code: ${principalCode}`).slice(0, 500),
      applicantMessage: (
        params.decisionNote ||
        `Your school is active! Access Codes — ${codeSummaryText}. Sign in with your registered Principal email to manage your school.`
      ).slice(0, 1000),
      updatedAt: now,
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `schools/${schoolId}`);
  }

  // 6. Auto-provision selected Classes & Sections from classSectionPlan in chunks (<= 350 ops per batch)
  if (plannedClassRecords.length > 0) {
    const CHUNK_SIZE = 350;
    for (let i = 0; i < plannedClassRecords.length; i += CHUNK_SIZE) {
      const chunk = plannedClassRecords.slice(i, i + CHUNK_SIZE);
      const classBatch = writeBatch(db);
      for (const cls of chunk) {
        classBatch.set(doc(db, 'classes', cls.classId), {
          id: cls.classId,
          schoolId,
          name: cls.name,
          code: cls.code,
          gradeLevel: cls.gradeLevel,
          section: cls.section,
          capacity: 40,
          academicYear: params.academicYear.trim().slice(0, 24),
          studentCount: 0,
          createdAt: now,
        });
      }
      try {
        await classBatch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `classes/${schoolId}`);
      }
    }
  }

  await recordAuditLog({
    schoolId,
    actorUid: params.actorUid,
    actorName: params.actorName,
    actorRole: 'main_head',
    action: params.source === 'public_application' ? 'SCHOOL_APPLICATION_APPROVED' : 'SCHOOL_PROVISIONED_MANUAL',
    targetType: 'school',
    targetId: schoolId,
    targetLabel: `${params.schoolName} (${schoolCode})`,
    details: `Provisioned school tenant (${codeSummaryText}), ${plannedClassRecords.length} class-sections, and Principal email binding (${cleanPrincipalEmail}).`,
  }).catch(() => undefined);

  return {
    schoolId,
    schoolCode,
    principalCode,
    subscriptionId,
    provisionedClassCount: plannedClassRecords.length,
  };
}

