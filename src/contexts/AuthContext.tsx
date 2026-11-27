import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  sendEmailVerification,
  updatePassword,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, getDocFromCache, setDoc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { DEFAULT_NOTIFICATION_PREFS } from '../lib/notifications';
import { recordAuditLog } from '../lib/audit';
import { emailToKey } from '../lib/schoolProvisioning';
import { clearAllMainHeadSessionUnlocks } from '../lib/adminVerification';
import type { EmailDirectoryEntry, PlatformUser, School } from '../types/models';

const BOOTSTRAPPED_MAIN_HEAD_EMAIL = 'sjtutorai@gmail.com';
const SESSION_IDLE_MS = 60 * 60 * 1000; // 60 minutes default
const DEFAULT_COORD_PERMS = {
  canEditAttendance: false,
  canEditMarks: false,
  canAssignTeachers: false,
  canPublishNotices: false,
  canCoordinateExams: false,
};

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  realProfile: PlatformUser | null;
  activeUser: PlatformUser | null;
  activeSchool: School | null;
  schoolLoading: boolean;
  schoolLoadError: string | null;
  loading: boolean;
  authError: string | null;
  previewPersona: PlatformUser | null;
  isPreviewMode: boolean;
  emailVerified: boolean;
  isPasswordAccount: boolean;
  needsEmailVerification: boolean;
  signInUnified: (identifier: string, password: string) => Promise<{ ok: boolean; error?: string; needsEmailAuthSetup?: boolean; needsEmailVerification?: boolean; profile?: PlatformUser }>;
  signUpEmailPassword: (params: { displayName: string; username: string; email: string; password: string }) => Promise<{ ok: boolean; error?: string; needsEmailAuthSetup?: boolean; needsEmailVerification?: boolean; verificationEmailSent?: boolean; profile?: PlatformUser }>;
  signInGoogle: () => Promise<{ ok: boolean; error?: string; profile?: PlatformUser }>;
  requestPasswordRecovery: (email: string) => Promise<{ ok: boolean; error?: string; email?: string }>;
  replaceTemporaryPassword: (newPassword: string, currentPassword?: string) => Promise<{ ok: boolean; error?: string }>;
  checkEmailVerification: () => Promise<boolean>;
  resendVerificationEmail: () => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  enterDemoPreview: (persona: PlatformUser) => void;
  exitDemoPreview: () => void;
  refreshProfile: () => Promise<PlatformUser | null>;
  reloadSchool: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeIdentifierToEmail(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed}@academiaone.edu`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [realProfile, setRealProfile] = useState<PlatformUser | null>(null);
  const [previewPersona, setPreviewPersona] = useState<PlatformUser | null>(null);
  const [activeSchool, setActiveSchool] = useState<School | null>(null);
  const [schoolLoading, setSchoolLoading] = useState(false);
  const [schoolLoadError, setSchoolLoadError] = useState<string | null>(null);
  const [schoolReloadTick, setSchoolReloadTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  const authFlowBusyRef = useRef(false);

  const activeUser = previewPersona || realProfile;
  const isPasswordAccount = Boolean(
    firebaseUser?.providerData?.some((p) => p?.providerId === 'password'),
  );
  const isBootstrappedMainHead =
    (firebaseUser?.email || realProfile?.email || '').trim().toLowerCase() === BOOTSTRAPPED_MAIN_HEAD_EMAIL;
  const needsEmailVerification = Boolean(
    firebaseUser &&
      !previewPersona &&
      isPasswordAccount &&
      !emailVerified &&
      !isBootstrappedMainHead,
  );

  const sendVerificationWithFallback = useCallback(async (user: FirebaseUser): Promise<{ ok: boolean; error?: string }> => {
    const continueUrl = `${window.location.origin}/verify-email`;
    try {
      await sendEmailVerification(user, { url: continueUrl, handleCodeInApp: false });
      return { ok: true };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/unauthorized-continue-uri' ||
        code === 'auth/invalid-continue-uri' ||
        code === 'auth/missing-continue-uri'
      ) {
        try {
          await sendEmailVerification(user);
          return { ok: true };
        } catch (fallbackErr: unknown) {
          const fbCode = (fallbackErr as { code?: string })?.code || '';
          if (fbCode === 'auth/too-many-requests') {
            return { ok: false, error: 'Too many verification emails requested. Please wait a minute before trying again.' };
          }
          return {
            ok: false,
            error: fallbackErr instanceof Error ? fallbackErr.message : 'Unable to send verification email right now.',
          };
        }
      }
      if (code === 'auth/too-many-requests') {
        return { ok: false, error: 'Too many verification emails requested. Please wait a minute before trying again.' };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to send verification email right now.',
      };
    }
  }, []);

  const ensureUserProfile = useCallback(async (fbUser: FirebaseUser): Promise<PlatformUser> => {
    const userRef = doc(db, 'users', fbUser.uid);
    const email = (fbUser.email || '').trim().toLowerCase();
    const isMainHeadEmail = email === BOOTSTRAPPED_MAIN_HEAD_EMAIL;

    let snap;
    try {
      snap = await getDoc(userRef);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/offline|unavailable/i.test(msg)) {
        try {
          snap = await getDocFromCache(userRef);
        } catch {
          handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
        }
      } else {
        handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
      }
    }

    // Check emailDirectory for pre-registered school membership (works identically for Email/Password & Google)
    let dirEntry: EmailDirectoryEntry | null = null;
    if (email && !isMainHeadEmail) {
      try {
        const dirSnap = await getDoc(doc(db, 'emailDirectory', emailToKey(email)));
        if (dirSnap.exists()) {
          const candidate = dirSnap.data() as EmailDirectoryEntry;
          if (candidate.status === 'active' && candidate.schoolId) {
            dirEntry = candidate;
          }
        }
      } catch (err) {
        console.warn('Email directory check warning:', err instanceof Error ? err.message : err);
      }
    }

    const bindRosterProfileUid = async (entry: EmailDirectoryEntry) => {
      if (!entry.linkedProfileId) return;
      try {
        if (entry.role === 'student') {
          await updateDoc(doc(db, 'students', entry.linkedProfileId), {
            userId: fbUser.uid,
            updatedAt: serverTimestamp(),
          });
        } else if (entry.role === 'teacher') {
          await updateDoc(doc(db, 'teachers', entry.linkedProfileId), {
            userId: fbUser.uid,
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-blocking: principal may have already linked UID
      }
    };

    if (snap.exists()) {
      const existing = snap.data() as PlatformUser;

      // Guarantee Main Head upgrade if sjtutorai@gmail.com signed in previously with a different role
      if (isMainHeadEmail && (existing.role !== 'main_head' || existing.schoolId !== 'platform')) {
        const upgraded: PlatformUser = {
          ...existing,
          role: 'main_head',
          schoolId: 'platform',
          status: 'active',
        };
        await updateDoc(userRef, {
          role: 'main_head',
          schoolId: 'platform',
          status: 'active',
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);
        return upgraded;
      }

      // Auto-claim newly approved/registered school emailDirectory entry if user was previously unassigned or reassigned
      if (
        dirEntry &&
        (existing.schoolId === 'unassigned' ||
          existing.schoolId !== dirEntry.schoolId ||
          existing.role !== dirEntry.role)
      ) {
        const claimed: PlatformUser = {
          ...existing,
          displayName: (existing.displayName || dirEntry.displayName || 'SJ Academia One User').trim().slice(0, 120),
          role: dirEntry.role,
          schoolId: dirEntry.schoolId.slice(0, 128),
          status: 'active',
          accessCode: (dirEntry.accessCode || existing.accessCode || '').slice(0, 24),
          classId: (dirEntry.classId || existing.classId || '').slice(0, 128),
          section: (dirEntry.section || existing.section || '').slice(0, 32),
          assignedClassIds: Array.isArray(dirEntry.assignedClassIds)
            ? dirEntry.assignedClassIds.slice(0, 200)
            : Array.isArray(existing.assignedClassIds)
              ? existing.assignedClassIds.slice(0, 200)
              : [],
          coordinatorPermissions: dirEntry.coordinatorPermissions || existing.coordinatorPermissions || DEFAULT_COORD_PERMS,
        };
        const claimPatch = {
          displayName: claimed.displayName,
          role: claimed.role,
          schoolId: claimed.schoolId,
          status: 'active',
          accessCode: claimed.accessCode,
          classId: claimed.classId,
          section: claimed.section,
          assignedClassIds: claimed.assignedClassIds,
          coordinatorPermissions: claimed.coordinatorPermissions,
          updatedAt: serverTimestamp(),
        };
        try {
          await updateDoc(userRef, claimPatch);
        } catch (err) {
          // Retry once after forcing a fresh ID token in case of transient auth propagation delay
          try {
            await fbUser.getIdToken(true);
            await updateDoc(userRef, claimPatch);
          } catch (retryErr) {
            console.warn('Claim directory update warning:', retryErr || err);
          }
        }
        await bindRosterProfileUid(dirEntry);
        return claimed;
      }

      if (dirEntry) {
        await bindRosterProfileUid(dirEntry);
      }

      return existing;
    }

    const derivedUsername = (email.split('@')[0] || `user_${fbUser.uid.slice(0, 6)}`)
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .slice(0, 48);

    const safeUsername = (derivedUsername.length >= 3 ? derivedUsername : `usr_${fbUser.uid.slice(0, 6)}`).slice(0, 64);
    const safeEmail = (email || `${fbUser.uid}@academiaone.edu`).slice(0, 160);
    const safeDisplayNameRaw = (fbUser.displayName || dirEntry?.displayName || derivedUsername || 'SJ Academia One User').trim();
    const safeDisplayName = (safeDisplayNameRaw.length >= 2 ? safeDisplayNameRaw : 'SJ Academia One User').slice(0, 120);

    const newProfile: PlatformUser = {
      uid: fbUser.uid,
      username: safeUsername,
      email: safeEmail,
      displayName: safeDisplayName,
      role: isMainHeadEmail ? 'main_head' : dirEntry ? dirEntry.role : 'student',
      schoolId: isMainHeadEmail ? 'platform' : dirEntry ? dirEntry.schoolId.slice(0, 128) : 'unassigned',
      status: 'active',
      mustChangePassword: false,
      phone: '',
      accessCode: (dirEntry?.accessCode || '').slice(0, 24),
      classId: (dirEntry?.classId || '').slice(0, 128),
      section: (dirEntry?.section || '').slice(0, 32),
      assignedClassIds: Array.isArray(dirEntry?.assignedClassIds) ? dirEntry.assignedClassIds.slice(0, 50) : [],
      assignedSubjectIds: [],
      coordinatorPermissions: dirEntry?.coordinatorPermissions || DEFAULT_COORD_PERMS,
      isDemo: false,
    };

    try {
      await setDoc(userRef, {
        ...newProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'notificationPreferences', fbUser.uid), {
        ...DEFAULT_NOTIFICATION_PREFS(fbUser.uid),
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
      if (dirEntry) {
        await bindRosterProfileUid(dirEntry);
      }
    } catch (err) {
      // If a concurrent call already created the document, read and return it cleanly
      const retrySnap = await getDoc(userRef).catch(() => null);
      if (retrySnap && retrySnap.exists()) {
        return retrySnap.data() as PlatformUser;
      }
      // If directory-bound creation was rejected, fall back to clean unassigned student profile
      if (!isMainHeadEmail && dirEntry) {
        const fallbackProfile: PlatformUser = {
          ...newProfile,
          role: 'student',
          schoolId: 'unassigned',
          accessCode: '',
          classId: '',
          section: '',
          assignedClassIds: [],
          coordinatorPermissions: DEFAULT_COORD_PERMS,
        };
        try {
          await setDoc(userRef, {
            ...fallbackProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return fallbackProfile;
        } catch {
          // Fall through to structured error handler below
        }
      }
      handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}`);
    }

    return newProfile;
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      setEmailVerified(Boolean(fbUser?.emailVerified));
      if (!fbUser) {
        setRealProfile(null);
        setPreviewPersona(null);
        setActiveSchool(null);
        setLoading(false);
        return;
      }
      // If signUpEmailPassword / signInUnified / signInGoogle is actively initializing the profile,
      // let it complete without racing on users/{uid} writes.
      if (authFlowBusyRef.current) {
        return;
      }
      try {
        const prof = await ensureUserProfile(fbUser);
        setRealProfile(prof);
        setAuthError(null);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Unable to load account profile.');
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [ensureUserProfile]);

  // Real-time access revocation guard: if Main Head permanently deletes a user's Firestore doc
  // (or marks them suspended/inactive), immediately revoke their active session and sign out.
  useEffect(() => {
    if (!firebaseUser || !realProfile || previewPersona) return;
    const email = (firebaseUser.email || '').trim().toLowerCase();
    if (email === BOOTSTRAPPED_MAIN_HEAD_EMAIL || realProfile.role === 'main_head') return;

    let hasSeenServerDoc = false;

    const unsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          if (!snap.metadata.fromCache) {
            hasSeenServerDoc = true;
          }
          const liveProfile = snap.data() as PlatformUser;
          if (liveProfile.status === 'suspended' || liveProfile.status === 'inactive') {
            setAuthError(`Your account is currently ${liveProfile.status}. Contact your administrator.`);
            setRealProfile(null);
            setActiveSchool(null);
            signOut(auth).catch(() => undefined);
            return;
          }
          setRealProfile(liveProfile);
          return;
        }
        // Only force sign-out if the document was confirmed to exist on the server and was subsequently deleted
        if (!snap.metadata.fromCache && hasSeenServerDoc) {
          setAuthError('Your account access has been permanently removed by the platform administrator.');
          setRealProfile(null);
          setActiveSchool(null);
          signOut(auth).catch(() => undefined);
        }
      },
      () => {
        // Ignore transient network errors
      },
    );
    return () => unsub();
  }, [firebaseUser?.uid, realProfile?.uid, previewPersona]);

  // Real-time subscription to active user's school document (with token-refresh recovery & missing-school detection)
  useEffect(() => {
    const targetSchoolId = activeUser?.schoolId;
    if (!activeUser || !targetSchoolId || targetSchoolId === 'platform' || targetSchoolId === 'unassigned') {
      setActiveSchool(null);
      setSchoolLoading(false);
      setSchoolLoadError(null);
      return;
    }

    let cancelled = false;
    let activeUnsub: (() => void) | null = null;
    let hasRetried = false;

    setSchoolLoading(true);
    setSchoolLoadError(null);

    const attachSchoolListener = () => {
      if (cancelled) return;
      if (activeUnsub) {
        activeUnsub();
        activeUnsub = null;
      }
      const schoolRef = doc(db, 'schools', targetSchoolId);
      activeUnsub = onSnapshot(
        schoolRef,
        (snap) => {
          if (cancelled) return;
          if (snap.exists()) {
            setActiveSchool(snap.data() as School);
            setSchoolLoadError(null);
            setSchoolLoading(false);
          } else {
            // Confirm directly from server (avoids stale empty cache) and check if user was reassigned via emailDirectory
            getDoc(schoolRef)
              .then(async (freshSnap) => {
                if (cancelled) return;
                if (freshSnap.exists()) {
                  setActiveSchool(freshSnap.data() as School);
                  setSchoolLoadError(null);
                  setSchoolLoading(false);
                  return;
                }
                // Check if emailDirectory points to a newer school for this user
                const cleanEmail = (activeUser.email || '').trim().toLowerCase();
                if (!previewPersona && cleanEmail && auth.currentUser) {
                  try {
                    const dirSnap = await getDoc(doc(db, 'emailDirectory', emailToKey(cleanEmail)));
                    if (!cancelled && dirSnap.exists()) {
                      const entry = dirSnap.data() as EmailDirectoryEntry;
                      if (entry.status === 'active' && entry.schoolId && entry.schoolId !== targetSchoolId) {
                        const synced = await ensureUserProfile(auth.currentUser);
                        if (!cancelled) {
                          setRealProfile(synced);
                          return;
                        }
                      }
                    }
                  } catch {
                    // Continue to missing-school state
                  }
                }
                if (!cancelled) {
                  setActiveSchool(null);
                  setSchoolLoadError(
                    'This school record is no longer available. It may have been removed or replaced by the Main Head administrator.',
                  );
                  setSchoolLoading(false);
                }
              })
              .catch(() => {
                if (!cancelled) {
                  setActiveSchool(null);
                  setSchoolLoadError('Unable to verify your school record right now. Try refreshing.');
                  setSchoolLoading(false);
                }
              });
          }
        },
        (err) => {
          if (cancelled) return;
          console.warn('School subscription listener warning:', err.message);
          if (!hasRetried && auth.currentUser) {
            hasRetried = true;
            // Refresh ID token and retry once cleanly in case of transient auth propagation delay
            auth.currentUser
              .getIdToken(true)
              .then(() => getDoc(schoolRef))
              .then((retrySnap) => {
                if (cancelled) return;
                if (retrySnap.exists()) {
                  setActiveSchool(retrySnap.data() as School);
                  setSchoolLoadError(null);
                  setSchoolLoading(false);
                  attachSchoolListener();
                } else {
                  setActiveSchool(null);
                  setSchoolLoadError(
                    'This school record could not be found. It may have been removed by the Main Head administrator.',
                  );
                  setSchoolLoading(false);
                }
              })
              .catch((retryErr) => {
                if (cancelled) return;
                setActiveSchool(null);
                setSchoolLoadError(
                  retryErr instanceof Error
                    ? `Unable to load school workspace (${retryErr.message}).`
                    : 'Unable to load school workspace right now.',
                );
                setSchoolLoading(false);
              });
          } else {
            setActiveSchool(null);
            setSchoolLoadError(`Unable to load school workspace (${err.message}).`);
            setSchoolLoading(false);
          }
        },
      );
    };

    attachSchoolListener();

    return () => {
      cancelled = true;
      if (activeUnsub) activeUnsub();
    };
  }, [activeUser?.schoolId, activeUser?.uid, activeUser?.email, previewPersona, schoolReloadTick, ensureUserProfile]);

  const reloadSchool = useCallback(() => {
    setSchoolReloadTick((n) => n + 1);
  }, []);

  // Session idle timeout guard
  const logout = useCallback(async () => {
    clearAllMainHeadSessionUnlocks();
    setPreviewPersona(null);
    await signOut(auth);
    setRealProfile(null);
    setActiveSchool(null);
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    const resetIdle = () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        logout();
      }, SESSION_IDLE_MS);
    };
    resetIdle();
    const events = ['mousemove', 'keydown', 'click'];
    events.forEach((ev) => window.addEventListener(ev, resetIdle, { passive: true }));
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, resetIdle));
    };
  }, [firebaseUser, logout]);

  const signInUnified = useCallback(
    async (identifier: string, password: string) => {
      const email = normalizeIdentifierToEmail(identifier);
      authFlowBusyRef.current = true;
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await cred.user.reload().catch(() => undefined);
        await cred.user.getIdToken(true).catch(() => undefined);
        const verifiedNow = Boolean(cred.user.emailVerified);
        const isMainHead = (cred.user.email || '').trim().toLowerCase() === BOOTSTRAPPED_MAIN_HEAD_EMAIL;
        const isPw = Boolean(cred.user.providerData?.some((p) => p?.providerId === 'password'));
        const prof = await ensureUserProfile(cred.user);
        setFirebaseUser(cred.user);
        setEmailVerified(verifiedNow);
        setRealProfile(prof);
        setPreviewPersona(null);
        setLoading(false);
        return {
          ok: true,
          profile: prof,
          needsEmailVerification: isPw && !verifiedNow && !isMainHead,
        };
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/operation-not-allowed') {
          return {
            ok: false,
            needsEmailAuthSetup: true,
            error:
              'Email/Password sign-in is not yet enabled in Firebase Console for this project. Enable Authentication -> Sign-in method -> Email/Password, or use Continue with Google below.',
          };
        }
        if (code === 'auth/too-many-requests') {
          return { ok: false, error: 'Too many sign-in attempts. Please wait a few minutes and try again.' };
        }
        return {
          ok: false,
          error: 'Invalid credentials. Please verify your username/email and password.',
        };
      } finally {
        authFlowBusyRef.current = false;
      }
    },
    [ensureUserProfile],
  );

  const signUpEmailPassword = useCallback(
    async (params: { displayName: string; username: string; email: string; password: string }) => {
      const cleanEmail = params.email.trim().toLowerCase();
      const cleanUser = params.username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      authFlowBusyRef.current = true;
      try {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
        // Ensure Firestore's auth stream receives the freshly issued ID token immediately
        await cred.user.getIdToken(true).catch(() => undefined);
        const verifyRes = await sendVerificationWithFallback(cred.user);

        const isMainHead = cleanEmail === BOOTSTRAPPED_MAIN_HEAD_EMAIL;

        let dirEntry: EmailDirectoryEntry | null = null;
        if (!isMainHead) {
          try {
            const dirSnap = await getDoc(doc(db, 'emailDirectory', emailToKey(cleanEmail)));
            if (dirSnap.exists()) {
              const candidate = dirSnap.data() as EmailDirectoryEntry;
              if (candidate.status === 'active' && candidate.schoolId) {
                dirEntry = candidate;
              }
            }
          } catch {
            // Proceed as unassigned for School Code join flow
          }
        }

        const safeDisplayNameRaw = params.displayName.trim();
        let profile: PlatformUser = {
          uid: cred.user.uid,
          username: (cleanUser.length >= 3 ? cleanUser : `user_${cred.user.uid.slice(0, 6)}`).slice(0, 64),
          email: cleanEmail.slice(0, 160),
          displayName: (safeDisplayNameRaw.length >= 2 ? safeDisplayNameRaw : 'SJ Academia One User').slice(0, 120),
          role: isMainHead ? 'main_head' : dirEntry ? dirEntry.role : 'student',
          schoolId: isMainHead ? 'platform' : dirEntry ? dirEntry.schoolId.slice(0, 128) : 'unassigned',
          status: 'active',
          mustChangePassword: false,
          phone: '',
          accessCode: (dirEntry?.accessCode || '').slice(0, 24),
          classId: (dirEntry?.classId || '').slice(0, 128),
          section: (dirEntry?.section || '').slice(0, 32),
          assignedClassIds: Array.isArray(dirEntry?.assignedClassIds) ? dirEntry.assignedClassIds.slice(0, 200) : [],
          assignedSubjectIds: [],
          coordinatorPermissions: dirEntry?.coordinatorPermissions || DEFAULT_COORD_PERMS,
          isDemo: false,
        };

        const userRef = doc(db, 'users', cred.user.uid);
        const writeUserProfileWithRetry = async (targetProfile: PlatformUser) => {
          const payload = {
            ...targetProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          try {
            await setDoc(userRef, payload);
          } catch (firstErr) {
            // Wait briefly for Firebase Auth token propagation to Firestore and retry once
            await new Promise((resolve) => setTimeout(resolve, 350));
            await cred.user.getIdToken(true).catch(() => undefined);
            try {
              await setDoc(userRef, payload);
            } catch {
              throw firstErr;
            }
          }
        };

        const existingSnap = await getDoc(userRef).catch(() => null);
        if (!existingSnap || !existingSnap.exists()) {
          try {
            await writeUserProfileWithRetry(profile);
          } catch (writeErr) {
            // If an emailDirectory-bound create was rejected by rules, fall back to clean unassigned student profile
            if (!isMainHead && profile.schoolId !== 'unassigned') {
              profile = {
                ...profile,
                role: 'student',
                schoolId: 'unassigned',
                accessCode: '',
                classId: '',
                section: '',
                assignedClassIds: [],
                coordinatorPermissions: DEFAULT_COORD_PERMS,
              };
              dirEntry = null;
              await writeUserProfileWithRetry(profile);
            } else {
              throw writeErr;
            }
          }
        } else if (dirEntry) {
          await updateDoc(userRef, {
            displayName: profile.displayName,
            role: profile.role,
            schoolId: profile.schoolId,
            status: 'active',
            accessCode: profile.accessCode,
            classId: profile.classId,
            section: profile.section,
            assignedClassIds: profile.assignedClassIds,
            coordinatorPermissions: profile.coordinatorPermissions,
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
        }

        await setDoc(doc(db, 'notificationPreferences', cred.user.uid), {
          ...DEFAULT_NOTIFICATION_PREFS(cred.user.uid),
          updatedAt: serverTimestamp(),
        }).catch(() => undefined);

        if (dirEntry?.linkedProfileId) {
          const targetCol = dirEntry.role === 'student' ? 'students' : dirEntry.role === 'teacher' ? 'teachers' : null;
          if (targetCol) {
            await updateDoc(doc(db, targetCol, dirEntry.linkedProfileId), {
              userId: cred.user.uid,
              updatedAt: serverTimestamp(),
            }).catch(() => undefined);
          }
        }

        await recordAuditLog({
          schoolId: profile.schoolId,
          actorUid: cred.user.uid,
          actorName: profile.displayName,
          actorRole: profile.role,
          action: dirEntry ? 'ACCOUNT_REGISTERED_EMAIL_MATCHED' : 'ACCOUNT_REGISTERED',
          targetType: 'user',
          targetId: cred.user.uid,
          targetLabel: profile.email,
          details: dirEntry
            ? `Auto-matched to ${dirEntry.schoolName || dirEntry.schoolId} as ${dirEntry.role}.`
            : 'Self-registered via Email & Password.',
        }).catch(() => undefined);

        setFirebaseUser(cred.user);
        setEmailVerified(Boolean(cred.user.emailVerified));
        setRealProfile(profile);
        setPreviewPersona(null);
        setLoading(false);
        return {
          ok: true,
          profile,
          verificationEmailSent: verifyRes.ok,
          needsEmailVerification: !cred.user.emailVerified && !isMainHead,
        };
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/operation-not-allowed') {
          return {
            ok: false,
            needsEmailAuthSetup: true,
            error:
              'Email/Password registration requires enabling the Email/Password provider in Firebase Console (Authentication -> Sign-in method -> Email/Password).',
          };
        }
        if (code === 'auth/email-already-in-use') {
          return { ok: false, error: 'An account with this email already exists. Try signing in instead.' };
        }
        if (code === 'auth/weak-password') {
          return { ok: false, error: 'Password must be at least 6 characters with letters and numbers.' };
        }
        return { ok: false, error: err instanceof Error ? err.message : 'Unable to complete registration.' };
      } finally {
        authFlowBusyRef.current = false;
      }
    },
    [sendVerificationWithFallback],
  );

  const signInGoogle = useCallback(async () => {
    authFlowBusyRef.current = true;
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await cred.user.getIdToken(true).catch(() => undefined);
      const prof = await ensureUserProfile(cred.user);
      setFirebaseUser(cred.user);
      setEmailVerified(Boolean(cred.user.emailVerified));
      setRealProfile(prof);
      setPreviewPersona(null);
      setLoading(false);
      return { ok: true, profile: prof };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        return { ok: false, error: 'Sign-in popup was closed before completing.' };
      }
      return { ok: false, error: 'Unable to sign in with Google right now.' };
    } finally {
      authFlowBusyRef.current = false;
    }
  }, [ensureUserProfile]);

  const requestPasswordRecovery = useCallback(async (rawEmail: string) => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return {
        ok: false,
        error: 'Enter the registered email address for your account (usernames alone cannot receive reset emails).',
      };
    }

    const continueUrl = `${window.location.origin}/reset-password`;
    try {
      await sendPasswordResetEmail(auth, cleanEmail, {
        url: continueUrl,
        handleCodeInApp: false,
      });
      return { ok: true, email: cleanEmail };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/unauthorized-continue-uri' ||
        code === 'auth/invalid-continue-uri' ||
        code === 'auth/missing-continue-uri'
      ) {
        try {
          await sendPasswordResetEmail(auth, cleanEmail);
          return { ok: true, email: cleanEmail };
        } catch (fallbackErr: unknown) {
          const fbCode = (fallbackErr as { code?: string })?.code || '';
          if (fbCode === 'auth/user-not-found') {
            return { ok: true, email: cleanEmail };
          }
          if (fbCode === 'auth/too-many-requests') {
            return { ok: false, error: 'Too many reset attempts. Please wait a few minutes and try again.' };
          }
          return {
            ok: false,
            error: fallbackErr instanceof Error ? fallbackErr.message : 'Unable to send password reset email right now.',
          };
        }
      }
      if (code === 'auth/user-not-found') {
        // Non-revealing privacy success when email does not match an active account
        return { ok: true, email: cleanEmail };
      }
      if (code === 'auth/invalid-email') {
        return { ok: false, error: 'Enter a valid email address.' };
      }
      if (code === 'auth/too-many-requests') {
        return { ok: false, error: 'Too many password reset requests. Please wait a few minutes before retrying.' };
      }
      if (code === 'auth/operation-not-allowed') {
        return {
          ok: false,
          error: 'Email/Password sign-in is disabled in Firebase Console. Enable Email/Password authentication first.',
        };
      }
      if (code === 'auth/network-request-failed') {
        return { ok: false, error: 'Network error while sending reset email. Check your internet connection and retry.' };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to send password reset email right now.',
      };
    }
  }, []);

  const replaceTemporaryPassword = useCallback(async (newPassword: string, currentPassword?: string) => {
    if (!auth.currentUser) return { ok: false, error: 'Not signed in.' };
    try {
      if (currentPassword && auth.currentUser.email) {
        const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
        await reauthenticateWithCredential(auth.currentUser, credential);
      }
      await updatePassword(auth.currentUser, newPassword);
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp(),
      });
      setRealProfile((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
      return { ok: true };
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        return { ok: false, error: 'Your current password is incorrect. Please check and try again.' };
      }
      if (code === 'auth/requires-recent-login') {
        return {
          ok: false,
          error: 'For security, enter your current password or sign out and sign back in before changing your password.',
        };
      }
      if (code === 'auth/weak-password') {
        return { ok: false, error: 'New password must be at least 8 characters with letters and numbers.' };
      }
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to update password.' };
    }
  }, []);

  const checkEmailVerification = useCallback(async (): Promise<boolean> => {
    const current = auth.currentUser;
    if (!current) return false;
    try {
      await current.reload();
      await current.getIdToken(true).catch(() => undefined);
      const isNowVerified = Boolean(current.emailVerified);
      setEmailVerified(isNowVerified);
      setFirebaseUser(current);
      if (isNowVerified) {
        const prof = await ensureUserProfile(current).catch(() => null);
        if (prof) setRealProfile(prof);
      }
      return isNowVerified;
    } catch {
      return Boolean(current.emailVerified);
    }
  }, [ensureUserProfile]);

  const resendVerificationEmail = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return { ok: false, error: 'Please sign in first to resend your verification email.' };
    if (current.emailVerified) {
      setEmailVerified(true);
      return { ok: true };
    }
    return sendVerificationWithFallback(current);
  }, [sendVerificationWithFallback]);

  const refreshProfile = useCallback(async (): Promise<PlatformUser | null> => {
    if (!auth.currentUser) return null;
    const prof = await ensureUserProfile(auth.currentUser);
    setRealProfile(prof);
    return prof;
  }, [ensureUserProfile]);

  const enterDemoPreview = useCallback(
    (persona: PlatformUser) => {
      if (realProfile?.role !== 'main_head') return;
      setPreviewPersona(persona);
    },
    [realProfile?.role],
  );

  const exitDemoPreview = useCallback(() => {
    setPreviewPersona(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        realProfile,
        activeUser,
        activeSchool,
        schoolLoading,
        schoolLoadError,
        loading,
        authError,
        previewPersona,
        isPreviewMode: Boolean(previewPersona),
        emailVerified,
        isPasswordAccount,
        needsEmailVerification,
        signInUnified,
        signUpEmailPassword,
        signInGoogle,
        requestPasswordRecovery,
        replaceTemporaryPassword,
        checkEmailVerification,
        resendVerificationEmail,
        logout,
        enterDemoPreview,
        exitDemoPreview,
        refreshProfile,
        reloadSchool,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
