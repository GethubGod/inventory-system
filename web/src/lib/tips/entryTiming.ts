// Entry-log timing: how long after a shift's close time the closer actually
// saved the entry, and whether a scheduled shift's close has passed at all.
//
// Close times are product policy (not stored in the DB): lunch closes 3:00 PM,
// dinner 10:00 PM, America/Los_Angeles. "Next day" means the save happened on
// a later BUSINESS date than the entry's — the 4am rollover keeps a 1:30am
// dinner save on the same business date (amber, not red).

import { businessDateFor, laClock, TIPS_TIMEZONE } from "./businessDate";
import type { MealPeriod } from "@/types/database";

export const MEAL_CLOSE_HOUR: Record<MealPeriod, number> = {
  lunch: 15,
  dinner: 22,
};

/**
 * The UTC instant of local LA wall-clock (y-m-d hh:mm). Resolves the LA UTC
 * offset (PDT/PST) by correcting an initial guess against laClock; two
 * corrections are enough even across a DST boundary.
 */
function laInstant(year: number, month: number, day: number, hour: number, minute = 0): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 2; i += 1) {
    const c = laClock(guess, TIPS_TIMEZONE);
    const deltaMinutes =
      (Date.UTC(year, month - 1, day, hour, minute) -
        Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute)) /
      60000;
    if (deltaMinutes === 0) break;
    guess = new Date(guess.getTime() + deltaMinutes * 60000);
  }
  return guess;
}

/** The UTC instant when a business date's meal closed (3 PM / 10 PM LA). */
export function closeInstant(businessDate: string, meal: MealPeriod): Date {
  const [y, m, d] = businessDate.split("-").map(Number);
  return laInstant(y, m ?? 1, d ?? 1, MEAL_CLOSE_HOUR[meal]);
}

/** Whether a shift's close time has passed — a not-yet-closed shift can't be "missing". */
export function shiftHasClosed(businessDate: string, meal: MealPeriod, now: Date): boolean {
  return now.getTime() >= closeInstant(businessDate, meal).getTime();
}

/** Whole minutes between the save and the close (negative = saved before close). */
export function minutesAfterClose(loggedAt: Date, businessDate: string, meal: MealPeriod): number {
  return Math.round((loggedAt.getTime() - closeInstant(businessDate, meal).getTime()) / 60000);
}

export type EntryTimingKind = "ok" | "late" | "nextDay";

export interface EntryTiming {
  kind: EntryTimingKind;
  minutes: number;
}

/** Green ≤ 45 min after close, amber later that night, red on a later business date. */
export function classifyEntryTiming(
  loggedAt: Date,
  businessDate: string,
  meal: MealPeriod,
): EntryTiming {
  const minutes = minutesAfterClose(loggedAt, businessDate, meal);
  if (businessDateFor(loggedAt) !== businessDate) return { kind: "nextDay", minutes };
  if (minutes <= 45) return { kind: "ok", minutes };
  return { kind: "late", minutes };
}

/** "10:24 PM" — the save moment as an LA wall-clock time. */
export function formatLoggedAt(loggedAt: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIPS_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(loggedAt);
}

/** The timing cell's text: "+28 min after close" / "+1.2 hr after close" / "next day · 10:05 AM". */
export function timingText(timing: EntryTiming, loggedAt: Date): string {
  if (timing.kind === "nextDay") return `next day · ${formatLoggedAt(loggedAt)}`;
  const minutes = Math.max(0, timing.minutes);
  if (timing.kind === "late" && minutes >= 60) {
    return `+${Math.round((minutes / 60) * 10) / 10} hr after close`;
  }
  return `+${minutes} min after close`;
}
