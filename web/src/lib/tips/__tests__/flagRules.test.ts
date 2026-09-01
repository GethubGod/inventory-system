import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../dashboardDerive";
import {
  applyFlagRules,
  DEFAULT_FLAG_RULES,
  describeStoredReason,
  flagReasons,
  parseFlagRules,
} from "../flagRules";

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "e1",
    businessDate: "2026-08-31",
    locationId: "loc",
    meal: "dinner",
    cashCents: 1500,
    cardCents: 16000,
    splitCount: 2,
    peopleIds: ["a", "b"],
    peopleNames: ["Xander", "Ma"],
    weights: [1, 1],
    gratuityCents: 0,
    enteredScope: "day",
    rawCashCents: 1500,
    rawCardCents: 16000,
    rawGratuityCents: 0,
    note: null,
    noteAt: null,
    enteredById: null,
    enteredByName: null,
    entryMethod: "typed",
    flagged: true,
    flaggedRaw: true,
    flagVerifiedAt: null,
    anomalyReason: "day_total_no_lunch",
    createdAt: "2026-09-01T04:00:00Z",
    ...overrides,
  };
}

describe("describeStoredReason", () => {
  it("turns the no-lunch code into a sentence", () => {
    expect(describeStoredReason("day_total_no_lunch")).toEqual([
      { kind: "no_lunch", text: expect.stringContaining("before lunch was recorded") },
    ]);
  });

  it("rewrites the statistical reason with dollar amounts", () => {
    const [part] = describeStoredReason("cash $500.00 vs typical $10-$30 (max ever $40)");
    expect(part.kind).toBe("unusual");
    expect(part.text).toBe(
      "Cash $500.00 is far above the usual $10.00 to $30.00 for this shift (highest before this: $40.00).",
    );
  });

  it("splits a combined reason into both parts", () => {
    const parts = describeStoredReason(
      "day_total_no_lunch; card $900.00 vs typical $100-$200 (max ever $250)",
    );
    expect(parts.map((part) => part.kind)).toEqual(["no_lunch", "unusual"]);
  });

  it("passes unknown text through and handles null", () => {
    expect(describeStoredReason("something else")).toEqual([{ kind: "unusual", text: "something else" }]);
    expect(describeStoredReason(null)).toEqual([]);
  });
});

describe("flagReasons + applyFlagRules", () => {
  it("flags the no-lunch case only while that rule is on", () => {
    expect(flagReasons(entry(), DEFAULT_FLAG_RULES)).toHaveLength(1);
    expect(flagReasons(entry(), { ...DEFAULT_FLAG_RULES, noLunch: false })).toHaveLength(0);
    expect(applyFlagRules(entry(), { ...DEFAULT_FLAG_RULES, noLunch: false }).flagged).toBe(false);
  });

  it("keeps a verified row clear whatever the rules say", () => {
    const verified = entry({ flagged: false, flagVerifiedAt: "2026-09-01T05:00:00Z" });
    expect(applyFlagRules(verified, DEFAULT_FLAG_RULES).flagged).toBe(false);
    expect(
      applyFlagRules(verified, { ...DEFAULT_FLAG_RULES, cashOverCents: 100 }).flagged,
    ).toBe(false);
  });

  it("applies the cash and card limits to rows that were never flagged at save", () => {
    const quiet = entry({ flagged: false, flaggedRaw: false, anomalyReason: null });
    expect(flagReasons(quiet, DEFAULT_FLAG_RULES)).toHaveLength(0);
    const reasons = flagReasons(quiet, {
      ...DEFAULT_FLAG_RULES,
      cashOverCents: 1000,
      cardOverCents: 20000,
    });
    expect(reasons).toEqual([
      { kind: "cash_over", text: "Cash $15.00 is over the $10.00 limit you set." },
    ]);
    expect(applyFlagRules(quiet, { ...DEFAULT_FLAG_RULES, cashOverCents: 1000 }).flagged).toBe(true);
  });

  it("treats a legacy flagged row with no reason as an unusual amount", () => {
    const legacy = entry({ anomalyReason: null });
    expect(flagReasons(legacy, DEFAULT_FLAG_RULES)[0]?.kind).toBe("unusual");
    expect(flagReasons(legacy, { ...DEFAULT_FLAG_RULES, unusualAmounts: false })).toHaveLength(0);
  });

  it("returns the same object when nothing changes", () => {
    const row = entry();
    expect(applyFlagRules(row, DEFAULT_FLAG_RULES)).toBe(row);
  });
});

describe("parseFlagRules", () => {
  it("falls back to defaults on junk and validates limits", () => {
    expect(parseFlagRules(null)).toEqual(DEFAULT_FLAG_RULES);
    expect(parseFlagRules("nope")).toEqual(DEFAULT_FLAG_RULES);
    expect(
      parseFlagRules({ noLunch: false, unusualAmounts: "yes", cashOverCents: -5, cardOverCents: 250.4 }),
    ).toEqual({ noLunch: false, unusualAmounts: true, cashOverCents: null, cardOverCents: 250 });
  });
});
