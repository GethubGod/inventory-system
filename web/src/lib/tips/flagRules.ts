// Manager-adjustable flag rules for the Tip Dashboard.
//
// The phone saves two kinds of flag onto tip_entries.anomaly_reason: the
// literal "day_total_no_lunch" (a whole-day dinner saved before lunch was
// recorded) and the save-time statistical check ("cash $500.00 vs typical
// $10-$30 (max ever $40)"), joined with "; " when both apply. The rules here
// decide which of those the dashboard treats as "needs attention", and add
// two plain limits (cash over $X, card over $Y) evaluated on the dashboard.
// Everything is display-time: changing a rule re-evaluates history, and
// Verify still clears a row by stamping flag_verified_at.

import type { LedgerEntry } from "./dashboardDerive";
import { moneyFromCents } from "./dashboardDerive";

export interface FlagRules {
  /** Flag a whole-day dinner that was saved before lunch was recorded. */
  noLunch: boolean;
  /** Flag amounts the save-time check called unusual against the 4-week history. */
  unusualAmounts: boolean;
  /** Flag any entry whose cash pool is over this many cents ($0 flags any cash). null = off. */
  cashOverCents: number | null;
  /** Flag any entry whose card figure is over this many cents. null = off. */
  cardOverCents: number | null;
}

export const DEFAULT_FLAG_RULES: FlagRules = {
  noLunch: true,
  unusualAmounts: true,
  cashOverCents: null,
  cardOverCents: null,
};

export const NO_LUNCH_CODE = "day_total_no_lunch";

function centsOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

/** Validate a stored rules object; anything malformed falls back to the default. */
export function parseFlagRules(raw: unknown): FlagRules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_FLAG_RULES;
  const source = raw as Record<string, unknown>;
  return {
    noLunch: typeof source.noLunch === "boolean" ? source.noLunch : DEFAULT_FLAG_RULES.noLunch,
    unusualAmounts:
      typeof source.unusualAmounts === "boolean"
        ? source.unusualAmounts
        : DEFAULT_FLAG_RULES.unusualAmounts,
    cashOverCents: centsOrNull(source.cashOverCents),
    cardOverCents: centsOrNull(source.cardOverCents),
  };
}

export type FlagKind = "no_lunch" | "unusual" | "cash_over" | "card_over";

export interface FlagReason {
  kind: FlagKind;
  /** One plain-English sentence a manager can act on. */
  text: string;
}

const STATISTICAL_PATTERN =
  /^(cash|card) \$([\d,]+(?:\.\d+)?) vs typical \$([\d,]+(?:\.\d+)?)-\$([\d,]+(?:\.\d+)?) \(max ever \$([\d,]+(?:\.\d+)?)\)$/;

function dollars(text: string): string {
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? moneyFromCents(Math.round(value * 100)) : `$${text}`;
}

/**
 * The stored anomaly_reason as plain-English sentences, one per part.
 * Unknown parts pass through untouched so nothing the server said is lost.
 */
export function describeStoredReason(
  reason: string | null,
): Array<{ kind: "no_lunch" | "unusual"; text: string }> {
  if (!reason) return [];
  return reason
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part === NO_LUNCH_CODE) {
        return {
          kind: "no_lunch" as const,
          text: "Whole-day total entered before lunch was recorded, so nothing was subtracted for lunch.",
        };
      }
      const match = STATISTICAL_PATTERN.exec(part);
      if (match) {
        const [, field, value, low, high, maxEver] = match;
        const label = field === "cash" ? "Cash" : "Card";
        return {
          kind: "unusual" as const,
          text: `${label} ${dollars(value)} is far above the usual ${dollars(low)} to ${dollars(high)} for this shift (highest before this: ${dollars(maxEver)}).`,
        };
      }
      return { kind: "unusual" as const, text: part };
    });
}

type FlagInput = Pick<LedgerEntry, "anomalyReason" | "flaggedRaw" | "cashCents" | "cardCents">;

/** Why this entry needs attention under the given rules; empty when it does not. */
export function flagReasons(entry: FlagInput, rules: FlagRules): FlagReason[] {
  const reasons: FlagReason[] = [];
  const stored = describeStoredReason(entry.anomalyReason);
  for (const part of stored) {
    if (part.kind === "no_lunch" && rules.noLunch) reasons.push(part);
    if (part.kind === "unusual" && rules.unusualAmounts) reasons.push(part);
  }
  // A row flagged at save time with no reason text (pre-v3) still counts as
  // an unusual amount, since that was the only flag source then.
  if (entry.flaggedRaw && stored.length === 0 && rules.unusualAmounts) {
    reasons.push({ kind: "unusual", text: "Flagged as unusual when it was saved." });
  }
  if (rules.cashOverCents !== null && entry.cashCents > rules.cashOverCents) {
    reasons.push({
      kind: "cash_over",
      text: `Cash ${moneyFromCents(entry.cashCents)} is over the ${moneyFromCents(rules.cashOverCents)} limit you set.`,
    });
  }
  if (rules.cardOverCents !== null && entry.cardCents > rules.cardOverCents) {
    reasons.push({
      kind: "card_over",
      text: `Card ${moneyFromCents(entry.cardCents)} is over the ${moneyFromCents(rules.cardOverCents)} limit you set.`,
    });
  }
  return reasons;
}

/**
 * Re-derive `flagged` for the dashboard: needs attention under the rules and
 * not yet verified. Verified rows stay clear whatever the rules say.
 */
export function applyFlagRules(entry: LedgerEntry, rules: FlagRules): LedgerEntry {
  const flagged = entry.flagVerifiedAt === null && flagReasons(entry, rules).length > 0;
  return entry.flagged === flagged ? entry : { ...entry, flagged };
}
