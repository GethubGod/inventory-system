import { describe, expect, it } from "vitest";

import { weekdayOfBusinessDate } from "../businessDate";
import {
  deriveMissingShifts,
  scheduledEmployeeIds,
  type ScheduleEmployee,
  type ScheduleRow,
} from "../schedule";

const SUSHI = "loc-sushi";
const POKI = "loc-poki";

const employees: ScheduleEmployee[] = [
  { id: "maria", active: true, locationId: SUSHI },
  { id: "lena", active: true, locationId: POKI },
  { id: "ken", active: true, locationId: null }, // works both
  { id: "aiko", active: false, locationId: SUSHI }, // deactivated
  { id: "rey", active: true, locationId: POKI }, // moved to Poki; stale Sushi rows below
];

const schedules: ScheduleRow[] = [
  // Friday (weekday 5) dinner at Sushi: Maria + Ken (+ stale Rey + inactive Aiko).
  { tipEmployeeId: "maria", locationId: SUSHI, weekday: 5, meal: "dinner" },
  { tipEmployeeId: "ken", locationId: SUSHI, weekday: 5, meal: "dinner" },
  { tipEmployeeId: "aiko", locationId: SUSHI, weekday: 5, meal: "dinner" },
  { tipEmployeeId: "rey", locationId: SUSHI, weekday: 5, meal: "dinner" },
  // Friday lunch at Poki: Lena.
  { tipEmployeeId: "lena", locationId: POKI, weekday: 5, meal: "lunch" },
  // Saturday (weekday 6) dinner at Poki: Lena.
  { tipEmployeeId: "lena", locationId: POKI, weekday: 6, meal: "dinner" },
];

describe("weekdayOfBusinessDate", () => {
  it("uses the JS getDay convention", () => {
    expect(weekdayOfBusinessDate("2026-08-09")).toBe(0); // Sunday
    expect(weekdayOfBusinessDate("2026-08-03")).toBe(1); // Monday
    expect(weekdayOfBusinessDate("2026-08-07")).toBe(5); // Friday
  });
});

describe("scheduledEmployeeIds", () => {
  it("returns active people scheduled for that location, weekday, and meal", () => {
    // 2026-08-07 is a Friday.
    const ids = scheduledEmployeeIds(schedules, employees, SUSHI, "2026-08-07", "dinner");
    expect(ids.sort()).toEqual(["ken", "maria"]);
  });

  it("excludes inactive people and stale rows from a works-at change", () => {
    const ids = scheduledEmployeeIds(schedules, employees, SUSHI, "2026-08-07", "dinner");
    expect(ids).not.toContain("aiko"); // inactive
    expect(ids).not.toContain("rey"); // now works at Poki only
  });

  it("is empty for an unscheduled slot", () => {
    expect(scheduledEmployeeIds(schedules, employees, SUSHI, "2026-08-07", "lunch")).toEqual([]);
  });
});

describe("deriveMissingShifts", () => {
  // Range: Mon Aug 3 – Sun Aug 9, 2026. Scheduled slots inside it:
  //   Fri Aug 7 — Sushi dinner, Poki lunch
  //   Sat Aug 8 — Poki dinner
  const rangeStart = "2026-08-03";
  const rangeEnd = "2026-08-09";
  const base = {
    schedules,
    employees,
    locationIds: [SUSHI, POKI],
    rangeStart,
    rangeEnd,
  };

  it("reports scheduled slots with no entry once their close has passed", () => {
    const missing = deriveMissingShifts({
      ...base,
      entries: [{ businessDate: "2026-08-07", locationId: SUSHI, meal: "dinner" }],
      // Sunday night after everything closed.
      now: new Date("2026-08-10T06:00:00Z"),
    });
    expect(missing).toEqual([
      { businessDate: "2026-08-08", locationId: POKI, meal: "dinner" },
      { businessDate: "2026-08-07", locationId: POKI, meal: "lunch" },
    ]);
  });

  it("does not report a shift whose close time hasn't passed", () => {
    // Friday 2 PM LA: Poki lunch (closes 3 PM) and everything later are still open.
    const missing = deriveMissingShifts({
      ...base,
      entries: [],
      now: new Date("2026-08-07T21:00:00Z"),
    });
    expect(missing).toEqual([]);
  });

  it("reports a just-closed lunch the same afternoon", () => {
    // Friday 3:30 PM LA: Poki lunch closed half an hour ago.
    const missing = deriveMissingShifts({
      ...base,
      entries: [],
      now: new Date("2026-08-07T22:30:00Z"),
    });
    expect(missing).toEqual([{ businessDate: "2026-08-07", locationId: POKI, meal: "lunch" }]);
  });

  it("respects the location filter", () => {
    const missing = deriveMissingShifts({
      ...base,
      locationIds: [SUSHI],
      entries: [],
      now: new Date("2026-08-10T06:00:00Z"),
    });
    expect(missing).toEqual([{ businessDate: "2026-08-07", locationId: SUSHI, meal: "dinner" }]);
  });

  it("sorts newest first, dinner before lunch within a day", () => {
    const missing = deriveMissingShifts({
      ...base,
      entries: [],
      now: new Date("2026-08-10T06:00:00Z"),
    });
    expect(missing.map((m) => `${m.businessDate} ${m.meal}`)).toEqual([
      "2026-08-08 dinner",
      "2026-08-07 dinner",
      "2026-08-07 lunch",
    ]);
  });
});
