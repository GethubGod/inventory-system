/**
 * Cart Helpers Tests
 *
 * Pure-function tests for cart normalization, merging, and context resolution.
 * Zero React Native dependencies — runs with plain ts-jest.
 */

import {
  toValidNumber,
  normalizeNote,
  getEffectiveQuantity,
  isSubmittableCartItem,
  normalizeCartItem,
  normalizeLocationCart,
  normalizeCartByLocation,
  normalizeCartContext,
  mergeCartItem,
  findCartItemIndex,
} from '../store/helpers/cartHelpers';
import type { CartItem } from '../store/orderStore.types';

// ── Helpers ──────────────────────────────────────────────────

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'cart-001',
    inventoryItemId: 'item-001',
    quantity: 5,
    unitType: 'base',
    inputMode: 'quantity',
    quantityRequested: 5,
    remainingReported: null,
    decidedQuantity: null,
    decidedBy: null,
    decidedAt: null,
    note: null,
    wasSuggested: false,
    originalSuggestedQty: null,
    ...overrides,
  };
}

// ── toValidNumber ────────────────────────────────────────────

describe('toValidNumber', () => {
  test('returns number for finite number input', () => {
    expect(toValidNumber(42)).toBe(42);
    expect(toValidNumber(0)).toBe(0);
    expect(toValidNumber(-3.5)).toBe(-3.5);
  });

  test('parses numeric strings', () => {
    expect(toValidNumber('42')).toBe(42);
    expect(toValidNumber('3.14')).toBe(3.14);
    expect(toValidNumber(' 10 ')).toBe(10);
  });

  test('returns null for non-numeric values', () => {
    expect(toValidNumber('hello')).toBeNull();
    expect(toValidNumber('')).toBeNull();
    expect(toValidNumber(null)).toBeNull();
    expect(toValidNumber(undefined)).toBeNull();
    expect(toValidNumber(NaN)).toBeNull();
    expect(toValidNumber(Infinity)).toBeNull();
  });
});

// ── normalizeNote ────────────────────────────────────────────

describe('normalizeNote', () => {
  test('trims and returns non-empty strings', () => {
    expect(normalizeNote('  hello  ')).toBe('hello');
    expect(normalizeNote('note')).toBe('note');
  });

  test('returns null for empty or non-string values', () => {
    expect(normalizeNote('')).toBeNull();
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote(42)).toBeNull();
  });
});

// ── getEffectiveQuantity ─────────────────────────────────────

describe('getEffectiveQuantity', () => {
  test('returns quantityRequested for quantity mode', () => {
    const item = makeCartItem({ inputMode: 'quantity', quantityRequested: 10 });
    expect(getEffectiveQuantity(item)).toBe(10);
  });

  test('returns decidedQuantity for remaining mode', () => {
    const item = makeCartItem({
      inputMode: 'remaining',
      quantityRequested: null,
      decidedQuantity: 7,
    });
    expect(getEffectiveQuantity(item)).toBe(7);
  });

  test('returns 0 when quantities are null', () => {
    expect(getEffectiveQuantity(makeCartItem({ quantityRequested: null }))).toBe(0);
    expect(
      getEffectiveQuantity(makeCartItem({ inputMode: 'remaining', decidedQuantity: null }))
    ).toBe(0);
  });
});

// ── isSubmittableCartItem ────────────────────────────────────

describe('isSubmittableCartItem', () => {
  test('submittable when quantity > 0', () => {
    expect(isSubmittableCartItem(makeCartItem({ quantityRequested: 5 }))).toBe(true);
  });

  test('not submittable when quantity is 0', () => {
    expect(isSubmittableCartItem(makeCartItem({ quantityRequested: 0 }))).toBe(false);
  });

  test('remaining mode: submittable when reported >= 0', () => {
    expect(
      isSubmittableCartItem(
        makeCartItem({ inputMode: 'remaining', remainingReported: 0 })
      )
    ).toBe(true);
  });

  test('remaining mode: submittable even when reported is null (coalesces to 0)', () => {
    expect(
      isSubmittableCartItem(
        makeCartItem({ inputMode: 'remaining', remainingReported: null })
      )
    ).toBe(true);
  });
});

// ── normalizeCartItem ────────────────────────────────────────

describe('normalizeCartItem', () => {
  test('normalizes a valid quantity-mode item', () => {
    const result = normalizeCartItem({
      inventoryItemId: 'abc',
      quantity: 5,
      unitType: 'base',
      inputMode: 'quantity',
    });
    expect(result).not.toBeNull();
    expect(result!.inventoryItemId).toBe('abc');
    expect(result!.quantityRequested).toBe(5);
    expect(result!.inputMode).toBe('quantity');
  });

  test('returns null for missing inventoryItemId', () => {
    expect(normalizeCartItem({ quantity: 5 })).toBeNull();
    expect(normalizeCartItem({ inventoryItemId: '', quantity: 5 })).toBeNull();
  });

  test('returns null for zero quantity in quantity mode', () => {
    expect(
      normalizeCartItem({ inventoryItemId: 'abc', quantity: 0, inputMode: 'quantity' })
    ).toBeNull();
  });

  test('normalizes remaining-mode item', () => {
    const result = normalizeCartItem({
      inventoryItemId: 'abc',
      remainingReported: 3,
      unitType: 'pack',
      inputMode: 'remaining',
    });
    expect(result).not.toBeNull();
    expect(result!.inputMode).toBe('remaining');
    expect(result!.remainingReported).toBe(3);
    expect(result!.unitType).toBe('pack');
  });

  test('preserves note', () => {
    const result = normalizeCartItem({
      inventoryItemId: 'abc',
      quantity: 1,
      note: '  extra fresh  ',
    });
    expect(result).not.toBeNull();
    expect(result!.note).toBe('extra fresh');
  });

  test('uses provided id over generated', () => {
    const result = normalizeCartItem({
      id: 'my-id',
      inventoryItemId: 'abc',
      quantity: 1,
    });
    expect(result!.id).toBe('my-id');
  });
});

