/**
 * Pure helpers for the Quick Order "missing quantity" correction flow.
 *
 * The flow shows a bottom sheet ({@link QuickOrderQuantitySheet}) for every
 * parsed row that needs a quantity. When more than one row needs one it becomes
 * a multi-step "Item X of N" walk-through. All decision-shaped logic lives here
 * so it can be unit-tested without rendering anything.
 */

import {
  deriveQuickOrderAllowedUnits,
  getParsedItemIssue,
  getParsedItemKey,
  normalizeQuickOrderUnit,
  type ParsedQuickOrderItem,
  type QuickOrderInventoryItem,
} from './quickOrderItems';
import type { PreviousQuantitySuggestion } from './quickOrderHistorySuggestions';

/** A single selectable unit in the sheet's segmented control. */
export type QuantityUnitOption = {
  /** The unit string stored on the parsed item when this option is chosen. */
  value: string;
  /** Human-friendly label shown in the segment (e.g. "case", "lb"). */
  label: string;
};

export type QuantityUnitResolution = {
  options: QuantityUnitOption[];
  /** Pre-selected option value, or `null` when there is nothing sensible to pick. */
  defaultValue: string | null;
};

export type QuantitySheetInitialState = {
  quantity: number;
  unit: string | null;
  suggestion: PreviousQuantitySuggestion | null;
};

export type QuantityFlowState = {
  /** Stable keys ({@link getParsedItemKey}) of the rows still being worked through. */
  queue: string[];
  /** Index into {@link queue} of the row currently shown in the sheet. */
  index: number;
};

/** Last-resort unit choices when the catalog/parser give us nothing to work with. */
const FALLBACK_UNITS = ['lb', 'case', 'pack', 'each'] as const;

/**
 * Keys of every parsed row whose only outstanding problem is a missing quantity
 * (covers both `missing_quantity` and `missing_quantity_and_unit`). Rows that
 * need an item picked, a bad unit fixed, or a duplicate decision are *not*
 * included — those are handled by other surfaces and must not auto-open this
 * sheet.
 */
export function getQuantityFixQueue(items: ParsedQuickOrderItem[]): string[] {
  return items
    .filter((item) => getParsedItemIssue(item)?.kind === 'pick-quantity')
    .map(getParsedItemKey);
}

export function isMultiItemQuantityFlow(queue: readonly string[]): boolean {
  return queue.length > 1;
}

/** `{ index: next }` while there is another row to do, otherwise `null` (flow finished). */
export function advanceQuantityFlow(state: QuantityFlowState): { index: number } | null {
  const next = state.index + 1;
  return next < state.queue.length ? { index: next } : null;
}

/** Units that read awkwardly when an "s" is appended (abbreviations, "each"). */
const NON_PLURALIZED_UNITS = new Set(['lb', 'oz', 'kg', 'g', 'ml', 'l', 'each']);

/** "2 cases" / "1 case" / "5 lb" — quantity with a (lightly pluralized) unit. */
export function formatQuantityWithUnit(quantity: number, unitLabel: string): string {
  const label = prettifyUnitLabel(unitLabel);
  if (!label) return String(quantity);
  const plural =
    quantity === 1 || /s$/i.test(label) || NON_PLURALIZED_UNITS.has(label.toLowerCase())
      ? label
      : `${label}s`;
  return `${quantity} ${plural}`;
}

/** "Add 2 cases" / "Add 1 case" / "Add 5 lb" — the sheet's primary CTA text. */
export function formatAddQuantityCta(quantity: number, unitLabel: string): string {
  return `Add ${formatQuantityWithUnit(quantity, unitLabel)}`;
}

/**
 * Builds the unit choices for an item, preferring the catalog's allowed/order/
 * default/pack/base units, then any units the parser flagged as valid, and only falling back to a small
 * common set when nothing else is known. Also resolves a sensible default
 * selection: the row's current unit, else the catalog pack unit, else the
 * catalog base unit, else the first option.
 */
export function resolveQuantityUnitOptions(input: {
  item: ParsedQuickOrderItem;
  inventoryItem: QuickOrderInventoryItem | null;
  suggestion: PreviousQuantitySuggestion | null;
}): QuantityUnitResolution {
  const { item, inventoryItem } = input;

  const ordered: string[] = [];
  const push = (value: string | null | undefined) => {
    if (value && value.trim()) ordered.push(value.trim());
  };
  push(inventoryItem?.pack_unit);
  push(inventoryItem?.base_unit);
  deriveQuickOrderAllowedUnits(item, inventoryItem).forEach(push);
  push(item.unit);
  if (ordered.length === 0) FALLBACK_UNITS.forEach(push);

  const options: QuantityUnitOption[] = [];
  const seen = new Set<string>();
  for (const raw of ordered) {
    const key = normalizeQuickOrderUnit(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({ value: raw, label: prettifyUnitLabel(raw) });
  }

  const findOption = (target: string | null | undefined): string | null => {
    const key = normalizeQuickOrderUnit(target ?? null);
    if (!key) return null;
    return options.find((option) => normalizeQuickOrderUnit(option.value) === key)?.value ?? null;
  };

  const defaultValue =
    findOption(item.unit) ??
    findOption(inventoryItem?.pack_unit) ??
    findOption(inventoryItem?.base_unit) ??
    options[0]?.value ??
    null;

  return { options, defaultValue };
}

/** Finds the option whose unit matches `value` (by canonical form), if any. */
export function findUnitOption(
  options: readonly QuantityUnitOption[],
  value: string | null | undefined,
): QuantityUnitOption | null {
  const key = normalizeQuickOrderUnit(value ?? null);
  if (!key) return null;
  return options.find((option) => normalizeQuickOrderUnit(option.value) === key) ?? null;
}

export function getUsablePreviousQuantitySuggestion(
  suggestion: PreviousQuantitySuggestion | null | undefined,
  options: readonly QuantityUnitOption[],
): PreviousQuantitySuggestion | null {
  if (!suggestion) return null;
  if (!Number.isFinite(suggestion.quantity) || suggestion.quantity <= 0) return null;
  return findUnitOption(options, suggestion.unit) ? suggestion : null;
}

export function getQuantitySheetInitialState(input: {
  item: ParsedQuickOrderItem;
  options: readonly QuantityUnitOption[];
  defaultValue: string | null;
  suggestion: PreviousQuantitySuggestion | null;
}): QuantitySheetInitialState {
  const typedQuantity = input.item.quantity != null && Number.isFinite(input.item.quantity) && input.item.quantity > 0
    ? input.item.quantity
    : null;
  const typedUnit = findUnitOption(input.options, input.item.unit)?.value ?? input.defaultValue;
  const suggestion = getUsablePreviousQuantitySuggestion(input.suggestion, input.options);

  if (typedQuantity == null && suggestion) {
    return {
      quantity: suggestion.quantity,
      unit: findUnitOption(input.options, suggestion.unit)?.value ?? typedUnit,
      suggestion,
    };
  }

  return {
    quantity: typedQuantity ?? 0,
    unit: typedUnit,
    suggestion,
  };
}

function prettifyUnitLabel(raw: string): string {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (lower === 'each' || lower === 'ea') return 'each';
  if (lower === 'piece' || lower === 'pieces' || lower === 'pc' || lower === 'pcs') return 'piece';
  switch (normalizeQuickOrderUnit(value)) {
    case 'cs':
      return 'case';
    case 'pc':
      return 'piece';
    case 'pack':
      return 'pack';
    default:
      return value.toLowerCase();
  }
}
