/**
 * Quick Order parser contract and UI context notes.
 *
 * Active Google Sheets config tables:
 * - qo_items: owner-maintained parser catalog config linked to inventory_items.
 * - qo_reorder_rules: global/location inventory reorder thresholds.
 * - qo_personalization: employee aliases and employee item_config rows.
 * - qo_keywords: ignore phrases, unit aliases, and status terms.
 * - qo_holiday_overrides: synced for future use; not consumed at runtime yet.
 *
 * Resolution order:
 * - Preprocess: strip qo_keywords(ignore), then apply qo_keywords(status_term).
 * - Item: qo_personalization alias, qo_items aliases, qo_items exact name,
 *   qo_items fuzzy name.
 * - Unit:
 *   - No typed unit: qo_personalization personal_unit for that employee/item,
 *     then qo_items.order_unit.
 *   - Typed unit: match qo_personalization personal_unit or
 *     personal_unit_equals first. If it does not match personalization but does
 *     match qo_items.order_unit or a qo_keywords unit_alias for that global
 *     unit, use global ordering logic. If it matches neither, return
 *     status="unit_unrecognized" and ask the employee to retype using a
 *     suggested unit; do not add an item or fire a recommendation.
 * - Reorder: qo_personalization thresholds, qo_reorder_rules, qo_items
 *   target_stock, item_reorder_rules, item_order_profiles, then no order.
 *   When the resolved stock quantity is exactly 0, skip qo_personalization
 *   thresholds and start with qo_reorder_rules.
 *
 * Unit decision tree:
 * Did the employee specify a unit?
 * - No: use the employee personal_unit for this item when configured; otherwise
 *   use qo_items.order_unit.
 * - Yes, and it matches personal_unit or personal_unit_equals: use
 *   personalization thresholds.
 * - Yes, and it misses personalization but matches qo_items.order_unit or a
 *   qo_keywords unit_alias for that unit: use global reorder logic and skip
 *   personalization thresholds.
 * - Yes, and it matches neither: return unit_unrecognized with suggested units
 *   ordered personal unit first, then item default, then relevant aliases.
 *
 * Custom counting units: when qo_personalization has personal_unit but no
 * personal_unit_equals, the parser treats that word as employee-only stock
 * state. Example: Nate can count Tamago as "10 order"; the snapshot is written
 * with tracking_unit="order". The recommendation engine compares Nate's
 * threshold in the same tracking_unit space and still emits the configured
 * order_qty/order_unit such as "1 pack".
 *
 * Deprecated sheet-driven tables no longer drive parser behavior:
 * quick_order_alias_rules, quick_order_unit_rules, quick_order_reorder_rules,
 * quick_order_status_terms, employee_quick_order_aliases,
 * inventory_reorder_rules, inventory_status_terms, unit_synonyms,
 * item_allowed_units, and item_order_limits. item_reorder_rules and
 * item_order_profiles remain as the lowest-priority legacy smart-ordering
 * fallbacks.
 *
 * This file also builds the short gray "why" lines shown above a Quick Order
 * reply whenever a non-obvious rule, alias, correction, unit, or match decision
 * shaped the result.
 */

/** Which kind of behind-the-scenes decision a note explains. */
export type QuickOrderContextNoteCategory =
  | "inventory_rule"
  | "personal_context"
  | "correction"
  | "unit"
  | "match";

export type QuickOrderContextNote = {
  category: QuickOrderContextNoteCategory;
  text: string;
};

/** Minimal shape of a parsed order item this builder reads. */
type ContextParsedItem = {
  item_id?: string | null;
  item_name?: string;
  display_name?: string;
  raw_token?: string;
  raw_text?: string;
  match_type?: string;
  matched_alias?: string | null;
  parse_source?: string;
  needs_clarification?: boolean;
  reason_codes?: string[];
  user_visible_note?: string | null;
};

/** Minimal shape of a stock update this builder reads. */
type ContextStockUpdate = {
  item_name?: string;
  unit?: string | null;
  original_text?: string;
  personal_alias?: string | null;
  unit_inferred?: boolean;
  reason_codes?: string[];
  user_visible_note?: string | null;
};

/** Minimal shape of a safety warning this builder reads. */
type ContextSafetyWarning = {
  type?: string;
  message?: string;
  item_name?: string | null;
  reason_codes?: string[];
  user_visible_note?: string | null;
};

/** Minimal shape of a recommendation this builder reads. */
type ContextRecommendation = {
  reason_codes?: string[];
  user_visible_note?: string | null;
};

/** Minimal shape of an inventory "Updated" row this builder reads. */
type ContextInventoryUpdate = {
  item_name?: string;
  no_order_reason?: string | null;
};

