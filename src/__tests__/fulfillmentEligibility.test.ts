import {
  getPendingFulfillmentOrderIdsFromItemRows,
  isOrderFulfillmentEligible,
  isOrderItemFulfillmentEligible,
  type FulfillmentOrderItemEligibilityOptions,
} from '../services/fulfillmentEligibility';

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getScreenOrderIds(
  orders: readonly unknown[],
  options?: FulfillmentOrderItemEligibilityOptions,
): string[] {
  return orders.flatMap((order) => {
    const row = toRecord(order);
    const orderId = typeof row?.id === 'string' ? row.id : null;
    const orderItems = Array.isArray(row?.order_items) ? row.order_items : [];

    if (!orderId || !isOrderFulfillmentEligible(order)) return [];
    return orderItems.some((item) => isOrderItemFulfillmentEligible(item, options))
      ? [orderId]
      : [];
  });
}

function getBadgeOrderIds(
  orders: readonly unknown[],
  options?: FulfillmentOrderItemEligibilityOptions,
): string[] {
  const itemRows = orders.flatMap((order) => {
    const row = toRecord(order);
    const orderId = typeof row?.id === 'string' ? row.id : null;
    const orderItems = Array.isArray(row?.order_items) ? row.order_items : [];

    if (!orderId) return [];
    return orderItems.map((item) => ({
      ...(toRecord(item) ?? {}),
      order_id: orderId,
      orders: order,
    }));
  });

  return Array.from(getPendingFulfillmentOrderIdsFromItemRows(itemRows, options));
}

function expectBadgeAndScreenToAgree(
  orders: readonly unknown[],
  options?: FulfillmentOrderItemEligibilityOptions,
) {
  expect(getBadgeOrderIds(orders, options)).toEqual(getScreenOrderIds(orders, options));
}

describe('isOrderFulfillmentEligible', () => {
  test('includes regular non-Quick Order rows', () => {
    expect(isOrderFulfillmentEligible({ entry_method: 'manual' })).toBe(true);
    expect(isOrderFulfillmentEligible({})).toBe(true);
  });

  test('accepts quick-session rows once review is settled, matching the Fulfillment screen', () => {
    expect(isOrderFulfillmentEligible({
      entry_method: 'quick_order',
      quick_session_id: 'session-001',
      manager_review_status: 'approved',
    })).toBe(true);
    expect(isOrderFulfillmentEligible({
      entry_method: 'quick_order',
      quick_session_id: 'session-001',
      manager_review_status: 'not_required',
    })).toBe(true);
    expect(isOrderFulfillmentEligible({
      entry_method: 'voice_order',
      manager_review_status: 'not_required',
    })).toBe(true);
    // Session FK is ON DELETE SET NULL; a pending voice order must stay
    // excluded even with no quick_session_id.
    expect(isOrderFulfillmentEligible({
      entry_method: 'voice_order',
      quick_session_id: null,
      manager_review_status: 'pending',
    })).toBe(false);
  });

  test('excludes any order left in an unsettled review state', () => {
    for (const manager_review_status of ['pending', 'rejected', 'changes_requested']) {
      expect(isOrderFulfillmentEligible({
        entry_method: 'quick_order',
        quick_session_id: 'session-001',
        manager_review_status,
      })).toBe(false);
      // Gating on the status alone means a nulled session FK, or an entry
      // method the review pipeline predates, cannot slip past the gate.
      expect(isOrderFulfillmentEligible({
        entry_method: 'suggested_order',
        quick_session_id: null,
        manager_review_status,
      })).toBe(false);
    }
  });

  test('treats a missing review status as settled', () => {
    // manager_review_status is NOT NULL DEFAULT 'not_required', so it is absent
    // only on the badge's legacy-column fallback query, which runs against a
    // database old enough to have no review pipeline to honor.
    expect(isOrderFulfillmentEligible({ entry_method: 'quick_order' })).toBe(true);
    expect(
      isOrderFulfillmentEligible({ entry_method: 'quick_order', manager_review_status: null }),
    ).toBe(true);
  });
});

describe('Fulfillment badge and screen eligibility', () => {
  test('counts a fresh eligible order in both surfaces', () => {
    const orders = [{
      id: 'fresh-order',
      status: 'submitted',
      created_at: '2026-08-27T12:00:00.000Z',
      entry_method: 'manual',
      order_items: [{
        id: 'fresh-item',
        status: 'pending',
        quantity: 2,
        input_mode: 'quantity',
        inventory_item: { id: 'inventory-1' },
      }],
    }];

    expectBadgeAndScreenToAgree(orders);
    expect(getBadgeOrderIds(orders)).toEqual(['fresh-order']);
  });

  test('excludes a stale June 19 item that is no longer pending from both surfaces', () => {
    const orders = [{
      id: 'stale-order',
      status: 'submitted',
      created_at: '2026-06-19T12:00:00.000Z',
      entry_method: 'manual',
      order_items: [{
        id: 'stale-item',
        status: 'sent',
        quantity: 2,
        input_mode: 'quantity',
        inventory_item: { id: 'inventory-1' },
      }],
    }];

    expectBadgeAndScreenToAgree(orders);
    expect(getBadgeOrderIds(orders)).toEqual([]);
  });

  test('matches the screen for a review-pending Quick Order', () => {
    const orders = [{
      id: 'review-pending-order',
      status: 'submitted',
      created_at: '2026-08-27T12:00:00.000Z',
      entry_method: 'quick_order',
      quick_session_id: 'session-002',
      manager_review_status: 'pending',
      order_items: [{
        id: 'review-pending-item',
        status: 'pending',
        quantity: 2,
        input_mode: 'quantity',
        inventory_item: { id: 'inventory-1' },
      }],
    }];

    expectBadgeAndScreenToAgree(orders);
    expect(getBadgeOrderIds(orders)).toEqual([]);
  });

  test('applies consumed and queued order-later exclusions in both surfaces', () => {
    const orders = [
      {
        id: 'consumed-order',
        status: 'submitted',
        entry_method: 'manual',
        order_items: [{
          id: 'consumed-item',
          status: 'pending',
          quantity: 2,
          input_mode: 'quantity',
          inventory_item: { id: 'inventory-1' },
        }],
      },
      {
        id: 'queued-order',
        status: 'submitted',
        entry_method: 'manual',
        order_items: [{
          id: 'queued-item',
          status: 'pending',
          quantity: 2,
          input_mode: 'quantity',
          inventory_item: { id: 'inventory-1' },
        }],
      },
    ];
    const options = {
      consumedOrderItemIds: new Set(['consumed-item']),
      orderLaterSourceOrderItemIds: new Set(['queued-item']),
    };

    expectBadgeAndScreenToAgree(orders, options);
    expect(getBadgeOrderIds(orders, options)).toEqual([]);
  });

  test('includes review-exempt Quick Orders in both surfaces', () => {
    const orders = [{
      id: 'b0768c70',
      status: 'submitted',
      created_at: '2026-06-19T12:00:00.000Z',
      entry_method: 'quick_order',
      quick_session_id: 'session-003',
      manager_review_status: 'not_required',
      order_items: [{
        id: 'not-required-item',
        status: 'pending',
        quantity: 2,
        input_mode: 'quantity',
        inventory_item: { id: 'inventory-1' },
      }],
    }];

    expectBadgeAndScreenToAgree(orders);
    expect(getBadgeOrderIds(orders)).toEqual(['b0768c70']);
  });
});
