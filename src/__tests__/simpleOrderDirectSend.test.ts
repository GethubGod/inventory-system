import type { DirectSendGroup } from '@/services/orderChecklist';
import type { SupplierContact } from '@/services/supplierContacts';
import {
  buildDirectSendLines,
  channelForGroup,
  directSendGroupKey,
  orderGroupsForQueue,
  UNASSIGNED_GROUP_KEY,
} from '@/features/simpleOrder/directSendFlow';
import type { SelectionLine, SelectionState } from '@/features/simpleOrder/checklistSelection';
import {
  createSendAllQueue,
  getSendAllQueueProgress,
  sendAllQueueReducer,
} from '@/features/fulfillment/sendAll/sendAllQueue';

function makeContact(overrides: Partial<SupplierContact> = {}): SupplierContact {
  return {
    supplierId: 'sup-1',
    supplierName: 'True World',
    contactPhone: '+15551234567',
    contactChannel: 'sms',
    contactName: 'Sam',
    contactNotes: null,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<DirectSendGroup> = {}): DirectSendGroup {
  return {
    supplierId: 'sup-1',
    supplierName: 'True World',
    contact: makeContact(),
    lines: [{ itemId: 'inv-1', itemName: 'Salmon', unit: 'lb', quantity: 3 }],
    messageText: 'True World order',
    ...overrides,
  };
}

function makeLine(overrides: Partial<SelectionLine> = {}): SelectionLine {
  return {
    key: 'line-1',
    source: 'checklist',
    itemId: 'inv-1',
    itemName: 'Salmon',
    unit: 'lb',
    checked: true,
    quantity: 3,
    recommendedQty: 3,
    bucket: 'frequent',
    lastOrderedAt: null,
    ...overrides,
  };
}

function makeState(lines: SelectionLine[]): SelectionState {
  return { checklistId: 'chk-1', lines };
}

describe('directSendGroupKey', () => {
  it('uses the supplier id when present', () => {
    expect(directSendGroupKey(makeGroup())).toBe('sup-1');
  });

  it('uses the stable unassigned bucket for contactless groups', () => {
    expect(directSendGroupKey(makeGroup({ supplierId: null }))).toBe(
      UNASSIGNED_GROUP_KEY,
    );
  });
});

describe('channelForGroup', () => {
  it('uses the configured channel when a phone exists', () => {
    expect(channelForGroup(makeGroup())).toBe('sms');
    expect(
      channelForGroup(
        makeGroup({ contact: makeContact({ contactChannel: 'whatsapp' }) }),
      ),
    ).toBe('whatsapp');
  });

  it('falls back to the share sheet without a phone', () => {
    expect(
      channelForGroup(makeGroup({ contact: makeContact({ contactPhone: null }) })),
    ).toBe('share_sheet');
  });

  it('falls back to the share sheet without a contact (Unassigned card)', () => {
    expect(channelForGroup(makeGroup({ contact: null }))).toBe('share_sheet');
  });

  it('treats an explicit share_sheet channel as share sheet even with a phone', () => {
    expect(
      channelForGroup(
        makeGroup({ contact: makeContact({ contactChannel: 'share_sheet' }) }),
      ),
    ).toBe('share_sheet');
  });
});

describe('buildDirectSendLines', () => {
  it('includes checked unmatched lines, unlike review-mode buildSendLines', () => {
    const { lines } = buildDirectSendLines(
      makeState([
        makeLine(),
        makeLine({ key: 'line-2', itemId: null, itemName: 'Special sauce' }),
        makeLine({ key: 'line-3', checked: false, itemName: 'Unchecked' }),
      ]),
    );

    expect(lines).toEqual([
      { itemId: 'inv-1', itemName: 'Salmon', unit: 'lb', quantity: 3 },
      { itemId: null, itemName: 'Special sauce', unit: 'lb', quantity: 3 },
    ]);
  });

  it('drops lines with invalid quantities', () => {
    const { lines } = buildDirectSendLines(
      makeState([
        makeLine({ quantity: 0 }),
        makeLine({ key: 'line-2', quantity: Number.NaN }),
      ]),
    );
    expect(lines).toEqual([]);
  });
});

describe('orderGroupsForQueue', () => {
  it('sorts suppliers alphabetically with Unassigned last', () => {
    const ordered = orderGroupsForQueue([
      makeGroup({ supplierId: null, supplierName: 'Unassigned', contact: null }),
      makeGroup({ supplierId: 'sup-2', supplierName: 'Zeta Foods' }),
      makeGroup({ supplierId: 'sup-3', supplierName: 'Alpha Produce' }),
    ]);

    expect(ordered.map((group) => group.supplierName)).toEqual([
      'Alpha Produce',
      'Zeta Foods',
      'Unassigned',
    ]);
  });
});

describe('direct send over the Phase 1 queue reducer', () => {
  it('advances through send, skip, and completion like Send All', () => {
    const groups = orderGroupsForQueue([
      makeGroup({ supplierId: 'sup-a', supplierName: 'Alpha' }),
      makeGroup({ supplierId: 'sup-b', supplierName: 'Beta' }),
      makeGroup({ supplierId: null, supplierName: 'Unassigned', contact: null }),
    ]);
    let queue = createSendAllQueue(groups.map(directSendGroupKey));

    expect(queue.activeId).toBe('sup-a');

    queue = sendAllQueueReducer(queue, { type: 'send-completed', id: 'sup-a' });
    expect(queue.activeId).toBe('sup-b');

    queue = sendAllQueueReducer(queue, { type: 'skip', id: 'sup-b' });
    expect(queue.activeId).toBe(UNASSIGNED_GROUP_KEY);

    queue = sendAllQueueReducer(queue, {
      type: 'send-completed',
      id: UNASSIGNED_GROUP_KEY,
    });

    const progress = getSendAllQueueProgress(queue);
    expect(progress).toMatchObject({
      total: 3,
      sent: 2,
      skipped: 1,
      pending: 0,
      isComplete: true,
    });
  });
});