export type QuickOrderContextNotesInput = {
  parsedItems?: ContextParsedItem[];
  stockUpdates?: ContextStockUpdate[];
  recommendations?: ContextRecommendation[];
  safetyWarnings?: ContextSafetyWarning[];
  inventoryUpdates?: ContextInventoryUpdate[];
};

const clean = (value: string | null | undefined): string => (value ?? "").trim();

/** Disclosure heading per category, in the priority order below. */
const CATEGORY_HEADERS: Record<QuickOrderContextNoteCategory, string> = {
  inventory_rule: "Inventory rules",
  personal_context: "Personal context",
  correction: "Saved corrections",
  unit: "Unit handling",
  match: "Item matching",
};

/**
 * When a reply mixes categories we still show one heading. Inventory rules win
 * (they explain a surprising "no order"), then personal context, and so on.
 */
const CATEGORY_PRIORITY: QuickOrderContextNoteCategory[] = [
  "inventory_rule",
  "personal_context",
  "correction",
  "unit",
  "match",
];

/** The single heading shown above a set of notes (see {@link CATEGORY_PRIORITY}). */
export function getQuickOrderContextNotesHeader(
  notes: QuickOrderContextNote[],
): string {
  for (const category of CATEGORY_PRIORITY) {
    if (notes.some((note) => note.category === category)) {
      return CATEGORY_HEADERS[category];
    }
  }
  return "Context";
}

export function buildQuickOrderContextNotes(
  input: QuickOrderContextNotesInput,
): QuickOrderContextNote[] {
  const notes: QuickOrderContextNote[] = [];
  const seen = new Set<string>();
  const add = (text: string, category: QuickOrderContextNoteCategory) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    notes.push({ category, text: trimmed });
  };

  // Inventory rules first: these explain a result the user can't infer from the
  // card alone — most often "I counted it but did not add an order."
  for (const warning of input.safetyWarnings ?? []) {
    addRuleMetadataNote(warning, add);
    if (warning.type !== "no_order_needed") continue;
    add(clean(warning.message), "inventory_rule");
  }
  for (const update of input.inventoryUpdates ?? []) {
    add(clean(update.no_order_reason), "inventory_rule");
  }

  for (const recommendation of input.recommendations ?? []) {
    addRuleMetadataNote(recommendation, add);
  }

  for (const update of input.stockUpdates ?? []) {
    addRuleMetadataNote(update, add);
    const itemName = clean(update.item_name);
    const alias = clean(update.personal_alias);
    if (alias && itemName) {
      add(`“${alias}” → ${itemName}`, "personal_context");
    }
    const original = clean(update.original_text);
    const unit = clean(update.unit);
    // "box" counted as "case" — the employee typed one word, saw another.
    if (unit.toLowerCase() === "cs" && /\bbox(?:es)?\b/i.test(original)) {
      add(`Counted “box” as case`, "unit");
    } else if (update.unit_inferred && unit && itemName) {
      add(`No unit entered — counted ${itemName} in ${unit}`, "unit");
    }
  }

  for (const item of input.parsedItems ?? []) {
    addRuleMetadataNote(item, add);
    if (!item.item_id || item.needs_clarification) continue;
    const itemName = clean(item.item_name) || clean(item.display_name);
    const typed = clean(item.matched_alias) || clean(item.raw_token) || clean(item.raw_text);
    if (!itemName) continue;

    if (item.match_type === "employee_alias" && typed) {
      add(`“${typed}” → ${itemName}`, "personal_context");
    } else if (item.parse_source === "correction" && typed) {
      add(`Applied a saved correction: “${typed}” → ${itemName}`, "correction");
    } else if (item.match_type === "fuzzy" && typed && typed.toLowerCase() !== itemName.toLowerCase()) {
      add(`Closest match for “${typed}” → ${itemName}`, "match");
    }
  }

  return notes;
}

function addRuleMetadataNote(
  entry: { reason_codes?: string[]; user_visible_note?: string | null },
  add: (text: string, category: QuickOrderContextNoteCategory) => void,
) {
  const note = clean(entry.user_visible_note);
  if (!note) return;
  const codes = entry.reason_codes ?? [];
  if (codes.some((code) => code.includes("reorder") || code.includes("status") || code.includes("no_order"))) {
    add(note, "inventory_rule");
  } else if (codes.some((code) => code.includes("employee"))) {
    add(note, "personal_context");
  } else if (codes.some((code) => code.includes("unit"))) {
    add(note, "unit");
  } else {
    add(note, "match");
  }
}
