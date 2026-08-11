import {
  getParsedItemDisplayName,
  getParsedItemIssue,
  type ParsedQuickOrderItem,
} from "./quickOrderItems";
import type {
  QuickOrderRecommendation,
  QuickOrderSafetyWarning,
  QuickOrderStockUpdate,
} from "./quickOrderResponse";

export type QuickOrderInventoryUpdateStatus =
  | "ordered"
  | "no_order"
  | "needs_input";

/**
 * One row of the inventory-mode "Updated" card: the item the user counted, its
 * current on-hand quantity/phrase, and the quantity the system chose to order.
 */
export type QuickOrderInventoryUpdate = {
  item_id: string;
  item_name: string;
  current_quantity: number | null;
  current_unit: string | null;
  /** Used for non-numeric stock phrases such as "a lot". */
  current_label?: string | null;
  new_quantity: number | null;
  new_unit: string | null;
  status?: QuickOrderInventoryUpdateStatus;
  no_order_reason?: string | null;
  issue_message?: string | null;
  source_text?: string | null;
  composer_prefill?: string | null;
};

export function buildInventoryUpdateRows(input: {
  stockUpdates: QuickOrderStockUpdate[];
  recommendations: QuickOrderRecommendation[];
  safetyWarnings?: QuickOrderSafetyWarning[];
  reviewItems?: ParsedQuickOrderItem[];
  rawText?: string;
}): QuickOrderInventoryUpdate[] {
  const safetyWarnings = input.safetyWarnings ?? [];
  const recommendationByItemId = new Map<string, QuickOrderRecommendation>();
  for (const recommendation of input.recommendations) {
    if (!recommendation.item_id) continue;
    if (!recommendationByItemId.has(recommendation.item_id)) {
      recommendationByItemId.set(recommendation.item_id, recommendation);
    }
  }

  const noOrderWarningByKey = indexWarnings(
    safetyWarnings.filter((warning) => warning.type === "no_order_needed"),
  );
  const needsInputWarningByKey = indexWarnings(
    safetyWarnings.filter(isNeedsInputInventoryWarning),
  );

  const rows: QuickOrderInventoryUpdate[] = input.stockUpdates.map((update) => {
    const keys = keysFor(update.item_id, update.item_name);
    const recommendation = update.item_id
      ? recommendationByItemId.get(update.item_id)
      : undefined;
    const needsInputWarning = findByKeys(needsInputWarningByKey, keys);
    const noOrderWarning = findByKeys(noOrderWarningByKey, keys);
    const status: QuickOrderInventoryUpdateStatus = needsInputWarning
      ? "needs_input"
      : recommendation
        ? "ordered"
        : "no_order";

    return {
      item_id: update.item_id,
      item_name: update.item_name,
      current_quantity: update.quantity,
      current_unit: update.unit,
      new_quantity: recommendation ? recommendation.suggested_quantity : null,
      new_unit: recommendation ? recommendation.unit : update.unit,
      status,
      no_order_reason: noOrderWarning?.message ?? null,
      issue_message: needsInputWarning?.message ?? null,
      source_text: update.original_text ?? null,
      composer_prefill:
        status === "needs_input"
          ? buildNeedsInputPrefill(update.original_text, update.item_name)
          : null,
    };
  });

  const existingKeys = new Set(
    rows.flatMap((row) => keysFor(row.item_id, row.item_name)),
  );

  for (const warning of safetyWarnings) {
    if (warning.type !== "no_order_needed" && !isNeedsInputInventoryWarning(warning)) {
      continue;
    }
    const itemName = warning.item_name?.trim();
    if (!itemName) continue;
    const keys = keysFor(warning.item_id ?? null, itemName);
    if (keys.some((key) => existingKeys.has(key))) continue;
    keys.forEach((key) => existingKeys.add(key));
    const needsInput = isNeedsInputInventoryWarning(warning);
    rows.push({
      item_id: warning.item_id ?? keys[0] ?? itemName,
      item_name: itemName,
      current_quantity: warning.quantity ?? null,
      current_unit: warning.unit ?? null,
      current_label:
        warning.quantity == null ? inferCurrentLabelFromWarning(warning) : null,
      new_quantity: null,
      new_unit: warning.unit ?? null,
      status: needsInput ? "needs_input" : "no_order",
      no_order_reason: warning.type === "no_order_needed" ? warning.message : null,
      issue_message: needsInput ? warning.message : null,
      source_text: warning.original_text ?? null,
      composer_prefill: needsInput
        ? buildNeedsInputPrefill(warning.original_text, itemName)
        : null,
    });
  }

  for (const recommendation of input.recommendations) {
    const itemName = recommendation.item_name?.trim();
    if (!itemName) continue;
    const keys = keysFor(recommendation.item_id, itemName);
    if (keys.some((key) => existingKeys.has(key))) continue;
    keys.forEach((key) => existingKeys.add(key));
    rows.push({
      item_id: recommendation.item_id,
      item_name: itemName,
      current_quantity: null,
      current_unit: null,
      new_quantity: recommendation.suggested_quantity,
      new_unit: recommendation.unit,
      status: "ordered",
      no_order_reason: null,
      issue_message: null,
      source_text: itemName,
      composer_prefill: null,
    });
  }

  for (const item of input.reviewItems ?? []) {
    if (!getParsedItemIssue(item)) continue;
    const itemName = getParsedItemDisplayName(item);
    const keys = keysFor(item.item_id, itemName);
    if (keys.some((key) => existingKeys.has(key))) continue;
    keys.forEach((key) => existingKeys.add(key));
    rows.push({
      item_id: item.item_id ?? keys[0] ?? itemName,
      item_name: itemName,
      current_quantity: item.quantity,
      current_unit: item.unit,
      current_label: item.quantity == null ? item.raw_token ?? item.raw_text ?? null : null,
      new_quantity: null,
      new_unit: item.unit,
      status: "needs_input",
      issue_message:
        item.user_visible_note ?? item.issue ?? getParsedItemIssue(item)?.label ?? "Needs input",
      source_text: item.raw_text ?? item.raw_token ?? null,
      composer_prefill: buildNeedsInputPrefill(item.raw_text ?? item.raw_token, itemName),
    });
  }

  return orderRowsBySourceText(rows, input.rawText);
}

