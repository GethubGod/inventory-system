// @ts-nocheck
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export interface ReminderSystemSettings {
  overdueThresholdDays: number;
  reminderRateLimitMinutes: number;
  recurringWindowMinutes: number;
}

export interface ManagerContext {
  userId: string;
  role: string | null;
  suspended: boolean;
}

export interface SendEmployeeReminderInput {
  employeeId: string;
  managerId: string | null;
  locationId?: string | null;
  source?: 'manual' | 'manual_repeat' | 'recurring' | 'system';
  message?: string;
  overrideRateLimit?: boolean;
  channels?: {
    push?: boolean;
    in_app?: boolean;
  };
}

export interface SendEmployeeReminderResult {
  reminder: any;
  event: any;
  inAppNotificationId: string | null;
  channelsAttempted: string[];
  notificationsEnabled: boolean;
  push: {
    attempted: boolean;
    status:
      | 'sent'
      | 'partial'
      | 'failed'
      | 'no_tokens'
      | 'not_delivered_push_disabled'
      | 'not_requested';
    tokenCount: number;
    successCount: number;
    failureCount: number;
    details?: any;
  };
  settings: ReminderSystemSettings;
}

export class ReminderRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'ReminderRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function toIsoString(value: any): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function minutesBetween(nowIso: string, thenIso: string): number {
  const now = new Date(nowIso).getTime();
  const then = new Date(thenIso).getTime();
  return Math.max(0, Math.floor((now - then) / (1000 * 60)));
}

function sanitizeExpoPushToken(token: string): string | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('ExponentPushToken[') && !trimmed.startsWith('ExpoPushToken[')) {
    return null;
  }
  return trimmed;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function getReminderSystemSettings(
  supabaseAdmin: SupabaseClient
): Promise<ReminderSystemSettings> {
  const { data } = await supabaseAdmin
    .from('reminder_system_settings')
    .select('overdue_threshold_days, reminder_rate_limit_minutes, recurring_window_minutes')
    .limit(1)
    .maybeSingle();

  return {
    overdueThresholdDays: Math.max(1, Number(data?.overdue_threshold_days ?? 7) || 7),
    reminderRateLimitMinutes: Math.max(1, Number(data?.reminder_rate_limit_minutes ?? 15) || 15),
    recurringWindowMinutes: Math.max(1, Number(data?.recurring_window_minutes ?? 15) || 15),
  };
}

export async function getRequesterFromToken(
  supabaseAdmin: SupabaseClient,
  token: string
): Promise<ManagerContext | null> {
  if (!token) return null;

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return null;
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, is_suspended')
    .eq('id', user.id)
    .maybeSingle();

  const { data: legacyUser } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  // Keep manager auth aligned with DB policies that use public.users.role.
  const profileRole = typeof profile?.role === 'string' ? profile.role : null;
  const usersRole = typeof legacyUser?.role === 'string' ? legacyUser.role : null;
  const resolvedRole =
    usersRole === 'manager'
      ? 'manager'
      : profileRole === 'manager'
        ? 'manager'
        : usersRole ?? profileRole;

  return {
    userId: user.id,
    role: resolvedRole,
    suspended: Boolean(profile?.is_suspended),
  };
}

async function resolveStaleReminderIfNeeded(
  supabaseAdmin: SupabaseClient,
  employeeId: string,
  activeReminder: any | null,
  latestOrder: any | null
): Promise<any | null> {
  if (!activeReminder || !latestOrder?.created_at) {
    return activeReminder;
  }

  const reminderCreatedAt = toIsoString(activeReminder.created_at);
  const latestOrderAt = toIsoString(latestOrder.created_at);
  if (!reminderCreatedAt || !latestOrderAt) return activeReminder;

  if (new Date(latestOrderAt).getTime() <= new Date(reminderCreatedAt).getTime()) {
    return activeReminder;
  }

  await supabaseAdmin.rpc('resolve_active_reminders_for_employee', {
    p_employee_id: employeeId,
    p_order_created_at: latestOrderAt,
    p_order_id: latestOrder.id ?? null,
  });

  return null;
}

