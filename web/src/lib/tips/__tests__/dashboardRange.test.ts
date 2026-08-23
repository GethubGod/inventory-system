import { describe, expect, it } from "vitest";

import {
  addDays,
  canStepBack,
  canStepForward,
  csvDayLabel,
  lastWeek,
  mondayOf,
  rangeBounds,
  rangeLabel,
  rangePresets,
  sameRange,
  shortDayLabel,
  stepWeek,
  thisMonth,
  thisWeek,
  thisYear,
  trendDayLabel,
} from "../dashboardRange";

describe("mondayOf", () => {
  it("backs a Sunday up to the previous Monday", () => {
    // 2026-08-09 is a Sunday; its week starts Mon Aug 3.
    expect(mondayOf("2026-08-09")).toBe("2026-08-03");
  });

  it("leaves a Monday alone", () => {
    expect(mondayOf("2026-08-03")).toBe("2026-08-03");
  });

  it("crosses a month boundary", () => {
    // Sat Aug 1, 2026 belongs to the week of Mon Jul 27.
    expect(mondayOf("2026-08-01")).toBe("2026-07-27");
  });
});

describe("range construction", () => {
  const today = "2026-08-05"; // a Wednesday

  it("this week runs Monday–Sunday around today", () => {
    expect(rangeBounds(thisWeek(today))).toEqual({ start: "2026-08-03", end: "2026-08-09" });
  });

  it("last week is the seven days before that", () => {
    expect(rangeBounds(lastWeek(today))).toEqual({ start: "2026-07-27", end: "2026-08-02" });
  });

  it("this month covers the whole calendar month", () => {
    expect(rangeBounds(thisMonth(today))).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("month bounds handle February", () => {
    expect(rangeBounds(thisMonth("2026-02-10"))).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("this year covers the calendar year", () => {
    expect(rangeBounds(thisYear(today))).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
});

describe("week stepping", () => {
  const today = "2026-08-05";

  it("steps a week back and forward", () => {
    const back = stepWeek(thisWeek(today), -1);
    expect(rangeBounds(back).start).toBe("2026-07-27");
    expect(rangeBounds(stepWeek(back, 1)).start).toBe("2026-08-03");
  });

  it("cannot step forward past the current week", () => {
    expect(canStepForward(thisWeek(today), today)).toBe(false);
    expect(canStepForward(lastWeek(today), today)).toBe(true);
  });

  it("only week ranges step", () => {
    expect(canStepBack(thisMonth(today))).toBe(false);
    expect(stepWeek(thisMonth(today), -1)).toEqual(thisMonth(today));
  });
});

describe("rangeLabel", () => {
  it("same-month week omits the second month", () => {
    expect(rangeLabel({ kind: "week", start: "2026-08-03" })).toBe("Aug 3 – 9, 2026");
  });

  it("cross-month week names both months", () => {
    expect(rangeLabel({ kind: "week", start: "2026-07-27" })).toBe("Jul 27 – Aug 2, 2026");
  });

  it("cross-year week names both years", () => {
    // Mon Dec 29, 2025 → Sun Jan 4, 2026.
    expect(rangeLabel({ kind: "week", start: "2025-12-29" })).toBe("Dec 29, 2025 – Jan 4, 2026");
  });

  it("month and year labels", () => {
    expect(rangeLabel({ kind: "month", year: 2026, month: 8 })).toBe("August 2026");
    expect(rangeLabel({ kind: "year", year: 2026 })).toBe("2026 — year to date");
  });
});

describe("rangePresets", () => {
  it("offers the four picker options with date labels", () => {
    const presets = rangePresets("2026-08-05");
    expect(presets.map((p) => p.pick)).toEqual(["This week", "Last week", "This month", "This year"]);
    expect(presets[0].dates).toBe("Aug 3 – 9, 2026");
    expect(presets[1].dates).toBe("Jul 27 – Aug 2, 2026");
    expect(sameRange(presets[0].range, thisWeek("2026-08-05"))).toBe(true);
    expect(sameRange(presets[0].range, presets[1].range)).toBe(false);
  });
});

describe("day labels", () => {
  it("row date has no comma, matching the mockup", () => {
    expect(shortDayLabel("2026-08-09")).toBe("Sun Aug 9");
  });

  it("trend label is weekday + day-of-month", () => {
    expect(trendDayLabel("2026-08-03")).toBe("Mon 3");
  });

  it("CSV date carries the record's own year", () => {
    expect(csvDayLabel("2026-08-09")).toBe("Sun Aug 9 2026");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
