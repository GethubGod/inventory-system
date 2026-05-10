import {
  areQuickOrderItemsCartReady,
  quickOrderItemsToCartAdds,
} from '../store/helpers/quickOrderCart';
import type {
  ParsedQuickOrderItem,
  QuickOrderInventoryItem,
} from '../features/ordering/quickOrderItems';

const SALMON_ID = '11111111-1111-4111-8111-111111111111';
const YELLOWTAIL_ID = '22222222-2222-4222-8222-222222222222';

const inventory: QuickOrderInventoryItem[] = [
  { id: SALMON_ID, name: 'Salmon', base_unit: 'lb', pack_unit: 'cs' },
  { id: YELLOWTAIL_ID, name: 'Yellowtail', base_unit: 'lb', pack_unit: null },
];
const inventoryById = new Map(inventory.map((item) => [item.id, item]));

function item(overrides: Partial<ParsedQuickOrderItem> = {}): ParsedQuickOrderItem {
  return {
    item_id: SALMON_ID,
    item_name: 'Salmon',
    raw_token: 'salmon',
    quantity: 4,
    unit: 'lb',
    unresolved: false,
    needs_clarification: false,
    notes: null,
    ...overrides,
  };
}

describe('areQuickOrderItemsCartReady', () => {
  it('is false for an empty list', () => {
    expect(areQuickOrderItemsCartReady([])).toBe(false);
  });

  it('is false when an item has no inventory id', () => {
    expect(areQuickOrderItemsCartReady([item({ item_id: null, unresolved: true })])).toBe(false);
  });

  it('is false when an item is missing a quantity', () => {
    expect(areQuickOrderItemsCartReady([item({ quantity: null })])).toBe(false);
  });

  it('is false when an item is missing a unit', () => {
    expect(areQuickOrderItemsCartReady([item({ unit: null })])).toBe(false);
  });

  it('is true when every item is fully resolved', () => {
    expect(
      areQuickOrderItemsCartReady([
        item(),
        item({ item_id: YELLOWTAIL_ID, item_name: 'Yellowtail', quantity: 9 }),
      ]),
    ).toBe(true);
  });
});

describe('quickOrderItemsToCartAdds', () => {
  it('converts resolved items, preserving quantity and notes', () => {
    const adds = quickOrderItemsToCartAdds(
      [
        item({ quantity: 4, notes: 'fresh only' }),
        item({ item_id: YELLOWTAIL_ID, item_name: 'Yellowtail', quantity: 9, unit: 'lb' }),
      ],
      inventoryById,
    );

    expect(adds).toEqual([
      { inventoryItemId: SALMON_ID, quantity: 4, unitType: 'base', note: 'fresh only' },
      { inventoryItemId: YELLOWTAIL_ID, quantity: 9, unitType: 'base', note: null },
    ]);
  });

  it('resolves the pack unit type when the parsed unit matches the inventory pack unit', () => {
    const adds = quickOrderItemsToCartAdds([item({ unit: 'case', quantity: 2 })], inventoryById);
    expect(adds[0]).toEqual({ inventoryItemId: SALMON_ID, quantity: 2, unitType: 'pack', note: null });
  });

  it('falls back to base when the inventory item is unknown', () => {
    const adds = quickOrderItemsToCartAdds([item({ unit: 'cs' })], new Map());
    expect(adds[0].unitType).toBe('base');
  });

  it('throws when an item is not ready', () => {
    expect(() => quickOrderItemsToCartAdds([item({ quantity: null })], inventoryById)).toThrow();
    expect(() =>
      quickOrderItemsToCartAdds([item({ item_id: null, unresolved: true })], inventoryById),
    ).toThrow();
  });
});
