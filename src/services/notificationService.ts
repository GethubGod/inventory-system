import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { Reminder } from '@/types/settings';
import { useSettingsStore } from '@/store';
import { supabase } from '@/lib/supabase';

const STOCK_PAUSED_NOTIFICATION_TYPE = 'stock-count-paused';

// Configure notification behavior
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

export async function requestNotificationPermissions(): Promise<boolean> {
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

export async function registerCurrentDevicePushToken(
  userId: string
): Promise<string | null> {
  if (!userId) return null;

  // Expo Go does not support remote push token registration reliably.
  // Keep local notifications enabled, but skip remote token enrollment.
  if ((Constants as any)?.appOwnership === 'expo') {
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

  if (!expoPushToken) return null;

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
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = scheduled.filter(
    (notification) => notification.content.data?.reminderId === reminderId
  );

  for (const notification of toCancel) {
    await Notifications.cancelScheduledNotificationAsync(notification.identifier);
  }
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
  return Notifications.getAllScheduledNotificationsAsync();
}

export async function scheduleNoOrderTodayReminder(
  enabled: boolean,
  time: string = '15:00'
): Promise<string | null> {
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

// Send immediate notification to employees who haven't ordered today
export async function sendReminderToEmployees(employeeIds: string[]): Promise<void> {
  // In a real app, you would send push notifications via a server
  // For now, we'll schedule an immediate local notification as a demo
  // In production, this would call your backend API to send push notifications
  // to the specific employee devices using their push tokens stored in the database

  // Send a local notification immediately (for demo purposes)
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Order Reminder Sent',
      body: `Reminder sent to ${employeeIds.length} employee${employeeIds.length !== 1 ? 's' : ''}`,
      data: { type: 'manager-reminder-sent' },
      sound: true,
    },
    trigger: null, // null trigger = immediate notification
  });

  // In production, you would:
  // 1. Fetch push tokens for these employee IDs from your database
  // 2. Call your backend API or Expo Push Service to send notifications
  // Example:
  // const { data: employees } = await supabase
  //   .from('users')
  //   .select('push_token')
  //   .in('id', employeeIds);
  //
  // const pushTokens = employees?.map(e => e.push_token).filter(Boolean);
  // await sendPushNotifications(pushTokens, {
  //   title: 'Order Reminder',
  //   body: "Don't forget to place your inventory order today!",
  // });
}

// Send order status update notification
export async function sendOrderStatusNotification(
  status: string,
  orderNumber: number
): Promise<void> {
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
