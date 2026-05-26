import {
  buildQuickOrderContextNotes,
  getQuickOrderContextNotesHeader,
} from "../features/ordering/quickOrderContextNotes";

describe("buildQuickOrderContextNotes", () => {
  test("returns no notes for an obvious exact match", () => {
    expect(
      buildQuickOrderContextNotes({
        parsedItems: [
          { item_id: "salmon-id", item_name: "Salmon", raw_token: "salmon", match_type: "exact_name" },
        ],
      }),
    ).toEqual([]);
  });

  test("surfaces a personal alias from a stock update", () => {
    expect(
      buildQuickOrderContextNotes({
        stockUpdates: [
          { item_name: "Ebi (Cooked Shrimp)", unit: "pack", personal_alias: "shrimp", original_text: "shrimp 1 pk" },
        ],
      }),
    ).toEqual([
      { category: "personal_context", text: "“shrimp” → Ebi (Cooked Shrimp)" },
    ]);
  });

  test("surfaces a personal alias from a parsed order item", () => {
    expect(
      buildQuickOrderContextNotes({
        parsedItems: [
          { item_id: "ebi-id", item_name: "Ebi (Cooked Shrimp)", raw_token: "shrimp", matched_alias: "shrimp", match_type: "employee_alias" },
        ],
      }),
    ).toEqual([
      { category: "personal_context", text: "“shrimp” → Ebi (Cooked Shrimp)" },
    ]);
  });

  test("explains an inferred unit", () => {
    expect(
      buildQuickOrderContextNotes({
        stockUpdates: [
          { item_name: "Salmon", unit: "cs", unit_inferred: true, original_text: "salmon 2" },
        ],
      }),
    ).toEqual([
      { category: "unit", text: "No unit entered — counted Salmon in cs" },
    ]);
  });

  test("explains box → case synonym, taking priority over inferred-unit", () => {
    expect(
      buildQuickOrderContextNotes({
        stockUpdates: [
          { item_name: "Salmon", unit: "cs", unit_inferred: true, original_text: "salmon 2 box" },
        ],
      }),
    ).toEqual([{ category: "unit", text: "Counted “box” as case" }]);
  });

  test("explains a saved correction and a fuzzy match", () => {
    expect(
      buildQuickOrderContextNotes({
        parsedItems: [
          { item_id: "salmon-id", item_name: "Salmon", raw_token: "salmn", parse_source: "correction" },
          { item_id: "uni-id", item_name: "Uni", raw_token: "oonie", match_type: "fuzzy" },
        ],
      }),
    ).toEqual([
      { category: "correction", text: "Applied a saved correction: “salmn” → Salmon" },
      { category: "match", text: "Closest match for “oonie” → Uni" },
    ]);
  });

  test("ignores items that still need clarification", () => {
    expect(
      buildQuickOrderContextNotes({
        parsedItems: [
          { item_id: "ebi-id", item_name: "Ebi", matched_alias: "shrimp", match_type: "employee_alias", needs_clarification: true },
        ],
      }),
    ).toEqual([]);
  });

  test("surfaces an inventory rule that suppressed an order", () => {
    expect(
      buildQuickOrderContextNotes({
        safetyWarnings: [
          {
            type: "no_order_needed",
            item_name: "Salmon",
            message: 'Salmon — no order needed. "a lot" means enough stock.',
          },
        ],
      }),
    ).toEqual([
      {
        category: "inventory_rule",
        text: 'Salmon — no order needed. "a lot" means enough stock.',
      },
    ]);
  });

  test("surfaces an inventory rule from an Updated row's no_order_reason", () => {
    expect(
      buildQuickOrderContextNotes({
        inventoryUpdates: [
          { item_name: "Salmon", no_order_reason: "Above reorder range — no order needed." },
        ],
      }),
    ).toEqual([
      { category: "inventory_rule", text: "Above reorder range — no order needed." },
    ]);
  });

  test("deduplicates a note that appears in both a stock update and a parsed item", () => {
    expect(
      buildQuickOrderContextNotes({
        stockUpdates: [
          { item_name: "Ebi (Cooked Shrimp)", unit: "pack", personal_alias: "shrimp", original_text: "shrimp" },
        ],
        parsedItems: [
          { item_id: "ebi-id", item_name: "Ebi (Cooked Shrimp)", matched_alias: "shrimp", match_type: "employee_alias" },
        ],
      }),
    ).toEqual([
      { category: "personal_context", text: "“shrimp” → Ebi (Cooked Shrimp)" },
    ]);
  });
});

describe("getQuickOrderContextNotesHeader", () => {
  test("labels inventory-rule notes", () => {
    expect(
      getQuickOrderContextNotesHeader([
        { category: "inventory_rule", text: "no order needed" },
      ]),
    ).toBe("Inventory rules");
  });

  test("labels personal-context notes", () => {
    expect(
      getQuickOrderContextNotesHeader([
        { category: "personal_context", text: "“shrimp” → Ebi" },
      ]),
    ).toBe("Personal context");
  });

  test("inventory rules win when categories are mixed", () => {
    expect(
      getQuickOrderContextNotesHeader([
        { category: "personal_context", text: "“shrimp” → Ebi" },
        { category: "inventory_rule", text: "no order needed" },
      ]),
    ).toBe("Inventory rules");
  });
});
