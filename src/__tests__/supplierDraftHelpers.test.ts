/**
 * Supplier Draft & Order-Later Helpers Tests
 *
 * Pure-function tests for supplier draft normalization and order-later queue management.
 */

// Mock RN and Supabase dependencies that sharedHelpers imports transitively
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({}) } }));
jest.mock('@/lib/notifications', () => ({ getNotificationsModule: () => null }));

import {
  normalizeSupplierDraftItem,
  normalizeSupplierDrafts,
  normalizeOrderLaterItem,
  normalizeOrderLaterQueue,
} from '../store/helpers/supplierDraftHelpers';

// ── normalizeSupplierDraftItem ───────────────────────────────

describe('normalizeSupplierDraftItem', () => {
  test('returns null for null/undefined', () => {
    expect(normalizeSupplierDraftItem(null)).toBeNull();
    expect(normalizeSupplierDraftItem(undefined)).toBeNull();
  });

  test('returns null for missing required fields', () => {
    expect(normalizeSupplierDraftItem({ supplierId: 'sup-1' })).toBeNull(); // No name
    expect(normalizeSupplierDraftItem({ name: 'Salmon' })).toBeNull(); // No supplierId
    expect(
      normalizeSupplierDraftItem({ supplierId: 'sup-1', name: 'Salmon', quantity: 0 })
    ).toBeNull(); // Zero quantity
  });

  test('normalizes valid draft item', () => {
    const result = normalizeSupplierDraftItem({
      supplierId: 'sup-1',
      name: 'Salmon',
      quantity: 5,
      unitType: 'pack',
    });
    expect(result).not.toBeNull();
    expect(result!.supplierId).toBe('sup-1');
    expect(result!.name).toBe('Salmon');
    expect(result!.quantity).toBe(5);
    expect(result!.unitType).toBe('pack');
  });

  test('defaults unitType to base', () => {
    const result = normalizeSupplierDraftItem({
      supplierId: 'sup-1',
      name: 'Tuna',
      quantity: 3,
    });
    expect(result!.unitType).toBe('base');
  });

  test('preserves note', () => {
    const result = normalizeSupplierDraftItem({
      supplierId: 'sup-1',
      name: 'Tuna',
      quantity: 2,
      note: '  fresh only  ',
    });
    expect(result!.note).toBe('fresh only');
  });
});

// ── normalizeSupplierDrafts ──────────────────────────────────

describe('normalizeSupplierDrafts', () => {
  test('returns empty object for non-object', () => {
    expect(normalizeSupplierDrafts(null)).toEqual({});
    expect(normalizeSupplierDrafts(undefined)).toEqual({});
  });

  test('normalizes drafts grouped by supplier', () => {
    const result = normalizeSupplierDrafts({
      'sup-1': [
        { supplierId: 'sup-1', name: 'Salmon', quantity: 5 },
        { supplierId: 'sup-1', name: 'Tuna', quantity: 3 },
      ],
      'sup-2': [
        { supplierId: 'sup-2', name: 'Rice', quantity: 10 },
        null, // Invalid - should be filtered out
      ],
    });
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['sup-1']).toHaveLength(2);
    expect(result['sup-2']).toHaveLength(1);
  });

  test('excludes suppliers with all invalid items', () => {
    const result = normalizeSupplierDrafts({
      'sup-1': [null, { name: 'no supplier id' }],
    });
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── normalizeOrderLaterItem ──────────────────────────────────

describe('normalizeOrderLaterItem', () => {
  test('returns null for null/undefined', () => {
    expect(normalizeOrderLaterItem(null)).toBeNull();
    expect(normalizeOrderLaterItem(undefined)).toBeNull();
  });

  test('returns null for missing required fields', () => {
    expect(normalizeOrderLaterItem({ item_name: 'Salmon' })).toBeNull(); // No createdBy
    expect(normalizeOrderLaterItem({ created_by: 'user-1' })).toBeNull(); // No itemName
  });

  test('normalizes valid order-later item', () => {
    const result = normalizeOrderLaterItem({
      item_name: 'Salmon',
      created_by: 'user-1',
      scheduled_at: '2024-01-15T10:00:00Z',
      qty: 5,
    });
    expect(result).not.toBeNull();
    expect(result!.itemName).toBe('Salmon');
    expect(result!.createdBy).toBe('user-1');
    expect(result!.quantity).toBe(5);
    expect(result!.status).toBe('queued');
  });

  test('handles camelCase fields', () => {
    const result = normalizeOrderLaterItem({
      itemName: 'Tuna',
      createdBy: 'user-2',
      scheduledAt: '2024-01-15T10:00:00Z',
    });
    expect(result).not.toBeNull();
    expect(result!.itemName).toBe('Tuna');
    expect(result!.createdBy).toBe('user-2');
  });

  test('preserves status field', () => {
    const cancelled = normalizeOrderLaterItem({
      item_name: 'Salmon',
      created_by: 'user-1',
      status: 'cancelled',
    });
    expect(cancelled!.status).toBe('cancelled');

    const added = normalizeOrderLaterItem({
      item_name: 'Salmon',
      created_by: 'user-1',
      status: 'added',
    });
    expect(added!.status).toBe('added');
  });

  test('defaults quantity to 1', () => {
    const result = normalizeOrderLaterItem({
      item_name: 'Salmon',
      created_by: 'user-1',
    });
    expect(result!.quantity).toBe(1);
  });
});

// ── normalizeOrderLaterQueue ─────────────────────────────────

describe('normalizeOrderLaterQueue', () => {
  test('returns empty array for non-array', () => {
    expect(normalizeOrderLaterQueue(null)).toEqual([]);
    expect(normalizeOrderLaterQueue(undefined)).toEqual([]);
  });

  test('filters out non-queued items', () => {
    const result = normalizeOrderLaterQueue([
      { item_name: 'A', created_by: 'u1', status: 'queued', scheduled_at: '2024-01-01T00:00:00Z' },
      { item_name: 'B', created_by: 'u1', status: 'cancelled', scheduled_at: '2024-01-02T00:00:00Z' },
      { item_name: 'C', created_by: 'u1', status: 'added', scheduled_at: '2024-01-03T00:00:00Z' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].itemName).toBe('A');
  });

  test('sorts by scheduledAt ascending', () => {
    const result = normalizeOrderLaterQueue([
      { item_name: 'Later', created_by: 'u1', scheduled_at: '2024-06-01T00:00:00Z' },
      { item_name: 'Earlier', created_by: 'u1', scheduled_at: '2024-01-01T00:00:00Z' },
    ]);
    expect(result[0].itemName).toBe('Earlier');
    expect(result[1].itemName).toBe('Later');
  });

  test('filters out invalid items', () => {
    const result = normalizeOrderLaterQueue([
      null,
      { item_name: 'Valid', created_by: 'u1' },
      { created_by: 'u1' }, // Missing name
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].itemName).toBe('Valid');
  });
});
