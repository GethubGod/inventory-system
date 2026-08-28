import { describe, expect, it } from "vitest";

import {
  cashShareCents,
  dailyTrend,
  moneyFromCents,
  rangeTotals,
  takeHomeByPerson,
  wholeDollarsFromCents,
  type LedgerEntry,
} from "../dashboardDerive";

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: "e1",
    businessDate: "2026-08-07",
    locationId: "loc-sushi",
    meal: "dinner",
    cashCents: 0,
    cardCents: 0,
    splitCount: 1,
    peopleIds: [],
    peopleNames: [],
    weights: [],
    gratuityCents: 0,
    enteredScope: "shift",
    rawCashCents: null,
    rawCardCents: null,
    rawGratuityCents: null,
    note: null,
    noteAt: null,
    enteredById: null,
    enteredByName: null,
    entryMethod: "typed",
    flagged: false,
    flaggedRaw: false,
    anomalyReason: null,
    createdAt: "2026-08-08T05:28:00Z",
    ...overrides,
  };
}

describe("cashShareCents", () => {
  it("divides the cash pool evenly", () => {
    expect(cashShareCents(39800, 2)).toBe(19900);
  });

  it("rounds half up; the remainder stays in the drawer", () => {
    // $1.01 between two people: 50.5¢ rounds to 51¢ each.
    expect(cashShareCents(101, 2)).toBe(51);
    // $3,100.00 across 3: 103333.33¢ → $1,033.33 each.
    expect(cashShareCents(310000, 3)).toBe(103333);
  });

  it("guards a nonsensical split count", () => {
    expect(cashShareCents(1000, 0)).toBe(0);
  });
});

describe("rangeTotals", () => {
  it("sums cash and card and counts only unverified flags", () => {
    const totals = rangeTotals([
      entry({ cashCents: 39800, cardCents: 64200 }),
      entry({ id: "e2", cashCents: 18150, cardCents: 36400, flagged: true, flaggedRaw: true }),
      entry({ id: "e3", cashCents: 1000, cardCents: 2000, flagged: false, flaggedRaw: true }), // verified
    ]);
    expect(totals).toEqual({ cashCents: 58950, cardCents: 102600, count: 3, flaggedCount: 1 });
  });
});

describe("dailyTrend", () => {
  it("totals cash+card per day, chronologically, only days with records", () => {
    const days = dailyTrend([
      entry({ businessDate: "2026-08-09", cashCents: 100, cardCents: 200 }),
      entry({ id: "e2", businessDate: "2026-08-07", cashCents: 50, cardCents: 25 }),
      entry({ id: "e3", businessDate: "2026-08-09", cashCents: 10, cardCents: 5 }),
    ]);
    expect(days).toEqual([
      { businessDate: "2026-08-07", totalCents: 75 },
      { businessDate: "2026-08-09", totalCents: 315 },
    ]);
  });
});

describe("takeHomeByPerson", () => {
  it("adds each entry's cash share to every name on the split", () => {
    const people = takeHomeByPerson([
      entry({
        cashCents: 39800,
        splitCount: 2,
        peopleIds: ["maria", "jose"],
        peopleNames: ["Maria", "Jose"],
      }),
      entry({
        id: "e2",
        cashCents: 10000,
        splitCount: 1,
        peopleIds: ["maria"],
        peopleNames: ["Maria"],
      }),
    ]);
    expect(people).toEqual([
      { id: "maria", name: "Maria", cents: 29900, shifts: 2 },
      { id: "jose", name: "Jose", cents: 19900, shifts: 1 },
    ]);
  });

  it("allocates the whole pool to the people actually on the split", () => {
    // v3: shares come from the weighted allocation over the people list —
    // nothing stays in the drawer, and split_count is headcount only.
    const people = takeHomeByPerson([
      entry({ cashCents: 300, splitCount: 3, peopleIds: ["a"], peopleNames: ["A"] }),
    ]);
    expect(people[0].cents).toBe(300);
  });

  it("weights the shares: one 50% person raises everyone else", () => {
    // The handoff's $205 vector: 45.56 / 45.56 / 45.55 / 45.55 / 22.78.
    const people = takeHomeByPerson([
      entry({
        cashCents: 20500,
        splitCount: 5,
        peopleIds: ["ana", "marco", "priya", "dee", "kenji"],
        peopleNames: ["Ana", "Marco", "Priya", "Dee", "Kenji"],
        weights: [1, 1, 1, 1, 0.5],
      }),
    ]);
    const byName = new Map(people.map((p) => [p.name, p.cents]));
    expect(byName.get("Ana")).toBe(4556);
    expect(byName.get("Marco")).toBe(4556);
    expect(byName.get("Priya")).toBe(4555);
    expect(byName.get("Dee")).toBe(4555);
    expect(byName.get("Kenji")).toBe(2278);
    expect(people.reduce((sum, p) => sum + p.cents, 0)).toBe(20500);
  });

  it("accumulates mixed weights across a range", () => {
    const people = takeHomeByPerson([
      entry({
        cashCents: 82200,
        splitCount: 2,
        peopleIds: ["sam", "rey"],
        peopleNames: ["Sam", "Rey"],
        weights: [1, 0.25],
      }),
      entry({
        id: "e2",
        businessDate: "2026-08-08",
        cashCents: 11800,
        splitCount: 2,
        peopleIds: ["sam", "rey"],
        peopleNames: ["Sam", "Rey"],
        weights: [0.5, 1],
      }),
    ]);
    const byName = new Map(people.map((p) => [p.name, p]));
    // 82200 → Sam 65760, Rey 16440; 11800 over [0.5, 1] → Sam 3933, Rey 7867.
    expect(byName.get("Sam")).toEqual({ id: "sam", name: "Sam", cents: 69693, shifts: 2 });
    expect(byName.get("Rey")).toEqual({ id: "rey", name: "Rey", cents: 24307, shifts: 2 });
  });

  it("breaks ties by name", () => {
    const people = takeHomeByPerson([
      entry({
        cashCents: 200,
        splitCount: 2,
        peopleIds: ["tom", "lena"],
        peopleNames: ["Tom", "Lena"],
      }),
    ]);
    expect(people.map((p) => p.name)).toEqual(["Lena", "Tom"]);
  });
});

describe("money formatting", () => {
  it("full cents and whole-dollar forms", () => {
    expect(moneyFromCents(681325)).toBe("$6,813.25");
    expect(wholeDollarsFromCents(681325)).toBe("$6,813");
    expect(wholeDollarsFromCents(681360)).toBe("$6,814"); // rounds
  });
});