export function getInventoryUpdateStatus(
  update: QuickOrderInventoryUpdate,
): QuickOrderInventoryUpdateStatus {
  if (
    update.status === "ordered" ||
    update.status === "no_order" ||
    update.status === "needs_input"
  ) {
    return update.status;
  }
  return update.new_quantity != null ? "ordered" : "no_order";
}

export function filterInventoryItemsForOrderList(
  items: ParsedQuickOrderItem[],
): ParsedQuickOrderItem[] {
  return items.filter((item) => getParsedItemIssue(item) == null);
}

function isNeedsInputInventoryWarning(warning: QuickOrderSafetyWarning): boolean {
  return warning.type === "recommendation_unavailable" || warning.type === "unusual_unit";
}

function indexWarnings(warnings: QuickOrderSafetyWarning[]) {
  const map = new Map<string, QuickOrderSafetyWarning>();
  for (const warning of warnings) {
    for (const key of keysFor(warning.item_id ?? null, warning.item_name ?? null)) {
      if (!map.has(key)) map.set(key, warning);
    }
  }
  return map;
}

function findByKeys<T>(map: Map<string, T>, keys: string[]): T | undefined {
  for (const key of keys) {
    const value = map.get(key);
    if (value) return value;
  }
  return undefined;
}

function keysFor(itemId: string | null | undefined, itemName: string | null | undefined): string[] {
  const keys: string[] = [];
  const id = itemId?.trim();
  const name = itemName?.trim().toLowerCase();
  if (id) keys.push(`id:${id}`);
  if (name) keys.push(`name:${name}`);
  return keys;
}

function inferCurrentLabelFromWarning(warning: QuickOrderSafetyWarning): string | null {
  const quoted =
    warning.message.match(/"([^"]+)"/)?.[1] ??
    warning.user_visible_note?.match(/"([^"]+)"/)?.[1] ??
    null;
  if (quoted?.trim()) return quoted.trim();
  if (warning.type === "no_order_needed" && /enough stock/i.test(warning.message)) {
    return "enough";
  }
  return null;
}

function buildNeedsInputPrefill(
  sourceText: string | null | undefined,
  itemName: string,
): string {
  const original = sourceText?.trim();
  if (original) return original;
  return itemName.trim();
}

function orderRowsBySourceText(
  rows: QuickOrderInventoryUpdate[],
  rawText: string | undefined,
): QuickOrderInventoryUpdate[] {
  const haystack = rawText?.toLowerCase();
  if (!haystack) return rows;
  return rows
    .map((row, index) => ({
      row,
      index,
      position: sourcePosition(haystack, row),
    }))
    .sort((a, b) => a.position - b.position || a.index - b.index)
    .map((entry) => entry.row);
}

function sourcePosition(haystack: string, row: QuickOrderInventoryUpdate): number {
  const source = row.source_text?.trim().toLowerCase();
  if (source) {
    const sourceIndex = haystack.indexOf(source);
    if (sourceIndex >= 0) return sourceIndex;
  }
  const name = row.item_name.trim().toLowerCase();
  if (name) {
    const nameIndex = haystack.indexOf(name);
    if (nameIndex >= 0) return nameIndex;
    for (const token of name.split(/\s+/).filter((part) => part.length >= 4)) {
      const tokenIndex = haystack.indexOf(token);
      if (tokenIndex >= 0) return tokenIndex;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}
