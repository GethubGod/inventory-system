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
  /**
   * Whether this unit is actually orderable for the current item. The sheet
   * always renders the four standard units (`pack` / `case` / `lb` / `piece`)
   * so the layout stays consistent — units the catalog doesn't support are
   * rendered as a disabled, grayed-out segment.
   */
  available: boolean;
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
 * The four units the sheet always renders, in display order. Anything an item
 * doesn't support is still shown — disabled and grayed — so every item gets
 * the same segmented layout. Non-standard units (e.g. "bottle") get appended
 * after these in {@link resolveQuantityUnitOptions}.
 */
const STANDARD_UNITS: ReadonlyArray<{ canonical: string; value: string; label: string }> = [
  { canonical: 'pack', value: 'pack', label: 'pack' },
  { canonical: 'cs', value: 'case', label: 'case' },
  { canonical: 'lb', value: 'lb', label: 'lb' },
  { canonical: 'pc', value: 'each', label: 'piece' },
];

/**
 * Keys of every parsed row whose outstanding problem is a missing quantity or
 * missing unit — both are handled by the same focused sheet (the segmented
 * unit control + the stepper). Rows that need an item picked, a bad unit
 * fixed, or a duplicate decision are *not* included — those are handled by
 * other surfaces and must not auto-open this sheet.
 */
export function getQuantityFixQueue(items: ParsedQuickOrderItem[]): string[] {
  return items
    .filter((item) => {
      const kind = getParsedItemIssue(item)?.kind;
      return kind === 'pick-quantity' || kind === 'pick-unit';
    })
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

/** Units that read awkwardly when an "s" is appended (mostly abbreviations). */
const NON_PLURALIZED_UNITS = new Set(['lb', 'oz', 'kg', 'g', 'ml', 'l']);

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
 * Builds the unit choices for an item. The sheet's segmented control always
 * shows the four standard units (`pack` / `case` / `lb` / `piece`), with each
 * one marked `available: true` when the catalog/parser actually supports it.
 * Non-standard units (e.g. `bottle`) get appended as additional available
 * segments so we never hide a real option. When nothing is known about the
 * item at all (no catalog row, no parser units), every standard unit is
 * treated as available. Pre-selects the row's current unit when valid,
 * falling back to the catalog pack/base unit, then the first available.
 */
export function resolveQuantityUnitOptions(input: {
  item: ParsedQuickOrderItem;
  inventoryItem: QuickOrderInventoryItem | null;
  suggestion: PreviousQuantitySuggestion | null;
}): QuantityUnitResolution {
  const { item, inventoryItem } = input;

  // Collect everything the catalog / parser says this item supports, keyed by
  // canonical form so duplicates collapse. The first raw value we see wins so
  // the user-visible label matches whatever the catalog uses.
  const derived = new Map<string, string>();
  const note = (value: string | null | undefined) => {
    if (!value?.trim()) return;
    const key = normalizeQuickOrderUnit(value);
    if (!key || derived.has(key)) return;
    derived.set(key, value.trim());
  };
  note(inventoryItem?.pack_unit);
  note(inventoryItem?.base_unit);
  deriveQuickOrderAllowedUnits(item, inventoryItem).forEach(note);
  note(item.unit);

  const nothingKnown = derived.size === 0;
  if (nothingKnown) FALLBACK_UNITS.forEach(note);

  const options: QuantityUnitOption[] = [];
  const consumed = new Set<string>();
  for (const std of STANDARD_UNITS) {
    const raw = derived.get(std.canonical);
    const available = nothingKnown || derived.has(std.canonical);
    if (raw) consumed.add(std.canonical);
    options.push({
      value: raw ?? std.value,
      label: std.label,
      available,
    });
  }
  // Any item-specific unit that isn't one of the four standards (e.g. `bottle`)
  // gets appended as an available segment.
  for (const [canonical, raw] of derived) {
    if (consumed.has(canonical)) continue;
    options.push({ value: raw, label: prettifyUnitLabel(raw), available: true });
  }

  const findAvailable = (target: string | null | undefined): string | null => {
    const key = normalizeQuickOrderUnit(target ?? null);
    if (!key) return null;
    const match = options.find(
      (option) => option.available && normalizeQuickOrderUnit(option.value) === key,
    );
    return match?.value ?? null;
  };

  // No-catalog fallback uses the original FALLBACK_UNITS ordering (`lb` first)
  // rather than display order (`pack` first) so existing items don't shift.
  const firstAvailableByPreference =
    FALLBACK_UNITS.map((value) => findAvailable(value)).find(Boolean) ??
    options.find((option) => option.available)?.value ??
    null;

  const defaultValue =
    findAvailable(item.unit) ??
    findAvailable(inventoryItem?.pack_unit) ??
    findAvailable(inventoryItem?.base_unit) ??
    firstAvailableByPreference;

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

/** Same as {@link findUnitOption} but skips segments marked unavailable. */
function findAvailableUnitOption(
  options: readonly QuantityUnitOption[],
  value: string | null | undefined,
): QuantityUnitOption | null {
  const match = findUnitOption(options, value);
  return match?.available ? match : null;
}

export function getUsablePreviousQuantitySuggestion(
  suggestion: PreviousQuantitySuggestion | null | undefined,
  options: readonly QuantityUnitOption[],
): PreviousQuantitySuggestion | null {
  if (!suggestion) return null;
  if (!Number.isFinite(suggestion.quantity) || suggestion.quantity <= 0) return null;
  return findAvailableUnitOption(options, suggestion.unit) ? suggestion : null;
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
  const typedUnit = findAvailableUnitOption(input.options, input.item.unit)?.value ?? input.defaultValue;
  const suggestion = getUsablePreviousQuantitySuggestion(input.suggestion, input.options);

  if (typedQuantity == null && suggestion) {
    return {
      quantity: suggestion.quantity,
      unit: findAvailableUnitOption(input.options, suggestion.unit)?.value ?? typedUnit,
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
  if (lower === 'each' || lower === 'ea') return 'piece';
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
