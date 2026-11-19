import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const firebaseProjectConfig = firebaseConfig;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

/**
 * Provision a new Firebase Auth account using an isolated secondary Firebase app
 * so the currently signed-in Main Head or Principal session is never interrupted.
 */
export async function provisionAuthAccountSecondary(
  email: string,
  tempPassword: string,
): Promise<{ uid: string; createdInAuth: boolean; warning?: string }> {
  let secondaryApp: FirebaseApp | null = null;
  try {
    const appName = `provision_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    secondaryApp = initializeApp(firebaseConfig, appName);
    const secondaryAuth: Auth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);
    const uid = cred.user.uid;
    await firebaseSignOut(secondaryAuth);
    return { uid, createdInAuth: true };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/operation-not-allowed') {
      return {
        uid: `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        createdInAuth: false,
        warning:
          'Profile created in Firestore. Enable Email/Password in Firebase Console (Authentication -> Sign-in method) so users can sign in with temporary credentials.',
      };
    }
    if (code === 'auth/email-already-in-use') {
      return {
        uid: `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        createdInAuth: false,
        warning: 'An Auth account with this email already exists; linked profile record created.',
      };
    }
    throw err;
  } finally {
    if (secondaryApp) {
      await deleteApp(secondaryApp).catch(() => undefined);
    }
  }
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function formatFirestoreDate(val: unknown): string {
  if (!val) return '—';
  if (typeof val === 'string') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? val : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return '—';
}

export function formatFirestoreDateTime(val: unknown): string {
  if (!val) return '—';
  if (typeof val === 'string') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? val : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return '—';
}
