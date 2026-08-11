jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

import type { ReceiptDetail, ReceiptLine } from '@/services/orderReceiving';
import {
  buildSaveLines,
  clampShortQty,
  countFlaggedLines,
  deriveSaveStatus,
  describeDiscrepancyLine,
  initReceiveState,
  isLineFlagged,
  receiveReducer,
  type ReceiveState,
} from '@/features/simpleOrder/receiving/receiveLineState';

function makeReceiptLine(overrides: Partial<ReceiptLine> = {}): ReceiptLine {
  return {
    id: 'line-1',
    receiptId: 'receipt-1',
    pastOrderItemId: 'poi-1',
    itemName: 'Salmon',
    unit: 'lb',
    orderedQty: 5,
    locationGroup: 'sushi',
    received: true,
    receivedQty: null,
    note: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeReceipt(lines: ReceiptLine[]): ReceiptDetail {
  return {
    id: 'receipt-1',
    pastOrderId: 'order-1',
    receivedBy: 'user-1',
    receivedAt: '2026-08-11T09:00:00Z',
    status: 'in_progress',
    createdAt: '2026-08-11T09:00:00Z',
    updatedAt: '2026-08-11T09:00:00Z',
    pastOrder: {
      id: 'order-1',
      supplierName: 'True World',
      createdAt: '2026-08-10T09:00:00Z',
      messageText: 'Salmon 5 lb',
    },
    lines,
  };
}

describe('initReceiveState', () => {
  test('defaults every fresh line to checked with no short quantity', () => {
    const state = initReceiveState(
      makeReceipt([
        makeReceiptLine(),
        makeReceiptLine({ id: 'line-2', pastOrderItemId: 'poi-2', itemName: 'Nori' }),
      ]),
    );

    expect(state.receiptId).toBe('receipt-1');
    expect(state.lines).toHaveLength(2);
    for (const line of state.lines) {
      expect(line.checked).toBe(true);
      expect(line.shortQty).toBeNull();
      expect(line.note).toBe('');
    }
  });

  test('resumes saved partial and missing flags from an in-progress receipt', () => {
    const state = initReceiveState(
      makeReceipt([
        // Saved short arrival: received with a quantity below ordered.
        makeReceiptLine({ received: true, receivedQty: 2, note: 'box damaged' }),
        // Saved missing line.
        makeReceiptLine({
          id: 'line-2',
          pastOrderItemId: 'poi-2',
          received: false,
          receivedQty: null,
        }),
        // Saved quantity at/above ordered counts as fully received.
        makeReceiptLine({
          id: 'line-3',
          pastOrderItemId: 'poi-3',
          received: true,
          receivedQty: 5,
        }),
      ]),
    );

    expect(state.lines[0]).toMatchObject({ checked: false, shortQty: 2, note: 'box damaged' });
    expect(state.lines[1]).toMatchObject({ checked: false, shortQty: null });
    expect(state.lines[2]).toMatchObject({ checked: true, shortQty: null });
  });
});

describe('receiveReducer', () => {
  const baseState = (): ReceiveState =>
    initReceiveState(makeReceipt([makeReceiptLine()]));

  test('toggle unchecks to "didn\'t arrive" and re-checking clears flag details', () => {
    let state = baseState();
    state = receiveReducer(state, { type: 'toggle', pastOrderItemId: 'poi-1' });
    expect(state.lines[0]).toMatchObject({ checked: false, shortQty: null });

    state = receiveReducer(state, { type: 'adjustShortQty', pastOrderItemId: 'poi-1', delta: 2 });
    state = receiveReducer(state, { type: 'setNote', pastOrderItemId: 'poi-1', note: 'short' });
    state = receiveReducer(state, { type: 'toggle', pastOrderItemId: 'poi-1' });
    expect(state.lines[0]).toMatchObject({ checked: true, shortQty: null, note: '' });
  });

  test('short quantity steps are clamped to [0, orderedQty]', () => {
    let state = receiveReducer(baseState(), { type: 'toggle', pastOrderItemId: 'poi-1' });

    state = receiveReducer(state, { type: 'adjustShortQty', pastOrderItemId: 'poi-1', delta: -1 });
    expect(state.lines[0].shortQty).toBe(0);

    for (let step = 0; step < 9; step += 1) {
      state = receiveReducer(state, { type: 'adjustShortQty', pastOrderItemId: 'poi-1', delta: 1 });
    }
    expect(state.lines[0].shortQty).toBe(5);
  });

  test('quantity and note edits are ignored while the line is checked', () => {
    let state = baseState();
    state = receiveReducer(state, { type: 'adjustShortQty', pastOrderItemId: 'poi-1', delta: 1 });
    state = receiveReducer(state, { type: 'setNote', pastOrderItemId: 'poi-1', note: 'nope' });
    expect(state.lines[0]).toMatchObject({ checked: true, shortQty: null, note: '' });
  });

  test('unknown line ids leave the state untouched', () => {
    const state = baseState();
    expect(receiveReducer(state, { type: 'toggle', pastOrderItemId: 'missing' })).toBe(state);
  });
});

describe('clampShortQty', () => {
  test('bounds and rounds values', () => {
    expect(clampShortQty(-2, 5)).toBe(0);
    expect(clampShortQty(7, 5)).toBe(5);
    expect(clampShortQty(2.5000000000000004, 5)).toBe(2.5);
    expect(clampShortQty(Number.NaN, 5)).toBe(0);
    expect(clampShortQty(3, Number.NaN)).toBe(0);
  });
});

describe('buildSaveLines + status derivation', () => {
  function threeLineState(): ReceiveState {
    return initReceiveState(
      makeReceipt([
        makeReceiptLine(),
        makeReceiptLine({ id: 'line-2', pastOrderItemId: 'poi-2', itemName: 'Nori', orderedQty: 3 }),
        makeReceiptLine({ id: 'line-3', pastOrderItemId: 'poi-3', itemName: 'Rice', orderedQty: 2 }),
      ]),
    );
  }

  test('all-checked state saves full arrivals and derives complete', () => {
    const state = threeLineState();
    expect(buildSaveLines(state)).toEqual([
      { pastOrderItemId: 'poi-1', received: true, receivedQty: null, note: null },
      { pastOrderItemId: 'poi-2', received: true, receivedQty: null, note: null },
      { pastOrderItemId: 'poi-3', received: true, receivedQty: null, note: null },
    ]);
    expect(countFlaggedLines(state)).toBe(0);
    expect(deriveSaveStatus(state)).toBe('complete');
  });

  test('missing and short lines save as discrepancies and derive partial', () => {
    let state = threeLineState();
    // poi-1 missing entirely.
    state = receiveReducer(state, { type: 'toggle', pastOrderItemId: 'poi-1' });
    state = receiveReducer(state, { type: 'setNote', pastOrderItemId: 'poi-1', note: '  never showed  ' });
    // poi-2 arrived short (2 of 3).
    state = receiveReducer(state, { type: 'toggle', pastOrderItemId: 'poi-2' });
    state = receiveReducer(state, { type: 'adjustShortQty', pastOrderItemId: 'poi-2', delta: 2 });

    expect(buildSaveLines(state)).toEqual([
      { pastOrderItemId: 'poi-1', received: false, receivedQty: null, note: 'never showed' },
      { pastOrderItemId: 'poi-2', received: true, receivedQty: 2, note: null },
      { pastOrderItemId: 'poi-3', received: true, receivedQty: null, note: null },
    ]);
    expect(countFlaggedLines(state)).toBe(2);
    expect(deriveSaveStatus(state)).toBe('partial');
  });

  test('stepping a short quantity back up to ordered restores a full arrival', () => {
    let state = threeLineState();
    state = receiveReducer(state, { type: 'toggle', pastOrderItemId: 'poi-3' });
    state = receiveReducer(state, { type: 'adjustShortQty', pastOrderItemId: 'poi-3', delta: 1 });
    state = receiveReducer(state, { type: 'adjustShortQty', pastOrderItemId: 'poi-3', delta: 1 });

    expect(isLineFlagged(state.lines[2])).toBe(false);
    expect(buildSaveLines(state)[2]).toEqual({
      pastOrderItemId: 'poi-3',
      received: true,
      receivedQty: null,
      note: null,
    });
    expect(deriveSaveStatus(state)).toBe('complete');
  });
});

describe('describeDiscrepancyLine', () => {
  test('labels missing and short lines for the manager section', () => {
    expect(
      describeDiscrepancyLine({ received: false, receivedQty: null, orderedQty: 4, unit: 'lb' }),
    ).toBe('Missing');
    expect(
      describeDiscrepancyLine({ received: true, receivedQty: 2, orderedQty: 5, unit: 'lb' }),
    ).toBe('Short: 2 of 5 lb');
    expect(
      describeDiscrepancyLine({ received: true, receivedQty: 1.5, orderedQty: 3, unit: '' }),
    ).toBe('Short: 1.5 of 3');
  });
});
