import {
  buildSendAllFinalizePayload,
  buildSendAllItemsText,
  buildSendAllMessage,
  countUnresolvedRemaining,
  formatSendAllQuantity,
  type InventoryUnitInfo,
  type SendAllRegularItem,
  type SendAllRemainingItem,
} from '../features/fulfillment/sendAll/sendAllMessage';

function makeUnitInfo(overrides: Partial<InventoryUnitInfo> = {}): InventoryUnitInfo {
  return {
    id: 'item-1',
    base_unit: 'pc',
    pack_unit: 'case',
    pack_size: 12,
    ...overrides,
  };
}

function makeRegular(overrides: Partial<SendAllRegularItem> = {}): SendAllRegularItem {
  return {
    id: 'sushi-item-1',
    inventoryItemId: 'item-1',
    name: 'Salmon',
    category: 'fish',
    locationGroup: 'sushi',
    quantity: 3,
    unitType: 'pack',
    unitLabel: 'case',
    notes: [],
    sourceOrderItemIds: ['oi-1'],
    sourceOrderIds: ['o-1'],
    sourceDraftItemIds: [],
    ...overrides,
  };
}

function makeRemaining(overrides: Partial<SendAllRemainingItem> = {}): SendAllRemainingItem {
  return {
    orderItemId: 'oi-9',
    orderId: 'o-9',
    inventoryItemId: 'item-9',
    name: 'Nori',
    category: 'dry',
    locationGroup: 'poki',
    locationId: 'loc-1',
    locationName: 'Poki Downtown',
    unitType: 'base',
    unitLabel: 'pack',
    reportedRemaining: 2,
    decidedQuantity: 4,
    note: null,
    ...overrides,
  };
}

describe('formatSendAllQuantity', () => {
  test('keeps integers plain and trims trailing zeros', () => {
    expect(formatSendAllQuantity(3)).toBe('3');
    expect(formatSendAllQuantity(2.5)).toBe('2.5');
    expect(formatSendAllQuantity(Number.NaN)).toBe('0');
  });
});

describe('countUnresolvedRemaining', () => {
  test('counts null, zero, and non-finite decided quantities', () => {
    expect(
      countUnresolvedRemaining([
        makeRemaining({ decidedQuantity: null }),
        makeRemaining({ decidedQuantity: 0 }),
        makeRemaining({ decidedQuantity: 4 }),
      ])
    ).toBe(2);
  });
});

