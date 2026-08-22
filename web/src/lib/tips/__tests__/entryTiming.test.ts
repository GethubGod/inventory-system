import { describe, expect, it } from "vitest";

import {
  classifyEntryTiming,
  closeInstant,
  formatLoggedAt,
  minutesAfterClose,
  shiftHasClosed,
  timingText,
} from "../entryTiming";

describe("closeInstant", () => {
  it("dinner closes 10 PM LA — 05:00Z next calendar day during PDT", () => {
    expect(closeInstant("2026-08-07", "dinner").toISOString()).toBe("2026-08-08T05:00:00.000Z");
  });

  it("lunch closes 3 PM LA — 22:00Z during PDT", () => {
    expect(closeInstant("2026-08-07", "lunch").toISOString()).toBe("2026-08-07T22:00:00.000Z");
  });

  it("uses PST in winter", () => {
    // January: UTC-8, so 10 PM = 06:00Z next day.
    expect(closeInstant("2026-01-09", "dinner").toISOString()).toBe("2026-01-10T06:00:00.000Z");
  });

  it("handles the fall-back DST day", () => {
    // DST ends 2am Nov 1, 2026 — 3 PM that day is already PST (UTC-8).
    expect(closeInstant("2026-11-01", "lunch").toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });
});

describe("classifyEntryTiming", () => {
  it("within 45 minutes of close is ok", () => {
    // Saved 10:28 PM LA after Friday dinner (closes 10 PM).
    const timing = classifyEntryTiming(new Date("2026-08-08T05:28:00Z"), "2026-08-07", "dinner");
    expect(timing).toEqual({ kind: "ok", minutes: 28 });
  });

  it("later the same night is late", () => {
    // Saved 11:12 PM LA — 72 minutes after close.
    const timing = classifyEntryTiming(new Date("2026-08-08T06:12:00Z"), "2026-08-07", "dinner");
    expect(timing).toEqual({ kind: "late", minutes: 72 });
  });

  it("the 0–4am tail is still the same business date (late, not next-day)", () => {
    // Saved 1:30 AM LA — businessDateFor rolls back to Aug 7.
    const timing = classifyEntryTiming(new Date("2026-08-08T08:30:00Z"), "2026-08-07", "dinner");
    expect(timing.kind).toBe("late");
    expect(timing.minutes).toBe(210);
  });

  it("after the 4am rollover it becomes next-day", () => {
    // Saved 10:05 AM LA the following morning.
    const timing = classifyEntryTiming(new Date("2026-08-08T17:05:00Z"), "2026-08-07", "dinner");
    expect(timing.kind).toBe("nextDay");
  });

  it("saving before close is ok", () => {
    // Lunch saved 2:50 PM LA, ten minutes before close.
    const timing = classifyEntryTiming(new Date("2026-08-07T21:50:00Z"), "2026-08-07", "lunch");
    expect(timing).toEqual({ kind: "ok", minutes: -10 });
  });
});

describe("timingText", () => {
  it("minutes for ok and sub-hour late", () => {
    expect(timingText({ kind: "ok", minutes: 28 }, new Date())).toBe("+28 min after close");
    expect(timingText({ kind: "late", minutes: 51 }, new Date())).toBe("+51 min after close");
  });

  it("hours (one decimal) at 60+ minutes late", () => {
    expect(timingText({ kind: "late", minutes: 72 }, new Date())).toBe("+1.2 hr after close");
  });

  it("early saves clamp to +0 rather than showing negative minutes", () => {
    expect(timingText({ kind: "ok", minutes: -10 }, new Date())).toBe("+0 min after close");
  });

  it("next-day shows the LA save time", () => {
    const loggedAt = new Date("2026-08-08T17:05:00Z"); // 10:05 AM LA
    expect(timingText({ kind: "nextDay", minutes: 725 }, loggedAt)).toBe("next day · 10:05 AM");
  });
});

describe("shiftHasClosed / minutesAfterClose", () => {
  it("a shift is only closed once its close time passes", () => {
    expect(shiftHasClosed("2026-08-07", "lunch", new Date("2026-08-07T21:00:00Z"))).toBe(false);
    expect(shiftHasClosed("2026-08-07", "lunch", new Date("2026-08-07T22:00:00Z"))).toBe(true);
  });

  it("minutesAfterClose rounds to whole minutes", () => {
    expect(
      minutesAfterClose(new Date("2026-08-07T22:30:30Z"), "2026-08-07", "lunch"),
    ).toBe(31);
  });
});

describe("formatLoggedAt", () => {
  it("formats as LA wall-clock time", () => {
    expect(formatLoggedAt(new Date("2026-08-08T05:28:00Z"))).toBe("10:28 PM");
  });
});
