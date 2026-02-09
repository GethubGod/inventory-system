// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';
import { getReminderSystemSettings, getRequesterFromToken } from '../_shared/reminders.ts';

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

function isoOrNull(value: any): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysSince(lastOrderIso: string | null): number | null {
  if (!lastOrderIso) return null;
  const orderDate = new Date(lastOrderIso);
  if (Number.isNaN(orderDate.getTime())) return null;

  const now = startOfDay(new Date());
  const orderStart = startOfDay(orderDate);
  const diff = now.getTime() - orderStart.getTime();
  return diff < 0 ? 0 : Math.floor(diff / (1000 * 60 * 60 * 24));
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
  const requester = await getRequesterFromToken(supabaseAdmin, token);

  if (!requester) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (requester.suspended) {
    return jsonResponse({ error: 'Suspended accounts cannot access reminders' }, 403);
  }

  if (requester.role !== 'manager') {
    return jsonResponse({ error: 'Only managers can access employee reminders' }, 403);
  }

  let locationId: string | null = null;
  let includeManagers = false;
  let overrideThreshold: number | null = null;

  try {
    const payload = await req.json().catch(() => ({}));
    locationId =
      typeof payload?.locationId === 'string' && payload.locationId.trim().length > 0
        ? payload.locationId.trim()
        : null;
    includeManagers = Boolean(payload?.includeManagers);
    if (typeof payload?.overdueThresholdDays === 'number' && Number.isFinite(payload.overdueThresholdDays)) {
      overrideThreshold = Math.max(1, Math.min(60, Math.floor(payload.overdueThresholdDays)));
    }
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const settings = await getReminderSystemSettings(supabaseAdmin);
  const overdueThresholdDays = overrideThreshold ?? settings.overdueThresholdDays;

  let usersQuery = supabaseAdmin
    .from('users')
    .select('id, name, email, role, default_location_id, created_at')
    .order('name', { ascending: true });

  if (includeManagers) {
    usersQuery = usersQuery.in('role', ['employee', 'manager']);
  } else {
    usersQuery = usersQuery.eq('role', 'employee');
  }

  if (locationId) {
    usersQuery = usersQuery.eq('default_location_id', locationId);
  }

  const { data: users, error: usersError } = await usersQuery;
  if (usersError) {
    return jsonResponse({ error: usersError.message || 'Unable to load users' }, 500);
  }

  const userRows = users ?? [];
  const userIds = userRows.map((row: any) => row.id);

  if (userIds.length === 0) {
    return jsonResponse({
      employees: [],
      stats: {
        pendingReminders: 0,
        overdueEmployees: 0,
        notificationsOff: 0,
      },
      settings: {
        overdueThresholdDays,
        reminderRateLimitMinutes: settings.reminderRateLimitMinutes,
        recurringWindowMinutes: settings.recurringWindowMinutes,
      },
    });
  }

  const [{ data: profiles }, { data: locations }, { data: orders }, { data: activeRemindersRaw }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, notifications_enabled, is_suspended, last_active_at, last_order_at')
      .in('id', userIds),
    supabaseAdmin
      .from('locations')
      .select('id, name, short_code')
      .eq('active', true),
    supabaseAdmin
      .from('orders')
      .select('id, user_id, location_id, created_at, status')
      .in('user_id', userIds)
      .neq('status', 'draft')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('reminders')
      .select('id, employee_id, manager_id, location_id, created_at, last_reminded_at, reminder_count, status')
      .in('employee_id', userIds)
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
  ]);

  const profileByUserId = new Map((profiles ?? []).map((row: any) => [row.id, row]));
  const locationById = new Map((locations ?? []).map((row: any) => [row.id, row]));

  const latestOrderByUserId = new Map<string, any>();
  for (const order of orders ?? []) {
    if (!latestOrderByUserId.has(order.user_id)) {
      latestOrderByUserId.set(order.user_id, order);
    }
  }

  let pendingReminderCount = 0;
  const activeReminderByEmployeeId = new Map<string, any>();
  for (const reminder of activeRemindersRaw ?? []) {
    const employeeId = reminder.employee_id;
    const latestOrder = latestOrderByUserId.get(employeeId);

    if (latestOrder?.created_at) {
      const latestOrderAt = new Date(latestOrder.created_at).getTime();
      const reminderCreatedAt = new Date(reminder.created_at).getTime();

      if (!Number.isNaN(latestOrderAt) && !Number.isNaN(reminderCreatedAt) && latestOrderAt > reminderCreatedAt) {
        await supabaseAdmin.rpc('resolve_active_reminders_for_employee', {
          p_employee_id: employeeId,
          p_order_created_at: latestOrder.created_at,
          p_order_id: latestOrder.id,
        });
        continue;
      }
    }

    pendingReminderCount += 1;
    if (!activeReminderByEmployeeId.has(employeeId)) {
      activeReminderByEmployeeId.set(employeeId, reminder);
    }
  }

  const employees = userRows.map((userRow: any) => {
    const profile = profileByUserId.get(userRow.id);
    const defaultLocation = userRow.default_location_id ? locationById.get(userRow.default_location_id) : null;
    const latestOrder = latestOrderByUserId.get(userRow.id);
    const latestOrderAt = isoOrNull(latestOrder?.created_at) ?? isoOrNull(profile?.last_order_at);
    const latestActivityAt = isoOrNull(profile?.last_active_at);
    const employeeDaysSince = daysSince(latestOrderAt);
    const activeReminder = activeReminderByEmployeeId.get(userRow.id) ?? null;
    const notificationsEnabled = profile?.notifications_enabled !== false;

    let status: 'ok' | 'overdue' | 'reminder_active' = 'ok';
    if (activeReminder) {
      status = 'reminder_active';
    } else if (employeeDaysSince == null || employeeDaysSince >= overdueThresholdDays) {
      status = 'overdue';
    }

    const latestLocation = latestOrder?.location_id ? locationById.get(latestOrder.location_id) : null;
    const locationName = defaultLocation?.name || latestLocation?.name || 'Unassigned';

    return {
      userId: userRow.id,
      name: userRow.name || userRow.email || 'Unknown',
      email: userRow.email,
      role: userRow.role,
      locationId: userRow.default_location_id,
      locationName,
      locationShortCode: defaultLocation?.short_code || latestLocation?.short_code || null,
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

  const overdueEmployees = employees.filter((employee: any) => employee.status === 'overdue').length;
  const notificationsOff = employees.filter((employee: any) => employee.notificationsOff).length;

  return jsonResponse({
    employees,
    stats: {
      pendingReminders: pendingReminderCount,
      overdueEmployees,
      notificationsOff,
    },
    settings: {
      overdueThresholdDays,
      reminderRateLimitMinutes: settings.reminderRateLimitMinutes,
      recurringWindowMinutes: settings.recurringWindowMinutes,
    },
    generatedAt: new Date().toISOString(),
  });
});
