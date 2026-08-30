import { describe, expect, it } from "vitest";
import {
  allocatePoolCents,
  fromCents,
  fullShareCents,
  perPersonShare,
  toCents,
  totalTips,
} from "../split";

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

describe("allocatePoolCents", () => {
  // The required vectors from the v3 handoff — exactly what the mockup's live
  // allocate() prints. Cents in, cents out.
  it("$205.00 with one 50% share raises everyone else: 45.56/45.56/45.55/45.55/22.78", () => {
    const shares = allocatePoolCents(20500, [1, 1, 1, 1, 0.5]);
    expect(shares).toEqual([4556, 4556, 4555, 4555, 2278]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(20500);
  });

  it("$205.00 all-full splits evenly: $41.00 x 5", () => {
    expect(allocatePoolCents(20500, [1, 1, 1, 1, 1])).toEqual([
      4100, 4100, 4100, 4100, 4100,
    ]);
  });

  it("$205.00 with a 75% share: full share $43.16, the 75% person $32.37", () => {
    const shares = allocatePoolCents(20500, [1, 1, 0.75, 1, 1]);
    expect(shares[2]).toBe(3237);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(20500);
    expect(fullShareCents(20500, [1, 1, 0.75, 1, 1])).toBe(4316);
  });

  it("$822.00 split 1 / 0.25: 657.60 and 164.40", () => {
    expect(allocatePoolCents(82200, [1, 0.25])).toEqual([65760, 16440]);
  });

  it("$118.00 three ways sums exactly; ties give the extra cent to the earliest position", () => {
    // The handoff's vector table shows the extra cent on the LAST person, but
    // that contradicts both its own $205/0.5 vector and the mockup's live
    // allocate() (stable fractional-desc sort => earliest position wins ties).
    // The live mockup is the tie-break authority. Flagged for David.
    const shares = allocatePoolCents(11800, [1, 1, 1]);
    expect(shares).toEqual([3934, 3933, 3933]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(11800);
  });

  it("a pool of 0 gives all zeros", () => {
    expect(allocatePoolCents(0, [1, 0.5, 0.25])).toEqual([0, 0, 0]);
  });

  it("one person takes everything at any weight", () => {
    expect(allocatePoolCents(20500, [0.25])).toEqual([20500]);
    expect(allocatePoolCents(20500, [1])).toEqual([20500]);
  });

  it("an empty or zero-weight list allocates nothing", () => {
    expect(allocatePoolCents(20500, [])).toEqual([]);
    expect(allocatePoolCents(20500, [0, 0])).toEqual([0, 0]);
  });

  it("a negative pool gives all zeros", () => {
    expect(allocatePoolCents(-500, [1, 1])).toEqual([0, 0]);
  });

  // Property-style invariants across many pools and weight mixes.
  it("shares always sum to the pool and are never negative (30 people, mixed weights)", () => {
    const cycle = [1, 0.75, 0.5, 0.25];
    const weights = Array.from({ length: 30 }, (_, i) => cycle[i % 4]);
    for (const pool of [1, 7, 99, 101, 12345, 1000003, 99999999]) {
      const shares = allocatePoolCents(pool, weights);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(pool);
      for (const share of shares) expect(share).toBeGreaterThanOrEqual(0);
    }
  });

  it("equal weights never differ by more than one cent", () => {
    for (const pool of [100, 101, 11800, 20500, 333333]) {
      for (const heads of [2, 3, 5, 7, 8]) {
        const shares = allocatePoolCents(pool, Array(heads).fill(1));
        const min = Math.min(...shares);
        const max = Math.max(...shares);
        expect(max - min).toBeLessThanOrEqual(1);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(pool);
      }
    }
  });

  it("a heavier weight never receives less than a lighter one", () => {
    const shares = allocatePoolCents(99999, [1, 0.75, 0.5, 0.25]);
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i - 1]).toBeGreaterThanOrEqual(shares[i]);
    }
  });
});

describe("fullShareCents", () => {
  it("matches the strip: $205.00 over weights 4.5 -> $45.56", () => {
    expect(fullShareCents(20500, [1, 1, 1, 1, 0.5])).toBe(4556);
  });

  it("equals the even split when all weights are 1", () => {
    expect(fullShareCents(20500, [1, 1, 1, 1, 1])).toBe(4100);
    expect(fullShareCents(11800, [1, 1, 1])).toBe(3933);
  });

  it("returns 0 for an empty pool or empty weights", () => {
    expect(fullShareCents(0, [1, 1])).toBe(0);
    expect(fullShareCents(100, [])).toBe(0);
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
