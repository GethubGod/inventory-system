// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  ReminderRateLimitError,
  getRequesterFromToken,
  sendEmployeeReminder,
} from '../_shared/reminders.ts';

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
    return jsonResponse({ error: 'Suspended accounts cannot send reminders' }, 403);
  }

  if (requester.role !== 'manager') {
    return jsonResponse({ error: 'Only managers can send reminders' }, 403);
  }

  let employeeId = '';
  let locationId: string | null = null;
  let message: string | undefined;
  let overrideRateLimit = false;
  let source: 'manual' | 'manual_repeat' | 'recurring' | 'system' = 'manual';
  let channels: { push?: boolean; in_app?: boolean } | undefined;

  try {
    const payload = await req.json();
    employeeId = typeof payload?.employeeId === 'string' ? payload.employeeId.trim() : '';
    locationId =
      typeof payload?.locationId === 'string' && payload.locationId.trim().length > 0
        ? payload.locationId.trim()
        : null;
    message = typeof payload?.message === 'string' ? payload.message : undefined;
    overrideRateLimit = Boolean(payload?.overrideRateLimit);

    if (
      payload?.source === 'manual' ||
      payload?.source === 'manual_repeat' ||
      payload?.source === 'recurring' ||
      payload?.source === 'system'
    ) {
      source = payload.source;
    }

    if (payload?.channels && typeof payload.channels === 'object') {
      channels = {
        push:
          typeof payload.channels.push === 'boolean'
            ? payload.channels.push
            : undefined,
        in_app:
          typeof payload.channels.in_app === 'boolean'
            ? payload.channels.in_app
            : undefined,
      };
    }
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (!employeeId) {
    return jsonResponse({ error: 'employeeId is required' }, 400);
  }

  try {
    const result = await sendEmployeeReminder(supabaseAdmin, {
      employeeId,
      managerId: requester.userId,
      locationId,
      message,
      source,
      overrideRateLimit,
      channels,
    });

    return jsonResponse({
      success: true,
      reminder: result.reminder,
      event: result.event,
      inAppNotificationId: result.inAppNotificationId,
      channelsAttempted: result.channelsAttempted,
      notificationsEnabled: result.notificationsEnabled,
      push: result.push,
      settings: result.settings,
    });
  } catch (error: any) {
    if (error instanceof ReminderRateLimitError) {
      return jsonResponse(
        {
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
          code: 'RATE_LIMITED',
        },
        429
      );
    }

    return jsonResponse({
      error: error?.message || 'Unable to send reminder',
    }, 500);
  }
});
