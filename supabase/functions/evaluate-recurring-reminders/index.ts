// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  ReminderRateLimitError,
  getReminderSystemSettings,
  getRequesterFromToken,
  sendEmployeeReminder,
} from '../_shared/reminders.ts';

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};
  parts.forEach((part) => {
    values[part.type] = part.value;
  });

  const weekdayShort = values.weekday || 'Sun';

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: WEEKDAY_MAP[weekdayShort] ?? 0,
    dateKey: `${values.year}-${values.month}-${values.day}`,
  };
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value || typeof value !== 'string') return null;
  const cleaned = value.trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isTimeInRange(nowMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function toDateKeyInTimezone(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return getZonedParts(date, timeZone).dateKey;
}

function daysBetweenDateKeys(a: string, b: string): number {
  const [aYear, aMonth, aDay] = a.split('-').map(Number);
  const [bYear, bMonth, bDay] = b.split('-').map(Number);
  const aMs = Date.UTC(aYear, aMonth - 1, aDay);
  const bMs = Date.UTC(bYear, bMonth - 1, bDay);
  return Math.max(0, Math.floor((aMs - bMs) / (1000 * 60 * 60 * 24)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.replace('Bearer ', '').trim();
  let authorized = false;
  let actorUserId: string | null = null;

  if (token === serviceRoleKey) {
    authorized = true;
  } else {
    const requester = await getRequesterFromToken(supabaseAdmin, token);
    if (!requester) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (requester.suspended) {
      return jsonResponse({ error: 'Suspended accounts cannot run reminders' }, 403);
    }
    if (requester.role !== 'manager') {
      return jsonResponse({ error: 'Only managers can run recurring reminders' }, 403);
    }
    authorized = true;
    actorUserId = requester.userId;
  }

  if (!authorized) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let dryRun = false;
  try {
    const payload = await req.json().catch(() => ({}));
    dryRun = Boolean(payload?.dryRun);
  } catch {
    // ignore invalid body and continue with defaults
  }

  const settings = await getReminderSystemSettings(supabaseAdmin);
  const now = new Date();

  const { data: rules, error: rulesError } = await supabaseAdmin
    .from('recurring_reminder_rules')
    .select('*')
    .eq('enabled', true)
    .order('created_at', { ascending: true });

  if (rulesError) {
    return jsonResponse({ error: rulesError.message || 'Unable to load recurring rules' }, 500);
  }

  const enabledRules = rules ?? [];
  if (enabledRules.length === 0) {
    return jsonResponse({
      success: true,
      evaluatedRules: 0,
      dueRules: 0,
      remindersSent: 0,
      skippedByCondition: 0,
      skippedByRateLimit: 0,
      dryRun,
    });
  }

  const employeeIdsFromRules = new Set<string>();
  const locationIdsFromRules = new Set<string>();
  enabledRules.forEach((rule: any) => {
    if (rule.scope === 'employee' && rule.employee_id) employeeIdsFromRules.add(rule.employee_id);
    if (rule.scope === 'location' && rule.location_id) locationIdsFromRules.add(rule.location_id);
  });

  const { data: allEmployees, error: employeeError } = await supabaseAdmin
    .from('users')
    .select('id, name, email, default_location_id, role')
    .eq('role', 'employee');

  if (employeeError) {
    return jsonResponse({ error: employeeError.message || 'Unable to load employees' }, 500);
  }

  const employees = (allEmployees ?? []).filter((employee: any) => {
    if (employeeIdsFromRules.size > 0 && employeeIdsFromRules.has(employee.id)) return true;
    if (locationIdsFromRules.size > 0 && employee.default_location_id && locationIdsFromRules.has(employee.default_location_id)) {
      return true;
    }
    return false;
  });

  const employeeById = new Map(employees.map((row: any) => [row.id, row]));
  const employeesByLocation = new Map<string, any[]>();
  employees.forEach((employee: any) => {
    const key = employee.default_location_id || '__none__';
    const list = employeesByLocation.get(key) || [];
    list.push(employee);
    employeesByLocation.set(key, list);
  });

  const targetEmployeeIds = employees.map((employee: any) => employee.id);
  const latestOrderByEmployeeId = new Map<string, any>();

  if (targetEmployeeIds.length > 0) {
    const { data: recentOrders } = await supabaseAdmin
      .from('orders')
      .select('id, user_id, location_id, created_at, status')
      .in('user_id', targetEmployeeIds)
      .neq('status', 'draft')
      .order('created_at', { ascending: false });

    (recentOrders ?? []).forEach((order: any) => {
      if (!latestOrderByEmployeeId.has(order.user_id)) {
        latestOrderByEmployeeId.set(order.user_id, order);
      }
    });
  }

  let evaluatedRules = 0;
  let dueRules = 0;
  let remindersSent = 0;
  let skippedByCondition = 0;
  let skippedByRateLimit = 0;
  const errors: { ruleId: string; employeeId?: string; message: string }[] = [];

  for (const rule of enabledRules) {
    evaluatedRules += 1;

    const timezone = typeof rule.timezone === 'string' && rule.timezone ? rule.timezone : 'America/Los_Angeles';
    const nowParts = getZonedParts(now, timezone);
    const nowMinutes = nowParts.hour * 60 + nowParts.minute;
    const scheduledMinutes = parseTimeToMinutes(rule.time_of_day);

    if (scheduledMinutes == null) {
      errors.push({ ruleId: rule.id, message: 'Invalid rule time_of_day' });
      continue;
    }

    const daysOfWeek = Array.isArray(rule.days_of_week)
      ? rule.days_of_week.map((value: any) => Number(value)).filter((value: number) => Number.isInteger(value))
      : [];

    if (!daysOfWeek.includes(nowParts.weekday)) {
      continue;
    }

    const windowMinutes = Math.max(1, Number(settings.recurringWindowMinutes || 15));
    if (!(nowMinutes >= scheduledMinutes && nowMinutes < scheduledMinutes + windowMinutes)) {
      continue;
    }

    const lastTriggeredDateKey = toDateKeyInTimezone(rule.last_triggered_at, timezone);
    if (lastTriggeredDateKey === nowParts.dateKey) {
      continue;
    }

    if (rule.quiet_hours_enabled) {
      const quietStart = parseTimeToMinutes(rule.quiet_hours_start);
      const quietEnd = parseTimeToMinutes(rule.quiet_hours_end);
      if (quietStart != null && quietEnd != null && isTimeInRange(nowMinutes, quietStart, quietEnd)) {
        continue;
      }
    }

    dueRules += 1;

    const candidateEmployees =
      rule.scope === 'employee'
        ? (rule.employee_id && employeeById.has(rule.employee_id) ? [employeeById.get(rule.employee_id)] : [])
        : employeesByLocation.get(rule.location_id || '__none__') || [];

    for (const employee of candidateEmployees) {
      if (!employee) continue;

      const latestOrder = latestOrderByEmployeeId.get(employee.id) ?? null;
      const lastOrderDateKey = toDateKeyInTimezone(latestOrder?.created_at, timezone);

      let conditionMet = false;
      if (rule.condition_type === 'no_order_today') {
        conditionMet = !lastOrderDateKey || lastOrderDateKey !== nowParts.dateKey;
      } else {
        const thresholdDays = Math.max(0, Number(rule.condition_value ?? 0));
        if (!lastOrderDateKey) {
          conditionMet = true;
        } else {
          const elapsedDays = daysBetweenDateKeys(nowParts.dateKey, lastOrderDateKey);
          conditionMet = elapsedDays >= thresholdDays;
        }
      }

      if (!conditionMet) {
        skippedByCondition += 1;
        continue;
      }

      if (dryRun) {
        remindersSent += 1;
        continue;
      }

      try {
        const channelConfig =
          rule.channels && typeof rule.channels === 'object'
            ? {
                push:
                  typeof rule.channels.push === 'boolean'
                    ? rule.channels.push
                    : true,
                in_app:
                  typeof rule.channels.in_app === 'boolean'
                    ? rule.channels.in_app
                    : true,
              }
            : { push: true, in_app: true };

        await sendEmployeeReminder(supabaseAdmin, {
          employeeId: employee.id,
          managerId: rule.created_by || actorUserId,
          locationId: rule.scope === 'location' ? rule.location_id : employee.default_location_id,
          source: 'recurring',
          overrideRateLimit: false,
          channels: channelConfig,
        });
        remindersSent += 1;
      } catch (error: any) {
        if (error instanceof ReminderRateLimitError) {
          skippedByRateLimit += 1;
          continue;
        }

        errors.push({
          ruleId: rule.id,
          employeeId: employee.id,
          message: error?.message || 'Failed to send recurring reminder',
        });
      }
    }

    if (!dryRun) {
      await supabaseAdmin
        .from('recurring_reminder_rules')
        .update({ last_triggered_at: new Date().toISOString() })
        .eq('id', rule.id);
    }
  }

  return jsonResponse({
    success: true,
    evaluatedRules,
    dueRules,
    remindersSent,
    skippedByCondition,
    skippedByRateLimit,
    errors,
    dryRun,
  });
});
