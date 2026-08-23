const mockFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: mockFrom,
  },
}));

import {
  deriveReceiptStatus,
  isReceiptLineDiscrepancy,
  listDiscrepancies,
} from '../services/orderReceiving';

function discrepancyQuery(result: { data: unknown; error: unknown }) {
  const query: any = {
    select: jest.fn(),
    gte: jest.fn(),
    order: jest.fn(),
  };
  query.select.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.order.mockResolvedValue(result);
  return query;
}

describe('order receiving helpers', () => {
  test('derives complete only when every line is checked and not short', () => {
    expect(deriveReceiptStatus([
      { received: true, receivedQty: null, orderedQty: 4 },
      { received: true, receivedQty: '4', orderedQty: 4 },
    ])).toBe('complete');

    expect(deriveReceiptStatus([
      { received: true, receivedQty: 3, orderedQty: 4 },
    ])).toBe('partial');

    expect(deriveReceiptStatus([
      { received: false, receivedQty: null, orderedQty: 4 },
    ])).toBe('partial');
  });

  test('treats unchecked and short quantities as discrepancies, but a blank quantity as full', () => {
    expect(isReceiptLineDiscrepancy({ received: false, receivedQty: null, orderedQty: 4 })).toBe(true);
    expect(isReceiptLineDiscrepancy({ received: true, receivedQty: 3.5, orderedQty: 4 })).toBe(true);
    expect(isReceiptLineDiscrepancy({ received: true, receivedQty: null, orderedQty: 4 })).toBe(false);
    expect(isReceiptLineDiscrepancy({ received: true, receivedQty: 4, orderedQty: 4 })).toBe(false);
  });
});

describe('listDiscrepancies', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns only missing or short lines with their order and receiving employee', async () => {
    const query = discrepancyQuery({
      data: [
        {
          id: 'line-short',
          receipt_id: 'receipt-1',
          past_order_item_id: 'order-item-1',
          received: true,
          received_qty: '2',
          note: 'Only two arrived',
          updated_at: '2026-08-12T16:00:00Z',
          past_order_item: {
            id: 'order-item-1', item_name: 'Salmon', unit: 'lb', quantity: '4', location_group: 'sushi',
          },
          receipt: {
            id: 'receipt-1', past_order_id: 'past-order-1', received_at: '2026-08-12T15:00:00Z', status: 'partial',
            past_order: { id: 'past-order-1', supplier_name: 'Fish Co', created_at: '2026-08-12T12:00:00Z' },
            employee: { id: 'employee-1', name: 'Ari', email: 'ari@example.com' },
          },
        },
        {
          id: 'line-full',
          receipt_id: 'receipt-1',
          past_order_item_id: 'order-item-2',
          received: true,
          received_qty: null,
          note: null,
          updated_at: '2026-08-12T16:00:00Z',
          past_order_item: {
            id: 'order-item-2', item_name: 'Tuna', unit: 'lb', quantity: '5', location_group: 'sushi',
          },
          receipt: {
            id: 'receipt-1', past_order_id: 'past-order-1', received_at: '2026-08-12T15:00:00Z', status: 'partial',
            past_order: { id: 'past-order-1', supplier_name: 'Fish Co', created_at: '2026-08-12T12:00:00Z' },
            employee: { id: 'employee-1', name: 'Ari', email: 'ari@example.com' },
          },
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    await expect(listDiscrepancies(14)).resolves.toEqual([
      expect.objectContaining({
        receiptId: 'receipt-1',
        receiptStatus: 'partial',
        pastOrderId: 'past-order-1',
        supplierName: 'Fish Co',
        employee: { id: 'employee-1', name: 'Ari', email: 'ari@example.com' },
        line: expect.objectContaining({ itemName: 'Salmon', orderedQty: 4, receivedQty: 2 }),
      }),
    ]);

    expect(mockFrom).toHaveBeenCalledWith('order_receipt_items');
    expect(query.gte).toHaveBeenCalledWith('receipt.received_at', expect.any(String));
  });
});
