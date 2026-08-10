import { describe, expect, it } from "vitest";
import {
  businessDateFor,
  defaultMealPeriod,
  formatBusinessDate,
} from "../businessDate";

// All instants below are exact UTC. In August LA is PDT (UTC-7); in January
// it is PST (UTC-8).

describe("businessDateFor", () => {
  it("keeps a late-evening save on the same business day", () => {
    // Aug 6 11:30pm PDT
    expect(businessDateFor(new Date("2026-08-07T06:30:00Z"))).toBe("2026-08-06");
  });

  it("assigns a post-midnight save to the prior business day", () => {
    // Aug 7 1:30am PDT still belongs to Aug 6.
    expect(businessDateFor(new Date("2026-08-07T08:30:00Z"))).toBe("2026-08-06");
  });

  it("rolls over at exactly 4am PDT", () => {
    // 3:59am PDT -> prior day; 4:00am PDT -> same day.
    expect(businessDateFor(new Date("2026-08-07T10:59:00Z"))).toBe("2026-08-06");
    expect(businessDateFor(new Date("2026-08-07T11:00:00Z"))).toBe("2026-08-07");
  });

  it("rolls over at exactly 4am PST in winter", () => {
    // 3:59am PST -> prior day; 4:00am PST -> same day.
    expect(businessDateFor(new Date("2026-01-10T11:59:00Z"))).toBe("2026-01-09");
    expect(businessDateFor(new Date("2026-01-10T12:00:00Z"))).toBe("2026-01-10");
  });

  it("crosses month and year boundaries correctly", () => {
    // Jan 1 1:00am PST belongs to Dec 31 of the prior year.
    expect(businessDateFor(new Date("2026-01-01T09:00:00Z"))).toBe("2025-12-31");
  });
});

describe("defaultMealPeriod", () => {
  it("switches from lunch to dinner at 4pm LA time", () => {
    // 3:59pm PDT -> lunch; 4:00pm PDT -> dinner.
    expect(defaultMealPeriod(new Date("2026-08-06T22:59:00Z"))).toBe("lunch");
    expect(defaultMealPeriod(new Date("2026-08-06T23:00:00Z"))).toBe("dinner");
  });

  it("treats the 0-4am tail as last night's dinner", () => {
    // 2:00am PDT.
    expect(defaultMealPeriod(new Date("2026-08-07T09:00:00Z"))).toBe("dinner");
  });

  it("defaults to lunch mid-morning", () => {
    // 11:00am PDT.
    expect(defaultMealPeriod(new Date("2026-08-06T18:00:00Z"))).toBe("lunch");
  });
});

describe("formatBusinessDate", () => {
  it('formats "2026-08-06" as "Thu, Aug 6"', () => {
    // Aug 6 2026 is a Thursday (doomsday 8/8/2026 = Saturday).
    expect(formatBusinessDate("2026-08-06")).toBe("Thu, Aug 6");
  });

  it("does not drift a day across timezones (noon-UTC anchor)", () => {
    expect(formatBusinessDate("2026-01-01")).toBe("Thu, Jan 1");
    expect(formatBusinessDate("2025-12-31")).toBe("Wed, Dec 31");
  });
});