// ── normalizeLocationCart ────────────────────────────────────

describe('normalizeLocationCart', () => {
  test('returns empty array for non-array input', () => {
    expect(normalizeLocationCart(null)).toEqual([]);
    expect(normalizeLocationCart(undefined)).toEqual([]);
    expect(normalizeLocationCart('string')).toEqual([]);
  });

  test('filters out invalid items', () => {
    const result = normalizeLocationCart([
      { inventoryItemId: 'abc', quantity: 5 },
      { quantity: 5 }, // Missing inventoryItemId
      null,
      { inventoryItemId: 'def', quantity: 3 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].inventoryItemId).toBe('abc');
    expect(result[1].inventoryItemId).toBe('def');
  });
});

// ── normalizeCartByLocation ──────────────────────────────────

describe('normalizeCartByLocation', () => {
  test('returns empty object for non-object input', () => {
    expect(normalizeCartByLocation(null)).toEqual({});
    expect(normalizeCartByLocation(undefined)).toEqual({});
  });

  test('normalizes each location cart', () => {
    const result = normalizeCartByLocation({
      'loc-1': [{ inventoryItemId: 'a', quantity: 2 }],
      'loc-2': [null, { inventoryItemId: 'b', quantity: 3 }],
      'loc-3': [null], // All invalid — should be excluded
    });
    expect(Object.keys(result)).toEqual(['loc-1', 'loc-2']);
    expect(result['loc-1']).toHaveLength(1);
    expect(result['loc-2']).toHaveLength(1);
  });
});

// ── normalizeCartContext ─────────────────────────────────────

describe('normalizeCartContext', () => {
  test('returns manager for "manager"', () => {
    expect(normalizeCartContext('manager')).toBe('manager');
  });

  test('returns employee for anything else', () => {
    expect(normalizeCartContext('employee')).toBe('employee');
    expect(normalizeCartContext(undefined)).toBe('employee');
    expect(normalizeCartContext('invalid' as any)).toBe('employee');
  });
});

// ── mergeCartItem ────────────────────────────────────────────

describe('mergeCartItem', () => {
  test('adds new item to empty cart', () => {
    const incoming = makeCartItem({ inventoryItemId: 'abc', quantityRequested: 5 });
    const result = mergeCartItem([], incoming);
    expect(result).toHaveLength(1);
    expect(result[0].inventoryItemId).toBe('abc');
  });

  test('merges quantity for matching item', () => {
    const existing = makeCartItem({
      inventoryItemId: 'abc',
      unitType: 'base',
      quantityRequested: 3,
    });
    const incoming = makeCartItem({
      inventoryItemId: 'abc',
      unitType: 'base',
      quantityRequested: 2,
    });
    const result = mergeCartItem([existing], incoming);
    expect(result).toHaveLength(1);
    expect(result[0].quantityRequested).toBe(5);
  });

  test('does not merge different unit types', () => {
    const existing = makeCartItem({ inventoryItemId: 'abc', unitType: 'base' });
    const incoming = makeCartItem({ inventoryItemId: 'abc', unitType: 'pack' });
    const result = mergeCartItem([existing], incoming);
    expect(result).toHaveLength(2);
  });

  test('replaces remaining-mode item for same inventoryItemId', () => {
    const existing = makeCartItem({
      inventoryItemId: 'abc',
      inputMode: 'remaining',
      remainingReported: 3,
    });
    const incoming = makeCartItem({
      inventoryItemId: 'abc',
      inputMode: 'remaining',
      remainingReported: 5,
    });
    const result = mergeCartItem([existing], incoming);
    expect(result).toHaveLength(1);
    expect(result[0].remainingReported).toBe(5);
  });
});

// ── findCartItemIndex ────────────────────────────────────────

describe('findCartItemIndex', () => {
  const cart = [
    makeCartItem({ id: 'id-1', inventoryItemId: 'item-a', unitType: 'base' }),
    makeCartItem({ id: 'id-2', inventoryItemId: 'item-b', unitType: 'pack' }),
    makeCartItem({ id: 'id-3', inventoryItemId: 'item-a', unitType: 'pack' }),
  ];

  test('finds by explicit cartItemId', () => {
    expect(findCartItemIndex(cart, 'item-a', 'base', 'id-1')).toBe(0);
    expect(findCartItemIndex(cart, 'item-b', 'pack', 'id-2')).toBe(1);
  });

  test('finds by inventoryItemId + unitType', () => {
    expect(findCartItemIndex(cart, 'item-b', 'pack')).toBe(1);
    expect(findCartItemIndex(cart, 'item-a', 'pack')).toBe(2);
  });

  test('falls back to inventoryItemId only', () => {
    expect(findCartItemIndex(cart, 'item-b', 'base')).toBe(1);
  });

  test('returns -1 for non-existent item', () => {
    expect(findCartItemIndex(cart, 'item-z', 'base')).toBe(-1);
  });
});
