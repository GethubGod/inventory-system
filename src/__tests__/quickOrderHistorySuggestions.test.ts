/**
 * Tests for the Quick Order "what did I order last time?" suggestions:
 *   - `pickPreviousItemQuantitySuggestion` (pure): same-weekday preference,
 *     fall-back to the most recent prior order, ignoring today's order, unit
 *     derivation, picking the larger of duplicate lines, no-history → null.
 *   - `fetchPreviousQuantitySuggestions`: query is scoped to the current user
 *     + location (and skips drafts), and never returns another user's data.
 */

import {
  fetchPreviousQuantitySuggestions,
  normalizeHistoryOrder,
  pickPreviousItemQuantitySuggestion,
  type HistoryOrder,
} from '../features/ordering/quickOrderHistorySuggestions';

// The module imports the Supabase client transitively; a tiny chainable mock
// records the query it builds and resolves to whatever rows the test set up.
const mockQueryCalls: { method: string; args: unknown[] }[] = [];
let mockOrderRows: unknown[] = [];

jest.mock('@/lib/supabase', () => {
  const builder: Record<string, unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    mockQueryCalls.push({ method, args });
    return builder;
  };
  for (const method of ['select', 'eq', 'neq', 'order', 'limit']) {
    builder[method] = record(method);
  }
  builder.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: mockOrderRows, error: null }).then(resolve);
  return {
    supabase: {
      from: (...args: unknown[]) => {
        mockQueryCalls.push({ method: 'from', args });
        return builder;
      },
    },
  };
});

function order(id: string, orderedAt: string, lines: HistoryOrder['lines']): HistoryOrder {
  return { id, orderedAt, lines };
}

// 2026-05-11 is a Monday; 2026-05-04 the previous Monday; 2026-05-07 a Thursday.
const NOW = new Date('2026-05-11T18:00:00.000Z');

describe('pickPreviousItemQuantitySuggestion', () => {
  it('prefers a prior order on the same weekday over a more recent one', () => {
    const orders = [
      order('thursday', '2026-05-07T12:00:00.000Z', [{ itemId: 'shrimp', itemName: 'Shrimp (Frozen)', quantity: 4, unit: 'lb' }]),
      order('last-monday', '2026-05-04T12:00:00.000Z', [{ itemId: 'shrimp', itemName: 'Shrimp (Frozen)', quantity: 2, unit: 'case' }]),
    ];
    const suggestion = pickPreviousItemQuantitySuggestion(orders, 'shrimp', NOW);
    expect(suggestion).toMatchObject({
      item_id: 'shrimp',
      item_name: 'Shrimp (Frozen)',
      quantity: 2,
      unit: 'case',
      label: 'LAST MONDAY',
      source_order_id: 'last-monday',
    });
  });

  it('falls back to the most recent prior order containing the item', () => {
    const orders = [
      // 2026-05-07 is a Thursday, 2026-04-22 a Wednesday — neither is a Monday.
      order('thursday', '2026-05-07T12:00:00.000Z', [{ itemId: 'shrimp', itemName: 'Shrimp', quantity: 3, unit: 'case' }]),
      order('older', '2026-04-22T12:00:00.000Z', [{ itemId: 'shrimp', itemName: 'Shrimp', quantity: 9, unit: 'lb' }]),
    ];
    const suggestion = pickPreviousItemQuantitySuggestion(orders, 'shrimp', NOW);
    expect(suggestion).toMatchObject({ quantity: 3, unit: 'case', label: 'LAST ORDER', source_order_id: 'thursday' });
  });

  it("ignores an order placed today", () => {
    const orders = [
      order('today', '2026-05-11T09:00:00.000Z', [{ itemId: 'shrimp', itemName: 'Shrimp', quantity: 7, unit: 'case' }]),
      order('thursday', '2026-05-07T12:00:00.000Z', [{ itemId: 'shrimp', itemName: 'Shrimp', quantity: 3, unit: 'case' }]),
    ];
    const suggestion = pickPreviousItemQuantitySuggestion(orders, 'shrimp', NOW);
    expect(suggestion?.source_order_id).toBe('thursday');
  });

  it('picks the larger line when the item appears twice in one order', () => {
    const orders = [
      order('thursday', '2026-05-07T12:00:00.000Z', [
        { itemId: 'shrimp', itemName: 'Shrimp', quantity: 1, unit: 'case' },
        { itemId: 'shrimp', itemName: 'Shrimp', quantity: 4, unit: 'case' },
      ]),
    ];
    expect(pickPreviousItemQuantitySuggestion(orders, 'shrimp', NOW)?.quantity).toBe(4);
  });

  it('returns null when the item has no history', () => {
    const orders = [order('thursday', '2026-05-07T12:00:00.000Z', [{ itemId: 'salmon', itemName: 'Salmon', quantity: 2, unit: 'lb' }])];
    expect(pickPreviousItemQuantitySuggestion(orders, 'shrimp', NOW)).toBeNull();
  });

  it('ignores historical units that are not currently valid for the item', () => {
    const orders = [
      order('last-monday', '2026-05-04T12:00:00.000Z', [{ itemId: 'shrimp', itemName: 'Shrimp', quantity: 2, unit: 'bottle' }]),
      order('thursday', '2026-05-07T12:00:00.000Z', [{ itemId: 'shrimp', itemName: 'Shrimp', quantity: 3, unit: 'case' }]),
    ];
    const suggestion = pickPreviousItemQuantitySuggestion(orders, 'shrimp', NOW, ['case', 'lb']);
    expect(suggestion).toMatchObject({ quantity: 3, unit: 'case', source_order_id: 'thursday' });
    expect(pickPreviousItemQuantitySuggestion(orders, 'shrimp', NOW, ['lb'])).toBeNull();
  });
});

