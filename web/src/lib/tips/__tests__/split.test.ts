import { describe, expect, it } from "vitest";
import { fromCents, perPersonShare, toCents, totalTips } from "../split";

describe("perPersonShare", () => {
  it("splits $100 three ways to $33.33 each (remainder stays in drawer)", () => {
    const share = perPersonShare(100, 0, 3);
    expect(share).toBe(33.33);
    // The documented rule: shares x count may differ from the pooled total.
    expect(share * 3).not.toBe(100);
  });

  it("avoids the (0.1 + 0.2) / 3 float trap", () => {
    // Naive float math gives 0.30000000000000004 / 3 = 0.10000000000000002.
    expect(perPersonShare(0.1, 0.2, 3)).toBe(0.1);
  });

  it("rounds half-up: $0.25 split 2 ways -> $0.13", () => {
    // 12.5 cents rounds up to 13 cents.
    expect(perPersonShare(0.25, 0, 2)).toBe(0.13);
  });

  it("rounds half-up: $100.01 split 2 ways -> $50.01", () => {
    // 5000.5 cents rounds up to 5001 cents.
    expect(perPersonShare(100.01, 0, 2)).toBe(50.01);
  });

  it("returns the exact total for a split of 1", () => {
    expect(perPersonShare(123.45, 67.89, 1)).toBe(191.34);
  });

  it("returns 0 when both amounts are 0", () => {
    expect(perPersonShare(0, 0, 4)).toBe(0);
  });

  it("returns 0 for invalid split counts", () => {
    expect(perPersonShare(100, 50, 0)).toBe(0);
    expect(perPersonShare(100, 50, -1)).toBe(0);
    expect(perPersonShare(100, 50, NaN)).toBe(0);
  });
});

describe("totalTips", () => {
  it("sums in integer cents so 0.1 + 0.2 is exactly 0.3", () => {
    expect(totalTips(0.1, 0.2)).toBe(0.3);
  });

  it("sums ordinary amounts exactly", () => {
    expect(totalTips(123.45, 67.89)).toBe(191.34);
  });
});

describe("toCents / fromCents", () => {
  it("rounds a true half-cent up (10.235 dollars floats to exactly 1023.5 cents)", () => {
    expect(toCents(10.235)).toBe(1024);
  });

  it("converts clean amounts exactly", () => {
    expect(toCents(0.1)).toBe(10);
    expect(toCents(0.2)).toBe(20);
    expect(toCents(33.33)).toBe(3333);
  });

  it("fromCents inverts toCents for cent-exact amounts", () => {
    expect(fromCents(toCents(33.33))).toBe(33.33);
    expect(fromCents(toCents(0.3))).toBe(0.3);
    expect(fromCents(30)).toBe(0.3);
  });
});
