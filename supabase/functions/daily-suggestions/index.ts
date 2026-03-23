// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';

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

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Unauthorized', status: 401, user: null };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return { error: 'Unauthorized', status: 401, user: null };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_suspended')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.is_suspended) {
    return {
      error: 'Suspended accounts cannot access daily suggestions',
      status: 403,
      user: null,
    };
  }

  return { error: null, status: 200, user };
}

const dayNames = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const authResult = await getAuthenticatedUser(req);
    if (authResult.error || !authResult.user) {
      return jsonResponse({ error: authResult.error || 'Unauthorized' }, authResult.status);
    }

    const payload = await req.json().catch(() => ({}));
    const locationId =
      typeof payload?.locationId === 'string' && payload.locationId.trim().length > 0
        ? payload.locationId.trim()
        : null;

    if (!locationId) {
      return jsonResponse({ error: 'Missing required field: locationId' }, 400);
    }

    const minFrequency =
      typeof payload?.minFrequency === 'number' && Number.isFinite(payload.minFrequency)
        ? Math.max(0, Math.min(1, payload.minFrequency))
        : 0.4;
    const lookbackMonths =
      typeof payload?.lookbackMonths === 'number' && Number.isFinite(payload.lookbackMonths)
        ? Math.max(1, Math.min(24, Math.floor(payload.lookbackMonths)))
        : 6;

    const [suggestionsResult, recentOrdersResult, weekdayOrderCountQuery] = await Promise.all([
      supabaseAdmin.rpc('get_dow_suggestions', {
        p_location_id: locationId,
        p_min_frequency: minFrequency,
        p_lookback_months: lookbackMonths,
      }),
      supabaseAdmin.rpc('get_recent_orders', {
        p_location_id: locationId,
        p_limit: 10,
      }),
      supabaseAdmin
        .from('orders')
        .select('id, created_at')
        .eq('location_id', locationId)
        .eq('status', 'fulfilled')
        .gte(
          'created_at',
          new Date(Date.now() - lookbackMonths * 30 * 24 * 60 * 60 * 1000).toISOString(),
        ),
    ]);

    const { data: suggestionsRaw, error: suggestionsError } = suggestionsResult;
    if (suggestionsError) {
      console.error('daily-suggestions rpc error', suggestionsError);
      return jsonResponse({ error: suggestionsError.message || 'Unable to load suggestions' }, 500);
    }

    const { data: recentOrdersRaw, error: recentOrdersError } = recentOrdersResult;
    if (recentOrdersError) {
      console.error('daily-suggestions recent orders rpc error', recentOrdersError);
      return jsonResponse(
        { error: recentOrdersError.message || 'Unable to load recent orders' },
        500,
      );
    }

    const now = new Date();
    const todayDow = now.getDay();

    if (weekdayOrderCountQuery.error) {
      console.error('daily-suggestions weekday count error', weekdayOrderCountQuery.error);
      return jsonResponse(
        { error: weekdayOrderCountQuery.error.message || 'Unable to load suggestions' },
        500,
      );
    }

    const totalSameDowOrders = (weekdayOrderCountQuery.data || []).filter((order: any) => {
      const createdAt = order?.created_at ? new Date(order.created_at) : null;
      return createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) && createdAt.getDay() === todayDow;
    }).length;

    const suggestionsArray = Array.isArray(suggestionsRaw)
      ? suggestionsRaw
      : typeof suggestionsRaw === 'string'
        ? JSON.parse(suggestionsRaw)
        : [];
    const recentOrders = Array.isArray(recentOrdersRaw)
      ? recentOrdersRaw
      : typeof recentOrdersRaw === 'string'
        ? JSON.parse(recentOrdersRaw)
        : [];

    return jsonResponse({
      suggestions: {
        day_label: dayNames[todayDow],
        total_past_orders: totalSameDowOrders,
        source: 'heuristic',
        items: (suggestionsArray || []).map((suggestion: any) => ({
          item_id: suggestion.item_id,
          item_name: suggestion.item_name,
          suggested_qty: Math.max(1, Math.round(Number(suggestion.suggested_qty ?? 1))),
          unit_type: suggestion.unit_type === 'base' ? 'base' : 'pack',
          unit: suggestion.unit ?? null,
          supplier_name: suggestion.supplier_name ?? null,
          frequency: Number(suggestion.frequency ?? 0),
          times_ordered: Number(suggestion.times_ordered ?? 0),
          total_orders: Number(suggestion.total_orders ?? totalSameDowOrders ?? 0),
          confidence_tier: 'medium',
        })),
      },
      recent_orders: recentOrders,
    });
  } catch (error) {
    console.error('daily-suggestions unexpected error', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