describe('buildSendAllItemsText', () => {
  test('groups items under location headers in sushi-then-poki order', () => {
    const text = buildSendAllItemsText(
      [
        makeRegular({ locationGroup: 'poki', name: 'Tuna', id: 'poki-tuna' }),
        makeRegular({ name: 'Salmon' }),
      ],
      []
    );
    expect(text).toBe(
      '--- SUSHI ---\n- Salmon: 3 case\n\n--- POKI ---\n- Tuna: 3 case'
    );
  });

  test('merges duplicate name/unit lines within a group', () => {
    const text = buildSendAllItemsText(
      [
        makeRegular({ quantity: 2 }),
        makeRegular({ id: 'sushi-item-1b', quantity: 3 }),
      ],
      []
    );
    expect(text).toBe('--- SUSHI ---\n- Salmon: 5 case');
  });

  test('remaining items use decided quantity and merge with regular lines', () => {
    const text = buildSendAllItemsText(
      [makeRegular({ locationGroup: 'poki', name: 'Nori', unitType: 'base', unitLabel: 'pack' })],
      [makeRemaining()]
    );
    expect(text).toBe('--- POKI ---\n- Nori: 7 pack');
  });

  test('undecided remaining items render a [set qty] placeholder', () => {
    const text = buildSendAllItemsText([], [makeRemaining({ decidedQuantity: null })]);
    expect(text).toBe('--- POKI ---\n- Nori: [set qty] pack');
  });

  test('empty input renders the no-items copy', () => {
    expect(buildSendAllItemsText([], [])).toBe('No items to order.');
  });

  test('items are sorted by name within a group', () => {
    const text = buildSendAllItemsText(
      [
        makeRegular({ id: 'b', name: 'Wasabi' }),
        makeRegular({ id: 'a', name: 'Ginger' }),
      ],
      []
    );
    expect(text).toBe('--- SUSHI ---\n- Ginger: 3 case\n- Wasabi: 3 case');
  });

  // F1 regression: the confirmation screen resolves printed unit labels through
  // resolveUnitSelectorProps, where inventory base_unit/pack_unit override the
  // order item's stored label. Send All must print the same resolved label.
  test('inventory canonical unit label overrides the order-item label (F1)', () => {
    const text = buildSendAllItemsText(
      [makeRegular({ unitType: 'pack', unitLabel: 'case' })],
      [],
      { 'item-1': makeUnitInfo({ pack_unit: 'cases' }) }
    );
    expect(text).toBe('--- SUSHI ---\n- Salmon: 3 cases');
  });

  test('lines merge on the inventory canonical label even when order-item labels differ (F1)', () => {
    const text = buildSendAllItemsText(
      [
        makeRegular({ id: 'a', quantity: 2, unitType: 'base', unitLabel: 'pc' }),
        makeRegular({ id: 'b', quantity: 3, unitType: 'base', unitLabel: 'pcs' }),
      ],
      [],
      { 'item-1': makeUnitInfo({ base_unit: 'pcs' }) }
    );
    expect(text).toBe('--- SUSHI ---\n- Salmon: 5 pcs');
  });

  test('remaining items also print the inventory canonical label (F1)', () => {
    const text = buildSendAllItemsText(
      [],
      [makeRemaining({ unitType: 'base', unitLabel: 'pack' })],
      { 'item-9': makeUnitInfo({ id: 'item-9', base_unit: 'sheets' }) }
    );
    expect(text).toBe('--- POKI ---\n- Nori: 4 sheets');
  });

  test('without inventory unit info the order-item label is kept', () => {
    const text = buildSendAllItemsText([makeRegular()], []);
    expect(text).toBe('--- SUSHI ---\n- Salmon: 3 case');
  });

  test('blank unit labels fall back to unit/pack like the confirmation screen (F4)', () => {
    const text = buildSendAllItemsText(
      [
        makeRegular({ id: 'a', name: 'Ginger', inventoryItemId: 'g-1', unitType: 'base', unitLabel: '' }),
        makeRegular({ id: 'b', name: 'Wasabi', inventoryItemId: 'w-1', unitType: 'pack', unitLabel: ' ' }),
      ],
      []
    );
    expect(text).toBe('--- SUSHI ---\n- Ginger: 3 unit\n- Wasabi: 3 pack');
  });

  test('[set qty] placeholder uses the resolved unit label (F4)', () => {
    const text = buildSendAllItemsText(
      [],
      [makeRemaining({ decidedQuantity: null })],
      { 'item-9': makeUnitInfo({ id: 'item-9', base_unit: 'sheets' }) }
    );
    expect(text).toBe('--- POKI ---\n- Nori: [set qty] sheets');
  });

  test('same-name regular items tie-break by inventoryItemId like the confirmation screen (F4)', () => {
    const text = buildSendAllItemsText(
      [
        makeRegular({ id: 'x', inventoryItemId: 'item-2', quantity: 2, unitLabel: 'case' }),
        makeRegular({ id: 'y', inventoryItemId: 'item-1', quantity: 7, unitLabel: 'box' }),
      ],
      []
    );
    expect(text).toBe('--- SUSHI ---\n- Salmon: 7 box\n- Salmon: 2 case');
  });

  test('remaining items keep source order (confirmation screen does not sort them)', () => {
    const text = buildSendAllItemsText(
      [],
      [
        makeRemaining({ orderItemId: 'oi-b', inventoryItemId: 'item-b', name: 'Wakame', decidedQuantity: 2 }),
        makeRemaining({ orderItemId: 'oi-a', inventoryItemId: 'item-a', name: 'Furikake', decidedQuantity: 5 }),
      ]
    );
    expect(text).toBe('--- POKI ---\n- Wakame: 2 pack\n- Furikake: 5 pack');
  });
});

