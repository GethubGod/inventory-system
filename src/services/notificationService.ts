// PHASE 4: Notifications, push tokens, in-app — direct Supabase calls, no matching edge functions yet.
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { NotificationRequest } from 'expo-notifications';
import { Reminder } from '@/types/settings';
import { useSettingsStore } from '@/store';
import { getNotificationsModule } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

const DEVICE_PUSH_TOKEN_STORAGE_KEY = 'device-push-token';
const STOCK_PAUSED_NOTIFICATION_TYPE = 'stock-count-paused';
let notificationHandlerConfigured = false;
const pushRegistrationGeneration = new Map<string, number>();
const pendingPushRegistrations = new Map<string, Set<Promise<string | null>>>();

function getPushRegistrationGeneration(userId: string): number {
  return pushRegistrationGeneration.get(userId) ?? 0;
}

async function getNotifications() {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return null;
  }

  if (!notificationHandlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => {
        const { notifications } = useSettingsStore.getState();
        const inQuietHours = isInQuietHours(
          notifications.quietHours.enabled,
          notifications.quietHours.startTime,
          notifications.quietHours.endTime
        );

        return {
          shouldPlaySound: notifications.soundEnabled && !inQuietHours,
          shouldSetBadge: true,
          shouldShowBanner: !inQuietHours,
          shouldShowList: !inQuietHours,
        };
      },
    });

    notificationHandlerConfigured = true;
  }

  return Notifications;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  const Notifications = await getNotifications();
  if (!Notifications) {
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  return finalStatus === 'granted';
}

export async function syncNotificationPreference(
  userId: string,
  enabled: boolean
): Promise<void> {
  if (!userId) return;
  const db = supabase as any;

  const { error } = await db
    .from('profiles')
    .update({ notifications_enabled: enabled })
    .eq('id', userId);

  if (error) {
    throw new Error(error.message || 'Unable to save notification preference.');
  }
}

function getExpoProjectId(): string | undefined {
  const fromEas = (Constants as any)?.easConfig?.projectId;
  const fromExpoConfig = (Constants as any)?.expoConfig?.extra?.eas?.projectId;
  return fromEas || fromExpoConfig;
}

export function isPushTokenRefreshDue(
  updatedAt: string | null | undefined,
  nowMs = Date.now(),
  maxAgeDays = 7
): boolean {
  if (!updatedAt) return true;
  const updatedAtMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return true;

  const maxAgeMs = Math.max(0, maxAgeDays) * 24 * 60 * 60 * 1000;
  return nowMs - updatedAtMs > maxAgeMs;
}

export async function registerCurrentDevicePushToken(userId: string): Promise<string | null> {
  const generation = getPushRegistrationGeneration(userId);
  const registrations = pendingPushRegistrations.get(userId) ?? new Set<Promise<string | null>>();
  pendingPushRegistrations.set(userId, registrations);
  const registration = registerDevicePushToken(userId, generation);
  registrations.add(registration);
  try {
    return await registration;
  } finally {
    registrations.delete(registration);
    if (registrations.size === 0) pendingPushRegistrations.delete(userId);
  }
}

async function registerDevicePushToken(
  userId: string,
  generation: number,
): Promise<string | null> {
  if (!userId) return null;

  // Expo Go does not support remote push token registration reliably.
  // Keep local notifications enabled, but skip remote token enrollment.
  if ((Constants as any)?.appOwnership === 'expo') {
    return null;
  }

  const Notifications = await getNotifications();
  if (!Notifications) {
    return null;
  }

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    return null;
  }

  const projectId = getExpoProjectId();
  const tokenResponse = projectId
    ? await Notifications.getExpoPushTokenAsync({ projectId })
    : await Notifications.getExpoPushTokenAsync();
  const expoPushToken = tokenResponse?.data?.trim();

  if (!expoPushToken || getPushRegistrationGeneration(userId) !== generation) return null;

  await AsyncStorage.setItem(DEVICE_PUSH_TOKEN_STORAGE_KEY, expoPushToken);
  if (getPushRegistrationGeneration(userId) !== generation) return null;
  const db = supabase as any;

  const { error: upsertError } = await db
    .from('device_push_tokens')
    .upsert(
      {
        user_id: userId,
        expo_push_token: expoPushToken,
        platform:
          Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
            ? Platform.OS
            : 'unknown',
        active: true,
      },
      { onConflict: 'user_id,expo_push_token' }
    );

  if (upsertError) {
    throw new Error(upsertError.message || 'Unable to register push token.');
  }

  const { error: deactivateError } = await db
    .from('device_push_tokens')
    .update({ active: false })
    .eq('user_id', userId)
    .neq('expo_push_token', expoPushToken);

  if (deactivateError) {
    throw new Error(deactivateError.message || 'Unable to refresh push token state.');
  }

  return expoPushToken;
}

