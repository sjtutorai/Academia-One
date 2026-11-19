import { doc, getDoc, writeBatch, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, generateId, handleFirestoreError, OperationType } from './firebase';
import { recordAuditLog } from './audit';
import type {
  CoordinatorPermissions,
  EmailDirectoryEntry,
  SchoolApplication,
  SubscriptionPlan,
} from '../types/models';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

export async function generateUniqueSchoolCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `ACA-${randomToken(4)}`;
    try {
      const snap = await getDoc(doc(db, 'schoolCodes', candidate));
      if (!snap.exists()) return candidate;
    } catch {
      return candidate;
    }
  }
  return `ACA-${Date.now().toString(36).slice(-4).toUpperCase()}`;
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
  plan: Pick<SubscriptionPlan, 'id' | 'name' | 'priceMonthly' | 'trialDays'>;
  source: 'public_application' | 'admin_manual';
  actorUid: string;
  actorName: string;
  application?: SchoolApplication;
  decisionNote?: string;
}

/**
 * Shared idempotent school provisioning service used by BOTH:
 * 1) Main Head approving a public 7-step School Application
 * 2) Main Head manually registering a school in the protected dashboard
 */
export async function provisionSchoolTenant(params: ProvisionSchoolParams): Promise<{
  schoolId: string;
  schoolCode: string;
  subscriptionId: string;
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
          subscriptionId: `sub_${current.approvedSchoolId}`,
        };
      }
    }
  }

  const schoolId = generateId('school');
  const schoolCode = (params.schoolCode || (await generateUniqueSchoolCode())).trim().toUpperCase();
  const subscriptionId = generateId('sub');
  const now = serverTimestamp();

  const startIso = new Date().toISOString().slice(0, 10);
  const trialDays = params.plan.trialDays > 0 ? params.plan.trialDays : 14;
  const endDateObj = new Date(Date.now() + (params.plan.priceMonthly > 0 ? trialDays : 365) * 86400000);
  const endIso = endDateObj.toISOString().slice(0, 10);
  const initialStatus = params.plan.priceMonthly > 0 ? 'trial' : 'active';

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
    phone: (params.schoolPhone || '').trim().slice(0, 32),
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
    teacherCount: 0,
    studentCount: 0,
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

  // 2. Register Exact-Key School Code Lookup
  batch.set(doc(db, 'schoolCodes', schoolCode), {
    code: schoolCode,
    schoolId,
    schoolName: params.schoolName.trim().slice(0, 140),
    status: initialStatus,
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
    paymentStatus: initialStatus === 'trial' ? 'trial' : 'paid_manual',
    paymentReference: params.source === 'public_application' ? `APPROVED-${params.application?.applicationNumber || schoolCode}` : 'ADMIN-MANUAL',
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

  // 5. If approving a public application, mark both application & public status tracker Approved atomically
  if (params.application) {
    const nextLog = [
      ...(params.application.activityLog || []),
      {
        at: new Date().toISOString(),
        actor: params.actorName,
        action: 'APPROVED_AND_PROVISIONED',
        note: `Issued School Code ${schoolCode}. ${params.decisionNote || ''}`.trim(),
      },
    ].slice(-50);

    batch.update(doc(db, 'schoolApplications', params.application.id), {
      status: 'approved',
      requestedPlanId: params.plan.id,
      decisionNote: (params.decisionNote || `Approved and provisioned with School Code ${schoolCode}.`).slice(0, 500),
      applicantMessage: (
        params.decisionNote ||
        `Your school registration has been approved. Sign in with ${cleanPrincipalEmail} (Email/Password or Google) to complete your Campus Setup Wizard.`
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
      decisionNote: (params.decisionNote || 'Application approved by Main Head.').slice(0, 500),
      applicantMessage: (
        params.decisionNote ||
        'Your school is now active. Use your registered Principal email via Email & Password or Google Sign-In to launch your Campus Setup Wizard.'
      ).slice(0, 1000),
      updatedAt: now,
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `schools/${schoolId}`);
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
    details: `Provisioned school tenant, plan ${params.plan.name}, and Principal email binding (${cleanPrincipalEmail}).`,
  }).catch(() => undefined);

  return { schoolId, schoolCode, subscriptionId };
}
