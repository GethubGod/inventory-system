import { describe, expect, it } from "vitest";
import {
  itemProvenanceLabel,
  nextSortOrder,
  normalizeSendMode,
  parseRecommendedQty,
  sortChecklistItems,
  unitForInventoryRow,
  type ChecklistItemRecord,
} from "../ordering";

function makeItem(
  overrides: Partial<ChecklistItemRecord> = {},
): ChecklistItemRecord {
  return {
    id: "item-1",
    itemId: "inv-1",
    itemName: "Salmon",
    unit: "lb",
    defaultChecked: true,
    recommendedQty: 3,
    stalenessBucket: "frequent",
    itemSource: "generated",
    sortOrder: 0,
    ...overrides,
  };
}

describe("normalizeSendMode", () => {
  it("returns direct only for the exact value", () => {
    expect(normalizeSendMode("direct")).toBe("direct");
    expect(normalizeSendMode("review")).toBe("review");
    expect(normalizeSendMode(null)).toBe("review");
    expect(normalizeSendMode("DIRECT")).toBe("review");
  });
});

describe("parseRecommendedQty", () => {
  it("clears on empty input", () => {
    expect(parseRecommendedQty("")).toEqual({ ok: true, value: null });
    expect(parseRecommendedQty("   ")).toEqual({ ok: true, value: null });
  });

  it("accepts positive numbers rounded to two decimals", () => {
    expect(parseRecommendedQty("3")).toEqual({ ok: true, value: 3 });
    expect(parseRecommendedQty(" 2.505 ")).toEqual({ ok: true, value: 2.51 });
  });

  it("rejects zero, negatives, and non-numbers", () => {
    expect(parseRecommendedQty("0")).toEqual({ ok: false });
    expect(parseRecommendedQty("-1")).toEqual({ ok: false });
    expect(parseRecommendedQty("abc")).toEqual({ ok: false });
    expect(parseRecommendedQty("Infinity")).toEqual({ ok: false });
  });
});

describe("unitForInventoryRow", () => {
  it("prefers default order unit, then base, then pack", () => {
    expect(
      unitForInventoryRow({
        default_order_unit: "case",
        base_unit: "lb",
        pack_unit: "box",
      }),
    ).toBe("case");
    expect(
      unitForInventoryRow({
        default_order_unit: " ",
        base_unit: "lb",
        pack_unit: "box",
      }),
    ).toBe("lb");
    expect(
      unitForInventoryRow({
        default_order_unit: null,
        base_unit: "",
        pack_unit: "box",
      }),
    ).toBe("box");
    expect(
      unitForInventoryRow({
        default_order_unit: null,
        base_unit: null,
        pack_unit: null,
      }),
    ).toBe("unit");
  });
});

describe("sortChecklistItems", () => {
  it("orders by sort_order then name without mutating input", () => {
    const items = [
      makeItem({ id: "c", itemName: "Zucchini", sortOrder: 1 }),
      makeItem({ id: "b", itemName: "Avocado", sortOrder: 1 }),
      makeItem({ id: "a", itemName: "Salmon", sortOrder: 0 }),
    ];
    const sorted = sortChecklistItems(items);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(items.map((item) => item.id)).toEqual(["c", "b", "a"]);
  });
});

describe("nextSortOrder", () => {
  it("appends after the highest sort order", () => {
    expect(
      nextSortOrder([makeItem({ sortOrder: 4 }), makeItem({ sortOrder: 9 })]),
    ).toBe(10);
  });

  it("starts at zero for an empty checklist", () => {
    expect(nextSortOrder([])).toBe(0);
  });
});

describe("itemProvenanceLabel", () => {
  it("labels manual and imported rows by source", () => {
    expect(
      itemProvenanceLabel({ itemSource: "manual", stalenessBucket: "frequent" }),
    ).toBe("Added");
    expect(
      itemProvenanceLabel({ itemSource: "import", stalenessBucket: null }),
    ).toBe("Imported");
  });

  it("labels generated rows by staleness bucket", () => {
    expect(
      itemProvenanceLabel({
        itemSource: "generated",
        stalenessBucket: "occasional",
      }),
    ).toBe("Occasional");
    expect(
      itemProvenanceLabel({ itemSource: "generated", stalenessBucket: null }),
    ).toBe("History");
  });
});