/**
 * Foreground callers can use this to renew a remote-push registration no more
 * than once per seven days. Wiring the AppState listener is intentionally left
 * to the frontend task.
 */
export async function refreshCurrentDevicePushTokenIfStale(
  userId: string,
  maxAgeDays = 7
): Promise<string | null> {
  if (!userId) return null;
  const generation = getPushRegistrationGeneration(userId);
  const db = supabase as any;

  const { data, error } = await db
    .from('device_push_tokens')
    .select('updated_at')
    .eq('user_id', userId)
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Unable to check push token freshness.');
  }

  if (!isPushTokenRefreshDue(data?.updated_at, Date.now(), maxAgeDays)) {
    return null;
  }

  if (getPushRegistrationGeneration(userId) !== generation) return null;
  return registerCurrentDevicePushToken(userId);
}

/** Deactivate only this phone while the departing user still has a session. */
export async function deactivateCurrentDevicePushToken(userId: string): Promise<void> {
  if (!userId || Constants.appOwnership === 'expo') return;
  pushRegistrationGeneration.set(userId, getPushRegistrationGeneration(userId) + 1);
  await Promise.allSettled([...(pendingPushRegistrations.get(userId) ?? [])]);
  let token = (await AsyncStorage.getItem(DEVICE_PUSH_TOKEN_STORAGE_KEY))?.trim();
  if (!token) {
    // Older builds did not save the device token. Never prompt during logout.
    const Notifications = await getNotifications();
    if (!Notifications) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const projectId = getExpoProjectId();
    const response = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    token = response.data.trim();
  }
  if (!token) return;

  const { error } = await supabase
    .from('device_push_tokens')
    .update({ active: false })
    .eq('user_id', userId)
    .eq('expo_push_token', token);
  if (error) throw new Error(error.message || 'Unable to deactivate this device.');
}

/** Remove private reminders and delivered banners from this shared device. */
export async function clearDeviceNotifications(shouldClear: () => boolean = () => true): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications || !shouldClear()) return;
  await Promise.all([
    Notifications.cancelAllScheduledNotificationsAsync(),
    Notifications.dismissAllNotificationsAsync(),
    Notifications.setBadgeCountAsync(0),
  ]);
}

export async function deactivatePushTokensForUser(userId: string): Promise<void> {
  if (!userId) return;
  const db = supabase as any;

  const { error } = await db
    .from('device_push_tokens')
    .update({ active: false })
    .eq('user_id', userId);

  if (error) {
    throw new Error(error.message || 'Unable to deactivate push tokens.');
  }
}

export async function scheduleReminder(reminder: Reminder): Promise<string[]> {
  const notificationIds: string[] = [];

  // Cancel any existing notifications for this reminder
  await cancelReminder(reminder.id);

  if (!reminder.enabled) {
    return notificationIds;
  }

  const Notifications = await getNotifications();
  if (!Notifications) {
    return notificationIds;
  }

  const [hours, minutes] = reminder.time.split(':').map(Number);

  if (reminder.repeatType === 'daily') {
    // Schedule daily notification
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: reminder.name,
        body: reminder.message,
        data: { reminderId: reminder.id },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: hours,
        minute: minutes,
      },
    });
    notificationIds.push(id);
  } else {
    // Schedule weekly notifications for selected days
    for (const dayIndex of reminder.selectedDays) {
      // Convert from 0-6 (Sun-Sat) to 1-7 (Sun-Sat) for expo-notifications
      const weekday = dayIndex + 1;
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: reminder.name,
          body: reminder.message,
          data: { reminderId: reminder.id, dayIndex },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: hours,
          minute: minutes,
        },
      });
      notificationIds.push(id);
    }
  }

  return notificationIds;
}

export async function cancelReminder(reminderId: string): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) {
    return;
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = scheduled.filter(
    (notification) => notification.content.data?.reminderId === reminderId
  );

  for (const notification of toCancel) {
    await Notifications.cancelScheduledNotificationAsync(notification.identifier);
  }
}

export async function cancelAllReminders(): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) {
    return;
  }

  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function getScheduledNotifications(): Promise<NotificationRequest[]> {
  const Notifications = await getNotifications();
  if (!Notifications) {
    return [];
  }

  return Notifications.getAllScheduledNotificationsAsync();
}

export async function scheduleNoOrderTodayReminder(
  enabled: boolean,
  time: string = '15:00'
): Promise<string | null> {
  const Notifications = await getNotifications();
  if (!Notifications) {
    return null;
  }

  // Cancel existing
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const existing = scheduled.filter(
    (n) => n.content.data?.type === 'no-order-today'
  );
  for (const n of existing) {
    await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }

  if (!enabled) {
    return null;
  }

  const [hours, minutes] = time.split(':').map(Number);

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Order Reminder',
      body: "You haven't placed an order today. Don't forget!",
      data: { type: 'no-order-today' },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: hours,
      minute: minutes,
    },
  });

  return id;
}

