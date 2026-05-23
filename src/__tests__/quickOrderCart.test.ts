import {
  areQuickOrderItemsCartReady,
  quickOrderItemsToCartAdds,
} from '../store/helpers/quickOrderCart';
import type {
  ParsedQuickOrderItem,
  QuickOrderInventoryItem,
} from '../features/ordering/quickOrderItems';
import { mergeQuickOrderParsedItemsDetailed } from '../features/ordering/quickOrderItems';

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
      { inventoryItemId: SALMON_ID, quantity: 4, unitType: 'base', note: 'fresh only', wasSuggested: false, originalSuggestedQty: null },
      { inventoryItemId: YELLOWTAIL_ID, quantity: 9, unitType: 'base', note: null, wasSuggested: false, originalSuggestedQty: null },
    ]);
  });

  it('resolves the pack unit type when the parsed unit matches the inventory pack unit', () => {
    const adds = quickOrderItemsToCartAdds([item({ unit: 'case', quantity: 2 })], inventoryById);
    expect(adds[0]).toEqual({ inventoryItemId: SALMON_ID, quantity: 2, unitType: 'pack', note: null, wasSuggested: false, originalSuggestedQty: null });
  });

  it('marks inventory recommendation items as suggested cart adds', () => {
    const adds = quickOrderItemsToCartAdds([
      item({
        unit: 'case',
        quantity: 1,
        source: 'inventory_recommendation',
        isSuggested: true,
      }),
    ], inventoryById);

    expect(adds[0]).toMatchObject({
      inventoryItemId: SALMON_ID,
      quantity: 1,
      unitType: 'pack',
      wasSuggested: true,
      originalSuggestedQty: 1,
    });
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

describe('mergeQuickOrderParsedItemsDetailed suggestion metadata', () => {
  it('lets human order entries replace suggested metadata on an existing row', () => {
    const suggested = item({
      unit: 'case',
      quantity: 8,
      source: 'remaining_recommendation',
      isSuggested: true,
      suggestionReason: 'Usual target is 9 cases.',
      suggestionSource: 'remaining_inventory',
    });
    const human = item({
      unit: 'case',
      quantity: 3,
      source: 'manual',
      isSuggested: false,
      suggestionReason: undefined,
      suggestionSource: undefined,
    });

    const result = mergeQuickOrderParsedItemsDetailed([suggested], [human]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      quantity: 3,
      source: 'manual',
      isSuggested: false,
    });
    expect(result.items[0].suggestionReason).toBeUndefined();
    expect(result.items[0].suggestionSource).toBeUndefined();
  });
});
