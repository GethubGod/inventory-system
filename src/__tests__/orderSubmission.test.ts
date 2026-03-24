/**
 * Order Submission Tests
 *
 * Pure-function tests for validation, error classification, and payload shape.
 * These have zero React Native dependencies and can run with plain Jest/ts-jest.
 *
 * Run: npx ts-jest/bin/ts-jest.js -- src/__tests__/orderSubmission.test.ts
 * Or with jest-expo if configured.
 */

// Import from the pure validation module (no RN/Supabase deps)
import {
  validateSubmitRequest,
  OrderSubmissionError,
  type SubmitOrderRequest,
  type OrderItemPayload,
} from '../services/orderValidation';

// ── Helpers ──────────────────────────────────────────────────

function makeItem(overrides: Partial<OrderItemPayload> = {}): OrderItemPayload {
  return {
    inventory_item_id: 'item-001',
    quantity: 5,
    unit_type: 'base',
    input_mode: 'quantity',
    quantity_requested: 5,
    remaining_reported: null,
    decided_quantity: null,
    decided_by: null,
    decided_at: null,
    note: null,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<SubmitOrderRequest> = {}): SubmitOrderRequest {
  return {
    orderId: 'order-uuid-001',
    locationId: 'loc-001',
    userId: 'user-001',
    status: 'submitted',
    items: [makeItem()],
    ...overrides,
  };
}

// ── Validation Tests ─────────────────────────────────────────

describe('validateSubmitRequest', () => {
  test('returns null for valid request', () => {
    expect(validateSubmitRequest(makeRequest())).toBeNull();
  });

  test('rejects empty orderId', () => {
    expect(validateSubmitRequest(makeRequest({ orderId: '' }))).toBe('Missing order ID');
  });

  test('rejects missing locationId', () => {
    expect(validateSubmitRequest(makeRequest({ locationId: '' }))).toBe('Missing location');
  });

  test('rejects missing userId', () => {
    expect(validateSubmitRequest(makeRequest({ userId: '' }))).toBe('Missing user');
  });

  test('rejects empty items array', () => {
    expect(validateSubmitRequest(makeRequest({ items: [] }))).toBe('Cart is empty');
  });

  test('rejects null items', () => {
    expect(validateSubmitRequest(makeRequest({ items: null as any }))).toBe('Cart is empty');
  });

  test('rejects undefined items', () => {
    expect(validateSubmitRequest(makeRequest({ items: undefined as any }))).toBe('Cart is empty');
  });

  test('rejects item without inventory_item_id', () => {
    const result = validateSubmitRequest(
      makeRequest({ items: [makeItem({ inventory_item_id: '' })] })
    );
    expect(result).toBe('Item 1 is missing a product reference');
  });

  test('rejects item with zero quantity', () => {
    const result = validateSubmitRequest(
      makeRequest({ items: [makeItem({ quantity: 0 })] })
    );
    expect(result).toBe('Item 1 has an invalid quantity');
  });

  test('rejects item with negative quantity', () => {
    const result = validateSubmitRequest(
      makeRequest({ items: [makeItem({ quantity: -3 })] })
    );
    expect(result).toBe('Item 1 has an invalid quantity');
  });

  test('rejects item with NaN quantity', () => {
    const result = validateSubmitRequest(
      makeRequest({ items: [makeItem({ quantity: NaN })] })
    );
    expect(result).toBe('Item 1 has an invalid quantity');
  });

  test('rejects item with Infinity quantity', () => {
    const result = validateSubmitRequest(
      makeRequest({ items: [makeItem({ quantity: Infinity })] })
    );
    expect(result).toBe('Item 1 has an invalid quantity');
  });

  test('accepts multiple valid items', () => {
    expect(
      validateSubmitRequest(
        makeRequest({
          items: [
            makeItem({ inventory_item_id: 'a', quantity: 1 }),
            makeItem({ inventory_item_id: 'b', quantity: 10 }),
            makeItem({ inventory_item_id: 'c', quantity: 0.5 }),
          ],
        })
      )
    ).toBeNull();
  });

  test('reports first invalid item in multi-item request', () => {
    const result = validateSubmitRequest(
      makeRequest({
        items: [
          makeItem({ inventory_item_id: 'a', quantity: 1 }),
          makeItem({ inventory_item_id: '', quantity: 5 }),
          makeItem({ inventory_item_id: 'c', quantity: -1 }),
        ],
      })
    );
    expect(result).toBe('Item 2 is missing a product reference');
  });

  test('does not require organization scope in the request shape', () => {
    expect(validateSubmitRequest(makeRequest())).toBeNull();
  });

  test('accepts remaining-mode item with valid quantity', () => {
    expect(
      validateSubmitRequest(
        makeRequest({
          items: [
            makeItem({
              input_mode: 'remaining',
              quantity: 1,
              quantity_requested: null,
              remaining_reported: 3,
            }),
          ],
        })
      )
    ).toBeNull();
  });

  test('accepts draft status', () => {
    expect(validateSubmitRequest(makeRequest({ status: 'draft' }))).toBeNull();
  });
});

// ── OrderSubmissionError Tests ───────────────────────────────

describe('OrderSubmissionError', () => {
  test('retryable flag for timeout', () => {
    const err = new OrderSubmissionError('timeout', true, 'TIMEOUT');
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toBe('timeout');
  });

  test('non-retryable flag for auth error', () => {
    const err = new OrderSubmissionError('no session', false, 'NO_SESSION');
    expect(err.retryable).toBe(false);
  });

  test('is instanceof Error', () => {
    const err = new OrderSubmissionError('test', false);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OrderSubmissionError);
    expect(err.name).toBe('OrderSubmissionError');
  });

  test('code is optional', () => {
    const err = new OrderSubmissionError('generic', true);
    expect(err.code).toBeUndefined();
  });
});

