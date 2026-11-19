import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, generateId, handleFirestoreError, OperationType } from './firebase';
import type { NotificationCategory, NotificationPreferences } from '../types/models';

export const DEFAULT_NOTIFICATION_PREFS = (userId: string): NotificationPreferences => ({
  userId,
  browserPushEnabled: false,
  inAppEnabled: true,
  messages: true,
  task_reminders: true,
  academic: true,
  special_offers: true,
  system: true,
});

export const NOTIFICATION_CATEGORY_META: Record<
  NotificationCategory,
  { label: string; description: string }
> = {
  messages: {
    label: 'New Messages & Announcements',
    description: 'School notices, class announcements, and direct academic flags.',
  },
  task_reminders: {
    label: 'Task & Homework Reminders',
    description: 'Upcoming homework deadlines, attendance tasks, and grading queues.',
  },
  academic: {
    label: 'Timetable, Exams & Results',
    description: 'Schedule updates, published exam timetables, and released marks.',
  },
  special_offers: {
    label: 'Special Offers & Plan Updates',
    description: 'Subscription upgrades, seasonal discounts, and renewal reminders.',
  },
  system: {
    label: 'Account & Security Alerts',
    description: 'Account creation, password resets, and subscription status notices.',
  },
};

export function getFcmIntegrationStatus(): {
  configured: boolean;
  label: string;
  requiredEnv: string;
} {
  const vapid = import.meta.env.VITE_FCM_VAPID_KEY as string | undefined;
  if (vapid && vapid.trim().length > 10) {
    return {
      configured: true,
      label: 'Configured (FCM Web Push Ready)',
      requiredEnv: 'VITE_FCM_VAPID_KEY',
    };
  }
  return {
    configured: false,
    label: 'Pending Configuration (Browser Web Push active; supply VITE_FCM_VAPID_KEY for background FCM)',
    requiredEnv: 'VITE_FCM_VAPID_KEY',
  };
}

export function getBrowserPushPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

export async function requestBrowserPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.requestPermission();
}

export function triggerBrowserPushNotification(title: string, body: string): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (window.Notification.permission !== 'granted') return false;
  try {
    new window.Notification(title, {
      body,
      tag: `academiaone-${Date.now()}`,
    });
    return true;
  } catch {
    return false;
  }
}

export async function saveNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<void> {
  const path = `notificationPreferences/${prefs.userId}`;
  try {
    await setDoc(doc(db, 'notificationPreferences', prefs.userId), {
      ...prefs,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function createNotification(params: {
  userId: string;
  schoolId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  linkRoute?: string;
  prefs?: NotificationPreferences | null;
}): Promise<string> {
  const id = generateId('ntf');
  const path = `notifications/${id}`;
  try {
    await setDoc(doc(db, 'notifications', id), {
      id,
      userId: params.userId,
      schoolId: params.schoolId || 'platform',
      category: params.category,
      title: params.title.slice(0, 160),
      body: params.body.slice(0, 600),
      linkRoute: (params.linkRoute || '').slice(0, 160),
      isRead: false,
      createdAt: serverTimestamp(),
    });

    if (params.prefs?.browserPushEnabled && params.prefs[params.category]) {
      triggerBrowserPushNotification(params.title, params.body);
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function markNotificationRead(id: string, isRead = true): Promise<void> {
  const path = `notifications/${id}`;
  try {
    await updateDoc(doc(db, 'notifications', id), { isRead });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
