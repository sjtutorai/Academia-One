import React, { useState } from 'react';
import { Bell, BellRing, CheckCheck, Send, SlidersHorizontal } from 'lucide-react';
import { useNotifications } from '../../contexts/NotificationContext';
import { NOTIFICATION_CATEGORY_META } from '../../lib/notifications';
import { formatFirestoreDateTime } from '../../lib/firebase';
import { Button, EmptyState, useToast } from '../ui/Primitives';
import type { NotificationCategory } from '../../types/models';

const CATEGORIES: NotificationCategory[] = [
  'messages',
  'task_reminders',
  'academic',
  'special_offers',
  'system',
];

export function NotificationsAndPreferencesView() {
  const {
    notifications,
    unreadCount,
    preferences,
    pushPermission,
    enableBrowserPush,
    updatePreferences,
    markRead,
    markAllRead,
    sendSamplePushEvent,
  } = useNotifications();
  const { pushToast } = useToast();

  const [tab, setTab] = useState<'inbox' | 'preferences'>('inbox');
  const [catFilter, setCatFilter] = useState<'all' | NotificationCategory>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [sendingTest, setSendingTest] = useState<string | null>(null);

  const filtered = notifications.filter((n) => {
    if (catFilter !== 'all' && n.category !== catFilter) return false;
    if (onlyUnread && n.isRead) return false;
    return true;
  });

  const handleEnablePush = async () => {
    const res = await enableBrowserPush();
    if (res === 'granted') {
      pushToast('success', 'Browser push notifications enabled.');
    } else if (res === 'denied') {
      pushToast('warning', 'Browser notifications are blocked in your browser site settings.');
    } else if (res === 'unsupported') {
      pushToast('info', 'Browser Notification API is not supported in this frame; in-app alerts remain active.');
    }
  };

  const handleSendSample = async (cat: NotificationCategory) => {
    setSendingTest(cat);
    try {
      await sendSamplePushEvent(cat);
      pushToast('success', `Dispatched ${NOTIFICATION_CATEGORY_META[cat].label} alert.`);
    } catch {
      pushToast('error', 'Unable to dispatch notification event.');
    } finally {
      setSendingTest(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('inbox')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              tab === 'inbox' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Notification Center ({unreadCount} unread)
          </button>
          <button
            type="button"
            onClick={() => setTab('preferences')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              tab === 'preferences' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Push & Channel Preferences
          </button>
        </div>

        {tab === 'inbox' && unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={markAllRead}>
            <CheckCheck className="w-4 h-4" />
            Mark All Read
          </Button>
        )}
      </div>

      {tab === 'inbox' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCatFilter('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
                  catFilter === 'all' ? 'bg-[#0B1528] text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                All
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCatFilter(c)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
                    catFilter === c ? 'bg-[#0B1528] text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {NOTIFICATION_CATEGORY_META[c].label.split('&')[0].trim()}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyUnread}
                onChange={(e) => setOnlyUnread(e.target.checked)}
                className="rounded border-slate-300 text-teal-600"
              />
              Unread only
            </label>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No notifications in this view"
              description="New messages, task reminders, published exams, and special offers will appear here in real time."
              actionLabel="Manage Push Preferences"
              onAction={() => setTab('preferences')}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
              {filtered.map((n) => (
                <div
                  key={n.id}
                  className={`p-5 flex items-start justify-between gap-4 transition-colors ${
                    n.isRead ? 'bg-white' : 'bg-teal-50/40'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-teal-700">
                        {NOTIFICATION_CATEGORY_META[n.category]?.label || n.category}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatFirestoreDateTime(n.createdAt)}</span>
                      {!n.isRead && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-900">Unread</span>
                        </>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 mt-1">{n.title}</h3>
                    <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">{n.body}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markRead(n.id, !n.isRead)}
                  >
                    {n.isRead ? 'Mark Unread' : 'Mark Read'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid lg:grid-cols-12 gap-6">
          {/* Channel & Category Switches */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200">
              <div>
                <h2 className="text-base font-bold font-display text-slate-900 flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-teal-600" />
                  Delivery Channels
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Control how AcademiaOne alerts you for messages, task reminders, and offers.
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={handleEnablePush}>
                <BellRing className="w-4 h-4" />
                {pushPermission === 'granted' ? 'Browser Push Active' : 'Enable Browser Push'}
              </Button>
            </div>

            <div className="space-y-4">
              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Browser Push Notifications</p>
                  <p className="text-xs text-slate-500">
                    Permission state: <span className="font-mono">{pushPermission}</span>
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(preferences?.browserPushEnabled)}
                  onChange={async (e) => {
                    if (e.target.checked && pushPermission !== 'granted') {
                      await handleEnablePush();
                    } else {
                      await updatePreferences({ browserPushEnabled: e.target.checked });
                      pushToast('success', 'Push preference saved.');
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-300 text-teal-600"
                />
              </label>

              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <div>
                  <p className="text-sm font-semibold text-slate-900">In-App Notification Feed</p>
                  <p className="text-xs text-slate-500">Show unread bell badge and real-time inbox feed.</p>
                </div>
                <input
                  type="checkbox"
                  checked={preferences?.inAppEnabled !== false}
                  onChange={async (e) => {
                    await updatePreferences({ inAppEnabled: e.target.checked });
                    pushToast('success', 'In-app feed preference saved.');
                  }}
                  className="w-4 h-4 rounded border-slate-300 text-teal-600"
                />
              </label>
            </div>

            <div className="pt-5 border-t border-slate-200 space-y-4">
              <h3 className="text-xs font-semibold text-slate-500">Event Categories</h3>
              {CATEGORIES.map((cat) => (
                <label key={cat} className="flex items-start justify-between gap-4 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{NOTIFICATION_CATEGORY_META[cat].label}</p>
                    <p className="text-xs text-slate-500">{NOTIFICATION_CATEGORY_META[cat].description}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences ? preferences[cat] : true}
                    onChange={async (e) => {
                      await updatePreferences({ [cat]: e.target.checked });
                      pushToast('success', `Updated ${NOTIFICATION_CATEGORY_META[cat].label}.`);
                    }}
                    className="w-4 h-4 mt-1 rounded border-slate-300 text-teal-600"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Live Test Trigger & FCM Integration Status */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h3 className="text-sm font-bold font-display text-slate-900 flex items-center gap-2">
                <Bell className="w-4 h-4 text-teal-600" />
                Test Key Push Events
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Dispatch a live Firestore notification event to verify in-app delivery and Browser Push alerts.
              </p>
              <div className="mt-4 space-y-2.5">
                {(['messages', 'task_reminders', 'special_offers'] as NotificationCategory[]).map((cat) => (
                  <Button
                    key={cat}
                    variant="secondary"
                    size="sm"
                    className="w-full justify-between"
                    disabled={sendingTest === cat}
                    onClick={() => handleSendSample(cat)}
                  >
                    <span>Send {NOTIFICATION_CATEGORY_META[cat].label}</span>
                    <Send className="w-3.5 h-3.5 text-teal-600" />
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
