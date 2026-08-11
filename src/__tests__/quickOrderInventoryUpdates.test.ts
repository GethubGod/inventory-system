import {
  buildInventoryUpdateRows,
  filterInventoryItemsForOrderList,
} from '../features/ordering/quickOrderInventoryUpdates';

describe('quickOrderInventoryUpdates', () => {
  test('keeps stock rows visible when no order is needed and shows the counted quantity', () => {
    const rows = buildInventoryUpdateRows({
      rawText: 'Tuna Loin 1 case\nGround Tuna 3 cases',
      stockUpdates: [
        {
          item_id: 'tuna-loin-id',
          item_name: 'Tuna Loin',
          quantity: 1,
          unit: 'cs',
          source: 'typed',
          confidence: 0.9,
          original_text: 'Tuna Loin 1 case',
        },
        {
          item_id: 'ground-tuna-id',
          item_name: 'Ground Tuna',
          quantity: 3,
          unit: 'cs',
          source: 'typed',
          confidence: 0.9,
          original_text: 'Ground Tuna 3 cases',
        },
      ],
      recommendations: [],
      safetyWarnings: [
        {
          type: 'no_order_needed',
          message: 'Tuna Loin is already at or above target stock. No order is needed.',
          item_id: 'tuna-loin-id',
          item_name: 'Tuna Loin',
          quantity: 1,
          unit: 'cs',
          severity: 'info',
          original_text: 'Tuna Loin 1 case',
        },
        {
          type: 'no_order_needed',
          message: 'Ground Tuna is already at or above target stock. No order is needed.',
          item_id: 'ground-tuna-id',
          item_name: 'Ground Tuna',
          quantity: 3,
          unit: 'cs',
          severity: 'info',
          original_text: 'Ground Tuna 3 cases',
        },
      ],
    });

    expect(rows).toMatchObject([
      {
        item_name: 'Tuna Loin',
        current_quantity: 1,
        current_unit: 'cs',
        new_quantity: null,
        status: 'no_order',
      },
      {
        item_name: 'Ground Tuna',
        current_quantity: 3,
        current_unit: 'cs',
        new_quantity: null,
        status: 'no_order',
      },
    ]);
  });

  test('marks missing target stock rows as needs input instead of zero order', () => {
    const rows = buildInventoryUpdateRows({
      rawText: 'White Fish 5 packs',
      stockUpdates: [
        {
          item_id: 'white-fish-id',
          item_name: 'White Fish (Izumidai)',
          quantity: 5,
          unit: 'pack',
          source: 'typed',
          confidence: 0.9,
          original_text: 'White Fish 5 packs',
        },
      ],
      recommendations: [],
      safetyWarnings: [
        {
          type: 'recommendation_unavailable',
          message: 'I found White Fish (Izumidai) at 5 packs remaining, but I do not know the target quantity yet.',
          item_id: 'white-fish-id',
          item_name: 'White Fish (Izumidai)',
          quantity: 5,
          unit: 'pack',
          severity: 'info',
          original_text: 'White Fish 5 packs',
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        item_name: 'White Fish (Izumidai)',
        current_quantity: 5,
        current_unit: 'pack',
        new_quantity: null,
        status: 'needs_input',
        issue_message: expect.stringContaining('target quantity'),
        composer_prefill: 'White Fish 5 packs',
      }),
    ]);
  });

  test('includes status-only no-order phrases and unresolved review items', () => {
    const rows = buildInventoryUpdateRows({
      rawText: 'A lot yellowtail\nMystery Fish 3 packs',
      stockUpdates: [],
      recommendations: [],
      safetyWarnings: [
        {
          type: 'no_order_needed',
          message: 'Yellowtail - no order needed. "a lot" means enough stock.',
          item_id: 'yellowtail-id',
          item_name: 'Yellowtail',
          severity: 'info',
          original_text: 'A lot yellowtail',
        },
      ],
      reviewItems: [
        {
          item_id: null,
          item_name: 'Mystery Fish',
          raw_text: 'Mystery Fish 3 packs',
          raw_token: 'Mystery Fish 3 packs',
          quantity: 3,
          unit: 'pack',
          status: 'no_match',
          needs_clarification: true,
          unresolved: true,
          source: 'remaining_inventory',
        },
      ],
    });

    expect(rows).toMatchObject([
      {
        item_name: 'Yellowtail',
        current_label: 'a lot',
        status: 'no_order',
      },
      {
        item_name: 'Mystery Fish',
        current_quantity: 3,
        current_unit: 'pack',
        status: 'needs_input',
        composer_prefill: 'Mystery Fish 3 packs',
      },
    ]);
  });

  test('keeps unresolved inventory rows out of the floating order list', () => {
    const ready = {
      item_id: 'salmon-id',
      item_name: 'Salmon',
      quantity: 1,
      unit: 'pc',
      status: 'valid' as const,
      needs_clarification: false,
      unresolved: false,
    };
    const unresolved = {
      item_id: null,
      item_name: 'masago outside',
      raw_text: 'masago outside 1 case',
      raw_token: 'masago outside 1 case',
      quantity: 1,
      unit: 'cs',
      status: 'no_match' as const,
      needs_clarification: true,
      unresolved: true,
    };

    expect(filterInventoryItemsForOrderList([ready, unresolved])).toEqual([ready]);
  });
});
