import { describe, expect, it } from "vitest";
import {
  moveItem,
  nextSortOrder,
  validateKitchenItemInput,
  type KitchenItemRecord,
} from "../kitchenItems";

function item(id: string, sort_order: number, name = id): KitchenItemRecord {
  return { id, name, unit: "pieces", location_id: null, sort_order, active: true };
}

describe("validateKitchenItemInput", () => {
  it("requires a name and a unit within length limits", () => {
    expect(validateKitchenItemInput({ name: " ", unit: "tubs", location_id: null })).toMatch(
      /name/,
    );
    expect(validateKitchenItemInput({ name: "Rice", unit: "", location_id: null })).toMatch(
      /unit/,
    );
    expect(
      validateKitchenItemInput({ name: "x".repeat(61), unit: "tubs", location_id: null }),
    ).toMatch(/60/);
    expect(
      validateKitchenItemInput({ name: "Rice", unit: "y".repeat(25), location_id: null }),
    ).toMatch(/24/);
    expect(validateKitchenItemInput({ name: " Rice ", unit: "tubs", location_id: null })).toBeNull();
  });
});

describe("nextSortOrder", () => {
  it("is one past the highest existing position", () => {
    expect(nextSortOrder([])).toBe(1);
    expect(nextSortOrder([item("a", 3), item("b", 7)])).toBe(8);
  });
});

describe("moveItem", () => {
  const list = [item("a", 1), item("b", 2), item("c", 3)];

  it("swaps positions with the neighbour", () => {
    expect(moveItem(list, "b", "up")).toEqual([
      { id: "b", sort_order: 1 },
      { id: "a", sort_order: 2 },
    ]);
    expect(moveItem(list, "b", "down")).toEqual([
      { id: "b", sort_order: 3 },
      { id: "c", sort_order: 2 },
    ]);
  });

  it("does nothing at the edges or for unknown ids", () => {
    expect(moveItem(list, "a", "up")).toEqual([]);
    expect(moveItem(list, "c", "down")).toEqual([]);
    expect(moveItem(list, "zz", "up")).toEqual([]);
  });

  it("separates tied positions so the move is visible", () => {
    const tied = [item("a", 0, "Alpha"), item("b", 0, "Beta")];
    expect(moveItem(tied, "b", "up")).toEqual([
      { id: "b", sort_order: 0 },
      { id: "a", sort_order: 1 },
    ]);
    expect(moveItem(tied, "a", "down")).toEqual([
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 0 },
    ]);
  });
});