async function getLatestOrderForEmployee(supabaseAdmin: SupabaseClient, employeeId: string) {
  const { data } = await supabaseAdmin
    .from('orders')
    .select('id, created_at, location_id')
    .eq('user_id', employeeId)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

async function getActiveReminderForEmployee(
  supabaseAdmin: SupabaseClient,
  employeeId: string,
  locationId: string | null
) {
  let query = supabaseAdmin
    .from('reminders')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  query = locationId ? query.eq('location_id', locationId) : query.is('location_id', null);

  const { data } = await query.maybeSingle();
  return data ?? null;
}

async function getLastReminderTimestamp(
  supabaseAdmin: SupabaseClient,
  employeeId: string,
  locationId: string | null
): Promise<string | null> {
  let query = supabaseAdmin
    .from('reminders')
    .select('last_reminded_at')
    .eq('employee_id', employeeId)
    .order('last_reminded_at', { ascending: false })
    .limit(1);

  query = locationId ? query.eq('location_id', locationId) : query.is('location_id', null);

  const { data } = await query.maybeSingle();
  return toIsoString(data?.last_reminded_at);
}

async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  payload: Record<string, unknown>
): Promise<{
  status: 'sent' | 'partial' | 'failed';
  successCount: number;
  failureCount: number;
  details: any[];
}> {
  let successCount = 0;
  let failureCount = 0;
  const details: any[] = [];

  for (const chunk of chunkArray(tokens, 100)) {
    const messages = chunk.map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: payload,
      priority: 'high',
      channelId: 'default',
    }));

    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const json = await response.json().catch(() => ({}));
      const responseData = Array.isArray(json?.data)
        ? json.data
        : json?.data
          ? [json.data]
          : [];

      responseData.forEach((entry: any) => {
        if (entry?.status === 'ok') {
          successCount += 1;
        } else {
          failureCount += 1;
        }
      });

      if (responseData.length === 0) {
        failureCount += messages.length;
      }

      details.push({
        responseStatus: response.status,
        data: responseData,
        errors: json?.errors ?? null,
      });
    } catch (error: any) {
      failureCount += messages.length;
      details.push({
        error: error?.message || 'Unknown push error',
      });
    }
  }

  const status =
    failureCount === 0
      ? 'sent'
      : successCount === 0
        ? 'failed'
        : 'partial';

  return { status, successCount, failureCount, details };
}

