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
