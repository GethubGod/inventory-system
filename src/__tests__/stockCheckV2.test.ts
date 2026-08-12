jest.mock('../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

import {
  calculateSuggestedOrderQty,
  mapStockCheckStatusToQuantity,
} from '../services/stockCheckV2';

describe('StockCheckV2 fast status mapping', () => {
  test('maps Full to par and Out to zero', () => {
    expect(mapStockCheckStatusToQuantity({
      status: 'full',
      parLevel: 12,
      reorderPoint: 4,
    })).toBe(12);

    expect(mapStockCheckStatusToQuantity({
      status: 'out',
      parLevel: 12,
      reorderPoint: 4,
    })).toBe(0);
  });

  test('maps Low one numpad step below the reorder point', () => {
    expect(mapStockCheckStatusToQuantity({
      status: 'low',
      parLevel: 12,
      reorderPoint: 4,
    })).toBe(3);
  });

  test('uses the legacy minimum quantity when a reorder point has not been configured', () => {
    expect(mapStockCheckStatusToQuantity({
      status: 'low',
      parLevel: 12,
      reorderPoint: null,
      legacyMinQuantity: 5,
    })).toBe(4);
  });
});

describe('StockCheckV2 suggestion math', () => {
  test('does not suggest an order until the count is below the reorder point', () => {
    expect(calculateSuggestedOrderQty({
      countedQty: 4,
      parLevel: 12,
      reorderPoint: 4,
      orderUnitSize: 1,
    })).toBe(0);
  });

  test('fills the deficit to par and rounds up to whole order units', () => {
    // 12 par - 3 counted = 9 counted units. At 5 counted units per case,
    // the order must be two cases rather than a partial 1.8-case order.
    expect(calculateSuggestedOrderQty({
      countedQty: 3,
      parLevel: 12,
      reorderPoint: 4,
      orderUnitSize: 5,
    })).toBe(2);
  });

  test('never produces a negative suggestion for a count at or above par', () => {
    expect(calculateSuggestedOrderQty({
      countedQty: 20,
      parLevel: 12,
      reorderPoint: 4,
      orderUnitSize: 1,
    })).toBe(0);
  });
});
