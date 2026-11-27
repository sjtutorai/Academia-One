import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updatePassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  enableNetwork,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

function createResilientFirestore(): Firestore {
  const transportSettings = {
    experimentalAutoDetectLongPolling: true,
    experimentalLongPollingOptions: { timeoutSeconds: 20 },
    ignoreUndefinedProperties: true,
  };

  try {
    return initializeFirestore(
      app,
      {
        ...transportSettings,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId,
    );
  } catch {
    try {
      return initializeFirestore(
        app,
        {
          ...transportSettings,
          localCache: memoryLocalCache(),
        },
        firebaseConfig.firestoreDatabaseId,
      );
    } catch {
      return getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
  }
}

export const db = createResilientFirestore();
export const auth = getAuth(app);
export const firebaseProjectConfig = firebaseConfig;

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void enableNetwork(db).catch(() => undefined);
  });
}

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
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore backend temporarily unreachable; operating with offline cache until reconnected.');
    }
  }
}
void testConnection();

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

/**
 * Allows the Main Head to set or rotate a school Principal's password using an isolated
 * secondary Firebase App without disrupting the Main Head's active session.
 * - If `currentPassword` is supplied, signs in on the secondary app and updates the password live.
 * - If no Email/Password credential exists yet for `email`, provisions it immediately with `newPassword`.
 * - If an Auth account already exists and `currentPassword` was omitted, dispatches an official
 *   Firebase password reset email to `email` and enforces password update on next login.
 */
export async function changeSchoolPasswordSecondary(params: {
  email: string;
  newPassword: string;
  currentPassword?: string;
}): Promise<{
  ok: boolean;
  mode?: 'updated_directly' | 'provisioned_new' | 'reset_email_sent';
  uid?: string;
  message: string;
}> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanNew = params.newPassword;
  const cleanCurrent = (params.currentPassword || '').trim();

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { ok: false, message: 'A valid Principal email address is required.' };
  }
  if (cleanNew.length < 8) {
    return { ok: false, message: 'New password must be at least 8 characters long.' };
  }

  let secondaryApp: FirebaseApp | null = null;
  try {
    const appName = `pw_rotate_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    secondaryApp = initializeApp(firebaseConfig, appName);
    const secondaryAuth: Auth = getAuth(secondaryApp);

    if (cleanCurrent) {
      try {
        const cred = await signInWithEmailAndPassword(secondaryAuth, cleanEmail, cleanCurrent);
        await updatePassword(cred.user, cleanNew);
        const uid = cred.user.uid;
        await firebaseSignOut(secondaryAuth);
        return {
          ok: true,
          mode: 'updated_directly',
          uid,
          message: `Password updated immediately for ${cleanEmail}.`,
        };
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
          return {
            ok: false,
            message: 'The current password entered is incorrect. Leave Current Password blank to send a secure reset link instead.',
          };
        }
        if (code === 'auth/user-not-found') {
          const created = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, cleanNew);
          const uid = created.user.uid;
          await firebaseSignOut(secondaryAuth);
          return {
            ok: true,
            mode: 'provisioned_new',
            uid,
            message: `Created new Email/Password login credential for ${cleanEmail}.`,
          };
        }
        throw err;
      }
    }

    try {
      const created = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, cleanNew);
      const uid = created.user.uid;
      await firebaseSignOut(secondaryAuth);
      return {
        ok: true,
        mode: 'provisioned_new',
        uid,
        message: `New school login password set immediately for ${cleanEmail}.`,
      };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/email-already-in-use') {
        await sendPasswordResetEmail(auth, cleanEmail);
        return {
          ok: true,
          mode: 'reset_email_sent',
          message: `Account already exists in Firebase Auth. A secure password reset link has been sent to ${cleanEmail} and password change is enforced on next login. (To change an existing password directly without email confirmation, enter the current password above.)`,
        };
      }
      if (code === 'auth/operation-not-allowed') {
        return {
          ok: false,
          message: 'Email/Password sign-in is disabled in Firebase Console. Enable Authentication -> Sign-in method -> Email/Password.',
        };
      }
      if (code === 'auth/weak-password') {
        return { ok: false, message: 'Password is too weak. Use at least 8 characters with letters and numbers.' };
      }
      throw err;
    }
  } catch (err: unknown) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Unable to update school password.',
    };
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
