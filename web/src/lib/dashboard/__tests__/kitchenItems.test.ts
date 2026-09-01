import { describe, expect, it } from "vitest";
import {
  nextSortOrder,
  reorderItems,
  sortItems,
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

describe("reorderItems", () => {
  const list = [item("a", 1), item("b", 2), item("c", 3)];

  it("swaps with the neighbour and renumbers the whole list", () => {
    expect(reorderItems(list, "b", "up")?.map((i) => [i.id, i.sort_order])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
    expect(reorderItems(list, "b", "down")?.map((i) => [i.id, i.sort_order])).toEqual([
      ["a", 1],
      ["c", 2],
      ["b", 3],
    ]);
  });

  it("does nothing at the edges or for unknown ids", () => {
    expect(reorderItems(list, "a", "up")).toBeNull();
    expect(reorderItems(list, "c", "down")).toBeNull();
    expect(reorderItems(list, "zz", "up")).toBeNull();
  });

  it("gives tied positions distinct numbers so the move is visible", () => {
    const tied = [item("a", 0, "Alpha"), item("b", 0, "Beta"), item("c", 0, "Gamma")];
    expect(reorderItems(tied, "b", "up")?.map((i) => [i.id, i.sort_order])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
    ]);
    expect(sortItems(tied).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});
