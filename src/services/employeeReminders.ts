import { supabase } from '@/lib/supabase';

export type EmployeeReminderState = 'ok' | 'overdue' | 'reminder_active';

export interface ReminderThreadSummary {
  id: string;
  locationId: string | null;
  managerId: string | null;
  createdAt: string | null;
  lastRemindedAt: string | null;
  reminderCount: number;
}

export interface EmployeeReminderStatusRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  locationId: string | null;
  locationName: string;
  locationShortCode: string | null;
  lastOrderAt: string | null;
  lastActivityAt: string | null;
  daysSinceLastOrder: number | null;
  status: EmployeeReminderState;
  notificationsEnabled: boolean;
  notificationsOff: boolean;
  activeReminder: ReminderThreadSummary | null;
  isSuspended: boolean;
}

export interface EmployeeReminderOverview {
  employees: EmployeeReminderStatusRow[];
  stats: {
    pendingReminders: number;
    overdueEmployees: number;
    notificationsOff: number;
  };
  settings: {
    overdueThresholdDays: number;
    reminderRateLimitMinutes: number;
    recurringWindowMinutes: number;
  };
  generatedAt: string;
}

export interface SendReminderResult {
  success: boolean;
  reminder: {
    id: string;
    reminder_count: number;
    status: string;
    last_reminded_at: string;
    created_at: string;
  };
  event: {
    id: string;
    event_type: string;
    channels_attempted: string[];
    delivery_result: Record<string, unknown>;
    sent_at: string;
  };
  push: {
    attempted: boolean;
    status: string;
    tokenCount: number;
    successCount: number;
    failureCount: number;
  };
  notificationsEnabled: boolean;
  inAppNotificationId: string | null;
  settings: {
    reminderRateLimitMinutes: number;
  };
}

export interface RecurringReminderRule {
  id: string;
  scope: 'employee' | 'location';
  employee_id: string | null;
  location_id: string | null;
  days_of_week: number[];
  time_of_day: string;
  timezone: string;
  condition_type: 'no_order_today' | 'days_since_last_order_gte';
  condition_value: number | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  channels: {
    push?: boolean;
    in_app?: boolean;
  };
  enabled: boolean;
  created_by: string;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderSystemSettings {
  id?: string;
  org_id: string;
  overdue_threshold_days: number;
  reminder_rate_limit_minutes: number;
  recurring_window_minutes: number;
  updated_at: string;
}

export interface ReminderDeliveryEvent {
  id: string;
  event_type: string;
  sent_at: string;
  channels_attempted: string[];
  delivery_result: Record<string, unknown>;
  reminder: {
    id: string;
    employee_id: string;
    manager_id: string | null;
    location_id: string | null;
    employee_name?: string | null;
  };
}

export class ReminderServiceError extends Error {
  code?: string;
  retryAfterSeconds?: number;
  status?: number;

