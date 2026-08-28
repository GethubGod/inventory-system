// Equal-split math. Per-person share is DERIVED, never stored.
//
// Rounding rule: each person's share is (cash + card) / splitCount rounded to
// the nearest cent, half-up (JS Math.round on cents). The rounded shares can
// differ from the pooled total by a few cents (e.g. $100 / 3 -> $33.33 each,
// $99.99 total); the remainder cents stay in the drawer rather than being
// assigned to anyone. Amounts are handled in integer cents to avoid float
// drift.

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Per-person share in dollars, rounded to the nearest cent (half-up). */
export function perPersonShare(
  cash: number,
  card: number,
  splitCount: number,
): number {
  if (!Number.isFinite(splitCount) || splitCount < 1) return 0;
  const totalCents = toCents(cash) + toCents(card);
  return fromCents(Math.round(totalCents / splitCount));
}

/** Pooled total in dollars, exact in cents. */
export function totalTips(cash: number, card: number): number {
  return fromCents(toCents(cash) + toCents(card));
}

// Weighted allocation (Tips v3 partial shares). Unlike perPersonShare above,
// the allocated shares must sum to the pool EXACTLY — nothing stays in the
// drawer beyond what largest-remainder cannot avoid (which is nothing).
// Half-up rounding is wrong here: it can pay out more than the pool.
//
// MIRROR: supabase/functions/_shared/tips.ts carries a copy of this logic
// (edge functions cannot import from web/). Keep them in sync.

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
