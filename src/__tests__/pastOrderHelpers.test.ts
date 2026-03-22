/**
 * Past Order Helpers Tests
 *
 * Pure-function tests for past-order normalization, last-ordered-quantity cache,
 * sync queue management, and consumed-order extraction.
 */

// Mock RN and Supabase dependencies that sharedHelpers imports transitively
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({}) } }));
jest.mock('@/lib/notifications', () => ({ getNotificationsModule: () => null }));

import {
  createLastOrderedAnyKey,
  createLastOrderedLocationIdKey,
  createLastOrderedLocationGroupKey,
  resolveLastOrderedFromCache,
  upsertLastOrderedCacheValue,
  normalizePastOrder,
  normalizePastOrders,
  mergeRemoteAndPendingPastOrders,
  extractConsumedOrderItemIds,
  getPastOrderCountsFromPayload,
} from '../store/helpers/pastOrderHelpers';
import type {
  LastOrderedQuantityCacheValue,
  PastOrder,
} from '../store/orderStore.types';

// ── Cache Key Generation ─────────────────────────────────────

describe('cache key generation', () => {
  test('createLastOrderedAnyKey', () => {
    expect(createLastOrderedAnyKey('item-1', 'kg')).toBe('item-1::kg::any');
  });

  test('createLastOrderedLocationIdKey', () => {
    expect(createLastOrderedLocationIdKey('item-1', 'kg', 'loc-1')).toBe(
      'item-1::kg::loc:loc-1'
    );
  });

  test('createLastOrderedLocationGroupKey', () => {
    expect(createLastOrderedLocationGroupKey('item-1', 'kg', 'sushi')).toBe(
      'item-1::kg::group:sushi'
    );
  });
});

// ── resolveLastOrderedFromCache ──────────────────────────────

describe('resolveLastOrderedFromCache', () => {
  const now = new Date().toISOString();

  test('returns location match first', () => {
    const cache: Record<string, LastOrderedQuantityCacheValue> = {
      'item-1::kg::loc:loc-1': { quantity: 10, orderedAt: now },
      'item-1::kg::any': { quantity: 5, orderedAt: now },
    };
    const result = resolveLastOrderedFromCache(cache, {
      key: 'k',
      itemId: 'item-1',
      unit: 'kg',
      locationId: 'loc-1',
      locationGroup: null,
    });
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(10);
    expect(result!.matchedBy).toBe('location');
  });

  test('falls back to any key', () => {
    const cache: Record<string, LastOrderedQuantityCacheValue> = {
      'item-1::kg::any': { quantity: 5, orderedAt: now },
    };
    const result = resolveLastOrderedFromCache(cache, {
      key: 'k',
      itemId: 'item-1',
      unit: 'kg',
      locationId: 'loc-999',
      locationGroup: null,
    });
    expect(result).not.toBeNull();
    expect(result!.quantity).toBe(5);
    expect(result!.matchedBy).toBe('supplier');
  });

  test('returns null when not in cache', () => {
    expect(
      resolveLastOrderedFromCache({}, {
        key: 'k',
        itemId: 'item-1',
        unit: 'kg',
        locationId: null,
        locationGroup: null,
      })
    ).toBeNull();
  });

  test('skips entries with quantity <= 0', () => {
    const cache: Record<string, LastOrderedQuantityCacheValue> = {
      'item-1::kg::any': { quantity: 0, orderedAt: now },
    };
    expect(
      resolveLastOrderedFromCache(cache, {
        key: 'k',
        itemId: 'item-1',
        unit: 'kg',
        locationId: null,
        locationGroup: null,
      })
    ).toBeNull();
  });
});

// ── upsertLastOrderedCacheValue ──────────────────────────────

describe('upsertLastOrderedCacheValue', () => {
  test('inserts into empty cache', () => {
    const cache: Record<string, LastOrderedQuantityCacheValue> = {};
    upsertLastOrderedCacheValue(cache, 'key-1', { quantity: 5, orderedAt: '2024-01-02T00:00:00Z' });
    expect(cache['key-1']).toEqual({ quantity: 5, orderedAt: '2024-01-02T00:00:00Z' });
  });

  test('updates when newer', () => {
    const cache: Record<string, LastOrderedQuantityCacheValue> = {
      'key-1': { quantity: 3, orderedAt: '2024-01-01T00:00:00Z' },
    };
    upsertLastOrderedCacheValue(cache, 'key-1', { quantity: 10, orderedAt: '2024-01-02T00:00:00Z' });
    expect(cache['key-1'].quantity).toBe(10);
  });

  test('does not update when older', () => {
    const cache: Record<string, LastOrderedQuantityCacheValue> = {
      'key-1': { quantity: 10, orderedAt: '2024-01-02T00:00:00Z' },
    };
    upsertLastOrderedCacheValue(cache, 'key-1', { quantity: 3, orderedAt: '2024-01-01T00:00:00Z' });
    expect(cache['key-1'].quantity).toBe(10);
  });
});

// ── normalizePastOrder ───────────────────────────────────────

describe('normalizePastOrder', () => {
  test('returns null for null/undefined input', () => {
    expect(normalizePastOrder(null)).toBeNull();
    expect(normalizePastOrder(undefined)).toBeNull();
  });

  test('returns null for missing required fields', () => {
    expect(normalizePastOrder({ supplier_name: 'Test' })).toBeNull(); // No messageText
    expect(normalizePastOrder({ message_text: 'hi' })).toBeNull(); // No supplierName
  });

  test('normalizes valid past order', () => {
    const result = normalizePastOrder({
      supplier_name: 'Fish Co',
      message_text: 'Order: 5x Salmon',
      created_at: '2024-01-15T10:00:00Z',
      share_method: 'copy',
    });
    expect(result).not.toBeNull();
    expect(result!.supplierName).toBe('Fish Co');
    expect(result!.messageText).toBe('Order: 5x Salmon');
    expect(result!.shareMethod).toBe('copy');
    expect(result!.id).toBeDefined();
  });

  test('handles camelCase fields', () => {
    const result = normalizePastOrder({
      supplierName: 'Fish Co',
      messageText: 'Order: 5x Salmon',
    });
    expect(result).not.toBeNull();
    expect(result!.supplierName).toBe('Fish Co');
  });
});

