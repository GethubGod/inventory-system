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

export async function listEmployeesWithReminderStatus(params?: {
  locationId?: string | null;
  includeManagers?: boolean;
  overdueThresholdDays?: number;
}): Promise<EmployeeReminderOverview> {
  const { data, error } = await supabase.functions.invoke<EmployeeReminderOverview>(
    'list-employees-with-status',
    {
      body: {
        locationId: params?.locationId ?? null,
        includeManagers: Boolean(params?.includeManagers),
        overdueThresholdDays: params?.overdueThresholdDays,
      },
    }
  );

  if (error) {
    const parsed = await parseFunctionError(error);
    throw new ReminderServiceError(
      parsed.message || 'Unable to load employee reminder status.',
      parsed
    );
  }

  return {
    employees: data?.employees ?? [],
    stats: data?.stats ?? {
      pendingReminders: 0,
      overdueEmployees: 0,
      notificationsOff: 0,
    },
    settings: data?.settings ?? {
      overdueThresholdDays: 7,
      reminderRateLimitMinutes: 15,
      recurringWindowMinutes: 15,
    },
    generatedAt: data?.generatedAt ?? new Date().toISOString(),
  };
}

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
  const { data, error } = await supabase.functions.invoke<SendReminderResult>('send-reminder', {
    body: {
      employeeId: params.employeeId,
      locationId: params.locationId ?? null,
      message: params.message,
      overrideRateLimit: Boolean(params.overrideRateLimit),
      source: params.source ?? 'manual',
      channels: params.channels,
    },
  });

  if (error) {
    const parsed = await parseFunctionError(error);
    throw new ReminderServiceError(
      parsed.message || 'Unable to send reminder.',
      parsed
    );
  }

  if (!data?.success) {
    throw new Error('Unable to send reminder.');
  }

  return data;
}

export async function evaluateRecurringReminderRules(params?: { dryRun?: boolean }) {
  const { data, error } = await supabase.functions.invoke<Record<string, unknown>>(
    'evaluate-recurring-reminders',
    {
      body: { dryRun: Boolean(params?.dryRun) },
    }
  );

  if (error) {
    const parsed = await parseFunctionError(error);
    throw new ReminderServiceError(
      parsed.message || 'Unable to evaluate recurring reminders.',
      parsed
    );
  }

  return data ?? {};
}

export async function listRecurringReminderRules(): Promise<RecurringReminderRule[]> {
  const db = supabase as any;
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
  const db = supabase as any;

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
  const db = supabase as any;
  const { error } = await db
    .from('recurring_reminder_rules')
    .delete()
    .eq('id', ruleId);

  if (error) {
    throw new Error(error.message || 'Unable to delete recurring rule.');
  }
}

export async function getReminderSystemSettings(): Promise<ReminderSystemSettings | null> {
  const db = supabase as any;
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
  const db = supabase as any;
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
  const db = supabase as any;
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
