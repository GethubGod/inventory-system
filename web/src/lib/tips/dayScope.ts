// Day-scope subtraction (Tips v3). A dinner entered as "Whole day (Square)"
// stores shift-only figures: what the closer typed minus what lunch already
// recorded, field by field (cash−cash, card−card, gratuity−gratuity), against
// today's lunch row at the same location. The server recomputes this on save
// and is authoritative; the client copy only drives the live receipt and the
// blocking negative warning.
//
// MIRROR: supabase/functions/_shared/tips.ts carries a copy of this logic
// (edge functions cannot import from web/). Keep them in sync.

import { fromCents, toCents } from "./split";

export type EnteredScope = "shift" | "day";

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
  if (scope !== "day" || lunch === null) {
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

/** Entered total in dollars, cent-exact: cash + card + gratuity. */
export function enteredTotal(amounts: MealAmounts): number {
  return fromCents(
    toCents(amounts.cash) + toCents(amounts.card) + toCents(amounts.gratuity),
  );
}
