const mockFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: mockFrom,
    functions: { invoke: jest.fn() },
  },
}));

import {
  isInvoicePriceMismatch,
  isInvoiceQuantityMismatch,
  summarizeInvoiceMismatches,
  type InvoiceScanItem,
} from '../services/invoiceScans';

function line(overrides: Partial<InvoiceScanItem> = {}): InvoiceScanItem {
  return {
    id: 'line-1',
    lineNumber: 1,
    rawName: 'Salmon',
    quantity: 4,
    unit: 'case',
    unitPrice: 25,
    totalPrice: 100,
    matchedItemId: 'item-salmon',
    matchedPastOrderItemId: 'past-line-salmon',
    matchedItemName: 'Salmon',
    orderedQuantity: 4,
    orderedUnit: 'case',
    priceDelta: 0,
    quantityDelta: 0,
    ...overrides,
  };
}

describe('invoice scan mismatch helpers', () => {
  test('uses a numeric tolerance so serialization noise is not a mismatch', () => {
    expect(isInvoicePriceMismatch(line({ priceDelta: 0.0000001 }))).toBe(false);
    expect(isInvoicePriceMismatch(line({ priceDelta: -1.25 }))).toBe(true);
    expect(isInvoiceQuantityMismatch(line({ quantityDelta: 0.0000001 }))).toBe(false);
    expect(isInvoiceQuantityMismatch(line({ quantityDelta: 0.5 }))).toBe(true);
  });

  test('summarizes matched, unmatched, price, and quantity discrepancies', () => {
    expect(summarizeInvoiceMismatches([
      line(),
      line({ id: 'line-2', lineNumber: 2, priceDelta: 2.5, quantityDelta: -1 }),
      line({
        id: 'line-3',
        lineNumber: 3,
        rawName: 'Unknown sauce',
        matchedItemId: null,
        matchedPastOrderItemId: null,
        matchedItemName: null,
        orderedQuantity: null,
        orderedUnit: null,
        priceDelta: null,
        quantityDelta: null,
      }),
    ])).toEqual({
      totalLines: 3,
      matchedLines: 2,
      unmatchedLines: 1,
      priceMismatchCount: 1,
      quantityMismatchCount: 1,
    });
  });
});
