// Time-frame math for the manager Tip Dashboard toolbar.
//
// Ranges are expressed in business dates (YYYY-MM-DD, 4am LA rollover — see
// businessDate.ts) so they filter tip_entries.business_date directly. Weeks
// run Monday–Sunday; the ‹ › arrows step weeks, the picker offers This week /
// Last week / This month / This year.

export type DashboardRange =
  | { kind: "week"; start: string } // start = the Monday business date
  | { kind: "month"; year: number; month: number } // month is 1-12
  | { kind: "year"; year: number };

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOWS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Noon-UTC anchor for a YYYY-MM-DD string — immune to timezone drift. */
function anchor(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12));
}

function toIso(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Add n calendar days to a YYYY-MM-DD string. */
export function addDays(iso: string, n: number): string {
  const date = anchor(iso);
  date.setUTCDate(date.getUTCDate() + n);
  return toIso(date);
}

/** The Monday of the week containing the given business date. */
export function mondayOf(iso: string): string {
  const day = anchor(iso).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((day + 6) % 7));
}

export function thisWeek(today: string): DashboardRange {
  return { kind: "week", start: mondayOf(today) };
}

export function lastWeek(today: string): DashboardRange {
  return { kind: "week", start: addDays(mondayOf(today), -7) };
}

export function thisMonth(today: string): DashboardRange {
  const d = anchor(today);
  return { kind: "month", year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function thisYear(today: string): DashboardRange {
  return { kind: "year", year: anchor(today).getUTCFullYear() };
}

/** Inclusive business-date bounds for a range. */
export function rangeBounds(range: DashboardRange): { start: string; end: string } {
  if (range.kind === "week") {
    return { start: range.start, end: addDays(range.start, 6) };
  }
  if (range.kind === "month") {
    const start = `${range.year}-${String(range.month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(range.year, range.month, 0, 12)).getUTCDate();
    return { start, end: `${range.year}-${String(range.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
  }
  return { start: `${range.year}-01-01`, end: `${range.year}-12-31` };
}

/** Step a week range by ±1 week. Month/year ranges are returned unchanged. */
export function stepWeek(range: DashboardRange, delta: -1 | 1): DashboardRange {
  if (range.kind !== "week") return range;
  return { kind: "week", start: addDays(range.start, delta * 7) };
}

/** The › arrow must not step past the week containing today. */
export function canStepForward(range: DashboardRange, today: string): boolean {
  return range.kind === "week" && range.start < mondayOf(today);
}

export function canStepBack(range: DashboardRange): boolean {
  return range.kind === "week";
}

/** "Aug 3 – 9, 2026" / "Jul 27 – Aug 2, 2026" / "Dec 29, 2025 – Jan 4, 2026". */
function weekLabel(start: string): string {
  const a = anchor(start);
  const b = anchor(addDays(start, 6));
  const aTxt = `${MONTHS_SHORT[a.getUTCMonth()]} ${a.getUTCDate()}`;
  const bDay = b.getUTCDate();
  if (a.getUTCFullYear() !== b.getUTCFullYear()) {
    return `${aTxt}, ${a.getUTCFullYear()} – ${MONTHS_SHORT[b.getUTCMonth()]} ${bDay}, ${b.getUTCFullYear()}`;
  }
  const bTxt = a.getUTCMonth() === b.getUTCMonth() ? `${bDay}` : `${MONTHS_SHORT[b.getUTCMonth()]} ${bDay}`;
  return `${aTxt} – ${bTxt}, ${a.getUTCFullYear()}`;
}

export function rangeLabel(range: DashboardRange): string {
  if (range.kind === "week") return weekLabel(range.start);
  if (range.kind === "month") return `${MONTHS_FULL[range.month - 1]} ${range.year}`;
  return `${range.year} — year to date`;
}

export interface RangePreset {
  key: "this-week" | "last-week" | "this-month" | "this-year";
  pick: string; // "This week"
  dates: string; // "Aug 3 – 9, 2026"
  range: DashboardRange;
}

export function rangePresets(today: string): RangePreset[] {
  const presets: Array<[RangePreset["key"], string, DashboardRange]> = [
    ["this-week", "This week", thisWeek(today)],
    ["last-week", "Last week", lastWeek(today)],
    ["this-month", "This month", thisMonth(today)],
    ["this-year", "This year", thisYear(today)],
  ];
  return presets.map(([key, pick, range]) => ({ key, pick, dates: rangeLabel(range), range }));
}

export function sameRange(a: DashboardRange, b: DashboardRange): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "week" && b.kind === "week") return a.start === b.start;
  if (a.kind === "month" && b.kind === "month") return a.year === b.year && a.month === b.month;
  if (a.kind === "year" && b.kind === "year") return a.year === b.year;
  return false;
}

/** "Sun Aug 9" — the mockup's row-date format (no comma). */
export function shortDayLabel(businessDate: string): string {
  const d = anchor(businessDate);
  return `${DOWS_SHORT[d.getUTCDay()]} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Mon 3" — the trend chart's x-axis label. */
export function trendDayLabel(businessDate: string): string {
  const d = anchor(businessDate);
  return `${DOWS_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** "Sun Aug 9 2026" — the CSV's per-record date (year from the record). */
export function csvDayLabel(businessDate: string): string {
  return `${shortDayLabel(businessDate)} ${anchor(businessDate).getUTCFullYear()}`;
}
