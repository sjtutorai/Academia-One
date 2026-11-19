import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  DEFAULT_NOTIFICATION_PREFS,
  createNotification,
  getBrowserPushPermission,
  markNotificationRead,
  requestBrowserPushPermission,
  saveNotificationPreferences,
  triggerBrowserPushNotification,
} from '../lib/notifications';
import type { AppNotification, NotificationCategory, NotificationPreferences } from '../types/models';
import { useAuth } from './AuthContext';

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  preferences: NotificationPreferences | null;
  pushPermission: NotificationPermission | 'unsupported';
  enableBrowserPush: () => Promise<NotificationPermission | 'unsupported'>;
  updatePreferences: (patch: Partial<NotificationPreferences>) => Promise<void>;
  markRead: (id: string, isRead?: boolean) => Promise<void>;
  markAllRead: () => Promise<void>;
  sendSamplePushEvent: (category: NotificationCategory) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { activeUser, realProfile } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getBrowserPushPermission(),
  );
  const knownIdsRef = useRef<Set<string>>(new Set());
  const initialLoadedRef = useRef(false);

  const ownerUid = realProfile?.uid || '';

  // Subscribe to Notification Preferences
  useEffect(() => {
    if (!ownerUid) {
      setPreferences(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'notificationPreferences', ownerUid),
      (snap) => {
        if (snap.exists()) {
          setPreferences(snap.data() as NotificationPreferences);
        } else {
          setPreferences(DEFAULT_NOTIFICATION_PREFS(ownerUid));
        }
      },
      () => {
        setPreferences(DEFAULT_NOTIFICATION_PREFS(ownerUid));
      },
    );
    return () => unsub();
  }, [ownerUid]);

  // Subscribe to Real-time Notifications for the signed-in user
  useEffect(() => {
    if (!ownerUid) {
      setNotifications([]);
      knownIdsRef.current = new Set();
      initialLoadedRef.current = false;
      return;
    }
    const q = query(collection(db, 'notifications'), where('userId', '==', ownerUid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: AppNotification[] = snap.docs.map((d) => d.data() as AppNotification);
        items.sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
          return tb - ta;
        });

        // Trigger Browser Push for newly arriving unread items
        if (initialLoadedRef.current && preferences?.browserPushEnabled) {
          for (const item of items) {
            if (!knownIdsRef.current.has(item.id) && !item.isRead) {
              const catEnabled = preferences[item.category];
              if (catEnabled) {
                triggerBrowserPushNotification(item.title, item.body);
              }
            }
          }
        }
        items.forEach((i) => knownIdsRef.current.add(i.id));
        initialLoadedRef.current = true;
        setNotifications(items);
      },
      (err) => {
        console.warn('Notification listener warning:', err.message);
      },
    );
    return () => unsub();
  }, [ownerUid, preferences]);

  const enableBrowserPush = useCallback(async () => {
    const perm = await requestBrowserPushPermission();
    setPushPermission(perm);
    if (perm === 'granted' && ownerUid) {
      const next: NotificationPreferences = {
        ...(preferences || DEFAULT_NOTIFICATION_PREFS(ownerUid)),
        userId: ownerUid,
        browserPushEnabled: true,
      };
      await saveNotificationPreferences(next);
      setPreferences(next);
    }
    return perm;
  }, [ownerUid, preferences]);

  const updatePreferences = useCallback(
    async (patch: Partial<NotificationPreferences>) => {
      if (!ownerUid) return;
      const next: NotificationPreferences = {
        ...(preferences || DEFAULT_NOTIFICATION_PREFS(ownerUid)),
        ...patch,
        userId: ownerUid,
      };
      setPreferences(next);
      await saveNotificationPreferences(next);
    },
    [ownerUid, preferences],
  );

  const markRead = useCallback(async (id: string, isRead = true) => {
    await markNotificationRead(id, isRead);
  }, []);

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.isRead);
    await Promise.all(unread.map((n) => markNotificationRead(n.id, true)));
  }, [notifications]);

  const sendSamplePushEvent = useCallback(
    async (category: NotificationCategory) => {
      if (!ownerUid || !activeUser) return;
      const samples: Record<NotificationCategory, { title: string; body: string }> = {
        messages: {
          title: 'New Academic Message',
          body: 'Dr. Eleanor Vance posted an update regarding Grade 10 midterm proctoring schedules.',
        },
        task_reminders: {
          title: 'Task Reminder: Attendance & Homework Review',
          body: 'Daily attendance submission closes at 10:30 AM and 4 homework submissions await feedback.',
        },
        academic: {
          title: 'Exam Timetable Published',
          body: 'Autumn Midterm Examination schedule for Grade 10-A has been published in Main Exam Hall.',
        },
        special_offers: {
          title: 'Special Offer: Annual Campus Plan Savings',
          body: 'Switch to annual billing before term renewal to save 20% across multi-campus licenses.',
        },
        system: {
          title: 'Security Notice: Session Verified',
          body: 'Your AcademiaOne account preferences and notification channel settings were synchronized.',
        },
      };
      const sample = samples[category];
      await createNotification({
        userId: ownerUid,
        schoolId: activeUser.schoolId || 'platform',
        category,
        title: sample.title,
        body: sample.body,
        prefs: preferences,
      });
    },
    [ownerUid, activeUser, preferences],
  );

  const visibleNotifications = preferences?.inAppEnabled === false ? [] : notifications;
  const unreadCount = visibleNotifications.filter((n) => !n.isRead).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications: visibleNotifications,
        unreadCount,
        preferences,
        pushPermission,
        enableBrowserPush,
        updatePreferences,
        markRead,
        markAllRead,
        sendSamplePushEvent,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}
