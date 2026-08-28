// Tip entry data endpoint for entry sessions: read today's slot, save
// (upsert) an entry with its people, and run the anomaly check at save time.
// All access is scoped to the session's location. Managers use the dashboard
// with real Supabase auth + RLS instead of this function.

// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { tipCorsHeadersForRequest } from '../_shared/cors.ts';
import {
  businessDateFor,
  checkAnomaly,
  defaultMealPeriod,
  deriveShiftAmounts,
  fetchScheduledIds,
  hasNegativeAmount,
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
    headers: { ...tipCorsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

function parseMeal(value: unknown): 'lunch' | 'dinner' | null {
  return value === 'lunch' || value === 'dinner' ? value : null;
}

async function loadSlot(locationId: string, businessDate: string, meal: string) {
  const { data, error } = await supabaseAdmin
    .from('tip_entries')
    .select('id, business_date, meal_period, cash_amount, card_amount, gratuity_amount, entered_scope, raw_cash_amount, raw_card_amount, raw_gratuity_amount, note, split_count, entry_method, voice_variant, corrections_count, entered_by, flagged_anomaly, updated_at, tip_entry_people(tip_employee_id, share_weight)')
    .eq('location_id', locationId)
    .eq('business_date', businessDate)
    .eq('meal_period', meal)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const people: Array<{ id: string; weight: number }> = (data.tip_entry_people ?? []).map(
    (row: { tip_employee_id: string; share_weight: unknown }) => ({
      id: row.tip_employee_id,
      weight: Number(row.share_weight),
    }),
  );
  return {
    id: data.id,
    businessDate: data.business_date,
    meal: data.meal_period,
    cash: Number(data.cash_amount),
    card: Number(data.card_amount),
    gratuity: Number(data.gratuity_amount),
    enteredScope: data.entered_scope === 'day' ? 'day' : 'shift',
    rawCash: Number(data.raw_cash_amount ?? data.cash_amount),
    rawCard: Number(data.raw_card_amount ?? data.card_amount),
    rawGratuity: Number(data.raw_gratuity_amount ?? data.gratuity_amount),
    note: data.note ?? null,
    splitCount: data.split_count,
    entryMethod: data.entry_method,
    voiceVariant: data.voice_variant,
    correctionsCount: data.corrections_count,
    enteredBy: data.entered_by,
    flaggedAnomaly: data.flagged_anomaly,
    updatedAt: data.updated_at,
    peopleIds: people.map((person) => person.id),
    people,
  };
}

async function fetchToday(locationId: string, businessDate: string, now: Date) {
  const { data, error } = await supabaseAdmin
    .from('tip_entries')
    .select('meal_period, cash_amount, card_amount, gratuity_amount')
    .eq('location_id', locationId)
    .eq('business_date', businessDate);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    meal_period: string;
    cash_amount: unknown;
    card_amount: unknown;
    gratuity_amount: unknown;
  }>;
  const meals = new Set(rows.map((row) => row.meal_period));
  const lunchRow = rows.find((row) => row.meal_period === 'lunch');
  return {
    businessDate,
    lunchRecorded: meals.has('lunch'),
    dinnerRecorded: meals.has('dinner'),
    defaultMeal: defaultMealPeriod(now),
    lunch: lunchRow
      ? {
        cash: Number(lunchRow.cash_amount),
        card: Number(lunchRow.card_amount),
        gratuity: Number(lunchRow.gratuity_amount),
      }
      : null,
  };
}

/**
 * Employee ids scheduled for (location, business date, meal), intersected
 * with the active roster so deactivated or moved staff never come back
 * pre-selected on the phone.
 */
async function scheduledRosterIds(locationId: string, businessDate: string, meal: 'lunch' | 'dinner') {
  const scheduled = await fetchScheduledIds(supabaseAdmin, locationId, businessDate, meal);
  if (scheduled.size === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('tip_employees')
    .select('id')
    .eq('active', true)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .in('id', [...scheduled]);
  if (error) {
    console.warn('[tip-entries] scheduled roster fetch failed', error);
    return [];
  }
  return (data ?? []).map((row: { id: string }) => row.id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: tipCorsHeadersForRequest(req) });
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

  // Warm-up ping (no session needed): fired while the phone is still on the
  // scan screen so the isolate is hot before the first real request.
  if (body.action === 'ping') {
    return json(req, { ok: true });
  }

  const session = await validateTipSession(
    supabaseAdmin,
    typeof body.sessionToken === 'string' ? body.sessionToken : null,
  );
  if (!session) {
    return json(req, { ok: false, code: 'session_invalid', error: 'Session expired. Scan the QR code again.' }, 401);
  }

  const action = typeof body.action === 'string' ? body.action : '';

  try {
    if (action === 'get_slot') {
      const meal = parseMeal(body.meal);
      if (!meal) return json(req, { ok: false, error: 'Invalid meal period' }, 400);
      const now = new Date();
      const businessDate = businessDateFor(now);
      const [entry, scheduledIds, today] = await Promise.all([
        loadSlot(session.location_id, businessDate, meal),
        scheduledRosterIds(session.location_id, businessDate, meal),
        fetchToday(session.location_id, businessDate, now),
      ]);
      return json(req, { ok: true, businessDate, entry, scheduledIds, today });
    }

    if (action === 'save') {
      const meal = parseMeal(body.meal);
      const cash = normalizeAmount(body.cash);
      const card = normalizeAmount(body.card);
      const gratuity = normalizeAmount(body.gratuity === undefined ? 0 : body.gratuity);
      const enteredScope = body.enteredScope === undefined
        ? 'shift'
        : body.enteredScope === 'shift' || body.enteredScope === 'day'
        ? body.enteredScope
        : null;
      const trimmedNote = typeof body.note === 'string'
        ? body.note.trim().slice(0, 280).trim()
        : '';
      const note = trimmedNote || null;
      const confirmAnomaly = body.confirmAnomaly === true;
      const entryMethod = body.entryMethod === 'voice' ? 'voice' : 'typed';
      const voiceVariant =
        body.voiceVariant === 'waveform' ||
        body.voiceVariant === 'live_transcript' ||
        body.voiceVariant === 'local_live'
          ? body.voiceVariant
          : null;
      const correctionsCount =
        typeof body.correctionsCount === 'number' && Number.isFinite(body.correctionsCount)
          ? Math.max(0, Math.min(50, Math.round(body.correctionsCount)))
          : 0;

      if (!meal) return json(req, { ok: false, error: 'Invalid meal period' }, 400);
      if (cash === null || card === null || gratuity === null) {
        return json(req, { ok: false, error: 'Amounts must be between $0 and $99,999.' }, 400);
      }
      if (!enteredScope) {
        return json(req, { ok: false, error: 'Invalid entered scope' }, 400);
      }

      const rawPeopleIds = Array.isArray(body.peopleIds) ? body.peopleIds : [];
      const rawWeights = body.weights === undefined
        ? rawPeopleIds.map(() => 1)
        : body.weights;
      if (
        !Array.isArray(rawWeights) ||
        rawWeights.length !== rawPeopleIds.length ||
        !rawWeights.every(
          (weight) =>
            typeof weight === 'number' && Number.isFinite(weight) && weight > 0 && weight <= 1,
        )
      ) {
        return json(req, {
          ok: false,
          code: 'bad_weights',
          error: 'Each selected person needs a share greater than 0% and no more than 100%.',
        }, 400);
      }

      // Filter invalid ids and dedupe in lockstep with their positional
      // weights. The first occurrence wins, matching Set's prior behavior.
      const uniquePeople: string[] = [];
      const uniqueWeights: number[] = [];
      const seenPeople = new Set<string>();
      rawPeopleIds.forEach((id, index) => {
        if (typeof id !== 'string' || !UUID_PATTERN.test(id) || seenPeople.has(id)) return;
        seenPeople.add(id);
        uniquePeople.push(id);
        uniqueWeights.push(rawWeights[index] as number);
      });
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
      let lunch: { cash: number; card: number; gratuity: number } | null = null;
      if (enteredScope === 'day') {
        const { data: lunchRow, error: lunchError } = await supabaseAdmin
          .from('tip_entries')
          .select('cash_amount, card_amount, gratuity_amount')
          .eq('location_id', session.location_id)
          .eq('business_date', businessDate)
          .eq('meal_period', 'lunch')
          .maybeSingle();
        if (lunchError) throw lunchError;
        if (lunchRow) {
          lunch = {
            cash: Number(lunchRow.cash_amount),
            card: Number(lunchRow.card_amount),
            gratuity: Number(lunchRow.gratuity_amount),
          };
        }
      }

      const typedAmounts = { cash, card, gratuity };
      const { derived } = deriveShiftAmounts(typedAmounts, enteredScope, lunch);
      if (hasNegativeAmount(derived)) {
        return json(req, {
          ok: false,
          code: 'negative_after_lunch',
          error: 'Lunch already recorded more than this. Check the Square report.',
        }, 400);
      }
      const missingLunch = enteredScope === 'day' && lunch === null;

      // Phase 2: anomaly check against trailing history for this slot,
      // excluding today's row (it's the one being edited).
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
      const anomaly = checkAnomaly(history, derived.cash, derived.card);
      let statisticalReason: string | null = null;
      if (anomaly.flagged) {
        if (!confirmAnomaly) {
          return json(req, { ok: false, needsConfirm: true, anomaly });
        }
        statisticalReason = anomaly.fields
          .map((f) => `${f.field} $${f.value.toFixed(2)} vs typical $${f.typicalLow}-$${f.typicalHigh} (max ever $${f.maxEver.toFixed(0)})`)
          .join('; ');
      }
      const flaggedAnomaly = missingLunch || anomaly.flagged;
      const anomalyReason = [
        missingLunch ? 'day_total_no_lunch' : null,
        statisticalReason,
      ].filter((reason): reason is string => reason !== null).join('; ') || null;

      // Atomic upsert + people replacement (single transaction in SQL) so a
      // failed people insert or two concurrent saves can't leave a slot with
      // a mixed or missing roster.
      const { error: saveError } = await supabaseAdmin.rpc('tip_save_entry', {
        p_business_date: businessDate,
        p_location_id: session.location_id,
        p_meal_period: meal,
        p_cash: derived.cash,
        p_card: derived.card,
        p_gratuity: derived.gratuity,
        p_entered_scope: enteredScope,
        p_raw_cash: cash,
        p_raw_card: card,
        p_raw_gratuity: gratuity,
        p_people: uniquePeople,
        p_weights: uniqueWeights,
        p_note: note,
        p_entry_method: entryMethod,
        p_voice_variant: entryMethod === 'voice' ? voiceVariant : null,
        p_corrections: correctionsCount,
        p_entered_by: session.closer_id,
        p_flagged: flaggedAnomaly,
        p_anomaly_reason: anomalyReason,
        p_session_id: session.id,
      });
      if (saveError?.code === 'P0001' && saveError.message === 'already_recorded') {
        const mealLabel = `${meal[0].toUpperCase()}${meal.slice(1)}`;
        return json(req, {
          ok: false,
          code: 'already_recorded',
          error: `${mealLabel} for today is already recorded on another device. Ask a manager if it needs a fix.`,
        }, 409);
      }
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