// ── normalizePastOrders ──────────────────────────────────────

describe('normalizePastOrders', () => {
  test('returns empty array for non-array', () => {
    expect(normalizePastOrders(null)).toEqual([]);
    expect(normalizePastOrders(undefined)).toEqual([]);
    expect(normalizePastOrders('string')).toEqual([]);
  });

  test('filters out invalid entries', () => {
    const result = normalizePastOrders([
      { supplier_name: 'A', message_text: 'order A', created_at: '2024-01-01T00:00:00Z' },
      null,
      { supplier_name: '', message_text: 'bad' },
      { supplier_name: 'B', message_text: 'order B', created_at: '2024-01-02T00:00:00Z' },
    ]);
    expect(result).toHaveLength(2);
  });

  test('sorts newest first', () => {
    const result = normalizePastOrders([
      { supplier_name: 'A', message_text: 'old', created_at: '2024-01-01T00:00:00Z' },
      { supplier_name: 'B', message_text: 'new', created_at: '2024-01-05T00:00:00Z' },
    ]);
    expect(result[0].supplierName).toBe('B');
    expect(result[1].supplierName).toBe('A');
  });
});

// ── getPastOrderCountsFromPayload ────────────────────────────

describe('getPastOrderCountsFromPayload', () => {
  test('counts from arrays', () => {
    const result = getPastOrderCountsFromPayload({
      regularItems: [1, 2, 3],
      remainingItems: [4, 5],
    });
    expect(result.itemCount).toBe(5);
    expect(result.remainingCount).toBe(2);
  });

  test('uses explicit counts when provided', () => {
    const result = getPastOrderCountsFromPayload({
      totalItemCount: 10,
      remainingCount: 3,
      regularItems: [1],
    });
    expect(result.itemCount).toBe(10);
    expect(result.remainingCount).toBe(3);
  });

  test('handles snake_case keys', () => {
    const result = getPastOrderCountsFromPayload({
      regular_items: [1, 2],
      remaining_items: [3],
      total_item_count: 7,
      remaining_count: 1,
    });
    expect(result.itemCount).toBe(7);
    expect(result.remainingCount).toBe(1);
  });

  test('handles empty payload', () => {
    const result = getPastOrderCountsFromPayload({});
    expect(result.itemCount).toBe(0);
    expect(result.remainingCount).toBe(0);
  });
});

// ── extractConsumedOrderItemIds ──────────────────────────────

describe('extractConsumedOrderItemIds', () => {
  test('extracts from camelCase payload', () => {
    const orders = [
      {
        id: 'p1',
        payload: { sourceOrderItemIds: ['oi-1', 'oi-2'] },
      },
    ] as unknown as PastOrder[];

    const result = extractConsumedOrderItemIds(orders);
    expect(result.has('oi-1')).toBe(true);
    expect(result.has('oi-2')).toBe(true);
  });

  test('extracts from snake_case payload', () => {
    const orders = [
      {
        id: 'p1',
        payload: { source_order_item_ids: ['oi-3'] },
      },
    ] as unknown as PastOrder[];

    const result = extractConsumedOrderItemIds(orders);
    expect(result.has('oi-3')).toBe(true);
  });

  test('deduplicates across multiple orders', () => {
    const orders = [
      { id: 'p1', payload: { sourceOrderItemIds: ['oi-1'] } },
      { id: 'p2', payload: { sourceOrderItemIds: ['oi-1', 'oi-2'] } },
    ] as unknown as PastOrder[];

    const result = extractConsumedOrderItemIds(orders);
    expect(result.size).toBe(2);
  });

  test('returns empty set for orders with no consumed IDs', () => {
    const orders = [{ id: 'p1', payload: {} }] as unknown as PastOrder[];
    const result = extractConsumedOrderItemIds(orders);
    expect(result.size).toBe(0);
  });
});

// ── mergeRemoteAndPendingPastOrders ──────────────────────────

describe('mergeRemoteAndPendingPastOrders', () => {
  const makeOrder = (id: string, date: string, syncStatus: 'synced' | 'pending_sync' = 'synced') =>
    ({
      id,
      createdAt: date,
      syncStatus,
    }) as unknown as PastOrder;

  test('returns remote orders when no pending locals', () => {
    const remote = [makeOrder('r1', '2024-01-02T00:00:00Z')];
    const result = mergeRemoteAndPendingPastOrders(remote, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
  });

  test('includes pending local orders not yet in remote', () => {
    const remote = [makeOrder('r1', '2024-01-01T00:00:00Z')];
    const local = [makeOrder('l1', '2024-01-02T00:00:00Z', 'pending_sync')];
    const result = mergeRemoteAndPendingPastOrders(remote, local, []);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('l1'); // Newer, sorted first
  });

  test('excludes local orders already in remote', () => {
    const remote = [makeOrder('shared-id', '2024-01-01T00:00:00Z')];
    const local = [makeOrder('shared-id', '2024-01-01T00:00:00Z', 'pending_sync')];
    const result = mergeRemoteAndPendingPastOrders(remote, local, []);
    expect(result).toHaveLength(1);
  });
});
