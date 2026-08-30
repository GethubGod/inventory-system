// Shared helpers for the tip-entry edge functions.
//
// The pure logic here (business date, anomaly rule, weighted allocation, day
// scope) MIRRORS the canonical, unit-tested implementations in
// web/src/lib/tips/businessDate.ts, web/src/lib/tips/anomaly.ts,
// web/src/lib/tips/split.ts, and web/src/lib/tips/dayScope.ts. Keep them in
// sync — edge functions cannot import from web/ (separate deploy bundles) and
// vice versa.

// deno-lint-ignore-file no-explicit-any

export const TIPS_TIMEZONE = 'America/Los_Angeles';

/** Session row as read by validateTipSession. */
export interface TipSession {
  id: string;
  location_id: string;
  closer_id: string | null;
  location_name: string;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function randomToken(bytes = 32): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function clientIdentifier(req: Request): string {
  // The LAST x-forwarded-for entry is the one appended by the hosting edge
  // proxy; earlier entries are client-supplied and trivially spoofable, which
  // would let an attacker rotate IPs to dodge the validation rate limit.
  const forwarded = req.headers.get('x-forwarded-for');
  const chain = forwarded?.split(',').map((part) => part.trim()).filter(Boolean) ?? [];
  const ip = chain[chain.length - 1] || req.headers.get('x-real-ip')?.trim() || 'unknown';
  return `${ip}:${req.headers.get('user-agent') ?? ''}`;
}

/**
 * Look up an entry session by its opaque token. Returns null when the token
 * is unknown, revoked, or expired. Touches last_seen_at at most once/hour.
 */
export async function validateTipSession(
  admin: any,
  sessionToken: unknown,
): Promise<TipSession | null> {
  if (typeof sessionToken !== 'string' || sessionToken.length < 16 || sessionToken.length > 128) {
    return null;
  }
  const tokenHash = await sha256Hex(sessionToken);
  const { data, error } = await admin
    .from('tip_entry_sessions')
    .select('id, location_id, closer_id, revoked, expires_at, last_seen_at, locations(name)')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;

  const lastSeen = data.last_seen_at ? new Date(data.last_seen_at).getTime() : 0;
  if (Date.now() - lastSeen > 60 * 60 * 1000) {
    await admin
      .from('tip_entry_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', data.id);
  }

  const locationName =
    (Array.isArray(data.locations) ? data.locations[0]?.name : data.locations?.name) ?? '';
  return {
    id: data.id,
    location_id: data.location_id,
    closer_id: data.closer_id ?? null,
    location_name: String(locationName),
  };
}

/** Session lookup by id (used by the WS ticket exchange). */
export async function getTipSessionById(
  admin: any,
  sessionId: string,
): Promise<TipSession | null> {
  const { data, error } = await admin
    .from('tip_entry_sessions')
    .select('id, location_id, closer_id, revoked, expires_at, locations(name)')
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  const locationName =
    (Array.isArray(data.locations) ? data.locations[0]?.name : data.locations?.name) ?? '';
  return {
    id: data.id,
    location_id: data.location_id,
    closer_id: data.closer_id ?? null,
    location_name: String(locationName),
  };
}

interface LaClock {
  year: number;
  month: number;
  day: number;
  hour: number;
}

function laClock(now: Date): LaClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIPS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // hour12:false can yield "24" for midnight in some engines; normalize.
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24 };
}

/**
 * MIRROR of web/src/lib/tips/businessDate.ts (canonical + unit tested there).
 * The restaurant's business date rolls over at 4am local: a 12:30am entry
 * after Friday dinner still belongs to Friday.
 */
export function businessDateFor(now: Date): string {
  const clock = laClock(now);
  const base = new Date(Date.UTC(clock.year, clock.month - 1, clock.day));
  if (clock.hour < 4) base.setUTCDate(base.getUTCDate() - 1);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Lunch before 4pm LA time; dinner otherwise (incl. the 0-4am tail of last night). */
export function defaultMealPeriod(now: Date): 'lunch' | 'dinner' {
  const { hour } = laClock(now);
  return hour >= 4 && hour < 16 ? 'lunch' : 'dinner';
}

export interface AnomalyFieldFlag {
  field: 'cash' | 'card';
  value: number;
  typicalLow: number;
  typicalHigh: number;
  maxEver: number;
}

export interface AnomalyResult {
  flagged: boolean;
  sampleSize: number;
  fields: AnomalyFieldFlag[];
}

const ANOMALY_MIN_HISTORY = 14;

function percentile(sortedAsc: number[], fraction: number): number {
  if (sortedAsc.length === 0) return 0;
  const index = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.round(fraction * (sortedAsc.length - 1))),
  );
  return sortedAsc[index];
}

/**
 * MIRROR of web/src/lib/tips/anomaly.ts (canonical + unit tested there).
 * Rule (transparent on purpose): with >= 14 historical entries for the same
 * location + meal period, a field is an outlier when it exceeds the largest
 * amount ever recorded for that slot AND is more than 3x the historical
 * median. Never blocks a save — the UI asks for confirmation.
 */
export function checkAnomaly(
  history: Array<{ cash: number; card: number }>,
  cash: number,
  card: number,
): AnomalyResult {
  const result: AnomalyResult = { flagged: false, sampleSize: history.length, fields: [] };
  if (history.length < ANOMALY_MIN_HISTORY) return result;

  for (const field of ['cash', 'card'] as const) {
    const values = history
      .map((h) => (field === 'cash' ? h.cash : h.card))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (values.length < ANOMALY_MIN_HISTORY) continue;
    const value = field === 'cash' ? cash : card;
    const maxEver = values[values.length - 1];
    const median = percentile(values, 0.5);
    const beyondMax = value > maxEver;
    const beyondMedian = median > 0 ? value > 3 * median : value > Math.max(maxEver, 50);
    if (beyondMax && beyondMedian) {
      result.flagged = true;
      result.fields.push({
        field,
        value,
        typicalLow: Math.round(percentile(values, 0.25)),
        typicalHigh: Math.round(percentile(values, 0.75)),
        maxEver,
      });
    }
  }
  return result;
}

