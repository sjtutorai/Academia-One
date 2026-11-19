import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { recordAuditLog } from './audit';

export interface AdminSecurityRecord {
  id: string;
  passcodeHash: string;
  passcodeSalt: string;
  algorithm: 'SHA-256-v1';
  updatedByUid: string;
  updatedByEmail?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const ADMIN_SECURITY_DOC_ID = 'main_head';
const SESSION_KEY_PREFIX = 'academiaone_mh_1step_unlocked_';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateCryptoSalt(byteLength = 16): string {
  const buf = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    return bytesToHex(buf);
  }
  for (let i = 0; i < byteLength; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(buf);
}

export async function hashAdminPasscode(passcode: string, salt: string): Promise<string> {
  const input = `academiaone_mh_v1:${salt}:${passcode}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return bytesToHex(new Uint8Array(digest));
  }
  // Deterministic fallback when SubtleCrypto is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ (ch + i), 2246822519);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 ^ h2 >>> 0).toString(16).padStart(8, '0')}${(Math.imul(h1, h2) >>> 0).toString(16).padStart(8, '0')}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function getSessionUnlockFingerprint(hash: string): string {
  return hash.slice(0, 24);
}

export function isMainHeadSessionUnlocked(uid: string, expectedHash?: string): boolean {
  try {
    const val = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${uid}`);
    if (!val) return false;
    if (expectedHash) {
      return val === getSessionUnlockFingerprint(expectedHash);
    }
    return true;
  } catch {
    return false;
  }
}

export function markMainHeadSessionUnlocked(uid: string, passcodeHash: string): void {
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${uid}`, getSessionUnlockFingerprint(passcodeHash));
  } catch {
    // ignore private browsing storage quota errors
  }
}

export function clearAllMainHeadSessionUnlocks(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SESSION_KEY_PREFIX)) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore storage errors
  }
}

export async function fetchAdminSecurityConfig(): Promise<AdminSecurityRecord | null> {
  const snap = await getDoc(doc(db, 'adminSecurity', ADMIN_SECURITY_DOC_ID));
  if (!snap.exists()) return null;
  return snap.data() as AdminSecurityRecord;
}

export async function verifyAdminPasscode(passcode: string, record: AdminSecurityRecord): Promise<boolean> {
  if (!passcode || !record.passcodeSalt || !record.passcodeHash) return false;
  const computed = await hashAdminPasscode(passcode, record.passcodeSalt);
  return constantTimeEqual(computed, record.passcodeHash);
}

export async function createAdminVerificationPasscode(params: {
  passcode: string;
  uid: string;
  email: string;
  actorName: string;
}): Promise<AdminSecurityRecord> {
  const salt = generateCryptoSalt(16);
  const hash = await hashAdminPasscode(params.passcode, salt);
  const now = serverTimestamp();

  const payload = {
    id: ADMIN_SECURITY_DOC_ID,
    passcodeHash: hash,
    passcodeSalt: salt,
    algorithm: 'SHA-256-v1' as const,
    updatedByUid: params.uid,
    updatedByEmail: params.email.trim().toLowerCase().slice(0, 160),
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, 'adminSecurity', ADMIN_SECURITY_DOC_ID), payload);

  await recordAuditLog({
    schoolId: 'platform',
    actorUid: params.uid,
    actorName: params.actorName,
    actorRole: 'main_head',
    action: 'SETUP_ADMIN_VERIFICATION_PASSWORD',
    targetType: 'admin_security',
    targetId: ADMIN_SECURITY_DOC_ID,
    targetLabel: params.email,
    details: 'Configured Main Head 1-Step Verification password (salted SHA-256).',
  }).catch(() => undefined);

  markMainHeadSessionUnlocked(params.uid, hash);

  return {
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function changeAdminVerificationPasscode(params: {
  currentPasscode: string;
  newPasscode: string;
  uid: string;
  email: string;
  actorName: string;
}): Promise<{ ok: boolean; error?: string; record?: AdminSecurityRecord }> {
  const existing = await fetchAdminSecurityConfig();
  if (!existing) {
    const created = await createAdminVerificationPasscode({
      passcode: params.newPasscode,
      uid: params.uid,
      email: params.email,
      actorName: params.actorName,
    });
    return { ok: true, record: created };
  }

  const matches = await verifyAdminPasscode(params.currentPasscode, existing);
  if (!matches) {
    return { ok: false, error: 'Current 1-Step Verification password is incorrect.' };
  }

  const salt = generateCryptoSalt(16);
  const hash = await hashAdminPasscode(params.newPasscode, salt);
  const now = serverTimestamp();

  await updateDoc(doc(db, 'adminSecurity', ADMIN_SECURITY_DOC_ID), {
    passcodeHash: hash,
    passcodeSalt: salt,
    algorithm: 'SHA-256-v1',
    updatedByUid: params.uid,
    updatedByEmail: params.email.trim().toLowerCase().slice(0, 160),
    updatedAt: now,
  });

  await recordAuditLog({
    schoolId: 'platform',
    actorUid: params.uid,
    actorName: params.actorName,
    actorRole: 'main_head',
    action: 'CHANGE_ADMIN_VERIFICATION_PASSWORD',
    targetType: 'admin_security',
    targetId: ADMIN_SECURITY_DOC_ID,
    targetLabel: params.email,
    details: 'Rotated Main Head 1-Step Verification password from Admin Security settings.',
  }).catch(() => undefined);

  markMainHeadSessionUnlocked(params.uid, hash);

  return {
    ok: true,
    record: {
      ...existing,
      passcodeHash: hash,
      passcodeSalt: salt,
      updatedByUid: params.uid,
      updatedByEmail: params.email.trim().toLowerCase().slice(0, 160),
      updatedAt: new Date().toISOString(),
    },
  };
}
