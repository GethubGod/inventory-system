// @ts-nocheck
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import {
  buildChecklistOrderDayMessage,
  isExpoDeviceNotRegistered,
  type ChecklistLocationGroup,
  type ChecklistReminderMessage,
} from './reminderDelivery.ts';

export {
  buildChecklistOrderDayMessage,
  isExpoDeviceNotRegistered,
  type ChecklistLocationGroup,
  type ChecklistReminderMessage,
} from './reminderDelivery.ts';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';

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
    deliveryOutcome: 'accepted' | 'failed' | null;
    receiptIds: string[];
    errorDetail: string | null;
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

/**
 * Resolves the message at delivery time, rather than trusting a count supplied
 * when the rule was created. A missing checklist is normal during rollout, so
 * it keeps the scheduled order-day reminder useful with a generic message.
 */
export async function getChecklistOrderDayReminderMessage(
  supabaseAdmin: SupabaseClient,
  employeeId: string,
  locationGroup: ChecklistLocationGroup
): Promise<ChecklistReminderMessage> {
  const { data: checklist, error: checklistError } = await supabaseAdmin
    .from('order_checklists')
    .select('id')
    .eq('user_id', employeeId)
    .eq('location_group', locationGroup)
    .maybeSingle();

  if (checklistError) {
    throw new Error(checklistError.message || 'Unable to load the order checklist.');
  }

  if (!checklist?.id) {
    return {
      body: buildChecklistOrderDayMessage(locationGroup, null),
      uncheckedDefaultItemCount: null,
      checklistFound: false,
    };
  }

  const { count, error: itemCountError } = await supabaseAdmin
    .from('order_checklist_items')
    .select('id', { count: 'exact', head: true })
    .eq('checklist_id', checklist.id)
    .eq('default_checked', false);

  if (itemCountError) {
    throw new Error(itemCountError.message || 'Unable to count unchecked checklist items.');
  }

  const uncheckedDefaultItemCount = Math.max(0, Number(count ?? 0) || 0);
  return {
    body: buildChecklistOrderDayMessage(locationGroup, uncheckedDefaultItemCount),
    uncheckedDefaultItemCount,
    checklistFound: true,
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

type ExpoPushDelivery = {
  token: string;
  status: 'accepted' | 'failed';
  receiptStatus: 'accepted' | 'failed' | 'pending' | null;
  receiptId: string | null;
  errorDetail: string | null;
};

function expoErrorDetail(value: any, fallback: string): string {
  const detail = value?.details?.error;
  const message = value?.message;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (typeof message === 'string' && message.trim()) {
    return message.trim().replace(/(?:Exponent|Expo)PushToken\[[^\]]+\]/g, '[redacted Expo token]');
  }
  return fallback;
}

async function markExpoTokensInactive(
  supabaseAdmin: SupabaseClient,
  employeeId: string,
  tokens: string[]
): Promise<string | null> {
  const invalidTokens = [...new Set(tokens.filter(Boolean))];
  if (invalidTokens.length === 0) return null;

  const { error } = await supabaseAdmin
    .from('device_push_tokens')
    .update({ active: false })
    .eq('user_id', employeeId)
    .in('expo_push_token', invalidTokens);

  return error?.message || null;
}

async function sendExpoPush(
  supabaseAdmin: SupabaseClient,
  employeeId: string,
  tokens: string[],
  title: string,
  body: string,
  payload: Record<string, unknown>
): Promise<{
  status: 'sent' | 'partial' | 'failed';
  successCount: number;
  failureCount: number;
  deliveryOutcome: 'accepted' | 'failed';
  receiptIds: string[];
  errorDetail: string | null;
  details: any[];
}> {
  const deliveries: ExpoPushDelivery[] = [];
  const details: any[] = [];
  const deviceNotRegisteredTokens = new Set<string>();

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

      chunk.forEach((token, index) => {
        const ticket = responseData[index];
        if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id.trim()) {
          deliveries.push({
            token,
            status: 'accepted',
            receiptStatus: 'pending',
            receiptId: ticket.id,
            errorDetail: null,
          });
          return;
        }

        if (isExpoDeviceNotRegistered(ticket)) {
          deviceNotRegisteredTokens.add(token);
        }
        deliveries.push({
          token,
          status: 'failed',
          receiptStatus: null,
          receiptId: null,
          errorDetail: expoErrorDetail(ticket ?? json, 'Expo did not return a push ticket.'),
        });
      });

      details.push({
        responseStatus: response.status,
        tickets: responseData.map((ticket: any) => ({
          status: ticket?.status ?? null,
          id: typeof ticket?.id === 'string' ? ticket.id : null,
          error: typeof ticket?.details?.error === 'string' ? ticket.details.error : null,
        })),
        errors: json?.errors ?? null,
      });
    } catch (error: any) {
      const errorDetail = error?.message || 'Unknown push error';
      chunk.forEach((token) => {
        deliveries.push({
          token,
          status: 'failed',
          receiptStatus: null,
          receiptId: null,
          errorDetail,
        });
      });
      details.push({ error: errorDetail });
    }
  }

  const receiptIds = deliveries
    .map((delivery) => delivery.receiptId)
    .filter((receiptId): receiptId is string => Boolean(receiptId));
  const deliveryByReceiptId = new Map(
    deliveries
      .filter((delivery) => delivery.receiptId)
      .map((delivery) => [delivery.receiptId as string, delivery])
  );

  // Expo receipts can take several minutes to appear. This immediate pass
  // records known failures now; absent receipts remain accepted/pending in the
  // event details instead of being misclassified as delivery failures.
  for (const receiptChunk of chunkArray(receiptIds, 1000)) {
    try {
      const response = await fetch(EXPO_PUSH_RECEIPTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ ids: receiptChunk }),
      });
      const json = await response.json().catch(() => ({}));
      const receiptData = json?.data && typeof json.data === 'object' ? json.data : {};

      receiptChunk.forEach((receiptId) => {
        const delivery = deliveryByReceiptId.get(receiptId);
        const receipt = receiptData[receiptId];
        if (!delivery || !receipt) return;

        if (receipt.status === 'ok') {
          delivery.receiptStatus = 'accepted';
          return;
        }

        delivery.status = 'failed';
        delivery.receiptStatus = 'failed';
        delivery.errorDetail = expoErrorDetail(receipt, 'Expo rejected the push receipt.');
        if (isExpoDeviceNotRegistered(receipt)) {
          deviceNotRegisteredTokens.add(delivery.token);
        }
      });

      details.push({
        receiptResponseStatus: response.status,
        receipts: receiptData,
        receiptErrors: json?.errors ?? null,
      });
    } catch (error: any) {
      details.push({ receiptCheckError: error?.message || 'Unable to check Expo push receipts.' });
    }
  }

  const inactiveTokenUpdateError = await markExpoTokensInactive(
    supabaseAdmin,
    employeeId,
    [...deviceNotRegisteredTokens]
  );
  if (inactiveTokenUpdateError) {
    details.push({ tokenHygieneError: inactiveTokenUpdateError });
  }

  const successCount = deliveries.filter((delivery) => delivery.status === 'accepted').length;
  const failureCount = deliveries.length - successCount;
  const status =
    failureCount === 0
      ? 'sent'
      : successCount === 0
        ? 'failed'
        : 'partial';
  const errorDetails = deliveries
    .map((delivery) => delivery.errorDetail)
    .filter((errorDetail): errorDetail is string => Boolean(errorDetail));
  if (inactiveTokenUpdateError) errorDetails.push(`Token hygiene update failed: ${inactiveTokenUpdateError}`);

  details.push({
    deliveries: deliveries.map(({ token: _token, ...delivery }) => delivery),
    deviceNotRegisteredTokenCount: deviceNotRegisteredTokens.size,
  });

  return {
    status,
    successCount,
    failureCount,
    deliveryOutcome: failureCount > 0 ? 'failed' : 'accepted',
    receiptIds,
    errorDetail: errorDetails.length > 0 ? errorDetails.join('; ') : null,
    details,
  };
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
    deliveryOutcome: null,
    receiptIds: [],
    errorDetail: null,
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
        const pushDelivery = await sendExpoPush(
          supabaseAdmin,
          employee.id,
          tokens,
          reminderTitle,
          reminderBody,
          {
            type: 'employee_reminder',
            reminder_id: reminderRow.id,
            source: input.source ?? 'manual',
            location_id: locationId,
          }
        );
        pushResult.status = pushDelivery.status;
        pushResult.successCount = pushDelivery.successCount;
        pushResult.failureCount = pushDelivery.failureCount;
        pushResult.deliveryOutcome = pushDelivery.deliveryOutcome;
        pushResult.receiptIds = pushDelivery.receiptIds;
        pushResult.errorDetail = pushDelivery.errorDetail;
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
      push_delivery_status: pushResult.deliveryOutcome,
      expo_push_receipt_ids: pushResult.receiptIds,
      push_error_detail: pushResult.errorDetail,
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
