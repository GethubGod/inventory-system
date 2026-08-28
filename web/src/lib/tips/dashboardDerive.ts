// Aggregations behind the Tip Dashboard's numbers — pure so every figure the
// manager sees is unit-tested.
//
// Money is handled in integer cents. The dashboard's per-person figure is the
// CASH share only (cash is pooled and handed out nightly; card tips ride
// payroll) — deliberately different from the entry phone's cash+card
// perPersonShare. Rounding matches the shared ledger rule: nearest cent,
// half up; remainder cents stay in the drawer.

import type { EntryMethod, MealPeriod } from "@/types/database";

export interface LedgerEntry {
  id: string;
  businessDate: string;
  locationId: string;
  meal: MealPeriod;
  cashCents: number;
  cardCents: number;
  splitCount: number;
  peopleIds: string[];
  peopleNames: string[];
  enteredById: string | null;
  enteredByName: string | null;
  entryMethod: EntryMethod;
  /** flagged_anomaly and not yet verified — what KPIs and attention count. */
  flagged: boolean;
  /** flagged_anomaly as stored, regardless of verification. */
  flaggedRaw: boolean;
  anomalyReason: string | null;
  createdAt: string; // ISO timestamp of the save (powers the entry log)
}

/** Each name's cash take-home for one entry: round(cash / splitCount), half up. */
export function cashShareCents(cashCents: number, splitCount: number): number {
  if (!Number.isFinite(splitCount) || splitCount < 1) return 0;
  return Math.round(cashCents / splitCount);
}

export interface RangeTotals {
  cashCents: number;
  cardCents: number;
  count: number;
  flaggedCount: number;
}

export function rangeTotals(entries: LedgerEntry[]): RangeTotals {
  const totals: RangeTotals = { cashCents: 0, cardCents: 0, count: entries.length, flaggedCount: 0 };
  for (const entry of entries) {
    totals.cashCents += entry.cashCents;
    totals.cardCents += entry.cardCents;
    if (entry.flagged) totals.flaggedCount += 1;
  }
  return totals;
}

export interface TrendDay {
  businessDate: string;
  totalCents: number; // cash + card
}

/** Daily cash+card totals, chronological, only days that have records. */
export function dailyTrend(entries: LedgerEntry[]): TrendDay[] {
  const byDay = new Map<string, number>();
  for (const entry of entries) {
    byDay.set(
      entry.businessDate,
      (byDay.get(entry.businessDate) ?? 0) + entry.cashCents + entry.cardCents,
    );
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([businessDate, totalCents]) => ({ businessDate, totalCents }));
}

/**
 * Split one location's trend wherever the shared chart timeline contains a
 * day that location did not record. This prevents a polyline from visually
 * interpolating through another location's otherwise-valid data point.
 */
export function splitTrendSeries(series: TrendDay[], timeline: TrendDay[]): TrendDay[][] {
  const indexByDate = new Map(timeline.map((day, index) => [day.businessDate, index]));
  const segments: TrendDay[][] = [];
  let previousIndex: number | undefined;

  for (const day of series) {
    const index = indexByDate.get(day.businessDate);
    if (index === undefined) continue;
    if (previousIndex === undefined || index !== previousIndex + 1) segments.push([]);
    segments.at(-1)?.push(day);
    previousIndex = index;
  }

  return segments;
}

export interface PersonTakeHome {
  id: string;
  name: string;
  cents: number;
  shifts: number;
}

/**
 * Cash take-home per person across the range: each entry contributes
 * round(cash / splitCount) to every name on its split. Sorted highest first.
 */
export function takeHomeByPerson(entries: LedgerEntry[]): PersonTakeHome[] {
  const byPerson = new Map<string, PersonTakeHome>();
  for (const entry of entries) {
    const share = cashShareCents(entry.cashCents, entry.splitCount);
    entry.peopleIds.forEach((personId, index) => {
      const name = entry.peopleNames[index] ?? "?";
      const person = byPerson.get(personId) ?? { id: personId, name, cents: 0, shifts: 0 };
      person.cents += share;
      person.shifts += 1;
      byPerson.set(personId, person);
    });
  }
  return [...byPerson.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

/** "$6,813.25" from cents. */
export function moneyFromCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "$6,813" from cents — the overview's compact figures. */
export function wholeDollarsFromCents(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}