export async function sendEmployeeReminder(
  supabaseAdmin: SupabaseClient,
  input: SendEmployeeReminderInput
): Promise<SendEmployeeReminderResult> {
  const settings = await getReminderSystemSettings(supabaseAdmin);
  const nowIso = new Date().toISOString();

  const { data: employee } = await supabaseAdmin
    .from('users')
    .select('id, name, email, role, default_location_id')
    .eq('id', input.employeeId)
    .maybeSingle();

  if (!employee || employee.role !== 'employee') {
    throw new Error('Employee not found.');
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('notifications_enabled, is_suspended')
    .eq('id', employee.id)
    .maybeSingle();

  if (profile?.is_suspended) {
    throw new Error('Cannot remind suspended employees.');
  }

  const notificationsEnabled = profile?.notifications_enabled !== false;
  const locationId = input.locationId ?? employee.default_location_id ?? null;
  const latestOrder = await getLatestOrderForEmployee(supabaseAdmin, employee.id);

  let activeReminder = await getActiveReminderForEmployee(supabaseAdmin, employee.id, locationId);
  activeReminder = await resolveStaleReminderIfNeeded(supabaseAdmin, employee.id, activeReminder, latestOrder);

  const reminderRateLimitMinutes = settings.reminderRateLimitMinutes;
  const lastRemindedAt = activeReminder?.last_reminded_at
    ? toIsoString(activeReminder.last_reminded_at)
    : await getLastReminderTimestamp(supabaseAdmin, employee.id, locationId);

  if (!input.overrideRateLimit && lastRemindedAt) {
    const elapsedMinutes = minutesBetween(nowIso, lastRemindedAt);
    if (elapsedMinutes < reminderRateLimitMinutes) {
      const retryAfterSeconds = Math.max(1, (reminderRateLimitMinutes - elapsedMinutes) * 60);
      throw new ReminderRateLimitError(
        `Reminder was sent recently. Try again in ${reminderRateLimitMinutes - elapsedMinutes} minute(s).`,
        retryAfterSeconds
      );
    }
  }

  let reminderRow: any = null;
  let eventType: 'sent' | 'reminded_again' = 'sent';

  if (activeReminder) {
    const nextCount = Math.max(1, Number(activeReminder.reminder_count ?? 1) + 1);
    const { data: updatedReminder, error: updateError } = await supabaseAdmin
      .from('reminders')
      .update({
        manager_id: input.managerId,
        last_reminded_at: nowIso,
        reminder_count: nextCount,
      })
      .eq('id', activeReminder.id)
      .select('*')
      .single();

    if (updateError || !updatedReminder) {
      throw new Error(updateError?.message || 'Failed to update reminder thread.');
    }

    reminderRow = updatedReminder;
    eventType = 'reminded_again';
  } else {
    const { data: createdReminder, error: createError } = await supabaseAdmin
      .from('reminders')
      .insert({
        employee_id: employee.id,
        manager_id: input.managerId,
        location_id: locationId,
        status: 'active',
        created_at: nowIso,
        last_reminded_at: nowIso,
        reminder_count: 1,
      })
      .select('*')
      .single();

    if (createError || !createdReminder) {
      throw new Error(createError?.message || 'Failed to create reminder thread.');
    }

    reminderRow = createdReminder;
  }

  const shouldAttemptInApp = input.channels?.in_app !== false;
  const pushChannelRequested = input.channels?.push !== false;
  const shouldAttemptPush = pushChannelRequested && notificationsEnabled;
  const channelsAttempted: string[] = [];

  const reminderTitle = 'Order reminder';
  const reminderBody =
    typeof input.message === 'string' && input.message.trim().length > 0
      ? input.message.trim()
      : 'Please submit your order when you have a moment.';

  let inAppNotificationId: string | null = null;
  if (shouldAttemptInApp) {
    channelsAttempted.push('in_app');
    const { data: notificationRow, error: notificationError } = await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: employee.id,
        title: reminderTitle,
        body: reminderBody,
        notification_type: 'employee_reminder',
        payload: {
          reminder_id: reminderRow.id,
          source: input.source ?? 'manual',
          location_id: locationId,
          manager_id: input.managerId,
        },
      })
      .select('id')
      .single();

    if (notificationError) {
      throw new Error(notificationError.message || 'Failed to create in-app notification.');
    }

    inAppNotificationId = notificationRow?.id ?? null;
  }

  const pushResult: SendEmployeeReminderResult['push'] = {
    attempted: false,
    status: 'not_requested',
    tokenCount: 0,
    successCount: 0,
    failureCount: 0,
  };

  if (pushChannelRequested) {
    if (!notificationsEnabled) {
      pushResult.attempted = false;
      pushResult.status = 'not_delivered_push_disabled';
    } else {
      channelsAttempted.push('push');
      pushResult.attempted = true;

      const { data: pushTokensRaw } = await supabaseAdmin
        .from('device_push_tokens')
        .select('expo_push_token')
        .eq('user_id', employee.id)
        .eq('active', true)
        .order('updated_at', { ascending: false });

      const tokens = (pushTokensRaw ?? [])
        .map((row: any) => sanitizeExpoPushToken(row?.expo_push_token))
        .filter((token: string | null): token is string => Boolean(token));

      pushResult.tokenCount = tokens.length;

      if (tokens.length === 0) {
        pushResult.status = 'no_tokens';
      } else {
        const pushDelivery = await sendExpoPush(tokens, reminderTitle, reminderBody, {
          type: 'employee_reminder',
          reminder_id: reminderRow.id,
          source: input.source ?? 'manual',
          location_id: locationId,
        });
        pushResult.status = pushDelivery.status;
        pushResult.successCount = pushDelivery.successCount;
        pushResult.failureCount = pushDelivery.failureCount;
        pushResult.details = pushDelivery.details;
      }
    }
  }

  const { data: reminderEvent, error: eventError } = await supabaseAdmin
    .from('reminder_events')
    .insert({
      reminder_id: reminderRow.id,
      event_type: eventType,
      sent_at: nowIso,
      channels_attempted: channelsAttempted,
      delivery_result: {
        source: input.source ?? 'manual',
        notifications_enabled: notificationsEnabled,
        in_app_notification_id: inAppNotificationId,
        push: pushResult,
      },
    })
    .select('*')
    .single();

  if (eventError) {
    throw new Error(eventError.message || 'Failed to store reminder event.');
  }

  return {
    reminder: reminderRow,
    event: reminderEvent,
    inAppNotificationId,
    channelsAttempted,
    notificationsEnabled,
    push: pushResult,
    settings,
  };
}
