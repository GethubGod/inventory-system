/**
 * Pure-function tests for the Quick Order missing-quantity correction flow:
 * which rows get queued, single vs. progress mode, unit-option resolution,
 * CTA formatting, advancing/skipping, and the "update the existing row, never
 * a duplicate" guarantee.
 */

import {
  advanceQuantityFlow,
  formatAddQuantityCta,
  formatQuantityWithUnit,
  getQuantityFixQueue,
  getQuantitySheetInitialState,
  getUsablePreviousQuantitySuggestion,
  isMultiItemQuantityFlow,
  resolveQuantityUnitOptions,
} from '../features/ordering/quickOrderQuantityFlow';
import {
  getParsedItemIssue,
  getParsedItemKey,
  updateParsedItem,
  type ParsedQuickOrderItem,
  type QuickOrderInventoryItem,
} from '../features/ordering/quickOrderItems';

function item(partial: Partial<ParsedQuickOrderItem>): ParsedQuickOrderItem {
  return { item_id: null, item_name: undefined, quantity: null, unit: null, ...partial };
}

const inventory = (
  partial: Partial<QuickOrderInventoryItem>,
): QuickOrderInventoryItem => ({ id: 'inv', name: 'Item', base_unit: null, pack_unit: null, ...partial });

describe('getQuantityFixQueue', () => {
  const missingQty = item({ item_id: 'a', item_name: 'Shrimp', quantity: null, unit: 'case' });
  const missingQtyAndUnit = item({ item_id: 'b', item_name: 'Salmon', quantity: null, unit: null });
  const valid = item({ item_id: 'c', item_name: 'Tuna', quantity: 2, unit: 'lb' });
  const missingUnitOnly = item({ item_id: 'd', item_name: 'Crab', quantity: 3, unit: null });
  const invalidUnit = item({ item_id: 'e', item_name: 'Eel', quantity: 1, unit: 'lb', status: 'invalid_unit' });
  const noMatch = item({ item_id: null, raw_token: 'wasbi', quantity: null, unit: null, status: 'no_match' });

  it('queues rows whose outstanding problem is a missing quantity or missing unit', () => {
    const queue = getQuantityFixQueue([missingQty, missingQtyAndUnit, valid, missingUnitOnly, invalidUnit, noMatch]);
    expect(queue).toEqual([
      getParsedItemKey(missingQty),
      getParsedItemKey(missingQtyAndUnit),
      getParsedItemKey(missingUnitOnly),
    ]);
  });

  it('preserves the order of the source list', () => {
    const queue = getQuantityFixQueue([missingQtyAndUnit, valid, missingQty, missingUnitOnly]);
    expect(queue).toEqual([
      getParsedItemKey(missingQtyAndUnit),
      getParsedItemKey(missingQty),
      getParsedItemKey(missingUnitOnly),
    ]);
  });

  it('returns an empty queue when nothing needs a quantity or unit', () => {
    expect(getQuantityFixQueue([valid, invalidUnit, noMatch])).toEqual([]);
  });
});

describe('isMultiItemQuantityFlow', () => {
  it('is false for a single-item queue and true for several', () => {
    expect(isMultiItemQuantityFlow(['a'])).toBe(false);
    expect(isMultiItemQuantityFlow(['a', 'b'])).toBe(true);
    expect(isMultiItemQuantityFlow([])).toBe(false);
  });
});

describe('advanceQuantityFlow', () => {
  it('advances the index until the queue is exhausted', () => {
    const state = { queue: ['a', 'b', 'c'], index: 0 };
    expect(advanceQuantityFlow(state)).toEqual({ index: 1 });
    expect(advanceQuantityFlow({ ...state, index: 1 })).toEqual({ index: 2 });
    expect(advanceQuantityFlow({ ...state, index: 2 })).toBeNull();
  });

  it('does not mutate the input state', () => {
    const state = { queue: ['a', 'b'], index: 0 };
    advanceQuantityFlow(state);
    expect(state).toEqual({ queue: ['a', 'b'], index: 0 });
  });
});

describe('formatQuantityWithUnit / formatAddQuantityCta', () => {
  it('pluralizes regular units but not abbreviations', () => {
    expect(formatQuantityWithUnit(2, 'case')).toBe('2 cases');
    expect(formatQuantityWithUnit(1, 'case')).toBe('1 case');
    expect(formatQuantityWithUnit(3, 'pack')).toBe('3 packs');
    expect(formatQuantityWithUnit(5, 'lb')).toBe('5 lb');
    expect(formatQuantityWithUnit(4, 'each')).toBe('4 pieces');
    expect(formatQuantityWithUnit(2, 'pieces')).toBe('2 pieces');
  });

  it('prefixes the CTA with "Add"', () => {
    expect(formatAddQuantityCta(2, 'case')).toBe('Add 2 cases');
    expect(formatAddQuantityCta(1, 'case')).toBe('Add 1 case');
    expect(formatAddQuantityCta(5, 'lb')).toBe('Add 5 lb');
  });
});