describe('buildSendAllMessage', () => {
  test('fills template variables and normalizes escaped newlines', () => {
    const message = buildSendAllMessage({
      template: 'Hi {{supplier}},\\n{{items}}\\nThanks! ({{date}})',
      supplierLabel: 'True World',
      regularItems: [makeRegular()],
      remainingItems: [],
      now: new Date(2026, 7, 11),
    });
    expect(message).toBe(
      'Hi True World,\n--- SUSHI ---\n- Salmon: 3 case\nThanks! (August 11, 2026)'
    );
  });

  test('never mentions "reported" for remaining-mode items', () => {
    const message = buildSendAllMessage({
      template: '{{items}}',
      supplierLabel: 'Supplier',
      regularItems: [],
      remainingItems: [makeRemaining()],
    });
    expect(/\breported\b/i.test(message)).toBe(false);
  });
});

describe('buildSendAllFinalizePayload', () => {
  test('mirrors the confirmation-screen payload shape', () => {
    const payload = buildSendAllFinalizePayload(
      [
        makeRegular({
          notes: [{ text: 'no ice' }],
          sourceOrderItemIds: ['oi-1', 'oi-2'],
          sourceOrderIds: ['o-1'],
          sourceDraftItemIds: ['d-1'],
        }),
      ],
      [makeRemaining()]
    );

    expect(payload.totalItemCount).toBe(2);
    expect(payload.locationLabels.sort()).toEqual(['Poki', 'Sushi']);
    expect(payload.consumedOrderItemIds.sort()).toEqual(['oi-1', 'oi-2', 'oi-9']);
    expect(payload.consumedDraftItemIds).toEqual(['d-1']);
    expect(payload.sourceOrderIds.sort()).toEqual(['o-1', 'o-9']);

    expect(payload.regularPayload[0]).toMatchObject({
      id: 'sushi-item-1',
      inventoryItemId: 'item-1',
      notes: ['no ice'],
      quantity: 3,
    });
    expect(payload.remainingPayload[0]).toMatchObject({
      orderItemId: 'oi-9',
      quantity: 4,
      decidedQuantity: 4,
      reportedRemaining: 2,
    });

    expect(payload.historyLineItems).toHaveLength(2);
    expect(payload.historyLineItems[0]).toMatchObject({
      itemId: 'item-1',
      unit: 'case',
      quantity: 3,
      locationId: null,
      note: 'no ice',
    });
    expect(payload.historyLineItems[1]).toMatchObject({
      itemId: 'item-9',
      quantity: 4,
      locationId: 'loc-1',
      locationName: 'Poki Downtown',
    });
  });

  test('deduplicates consumed ids and drops zero-quantity history lines', () => {
    const payload = buildSendAllFinalizePayload(
      [
        makeRegular({ quantity: 0, sourceOrderItemIds: ['oi-1'], sourceOrderIds: ['o-1'] }),
        makeRegular({ id: 'x2', sourceOrderItemIds: ['oi-1'], sourceOrderIds: ['o-1'] }),
      ],
      [makeRemaining({ decidedQuantity: null })]
    );

    expect(payload.consumedOrderItemIds.sort()).toEqual(['oi-1', 'oi-9']);
    expect(payload.sourceOrderIds).toEqual(['o-1', 'o-9']);
    // Zero-quantity regular item and undecided remaining item are excluded from history.
    expect(payload.historyLineItems).toHaveLength(1);
    expect(payload.remainingPayload[0].quantity).toBe(0);
  });
});
