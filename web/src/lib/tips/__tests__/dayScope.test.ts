import { describe, expect, it } from "vitest";
import {
  deriveShiftAmounts,
  enteredTotal,
  hasNegativeAmount,
  type MealAmounts,
} from "../dayScope";

const amounts = (cash: number, card: number, gratuity: number): MealAmounts => ({
  cash,
  card,
  gratuity,
});

describe("deriveShiftAmounts", () => {
  it("subtracts the lunch row field by field on day scope (the mockup's default state)", () => {
    const { derived, subtracted } = deriveShiftAmounts(
      amounts(323, 777, 216),
      "day",
      amounts(118, 142, 0),
    );
    expect(derived).toEqual(amounts(205, 635, 216));
    expect(subtracted).toBe(true);
  });

  it("passes typed figures through unchanged on shift scope", () => {
    const { derived, subtracted } = deriveShiftAmounts(
      amounts(323, 777, 216),
      "shift",
      amounts(118, 142, 0),
    );
    expect(derived).toEqual(amounts(323, 777, 216));
    expect(subtracted).toBe(false);
  });

  it("subtracts nothing when no lunch is on record (the flagged day_total_no_lunch case)", () => {
    const { derived, subtracted } = deriveShiftAmounts(
      amounts(822, 210, 0),
      "day",
      null,
    );
    expect(derived).toEqual(amounts(822, 210, 0));
    expect(subtracted).toBe(false);
  });

  it("computes in cents, avoiding float drift", () => {
    const { derived } = deriveShiftAmounts(
      amounts(0.3, 100.1, 0),
      "day",
      amounts(0.1, 0.2, 0),
    );
    expect(derived.cash).toBe(0.2);
    expect(derived.card).toBe(99.9);
  });

  it("can go negative — the caller decides what to do with it", () => {
    const { derived } = deriveShiftAmounts(
      amounts(50, 200, 0),
      "day",
      amounts(118, 142, 0),
    );
    expect(derived.cash).toBe(-68);
    expect(derived.card).toBe(58);
    expect(hasNegativeAmount(derived)).toBe(true);
  });

  it("a zero entry against a recorded lunch is fully negative", () => {
    const { derived } = deriveShiftAmounts(
      amounts(0, 0, 0),
      "day",
      amounts(118, 142, 5),
    );
    expect(derived).toEqual(amounts(-118, -142, -5));
    expect(hasNegativeAmount(derived)).toBe(true);
  });

  it("zero lunch on record subtracts zero but still counts as subtracted", () => {
    const { derived, subtracted } = deriveShiftAmounts(
      amounts(100, 50, 0),
      "day",
      amounts(0, 0, 0),
    );
    expect(derived).toEqual(amounts(100, 50, 0));
    expect(subtracted).toBe(true);
  });
});

describe("hasNegativeAmount", () => {
  it("is false for all-zero amounts", () => {
    expect(hasNegativeAmount(amounts(0, 0, 0))).toBe(false);
  });

  it("is true when any single field dips below zero", () => {
    expect(hasNegativeAmount(amounts(0, 0, -0.01))).toBe(true);
    expect(hasNegativeAmount(amounts(-0.01, 10, 0))).toBe(true);
    expect(hasNegativeAmount(amounts(10, -0.01, 0))).toBe(true);
  });
});

describe("enteredTotal", () => {
  it("sums all three buckets cent-exactly", () => {
    expect(enteredTotal(amounts(323, 777, 216))).toBe(1316);
    expect(enteredTotal(amounts(0.1, 0.2, 0.3))).toBe(0.6);
  });
});
