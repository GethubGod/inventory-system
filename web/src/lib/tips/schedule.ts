// Weekly-schedule derivations shared by the dashboard (missing shifts,
// pre-selection preview) — pure functions over tip_employee_schedules rows.
//
// weekday is 0 = Sunday … 6 = Saturday (JS Date.getDay(); see
// weekdayOfBusinessDate). A schedule row only counts while its employee is
// active AND still works at the row's location (location_id null = both) —
// stale rows left behind by a works-at change are ignored defensively.

import { businessDateFor, weekdayOfBusinessDate } from "./businessDate";
import { addDays } from "./dashboardRange";
import { shiftHasClosed } from "./entryTiming";
import type { MealPeriod } from "@/types/database";

export interface ScheduleRow {
  tipEmployeeId: string;
  locationId: string;
  weekday: number;
  meal: MealPeriod;
  /**
   * When the schedule rule was created (ISO timestamp). A rule can't testify
   * about business dates before it existed — without this floor, setting up
   * the schedule would retroactively flag months of "missing" shifts.
   */
  createdAt?: string;
}

export interface ScheduleEmployee {
  id: string;
  active: boolean;
  locationId: string | null; // null = works at both locations
}

function worksAt(employee: ScheduleEmployee, locationId: string): boolean {
  return employee.locationId === null || employee.locationId === locationId;
}

/**
 * Employee ids scheduled for (location, business date's weekday, meal) —
 * the set the entry phone pre-selects.
 */
export function scheduledEmployeeIds(
  schedules: ScheduleRow[],
  employees: ScheduleEmployee[],
  locationId: string,
  businessDate: string,
  meal: MealPeriod,
): string[] {
  const weekday = weekdayOfBusinessDate(businessDate);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const ids: string[] = [];
  for (const row of schedules) {
    if (row.locationId !== locationId || row.weekday !== weekday || row.meal !== meal) continue;
    const employee = byId.get(row.tipEmployeeId);
    if (!employee || !employee.active || !worksAt(employee, locationId)) continue;
    ids.push(row.tipEmployeeId);
  }
  return ids;
}

export interface MissingShift {
  businessDate: string;
  locationId: string;
  meal: MealPeriod;
}

const MAX_RANGE_DAYS = 400; // hard cap, mirrors the v1 discrepancies guard

/**
 * Business dates in [rangeStart, rangeEnd] where the schedule says somebody
 * was working (location + meal) but no tip_entries row exists and the shift's
 * close time has passed. Sorted newest-first.
 *
 * Two floors keep old dates honest: a slot only counts from the business
 * date its earliest schedule rule was created, and a location only counts
 * from its first-ever recorded entry (mirrors the v1 discrepancies rule —
 * a location that never used the system has nothing "missing"). Note the
 * derivation reflects the CURRENT schedule and roster on purpose: the spec
 * asks "who does the schedule say works this slot", not a historical diff.
 */
export function deriveMissingShifts(options: {
  schedules: ScheduleRow[];
  employees: ScheduleEmployee[];
  entries: Array<{ businessDate: string; locationId: string; meal: MealPeriod }>;
  locationIds: string[];
  /** Each location's first-ever entry business date (absent = no entries yet). */
  firstEntryDates: Record<string, string | undefined>;
  rangeStart: string;
  rangeEnd: string;
  now: Date;
}): MissingShift[] {
  const {
    schedules,
    employees,
    entries,
    locationIds,
    firstEntryDates,
    rangeStart,
    rangeEnd,
    now,
  } = options;

  const recorded = new Set(
    entries.map((e) => `${e.businessDate}|${e.locationId}|${e.meal}`),
  );

  // (locationId|weekday|meal) slots with at least one valid scheduled person,
  // mapped to the earliest business date their schedule rule existed on.
  const byId = new Map(employees.map((e) => [e.id, e]));
  const staffedSlots = new Map<string, string>();
  for (const row of schedules) {
    const employee = byId.get(row.tipEmployeeId);
    if (!employee || !employee.active || !worksAt(employee, row.locationId)) continue;
    const slot = `${row.locationId}|${row.weekday}|${row.meal}`;
    const floor = row.createdAt ? businessDateFor(new Date(row.createdAt)) : "";
    const existing = staffedSlots.get(slot);
    if (existing === undefined || floor < existing) staffedSlots.set(slot, floor);
  }

  const missing: MissingShift[] = [];
  const meals: MealPeriod[] = ["lunch", "dinner"];
  let date = rangeStart;
  for (let i = 0; i < MAX_RANGE_DAYS && date <= rangeEnd; i += 1) {
    const weekday = weekdayOfBusinessDate(date);
    for (const locationId of locationIds) {
      const firstEntry = firstEntryDates[locationId];
      if (!firstEntry || date < firstEntry) continue;
      for (const meal of meals) {
        const slotFloor = staffedSlots.get(`${locationId}|${weekday}|${meal}`);
        if (slotFloor === undefined || date < slotFloor) continue;
        if (recorded.has(`${date}|${locationId}|${meal}`)) continue;
        if (!shiftHasClosed(date, meal, now)) continue;
        missing.push({ businessDate: date, locationId, meal });
      }
    }
    date = addDays(date, 1);
  }

  // Newest first; dinner before lunch within a day to match the ledger's ordering.
  missing.sort((a, b) =>
    a.businessDate !== b.businessDate
      ? (a.businessDate < b.businessDate ? 1 : -1)
      : a.meal === b.meal
        ? 0
        : a.meal === "dinner"
          ? -1
          : 1,
  );
  return missing;
}