export async function scheduleBeforeClosingReminder(
  enabled: boolean,
  closingTime: string = '21:00',
  minutesBefore: number = 30
): Promise<string | null> {
  const Notifications = await getNotifications();
  if (!Notifications) {
    return null;
  }

  // Cancel existing
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const existing = scheduled.filter(
    (n) => n.content.data?.type === 'before-closing'
  );
  for (const n of existing) {
    await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }

  if (!enabled) {
    return null;
  }

  const [closingHours, closingMinutes] = closingTime.split(':').map(Number);

  // Calculate reminder time (30 min before closing)
  let reminderMinutes = closingMinutes - minutesBefore;
  let reminderHours = closingHours;

  if (reminderMinutes < 0) {
    reminderMinutes += 60;
    reminderHours -= 1;
  }

  if (reminderHours < 0) {
    reminderHours += 24;
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Closing Soon',
      body: `Store closes in ${minutesBefore} minutes. Review your orders!`,
      data: { type: 'before-closing' },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: reminderHours,
      minute: reminderMinutes,
    },
  });

  return id;
}

export async function cancelStockCountPausedNotifications(): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) {
    return;
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const stockNotifications = scheduled.filter(
    (notification) => notification.content.data?.type === STOCK_PAUSED_NOTIFICATION_TYPE
  );

  for (const notification of stockNotifications) {
    await Notifications.cancelScheduledNotificationAsync(notification.identifier);
  }
}

export async function scheduleStockCountPausedNotification(
  stationName: string,
  areaId?: string | null
): Promise<string | null> {
  const granted = await requestNotificationPermissions();
  if (!granted) return null;

  const Notifications = await getNotifications();
  if (!Notifications) {
    return null;
  }

  await cancelStockCountPausedNotifications();

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Stock count paused',
      body: `Tap to resume your stock count for ${stationName}.`,
      data: {
        type: STOCK_PAUSED_NOTIFICATION_TYPE,
        areaId: areaId ?? null,
      },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 60,
      repeats: false,
    },
  });

  return id;
}

// Re-schedule all reminders (call on app start)
export async function rescheduleAllReminders(reminders: Reminder[]): Promise<void> {
  for (const reminder of reminders) {
    if (reminder.enabled) {
      await scheduleReminder(reminder);
    }
  }
}

// Check if we're in quiet hours
export function isInQuietHours(
  quietHoursEnabled: boolean,
  startTime: string,
  endTime: string
): boolean {
  if (!quietHoursEnabled) {
    return false;
  }

  const now = new Date();
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentTime = currentHours * 60 + currentMinutes;

  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [endHours, endMinutes] = endTime.split(':').map(Number);
  const start = startHours * 60 + startMinutes;
  const end = endHours * 60 + endMinutes;

  // Handle overnight quiet hours (e.g., 22:00 to 07:00)
  if (start > end) {
    return currentTime >= start || currentTime < end;
  }

  return currentTime >= start && currentTime < end;
}

// Trigger local notification for employee with a pending manager reminder.
// Called on app foreground / focus when unread reminder notifications exist.
export async function triggerPendingReminderLocalNotification(
  message?: string
): Promise<void> {
  const { notifications } = useSettingsStore.getState();
  if (!notifications.pushEnabled) return;

  const granted = await requestNotificationPermissions();
  if (!granted) return;

  const Notifications = await getNotifications();
  if (!Notifications) {
    return;
  }

  // Avoid duplicate: cancel any existing pending-reminder notification first
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.content.data?.type === 'employee-pending-reminder') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Order Reminder',
      body: message || 'A manager reminded you to place your order.',
      data: { type: 'employee-pending-reminder' },
      sound: true,
    },
    trigger: null,
  });
}

// Mark pending reminder notifications as read and resolve active reminders
// client-side after an order is submitted. Belt-and-suspenders alongside DB trigger.
export async function completePendingRemindersForUser(
  userId: string
): Promise<void> {
  if (!userId) return;
  const db = supabase as any;

  // Mark in-app reminder notifications as read
  await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('notification_type', 'employee_reminder')
    .is('read_at', null);
}

// Send order status update notification
export async function sendOrderStatusNotification(
  status: string,
  orderNumber: number
): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) {
    return;
  }

  const statusMessages: Record<string, string> = {
    submitted: 'Your order has been submitted and is being processed.',
    processing: 'Your order is now being processed.',
    fulfilled: 'Your order has been fulfilled!',
    cancelled: 'Your order has been cancelled.',
  };

  const message = statusMessages[status] || `Order status updated to: ${status}`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Order #${orderNumber}`,
      body: message,
      data: { type: 'order-status', orderNumber, status },
      sound: true,
    },
    trigger: null,
  });
}
