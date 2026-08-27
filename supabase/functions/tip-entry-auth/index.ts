// Tip entry session endpoint: validates QR/NFC tokens server-side and rate
// limited via a SQL RPC, mints shift-scoped location sessions, and serves
// session state ("Who's closing?" roster, today's recorded slots). Modeled on
// validate-access-code.
//
// Entry sessions are attribution + location scoping only; they never grant
// manager data. All queries here run with the service role and are scoped to
// the session's location_id.

// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeadersForRequest } from '../_shared/cors.ts';
import {
  businessDateFor,
  clientIdentifier,
  defaultMealPeriod,
  fetchScheduledIds,
  randomToken,
  sha256Hex,
  validateTipSession,
} from '../_shared/tips.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const FAILURE_DELAY_MS = 350;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchRoster(locationId: string) {
  const { data, error } = await supabaseAdmin
    .from('tip_employees')
    .select('id, name, location_id')
    .eq('active', true)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.warn('[tip-entry-auth] roster fetch failed', error);
    return [];
  }
  return (data ?? []).map((row: { id: string; name: string }) => ({ id: row.id, name: row.name }));
}

async function fetchToday(locationId: string, now: Date = new Date()) {
  const businessDate = businessDateFor(now);
  const { data, error } = await supabaseAdmin
    .from('tip_entries')
    .select('meal_period')
    .eq('location_id', locationId)
    .eq('business_date', businessDate);
  if (error) console.warn('[tip-entry-auth] today fetch failed', error);
  const meals = new Set((data ?? []).map((row: { meal_period: string }) => row.meal_period));
  return {
    businessDate,
    lunchRecorded: meals.has('lunch'),
    dinnerRecorded: meals.has('dinner'),
    defaultMeal: defaultMealPeriod(now),
  };
}

async function mintSession(locationId: string) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const { error } = await supabaseAdmin
    .from('tip_entry_sessions')
    .insert({
      token_hash: tokenHash,
      location_id: locationId,
      expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    });
  if (error) throw new Error(`session insert failed: ${error.message}`);
  return token;
}

async function sessionPayload(locationId: string, locationName: string, closerId: string | null) {
  // businessDate and defaultMeal are computed locally, so all three queries
  // can run in parallel — one DB roundtrip's worth of wall clock, not three.
  const now = new Date();
  const businessDate = businessDateFor(now);
  const defaultMeal = defaultMealPeriod(now);
  // Scheduled = has a manager-set schedule row for today's default meal; the
  // entry form pre-selects these people and floats them to the top.
  const [today, bareRoster, scheduledIds] = await Promise.all([
    fetchToday(locationId, now),
    fetchRoster(locationId),
    fetchScheduledIds(supabaseAdmin, locationId, businessDate, defaultMeal),
  ]);
  const roster = bareRoster.map((row: { id: string; name: string }) => ({
    ...row,
    scheduled: scheduledIds.has(row.id),
  }));
  const closer = closerId ? roster.find((r: { id: string }) => r.id === closerId) ?? null : null;
  return {
    location: { id: locationId, name: locationName },
    roster,
    today,
    closer,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersForRequest(req) });
  }
  if (req.method !== 'POST') {
    return json(req, { error: 'Method not allowed' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'Invalid request body' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';

  // Warm-up ping: the entry pages fire this while the phone is still aiming
  // at the QR code, so the isolate + TLS + preflight are all hot by the time
  // the real validate_token lands. No auth, no DB.
  if (action === 'ping') {
    return json(req, { ok: true });
  }

  const identifierHash = await sha256Hex(clientIdentifier(req));

  try {
    if (action === 'validate_token') {
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      const { data: result, error } = await supabaseAdmin.rpc('tip_validate_entry_token', {
        p_token: token,
        p_identifier_hash: identifierHash,
      });
      if (error) throw error;

      if (!result?.ok || !result.location_id) {
        await delay(FAILURE_DELAY_MS);
        const rateLimited = result?.code === 'rate_limited';
        return json(req, {
          ok: false,
          code: result?.code ?? 'invalid',
          error: rateLimited
            ? 'Too many attempts. Wait a few minutes and try again.'
            : 'This QR code is no longer active. Ask a manager for the new one.',
        }, rateLimited ? 429 : 401);
      }

      // Session mint and payload queries are independent — run them together.
      const [sessionToken, payload] = await Promise.all([
        mintSession(result.location_id),
        sessionPayload(result.location_id, result.location_name ?? '', null),
      ]);

      // Remembered closer: fold what used to be a second set_closer request
      // into this one. Applied only when the remembered location matches the
      // scanned one (shared roster rows have location_id null, so roster
      // membership alone would leak a closer across stores) AND the id is
      // still on the roster — otherwise the client shows the picker.
      const closerId = typeof body.closerId === 'string' ? body.closerId.trim() : '';
      const rememberedLocation =
        typeof body.closerLocationId === 'string' ? body.closerLocationId.trim() : '';
      let closer: { id: string; name: string } | null = null;
      if (UUID_PATTERN.test(closerId) && rememberedLocation === result.location_id) {
        const match = payload.roster.find((r: { id: string }) => r.id === closerId);
        if (match) {
          const tokenHash = await sha256Hex(sessionToken);
          const { error: closerError } = await supabaseAdmin
            .from('tip_entry_sessions')
            .update({ closer_id: closerId })
            .eq('token_hash', tokenHash);
          if (!closerError) closer = match;
        }
      }

      return json(req, { ok: true, sessionToken, ...payload, closer });
    }

    if (action === 'end_session') {
      const session = await validateTipSession(supabaseAdmin, body.sessionToken);
      if (session) {
        const { error } = await supabaseAdmin
          .from('tip_entry_sessions')
          .update({ revoked: true })
          .eq('id', session.id);
        if (error) throw error;
      }
      return json(req, { ok: true });
    }

    // Everything below requires a valid entry session.
    const session = await validateTipSession(supabaseAdmin, body.sessionToken);
    if (!session) {
      return json(req, { ok: false, code: 'session_invalid', error: 'Session expired. Scan the QR code again.' }, 401);
    }

    if (action === 'state') {
      const payload = await sessionPayload(session.location_id, session.location_name, session.closer_id);
      return json(req, { ok: true, ...payload });
    }

    if (action === 'voice_ticket') {
      // Single-use 60s ticket for the live-transcript WebSocket, so the
      // entry session token never appears in a connection URL.
      const ticket = randomToken(24);
      await supabaseAdmin
        .from('tip_ws_tickets')
        .delete()
        .lt('expires_at', new Date().toISOString());
      const { error } = await supabaseAdmin.from('tip_ws_tickets').insert({
        token_hash: await sha256Hex(ticket),
        session_id: session.id,
      });
      if (error) throw error;
      return json(req, { ok: true, ticket });
    }

    if (action === 'set_closer') {
      const closerId = typeof body.closerId === 'string' ? body.closerId.trim() : '';
      if (!UUID_PATTERN.test(closerId)) {
        return json(req, { ok: false, error: 'Invalid closer' }, 400);
      }
      const roster = await fetchRoster(session.location_id);
      if (!roster.some((r: { id: string }) => r.id === closerId)) {
        return json(req, { ok: false, error: 'That person is not on this location\'s roster.' }, 400);
      }
      const { error } = await supabaseAdmin
        .from('tip_entry_sessions')
        .update({ closer_id: closerId })
        .eq('id', session.id);
      if (error) throw error;
      return json(req, { ok: true });
    }

    return json(req, { error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('[tip-entry-auth] failed', error);
    return json(req, { ok: false, error: 'Something went wrong. Try again.' }, 500);
  }
});