describe('resolveQuantityUnitOptions', () => {
  it('always renders the four standard units, marking unsupported ones unavailable', () => {
    const result = resolveQuantityUnitOptions({
      item: item({ item_id: 'a' }),
      inventoryItem: inventory({ base_unit: 'lb' }),
      suggestion: null,
    });
    expect(result.options).toEqual([
      { value: 'pack', label: 'pack', available: false },
      { value: 'case', label: 'case', available: false },
      { value: 'lb', label: 'lb', available: true },
      { value: 'each', label: 'piece', available: false },
    ]);
    expect(result.defaultValue).toBe('lb');
  });

  it('marks pack + base as available and defaults to the pack unit', () => {
    const result = resolveQuantityUnitOptions({
      item: item({ item_id: 'a' }),
      inventoryItem: inventory({ base_unit: 'lb', pack_unit: 'case' }),
      suggestion: null,
    });
    expect(result.options).toEqual([
      { value: 'pack', label: 'pack', available: false },
      { value: 'case', label: 'case', available: true },
      { value: 'lb', label: 'lb', available: true },
      { value: 'each', label: 'piece', available: false },
    ]);
    expect(result.defaultValue).toBe('case');
  });

  it("uses the row's existing unit as the default when present", () => {
    const result = resolveQuantityUnitOptions({
      item: item({ item_id: 'a', unit: 'lb' }),
      inventoryItem: inventory({ base_unit: 'lb', pack_unit: 'case' }),
      suggestion: null,
    });
    expect(result.defaultValue).toBe('lb');
  });

  it('appends non-standard available units after the four standards', () => {
    const result = resolveQuantityUnitOptions({
      item: item({ item_id: 'a', valid_units: ['bottle'] }),
      inventoryItem: inventory({ base_unit: 'lb' }),
      suggestion: null,
    });
    expect(result.options).toEqual([
      { value: 'pack', label: 'pack', available: false },
      { value: 'case', label: 'case', available: false },
      { value: 'lb', label: 'lb', available: true },
      { value: 'each', label: 'piece', available: false },
      { value: 'bottle', label: 'bottle', available: true },
    ]);
  });

  it('prefills from a valid prior-order suggestion when no quantity was typed', () => {
    const suggestion = {
      item_id: 'a',
      item_name: 'Shrimp',
      quantity: 2,
      unit: 'lb',
      label: 'LAST ORDER',
      source_order_id: 'o1',
      ordered_at: '2026-05-01T00:00:00.000Z',
    };
    const result = resolveQuantityUnitOptions({
      item: item({ item_id: 'a' }),
      inventoryItem: inventory({ base_unit: 'lb', pack_unit: 'case' }),
      suggestion,
    });
    expect(getQuantitySheetInitialState({
      item: item({ item_id: 'a' }),
      options: result.options,
      defaultValue: result.defaultValue,
      suggestion,
    })).toMatchObject({ quantity: 2, unit: 'lb', suggestion });
  });

  it('ignores a prior-order suggestion whose unit is no longer valid', () => {
    const result = resolveQuantityUnitOptions({
      item: item({ item_id: 'a' }),
      inventoryItem: inventory({ base_unit: 'lb', pack_unit: 'case' }),
      suggestion: null,
    });
    expect(getUsablePreviousQuantitySuggestion({
      item_id: 'a',
      item_name: 'Shrimp',
      quantity: 2,
      unit: 'bottle',
      label: 'LAST ORDER',
      source_order_id: 'o1',
      ordered_at: '2026-05-01T00:00:00.000Z',
    }, result.options)).toBeNull();
  });

  it('does not override a manually typed quantity with history', () => {
    const suggestion = {
      item_id: 'a',
      item_name: 'Shrimp',
      quantity: 2,
      unit: 'lb',
      label: 'LAST ORDER',
      source_order_id: 'o1',
      ordered_at: '2026-05-01T00:00:00.000Z',
    };
    const typed = item({ item_id: 'a', quantity: 5, unit: 'case' });
    const result = resolveQuantityUnitOptions({
      item: typed,
      inventoryItem: inventory({ base_unit: 'lb', pack_unit: 'case' }),
      suggestion,
    });
    expect(getQuantitySheetInitialState({
      item: typed,
      options: result.options,
      defaultValue: result.defaultValue,
      suggestion,
    })).toMatchObject({ quantity: 5, unit: 'case' });
  });

  it('falls back to all four standard units when the catalog gives nothing', () => {
    const result = resolveQuantityUnitOptions({
      item: item({ item_id: 'a' }),
      inventoryItem: null,
      suggestion: null,
    });
    expect(result.options).toEqual([
      { value: 'pack', label: 'pack', available: true },
      { value: 'case', label: 'case', available: true },
      { value: 'lb', label: 'lb', available: true },
      { value: 'each', label: 'piece', available: true },
    ]);
    expect(result.defaultValue).toBe('lb');
  });
});

describe('applying a quantity', () => {
  it('updates the existing row in place — never adds a duplicate', () => {
    const pending = item({ item_id: 'a', item_name: 'Shrimp (Frozen)', quantity: null, unit: 'case' });
    const others = [item({ item_id: 'b', item_name: 'Salmon', quantity: 1, unit: 'lb' })];
    const before = [pending, ...others];

    expect(getParsedItemIssue(pending)?.kind).toBe('pick-quantity');

    const after = updateParsedItem(before, getParsedItemKey(pending), { quantity: 2, unit: 'case' });

    expect(after).toHaveLength(before.length);
    const resolved = after.find((entry) => entry.item_id === 'a');
    expect(resolved?.quantity).toBe(2);
    expect(getParsedItemIssue(resolved as ParsedQuickOrderItem)).toBeNull();
  });

  it('leaves a skipped row unresolved (still needs a quantity)', () => {
    const queue = { queue: ['k1', 'k2'], index: 0 };
    const skipped = item({ item_id: 'a', item_name: 'Shrimp', quantity: null, unit: 'case' });
    // Skipping just advances the flow without touching the row.
    expect(advanceQuantityFlow(queue)).toEqual({ index: 1 });
    expect(getParsedItemIssue(skipped)?.kind).toBe('pick-quantity');
  });
});