// ── Idempotency Design ──────────────────────────────────────

describe('idempotency contract', () => {
  test('same orderId produces identical validation results', () => {
    // Documents: client retries with same orderId → DB uses ON CONFLICT
    const request1 = makeRequest({ orderId: 'idempotent-id-123' });
    const request2 = makeRequest({ orderId: 'idempotent-id-123' });
    expect(request1.orderId).toBe(request2.orderId);
    expect(validateSubmitRequest(request1)).toBeNull();
    expect(validateSubmitRequest(request2)).toBeNull();
  });
});

// ── Payload Shape ────────────────────────────────────────────

describe('OrderItemPayload shape', () => {
  test('contains all DB-required fields', () => {
    const item = makeItem();
    const requiredKeys = [
      'inventory_item_id', 'quantity', 'unit_type', 'input_mode',
      'quantity_requested', 'remaining_reported',
      'decided_quantity', 'decided_by', 'decided_at', 'note',
    ];
    for (const key of requiredKeys) {
      expect(item).toHaveProperty(key);
    }
  });

  test('does not contain server-generated fields', () => {
    const item = makeItem();
    expect(item).not.toHaveProperty('id');
    expect(item).not.toHaveProperty('created_at');
    expect(item).not.toHaveProperty('order_id');
  });
});

// ── Edge Cases ───────────────────────────────────────────────

describe('edge case validation', () => {
  test('single item with fractional quantity', () => {
    expect(
      validateSubmitRequest(makeRequest({ items: [makeItem({ quantity: 0.25 })] }))
    ).toBeNull();
  });

  test('item with note', () => {
    expect(
      validateSubmitRequest(makeRequest({ items: [makeItem({ note: 'extra spicy' })] }))
    ).toBeNull();
  });

  test('item with all optional fields null', () => {
    expect(
      validateSubmitRequest(
        makeRequest({
          items: [
            makeItem({
              quantity_requested: null,
              remaining_reported: null,
              decided_quantity: null,
              decided_by: null,
              decided_at: null,
              note: null,
            }),
          ],
        })
      )
    ).toBeNull();
  });

  test('large cart (50 items)', () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ inventory_item_id: `item-${i}`, quantity: i + 1 })
    );
    expect(validateSubmitRequest(makeRequest({ items }))).toBeNull();
  });
});