/** Round to cents, rejecting bad input. Returns null when invalid. */
export function normalizeAmount(value: unknown): number | null {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) return null;
  if (num < 0 || num >= 100000) return null;
  return Math.round(num * 100) / 100;
}

// Weighted allocation (Tips v3 partial shares). Unlike the legacy equal
// split, the allocated shares must sum to the pool EXACTLY — nothing stays in
// the drawer beyond what largest-remainder cannot avoid (which is nothing).
// Half-up rounding is wrong here: it can pay out more than the pool.
//
// MIRROR of web/src/lib/tips/split.ts (canonical + unit tested there). Keep
// both copies in sync.

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Split poolCents across weights by largest remainder.
 *
 * raw_i = poolCents * w_i / sum(w); everyone gets floor(raw_i); the leftover
 * cents go one at a time to the largest fractional parts, ties broken by the
 * person's position in the split (earlier wins). Returns integer cents,
 * positional with weights, summing exactly to poolCents. A pool of 0 or an
 * empty/zero weight list allocates all zeros.
 */
export function allocatePoolCents(
  poolCents: number,
  weights: number[],
): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (!Number.isFinite(poolCents) || poolCents <= 0 || totalWeight <= 0) {
    return weights.map(() => 0);
  }
  const raw = weights.map((w) => (poolCents * w) / totalWeight);
  const base = raw.map(Math.floor);
  const rest = poolCents - base.reduce((sum, c) => sum + c, 0);
  const order = raw
    .map((value, index) => [value - Math.floor(value), index] as const)
    .sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < rest; k++) {
    base[order[k % order.length][1]] += 1;
  }
  return base;
}

/**
 * The "full share" a weight-1 person takes, in cents, for display: the strip,
 * the ledger's Per person column, and the saved screen all print this.
 * round(poolCents / sum(weights)), half-up — display only; the money that is
 * actually assigned comes from allocatePoolCents.
 */
export function fullShareCents(poolCents: number, weights: number[]): number {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (!Number.isFinite(poolCents) || poolCents <= 0 || totalWeight <= 0) {
    return 0;
  }
  return Math.round(poolCents / totalWeight);
}

// Day-scope subtraction (Tips v3). A dinner entered as "Whole day (Square)"
// stores shift-only figures: what the closer typed minus what lunch already
// recorded, field by field (cash−cash, card−card, gratuity−gratuity), against
// today's lunch row at the same location. The server recomputes this on save
// and is authoritative; the client copy only drives the live receipt and the
// blocking negative warning.
//
// MIRROR of web/src/lib/tips/dayScope.ts (canonical + unit tested there). Keep
// both copies in sync.

export type EnteredScope = 'shift' | 'day';

export interface MealAmounts {
  cash: number;
  card: number;
  gratuity: number;
}

export interface DerivedAmounts {
  /** Shift-only figures in dollars, cent-exact. May be negative. */
  derived: MealAmounts;
  /** True when a lunch row existed and was subtracted. */
  subtracted: boolean;
}

/**
 * Derive the shift-only amounts from what the closer typed.
 *
 * On scope "day" with a lunch row on record, each field is typed − lunch,
 * computed in integer cents. On scope "shift", or on "day" with no lunch
 * recorded (the flagged day_total_no_lunch case), the typed figures pass
 * through unchanged and `subtracted` is false.
 */
export function deriveShiftAmounts(
  typed: MealAmounts,
  scope: EnteredScope,
  lunch: MealAmounts | null,
): DerivedAmounts {
  if (scope !== 'day' || lunch === null) {
    return { derived: { ...typed }, subtracted: false };
  }
  return {
    derived: {
      cash: fromCents(toCents(typed.cash) - toCents(lunch.cash)),
      card: fromCents(toCents(typed.card) - toCents(lunch.card)),
      gratuity: fromCents(toCents(typed.gratuity) - toCents(lunch.gratuity)),
    },
    subtracted: true,
  };
}

/** True when any derived field is negative — the one blocking entry state. */
export function hasNegativeAmount(amounts: MealAmounts): boolean {
  return amounts.cash < 0 || amounts.card < 0 || amounts.gratuity < 0;
}

/**
 * Weekday of a YYYY-MM-DD business date: 0 = Sunday … 6 = Saturday (the JS
 * Date.getDay() convention; tip_employee_schedules.weekday matches). Mirrors
 * weekdayOfBusinessDate in web/src/lib/tips/businessDate.ts.
 */
export function weekdayOfBusinessDate(businessDate: string): number {
  const [y, m, d] = businessDate.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay();
}

/**
 * Employee ids with a tip_employee_schedules row for (location, business
 * date's weekday, meal). Callers intersect this with the active roster —
 * the schedule table alone doesn't know about deactivations or works-at
 * changes.
 */
export async function fetchScheduledIds(
  admin: any,
  locationId: string,
  businessDate: string,
  meal: 'lunch' | 'dinner',
): Promise<Set<string>> {
  const { data, error } = await admin
    .from('tip_employee_schedules')
    .select('tip_employee_id')
    .eq('location_id', locationId)
    .eq('weekday', weekdayOfBusinessDate(businessDate))
    .eq('meal', meal);
  if (error) {
    console.warn('[tips] schedule fetch failed', error);
    return new Set();
  }
  return new Set(
    (data ?? []).map((row: { tip_employee_id: string }) => row.tip_employee_id),
  );
}
