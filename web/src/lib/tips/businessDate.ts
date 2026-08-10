// Business-date rules for tip entry. CANONICAL implementation — the edge
// functions carry a mirror in supabase/functions/_shared/tips.ts; keep both
// in sync.
//
// The restaurants close after midnight sometimes: a 12:30am save after Friday
// dinner still belongs to Friday. The business date therefore rolls over at
// 4am America/Los_Angeles, not at midnight.

export const TIPS_TIMEZONE = "America/Los_Angeles";

interface LaClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function laClock(now: Date, timeZone: string = TIPS_TIMEZONE): LaClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  // hour12:false can yield "24" for midnight in some engines; normalize.
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** YYYY-MM-DD business date for a moment in time (4am LA rollover). */
export function businessDateFor(
  now: Date,
  timeZone: string = TIPS_TIMEZONE,
): string {
  const clock = laClock(now, timeZone);
  const base = new Date(Date.UTC(clock.year, clock.month - 1, clock.day));
  if (clock.hour < 4) base.setUTCDate(base.getUTCDate() - 1);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(base.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Default meal period for the segmented control: lunch before ~4pm LA time,
 * dinner after — including the 0-4am tail, which belongs to last night's
 * dinner.
 */
export function defaultMealPeriod(
  now: Date,
  timeZone: string = TIPS_TIMEZONE,
): "lunch" | "dinner" {
  const { hour } = laClock(now, timeZone);
  return hour >= 4 && hour < 16 ? "lunch" : "dinner";
}

/** "Wed, Aug 6" for a YYYY-MM-DD business date (no timezone drift). */
export function formatBusinessDate(businessDate: string): string {
  const [y, m, d] = businessDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
