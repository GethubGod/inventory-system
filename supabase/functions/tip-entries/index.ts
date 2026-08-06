// Tip entry data endpoint for entry sessions: read today's slot, save
// (upsert) an entry with its people, and run the anomaly check at save time.
// All access is scoped to the session's location. Managers use the dashboard
// with real Supabase auth + RLS instead of this function.

// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeadersForRequest } from '../_shared/cors.ts';
import {
  businessDateFor,
  checkAnomaly,
  normalizeAmount,
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANOMALY_HISTORY_LIMIT = 60;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

function parseMeal(value: unknown): 'lunch' | 'dinner' | null {
  return value === 'lunch' || value === 'dinner' ? value : null;
}

async function loadSlot(locationId: string, businessDate: string, meal: string) {
  const { data, error } = await supabaseAdmin
    .from('tip_entries')
    .select('id, business_date, meal_period, cash_amount, card_amount, split_count, entry_method, voice_variant, corrections_count, entered_by, flagged_anomaly, updated_at, tip_entry_people(tip_employee_id)')
    .eq('location_id', locationId)
    .eq('business_date', businessDate)
    .eq('meal_period', meal)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    businessDate: data.business_date,
    meal: data.meal_period,
    cash: Number(data.cash_amount),
    card: Number(data.card_amount),
    splitCount: data.split_count,
    entryMethod: data.entry_method,
    voiceVariant: data.voice_variant,
    correctionsCount: data.corrections_count,
    enteredBy: data.entered_by,
    flaggedAnomaly: data.flagged_anomaly,
    updatedAt: data.updated_at,
    peopleIds: (data.tip_entry_people ?? []).map(
      (row: { tip_employee_id: string }) => row.tip_employee_id,
    ),
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

  const session = await validateTipSession(supabaseAdmin, body.sessionToken);
  if (!session) {
    return json(req, { ok: false, code: 'session_invalid', error: 'Session expired. Scan the sticker again.' }, 401);
  }

  const action = typeof body.action === 'string' ? body.action : '';

  try {
    if (action === 'get_slot') {
      const meal = parseMeal(body.meal);
      if (!meal) return json(req, { ok: false, error: 'Invalid meal period' }, 400);
      const businessDate = businessDateFor(new Date());
      const entry = await loadSlot(session.location_id, businessDate, meal);
      return json(req, { ok: true, businessDate, entry });
    }

    if (action === 'save') {
      const meal = parseMeal(body.meal);
      const cash = normalizeAmount(body.cash);
      const card = normalizeAmount(body.card);
      const confirmAnomaly = body.confirmAnomaly === true;
      const entryMethod = body.entryMethod === 'voice' ? 'voice' : 'typed';
      const voiceVariant =
        body.voiceVariant === 'waveform' || body.voiceVariant === 'live_transcript'
          ? body.voiceVariant
          : null;
      const correctionsCount =
        typeof body.correctionsCount === 'number' && Number.isFinite(body.correctionsCount)
          ? Math.max(0, Math.min(50, Math.round(body.correctionsCount)))
          : 0;

      if (!meal) return json(req, { ok: false, error: 'Invalid meal period' }, 400);
      if (cash === null || card === null) {
        return json(req, { ok: false, error: 'Amounts must be between $0 and $99,999.' }, 400);
      }

      const peopleIds = Array.isArray(body.peopleIds)
        ? body.peopleIds.filter((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id))
        : [];
      const uniquePeople = [...new Set(peopleIds)];
      if (uniquePeople.length < 1 || uniquePeople.length > 30) {
        return json(req, { ok: false, code: 'no_people', error: 'Pick at least one person splitting these tips.' }, 400);
      }

      // Everyone splitting must be active roster at this location (or both).
      const { data: rosterRows, error: rosterError } = await supabaseAdmin
        .from('tip_employees')
        .select('id')
        .eq('active', true)
        .or(`location_id.is.null,location_id.eq.${session.location_id}`)
        .in('id', uniquePeople);
      if (rosterError) throw rosterError;
      if ((rosterRows ?? []).length !== uniquePeople.length) {
        return json(req, { ok: false, error: 'Someone selected is not on this location\'s roster.' }, 400);
      }

      const businessDate = businessDateFor(new Date());

      // Phase 2: anomaly check against trailing history for this slot,
      // excluding today's row (it's the one being edited).
      let anomalyReason: string | null = null;
      let flaggedAnomaly = false;
      const { data: historyRows, error: historyError } = await supabaseAdmin
        .from('tip_entries')
        .select('cash_amount, card_amount')
        .eq('location_id', session.location_id)
        .eq('meal_period', meal)
        .neq('business_date', businessDate)
        .order('business_date', { ascending: false })
        .limit(ANOMALY_HISTORY_LIMIT);
      if (historyError) throw historyError;
      const history = (historyRows ?? []).map(
        (row: { cash_amount: unknown; card_amount: unknown }) => ({
          cash: Number(row.cash_amount),
          card: Number(row.card_amount),
        }),
      );
      const anomaly = checkAnomaly(history, cash, card);
      if (anomaly.flagged) {
        if (!confirmAnomaly) {
          return json(req, { ok: false, needsConfirm: true, anomaly });
        }
        flaggedAnomaly = true;
        anomalyReason = anomaly.fields
          .map((f) => `${f.field} $${f.value.toFixed(2)} vs typical $${f.typicalLow}-$${f.typicalHigh} (max ever $${f.maxEver.toFixed(0)})`)
          .join('; ');
      }

      // Atomic upsert + people replacement (single transaction in SQL) so a
      // failed people insert or two concurrent saves can't leave a slot with
      // a mixed or missing roster.
      const { error: saveError } = await supabaseAdmin.rpc('tip_save_entry', {
        p_business_date: businessDate,
        p_location_id: session.location_id,
        p_meal_period: meal,
        p_cash: cash,
        p_card: card,
        p_people: uniquePeople,
        p_entry_method: entryMethod,
        p_voice_variant: entryMethod === 'voice' ? voiceVariant : null,
        p_corrections: correctionsCount,
        p_entered_by: session.closer_id,
        p_flagged: flaggedAnomaly,
        p_anomaly_reason: anomalyReason,
      });
      if (saveError) throw saveError;

      const entry = await loadSlot(session.location_id, businessDate, meal);
      return json(req, { ok: true, businessDate, entry });
    }

    return json(req, { error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('[tip-entries] failed', error);
    return json(req, { ok: false, error: 'Could not save. Check your connection and try again.' }, 500);
  }
});