describe('normalizeHistoryOrder', () => {
  it('derives the unit from unit_type + the catalog row and drops empty/zero lines', () => {
    const normalized = normalizeHistoryOrder({
      id: 'o1',
      created_at: '2026-05-04T12:00:00.000Z',
      order_items: [
        { inventory_item_id: 'shrimp', quantity: 2, unit_type: 'pack', inventory_item: { id: 'shrimp', name: 'Shrimp', base_unit: 'lb', pack_unit: 'case' } },
        { inventory_item_id: 'tuna', quantity: 5, unit_type: 'base', inventory_item: { id: 'tuna', name: 'Tuna', base_unit: 'lb', pack_unit: 'case' } },
        { inventory_item_id: 'gone', quantity: 1, unit_type: 'base', inventory_item: null },
        { inventory_item_id: 'zero', quantity: 0, unit_type: 'base', inventory_item: { id: 'zero', name: 'Zero', base_unit: 'lb', pack_unit: null } },
      ],
    });
    expect(normalized).toEqual({
      id: 'o1',
      orderedAt: '2026-05-04T12:00:00.000Z',
      lines: [
        { itemId: 'shrimp', itemName: 'Shrimp', quantity: 2, unit: 'case' },
        { itemId: 'tuna', itemName: 'Tuna', quantity: 5, unit: 'lb' },
      ],
    });
  });

  it('returns null for an order with no usable lines', () => {
    expect(
      normalizeHistoryOrder({ id: 'o1', created_at: '2026-05-04T12:00:00.000Z', order_items: [] }),
    ).toBeNull();
  });
});

describe('fetchPreviousQuantitySuggestions', () => {
  beforeEach(() => {
    mockQueryCalls.length = 0;
    mockOrderRows = [];
  });

  it('scopes the query to the current user + location and skips drafts', async () => {
    mockOrderRows = [
      {
        id: 'last-monday',
        created_at: '2026-05-04T12:00:00.000Z',
        order_items: [
          { inventory_item_id: 'shrimp', quantity: 2, unit_type: 'pack', inventory_item: { id: 'shrimp', name: 'Shrimp (Frozen)', base_unit: 'lb', pack_unit: 'case' } },
        ],
      },
    ];

    const result = await fetchPreviousQuantitySuggestions({ userId: 'user-1', locationId: 'loc-1', itemIds: ['shrimp'] });

    expect(mockQueryCalls).toContainEqual({ method: 'from', args: ['orders'] });
    expect(mockQueryCalls).toContainEqual({ method: 'eq', args: ['user_id', 'user-1'] });
    expect(mockQueryCalls).toContainEqual({ method: 'eq', args: ['location_id', 'loc-1'] });
    expect(mockQueryCalls).toContainEqual({ method: 'neq', args: ['status', 'draft'] });

    expect(result.get('shrimp')).toMatchObject({ item_id: 'shrimp', quantity: 2, unit: 'case' });
  });

  it('filters fetched suggestions against current valid units when provided', async () => {
    mockOrderRows = [
      {
        id: 'last-monday',
        created_at: '2026-05-04T12:00:00.000Z',
        order_items: [
          { inventory_item_id: 'shrimp', quantity: 2, unit_type: 'pack', inventory_item: { id: 'shrimp', name: 'Shrimp', base_unit: 'lb', pack_unit: 'case' } },
        ],
      },
    ];

    const result = await fetchPreviousQuantitySuggestions({
      userId: 'user-1',
      locationId: 'loc-1',
      itemIds: ['shrimp'],
      validUnitsByItemId: new Map([['shrimp', ['lb']]]),
    });

    expect(result.has('shrimp')).toBe(false);
  });

  it('returns an empty map without querying when user or location is missing', async () => {
    expect((await fetchPreviousQuantitySuggestions({ userId: null, locationId: 'loc-1', itemIds: ['shrimp'] })).size).toBe(0);
    expect((await fetchPreviousQuantitySuggestions({ userId: 'user-1', locationId: null, itemIds: ['shrimp'] })).size).toBe(0);
    expect((await fetchPreviousQuantitySuggestions({ userId: 'user-1', locationId: 'loc-1', itemIds: [] })).size).toBe(0);
    expect(mockQueryCalls).toHaveLength(0);
  });
});