  constructor(
    message: string,
    options?: {
      code?: string;
      retryAfterSeconds?: number;
      status?: number;
    }
  ) {
    super(message);
    this.name = 'ReminderServiceError';
    this.code = options?.code;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.status = options?.status;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const db = supabase as any;

function isoOrNull(value: any): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function daysSince(lastOrderIso: string | null): number | null {
  if (!lastOrderIso) return null;
  const orderDate = new Date(lastOrderIso);
  if (Number.isNaN(orderDate.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const orderStart = new Date(orderDate);
  orderStart.setHours(0, 0, 0, 0);
  const diff = now.getTime() - orderStart.getTime();
  return diff < 0 ? 0 : Math.floor(diff / (1000 * 60 * 60 * 24));
}

async function loadSettings(): Promise<{
  overdueThresholdDays: number;
  reminderRateLimitMinutes: number;
  recurringWindowMinutes: number;
}> {
  const { data } = await db
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

// ---------------------------------------------------------------------------
// listEmployeesWithReminderStatus — direct DB (no Edge Function required)
// ---------------------------------------------------------------------------

export async function listEmployeesWithReminderStatus(params?: {
  locationId?: string | null;
  includeManagers?: boolean;
  overdueThresholdDays?: number;
}): Promise<EmployeeReminderOverview> {
  const settings = await loadSettings();
  const overdueThresholdDays = params?.overdueThresholdDays ?? settings.overdueThresholdDays;

  // 1. Fetch employees
  let usersQuery = db
    .from('users')
    .select('id, name, email, role, default_location_id, created_at')
    .order('name', { ascending: true });

  if (params?.includeManagers) {
    usersQuery = usersQuery.in('role', ['employee', 'manager']);
  } else {
    usersQuery = usersQuery.eq('role', 'employee');
  }

  if (params?.locationId) {
    usersQuery = usersQuery.eq('default_location_id', params.locationId);
  }

  const { data: users, error: usersError } = await usersQuery;
  if (usersError) {
    throw new ReminderServiceError(usersError.message || 'Unable to load users.');
  }

  const userRows: any[] = users ?? [];
  const userIds = userRows.map((r: any) => r.id);

  if (userIds.length === 0) {
    return {
      employees: [],
      stats: { pendingReminders: 0, overdueEmployees: 0, notificationsOff: 0 },
      settings: {
        overdueThresholdDays,
        reminderRateLimitMinutes: settings.reminderRateLimitMinutes,
        recurringWindowMinutes: settings.recurringWindowMinutes,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // 2. Parallel fetch: profiles, locations, latest orders, active reminders
  const [profilesRes, locationsRes, ordersRes, remindersRes] = await Promise.all([
    db
      .from('profiles')
      .select('id, notifications_enabled, is_suspended, last_active_at, last_order_at')
      .in('id', userIds),
    db
      .from('locations')
      .select('id, name, short_code')
      .eq('active', true),
    db
      .from('orders')
      .select('id, user_id, location_id, created_at, status')
      .in('user_id', userIds)
      .neq('status', 'draft')
      .order('created_at', { ascending: false }),
    db
      .from('reminders')
      .select('id, employee_id, manager_id, location_id, created_at, last_reminded_at, reminder_count, status')
      .in('employee_id', userIds)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
  ]);

  const profiles: any[] = profilesRes.data ?? [];
  const locations: any[] = locationsRes.data ?? [];
  const orders: any[] = ordersRes.data ?? [];
  const activeRemindersRaw: any[] = remindersRes.data ?? [];

  const profileById = new Map(profiles.map((r: any) => [r.id, r]));
  const locationById = new Map(locations.map((r: any) => [r.id, r]));

  // Latest order per user
  const latestOrderByUserId = new Map<string, any>();
  for (const order of orders) {
    if (!latestOrderByUserId.has(order.user_id)) {
      latestOrderByUserId.set(order.user_id, order);
    }
  }

  // Active reminders — auto-resolve stale ones
  let pendingReminderCount = 0;
  const activeReminderByEmployeeId = new Map<string, any>();

  for (const reminder of activeRemindersRaw) {
    const employeeId = reminder.employee_id;
    const latestOrder = latestOrderByUserId.get(employeeId);

    if (latestOrder?.created_at) {
      const latestOrderAt = new Date(latestOrder.created_at).getTime();
      const reminderCreatedAt = new Date(reminder.created_at).getTime();

      if (
        !Number.isNaN(latestOrderAt) &&
        !Number.isNaN(reminderCreatedAt) &&
        latestOrderAt > reminderCreatedAt
      ) {
        // Auto-resolve via security-definer RPC
        db.rpc('resolve_active_reminders_for_employee', {
          p_employee_id: employeeId,
          p_order_created_at: latestOrder.created_at,
          p_order_id: latestOrder.id ?? null,
        }).catch(() => {});
        continue;
      }
    }

    pendingReminderCount += 1;
    if (!activeReminderByEmployeeId.has(employeeId)) {
      activeReminderByEmployeeId.set(employeeId, reminder);
    }
  }

  // 3. Build employee rows
  const employees: EmployeeReminderStatusRow[] = userRows.map((userRow: any) => {
    const profile = profileById.get(userRow.id);
    const defaultLocation = userRow.default_location_id
      ? locationById.get(userRow.default_location_id)
      : null;
    const latestOrder = latestOrderByUserId.get(userRow.id);
    const latestOrderAt =
      isoOrNull(latestOrder?.created_at) ?? isoOrNull(profile?.last_order_at);
    const latestActivityAt = isoOrNull(profile?.last_active_at);
    const employeeDaysSince = daysSince(latestOrderAt);
    const activeReminder = activeReminderByEmployeeId.get(userRow.id) ?? null;
    const notificationsEnabled = profile?.notifications_enabled !== false;

    let status: EmployeeReminderState = 'ok';
    if (activeReminder) {
      status = 'reminder_active';
    } else if (employeeDaysSince == null || employeeDaysSince >= overdueThresholdDays) {
      status = 'overdue';
    }

    const latestLocation = latestOrder?.location_id
      ? locationById.get(latestOrder.location_id)
      : null;
    const locationName =
      defaultLocation?.name || latestLocation?.name || 'Unassigned';

    return {
      userId: userRow.id,
      name: userRow.name || userRow.email || 'Unknown',
      email: userRow.email,
      role: userRow.role,
      locationId: userRow.default_location_id,
      locationName,
      locationShortCode:
        defaultLocation?.short_code || latestLocation?.short_code || null,
      lastOrderAt: latestOrderAt,
      lastActivityAt: latestActivityAt,
      daysSinceLastOrder: employeeDaysSince,
      status,
      notificationsEnabled,
      notificationsOff: !notificationsEnabled,
      activeReminder: activeReminder
        ? {
            id: activeReminder.id,
            locationId: activeReminder.location_id,
            managerId: activeReminder.manager_id,
            createdAt: isoOrNull(activeReminder.created_at),
            lastRemindedAt: isoOrNull(activeReminder.last_reminded_at),
            reminderCount: Number(activeReminder.reminder_count ?? 1),
          }
        : null,
      isSuspended: Boolean(profile?.is_suspended),
    };
  });

  const overdueEmployees = employees.filter((e) => e.status === 'overdue').length;
  const notificationsOff = employees.filter((e) => e.notificationsOff).length;

  return {
    employees,
    stats: { pendingReminders: pendingReminderCount, overdueEmployees, notificationsOff },
    settings: {
      overdueThresholdDays,
      reminderRateLimitMinutes: settings.reminderRateLimitMinutes,
      recurringWindowMinutes: settings.recurringWindowMinutes,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// sendReminder — direct DB with optional Edge Function push
// ---------------------------------------------------------------------------

export async function sendReminder(params: {
  employeeId: string;
  locationId?: string | null;
  message?: string;
  overrideRateLimit?: boolean;
  source?: 'manual' | 'manual_repeat' | 'recurring' | 'system';
  channels?: {
    push?: boolean;
    in_app?: boolean;
  };
}): Promise<SendReminderResult> {
  // Try Edge Function first (it handles push notifications server-side)
  try {
    const { data, error } = await supabase.functions.invoke('send-reminder', {
      body: {
        employeeId: params.employeeId,
        locationId: params.locationId ?? null,
        message: params.message,
        overrideRateLimit: Boolean(params.overrideRateLimit),
        source: params.source ?? 'manual',
        channels: params.channels,
      },
    });

    if (!error) {
      const typedData = data as SendReminderResult | null;
      if (typedData?.success) {
        return typedData;
      }
    }

    // If edge function returned a structured rate-limit error, propagate it
    if (error) {
      const parsed = await parseFunctionError(error);
      if (parsed.code === 'RATE_LIMITED') {
        throw new ReminderServiceError(
          parsed.message || 'Reminder was sent recently.',
          parsed
        );
      }
    }
  } catch (e: any) {
    // Re-throw rate limit errors
    if (e instanceof ReminderServiceError && e.code === 'RATE_LIMITED') {
      throw e;
    }
    // Fall through to direct DB path
  }

  // ----- Direct DB fallback (works without Edge Functions) -----
  return sendReminderDirect(params);
}

async function sendReminderDirect(params: {
  employeeId: string;
  locationId?: string | null;
  message?: string;
  overrideRateLimit?: boolean;
  source?: 'manual' | 'manual_repeat' | 'recurring' | 'system';
  channels?: {
    push?: boolean;
    in_app?: boolean;
  };
}): Promise<SendReminderResult> {
  const settings = await loadSettings();
  const nowIso = new Date().toISOString();
  const locationId = params.locationId ?? null;
  const source = params.source ?? 'manual';

  // Check for existing active reminder
  let activeQuery = db
    .from('reminders')
    .select('*')
    .eq('employee_id', params.employeeId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  activeQuery = locationId
    ? activeQuery.eq('location_id', locationId)
    : activeQuery.is('location_id', null);

  const { data: activeReminder } = await activeQuery.maybeSingle();

  // Rate limiting
  const lastRemindedAt = activeReminder?.last_reminded_at
    ? isoOrNull(activeReminder.last_reminded_at)
    : null;

  if (!params.overrideRateLimit && lastRemindedAt) {
    const elapsedMs = Date.now() - new Date(lastRemindedAt).getTime();
    const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
    if (elapsedMinutes < settings.reminderRateLimitMinutes) {
      const remaining = settings.reminderRateLimitMinutes - elapsedMinutes;
      throw new ReminderServiceError(
        `Reminder was sent recently. Try again in ${remaining} minute(s).`,
        {
          code: 'RATE_LIMITED',
          retryAfterSeconds: Math.max(1, remaining * 60),
        }
      );
    }
  }

  // Get current user (manager) id
  const { data: { user: authUser } } = await supabase.auth.getUser();
  const managerId = authUser?.id ?? null;

  let reminderRow: any;
  let eventType: 'sent' | 'reminded_again' = 'sent';

  if (activeReminder) {
    const nextCount = Math.max(1, Number(activeReminder.reminder_count ?? 1) + 1);
    const { data: updated, error: updateError } = await db
      .from('reminders')
      .update({
        manager_id: managerId,
        last_reminded_at: nowIso,
        reminder_count: nextCount,
      })
      .eq('id', activeReminder.id)
      .select('*')
      .single();

    if (updateError || !updated) {
      throw new ReminderServiceError(
        updateError?.message || 'Failed to update reminder.'
      );
    }
    reminderRow = updated;
    eventType = 'reminded_again';
  } else {
    const { data: created, error: createError } = await db
      .from('reminders')
      .insert({
        employee_id: params.employeeId,
        manager_id: managerId,
        location_id: locationId,
        status: 'active',
        created_at: nowIso,
        last_reminded_at: nowIso,
        reminder_count: 1,
      })
      .select('*')
      .single();

    if (createError || !created) {
      throw new ReminderServiceError(
        createError?.message || 'Failed to create reminder.'
      );
    }
    reminderRow = created;
  }

  // Create in-app notification for the employee
  const reminderTitle = 'Order reminder';
  const reminderBody =
    typeof params.message === 'string' && params.message.trim().length > 0
      ? params.message.trim()
      : 'Please submit your order when you have a moment.';

  let inAppNotificationId: string | null = null;
  if (params.channels?.in_app !== false) {
    const { data: notifRow } = await db
      .from('notifications')
      .insert({
        user_id: params.employeeId,
        title: reminderTitle,
        body: reminderBody,
        notification_type: 'employee_reminder',
        payload: {
          reminder_id: reminderRow.id,
          source,
          location_id: locationId,
          manager_id: managerId,
        },
      })
      .select('id')
      .single();

    inAppNotificationId = notifRow?.id ?? null;
  }

  // Log event
  const channelsAttempted = ['in_app'];
  const { data: eventRow } = await db
    .from('reminder_events')
    .insert({
      reminder_id: reminderRow.id,
      event_type: eventType,
      sent_at: nowIso,
      channels_attempted: channelsAttempted,
      delivery_result: {
        source,
        in_app_notification_id: inAppNotificationId,
        push: { attempted: false, status: 'edge_function_unavailable' },
      },
    })
    .select('*')
    .single();

  return {
    success: true,
    reminder: {
      id: reminderRow.id,
      reminder_count: reminderRow.reminder_count,
      status: reminderRow.status,
      last_reminded_at: reminderRow.last_reminded_at,
      created_at: reminderRow.created_at,
    },
    event: {
      id: eventRow?.id ?? '',
      event_type: eventType,
      channels_attempted: channelsAttempted,
      delivery_result: eventRow?.delivery_result ?? {},
      sent_at: nowIso,
    },
    push: {
      attempted: false,
      status: 'edge_function_unavailable',
      tokenCount: 0,
      successCount: 0,
      failureCount: 0,
    },
    notificationsEnabled: true,
    inAppNotificationId,
    settings: {
      reminderRateLimitMinutes: settings.reminderRateLimitMinutes,
    },
  };
}

// ---------------------------------------------------------------------------
// parseFunctionError (shared helper for edge function error parsing)
// ---------------------------------------------------------------------------

async function parseFunctionError(error: unknown): Promise<{
  message: string | null;
  code?: string;
  retryAfterSeconds?: number;
  status?: number;
}> {
  let message: string | null = null;
  let code: string | undefined;
  let retryAfterSeconds: number | undefined;
  let status: number | undefined;

  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: any }).context;

    if (context && typeof context === 'object') {
      if (typeof context.status === 'number') {
        status = context.status;
      }
      if (typeof context.error === 'string') {
        message = context.error;
      }
      if (typeof context.code === 'string') {
        code = context.code;
      }
      if (typeof context.retryAfterSeconds === 'number') {
        retryAfterSeconds = context.retryAfterSeconds;
      }

      if (typeof context.json === 'function') {
        try {
          const payload = await context.json();
          if (typeof payload?.error === 'string') {
            message = payload.error;
          }
          if (typeof payload?.code === 'string') {
            code = payload.code;
          }
          if (typeof payload?.retryAfterSeconds === 'number') {
            retryAfterSeconds = payload.retryAfterSeconds;
          }
        } catch {
          // ignored
        }
      }
    }
  }

  if (!message && error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string') {
      message = value;
    }
  }

  return { message, code, retryAfterSeconds, status };
}

// ---------------------------------------------------------------------------
// Remaining functions (already work directly against DB)
// ---------------------------------------------------------------------------

export async function evaluateRecurringReminderRules(params?: { dryRun?: boolean }) {
  const { data, error } = await supabase.functions.invoke('evaluate-recurring-reminders', {
    body: { dryRun: Boolean(params?.dryRun) },
  });

  if (error) {
    const parsed = await parseFunctionError(error);
    throw new ReminderServiceError(
      parsed.message || 'Unable to evaluate recurring reminders.',
      parsed
    );
  }

  return (data as Record<string, unknown> | null) ?? {};
}

export async function listRecurringReminderRules(): Promise<RecurringReminderRule[]> {
  const { data, error } = await db
    .from('recurring_reminder_rules')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message || 'Unable to load recurring rules.');
  }

  return (data ?? []) as RecurringReminderRule[];
}

export async function upsertRecurringReminderRule(
  input: Omit<RecurringReminderRule, 'id' | 'created_at' | 'updated_at' | 'last_triggered_at'> & { id?: string }
): Promise<RecurringReminderRule> {
  const payload = {
    ...(input.id ? { id: input.id } : {}),
    scope: input.scope,
    employee_id: input.employee_id,
    location_id: input.location_id,
    days_of_week: input.days_of_week,
    time_of_day: input.time_of_day,
    timezone: input.timezone,
    condition_type: input.condition_type,
    condition_value: input.condition_value,
    quiet_hours_enabled: input.quiet_hours_enabled,
    quiet_hours_start: input.quiet_hours_start,
    quiet_hours_end: input.quiet_hours_end,
    channels: input.channels,
    enabled: input.enabled,
    created_by: input.created_by,
  };

  const { data, error } = await db
    .from('recurring_reminder_rules')
    .upsert(payload)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Unable to save recurring rule.');
  }

  return data as RecurringReminderRule;
}

export async function deleteRecurringReminderRule(ruleId: string): Promise<void> {
  const { error } = await db
    .from('recurring_reminder_rules')
    .delete()
    .eq('id', ruleId);

  if (error) {
    throw new Error(error.message || 'Unable to delete recurring rule.');
  }
}

export async function getReminderSystemSettings(): Promise<ReminderSystemSettings | null> {
  const { data, error } = await db
    .from('reminder_system_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Unable to load reminder settings.');
  }

  return (data ?? null) as ReminderSystemSettings | null;
}

export async function updateReminderSystemSettings(patch: {
  overdue_threshold_days?: number;
  reminder_rate_limit_minutes?: number;
  recurring_window_minutes?: number;
}): Promise<ReminderSystemSettings> {
  const existing = await getReminderSystemSettings();
  let query = db
    .from('reminder_system_settings')
    .update(patch);

  if (existing?.id) {
    query = query.eq('id', existing.id);
  } else if (existing?.org_id) {
    query = query.eq('org_id', existing.org_id);
  } else {
    throw new Error('Reminder settings row not found.');
  }

  const { data, error } = await query
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Unable to update reminder settings.');
  }

  return data as ReminderSystemSettings;
}

export async function listReminderDeliveryEvents(limit = 50): Promise<ReminderDeliveryEvent[]> {
  const { data, error } = await db
    .from('reminder_events')
    .select(`
      id,
      event_type,
      sent_at,
      channels_attempted,
      delivery_result,
      reminder:reminders(
        id,
        employee_id,
        manager_id,
        location_id,
        employee:users!reminders_employee_id_fkey(name)
      )
    `)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message || 'Unable to load reminder delivery events.');
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    event_type: row.event_type,
    sent_at: row.sent_at,
    channels_attempted: Array.isArray(row.channels_attempted) ? row.channels_attempted : [],
    delivery_result: typeof row.delivery_result === 'object' && row.delivery_result ? row.delivery_result : {},
    reminder: {
      id: row.reminder?.id,
      employee_id: row.reminder?.employee_id,
      manager_id: row.reminder?.manager_id,
      location_id: row.reminder?.location_id,
      employee_name: row.reminder?.employee?.name ?? null,
    },
  }));
}
