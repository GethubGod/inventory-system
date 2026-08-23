/**
 * Employee-app phase: note + unit-override + save-as-default service logic
 * (src/services/orderChecklist.ts additions).
 */

const mockAuthGetUser = jest.fn();
const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockSubmitOrder = jest.fn();
const mockGenerateUUID = jest.fn();
const mockLoadSupplierLookup = jest.fn();
const mockResolveOrderItemSupplier = jest.fn();
const mockListSupplierContacts = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: mockAuthGetUser },
    rpc: mockRpc,
    from: mockFrom,
  },
}));

jest.mock('../services/orderSubmission', () => ({
  generateUUID: mockGenerateUUID,
  submitOrder: mockSubmitOrder,
}));

jest.mock('../services/supplierResolver', () => ({
  loadSupplierLookup: mockLoadSupplierLookup,
  resolveOrderItemSupplier: mockResolveOrderItemSupplier,
}));

jest.mock('../services/supplierContacts', () => ({
  listSupplierContacts: mockListSupplierContacts,
}));

import {
  appendNoteToMessage,
  buildLineUnitMeta,
  normalizeOrderNote,
  prepareDirectSend,
  saveChecklistAsDefault,
  sendChecklistOrder,
} from '../services/orderChecklist';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeOrderNote', () => {
  it('trims and nullifies empty notes', () => {
    expect(normalizeOrderNote('  hold the rice  ')).toBe('hold the rice');
    expect(normalizeOrderNote('   ')).toBeNull();
    expect(normalizeOrderNote(undefined)).toBeNull();
    expect(normalizeOrderNote(null)).toBeNull();
  });
});

describe('appendNoteToMessage', () => {
  it('appends a Note block to the message body', () => {
    expect(appendNoteToMessage('Order:\n- 2 case shrimp\n', 'freezer is full')).toBe(
      'Order:\n- 2 case shrimp\n\nNote: freezer is full',
    );
  });

  it('leaves the message unchanged without a note', () => {
    expect(appendNoteToMessage('Order body', null)).toBe('Order body');
    expect(appendNoteToMessage('Order body', '   ')).toBe('Order body');
  });
});

describe('buildLineUnitMeta', () => {
  const inventoryItem = { id: 'item-1', base_unit: 'fillet', pack_unit: 'case' };

  it('needs nothing when the unit matches base or pack', () => {
    expect(
      buildLineUnitMeta(
        { itemId: 'item-1', itemName: 'Salmon', unit: 'fillet', quantity: 2 },
        inventoryItem,
      ),
    ).toEqual({ itemNote: null, override: null });
    expect(
      buildLineUnitMeta(
        { itemId: 'item-1', itemName: 'Salmon', unit: 'Case', quantity: 1 },
        inventoryItem,
      ),
    ).toEqual({ itemNote: null, override: null });
  });

  it('produces an override + item note for a foreign unit', () => {
    expect(
      buildLineUnitMeta(
        { itemId: 'item-1', itemName: 'Salmon', unit: 'lb', quantity: 20 },
        inventoryItem,
      ),
    ).toEqual({
      itemNote: 'Ordered as 20 lb',
      override: { inventory_item_id: 'item-1', unit_label: 'lb' },
    });
  });

  it('formats fractional quantities without float noise', () => {
    const meta = buildLineUnitMeta(
      { itemId: 'item-1', itemName: 'Salmon', unit: 'lb', quantity: 2.5 },
      inventoryItem,
    );
    expect(meta.itemNote).toBe('Ordered as 2.5 lb');
  });

  it('is inert for unmatched lines or missing inventory', () => {
    expect(
      buildLineUnitMeta({ itemId: null, itemName: 'X', unit: 'lb', quantity: 1 }, inventoryItem),
    ).toEqual({ itemNote: null, override: null });
    expect(
      buildLineUnitMeta({ itemId: 'item-1', itemName: 'X', unit: 'lb', quantity: 1 }, undefined),
    ).toEqual({ itemNote: null, override: null });
  });
});

describe('saveChecklistAsDefault', () => {
  it('maps lines to the RPC payload and returns the saved count', async () => {
    mockRpc.mockResolvedValue({ data: 2, error: null });

    const count = await saveChecklistAsDefault('sushi', [
      {
        checklistItemId: 'row-1',
        itemId: 'item-1',
        itemName: ' Salmon ',
        unit: ' fillet ',
        quantity: 5,
      },
      { checklistItemId: null, itemId: 'item-2', itemName: 'Nori', unit: 'pack', quantity: 3 },
    ]);

    expect(count).toBe(2);
    expect(mockRpc).toHaveBeenCalledWith('save_my_checklist_default', {
      p_location_group: 'sushi',
      p_items: [
        { id: 'row-1', item_id: 'item-1', item_name: 'Salmon', unit: 'fillet', quantity: 5 },
        { id: null, item_id: 'item-2', item_name: 'Nori', unit: 'pack', quantity: 3 },
      ],
    });
  });

  it('rejects empty selections and invalid lines', async () => {
    await expect(saveChecklistAsDefault('sushi', [])).rejects.toThrow(/at least one/i);
    await expect(
      saveChecklistAsDefault('sushi', [
        { checklistItemId: null, itemId: null, itemName: '', unit: 'pack', quantity: 1 },
      ]),
    ).rejects.toThrow(/missing a name or unit/i);
    await expect(
      saveChecklistAsDefault('sushi', [
        { checklistItemId: null, itemId: null, itemName: 'X', unit: 'pack', quantity: 0 },
      ]),
    ).rejects.toThrow(/invalid quantity/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('surfaces RPC errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('rpc down') });
    await expect(
      saveChecklistAsDefault('poki', [
        { checklistItemId: null, itemId: 'i', itemName: 'X', unit: 'bag', quantity: 1 },
      ]),
    ).rejects.toThrow('rpc down');
  });
});

describe('sendChecklistOrder note + unit override plumbing', () => {
  function setupSendMocks() {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const checklistBuilder: any = {
      select: jest.fn(() => checklistBuilder),
      eq: jest.fn(() => checklistBuilder),
      single: jest.fn(async () => ({ data: { id: 'cl-1' }, error: null })),
    };
    const userBuilder: any = {
      select: jest.fn(() => userBuilder),
      eq: jest.fn(() => userBuilder),
      single: jest.fn(async () => ({
        data: { default_location_id: 'loc-1' },
        error: null,
      })),
    };
    const inventoryBuilder: any = {
      select: jest.fn(() => inventoryBuilder),
      in: jest.fn(async () => ({
        data: [{ id: 'item-1', base_unit: 'fillet', pack_unit: 'case' }],
        error: null,
      })),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'order_checklists') return checklistBuilder;
      if (table === 'users') return userBuilder;
      if (table === 'inventory_items') return inventoryBuilder;
      throw new Error(`Unexpected table ${table}`);
    });

    mockGenerateUUID.mockReturnValue('order-uuid');
    mockSubmitOrder.mockResolvedValue({ order: { id: 'order-1' } });
    mockRpc.mockResolvedValue({ data: null, error: null });
  }

  it('submits the item note and records note + overrides via set_my_order_meta', async () => {
    setupSendMocks();

    await sendChecklistOrder(
      'cl-1',
      [{ itemId: 'item-1', itemName: 'Salmon', unit: 'lb', quantity: 20 }],
      { note: '  ring the back door  ' },
    );

    const submitted = mockSubmitOrder.mock.calls[0][0];
    expect(submitted.items[0].note).toBe('Ordered as 20 lb');
    expect(submitted.items[0].unit_type).toBe('base');

    expect(mockRpc).toHaveBeenCalledWith('set_my_order_meta', {
      p_order_id: 'order-1',
      p_note: 'ring the back door',
      p_unit_overrides: [{ inventory_item_id: 'item-1', unit_label: 'lb' }],
    });
  });

  it('skips the meta RPC when there is no note and no override', async () => {
    setupSendMocks();

    await sendChecklistOrder('cl-1', [
      { itemId: 'item-1', itemName: 'Salmon', unit: 'fillet', quantity: 2 },
    ]);

    expect(mockSubmitOrder.mock.calls[0][0].items[0].note).toBeNull();
    expect(mockRpc).not.toHaveBeenCalledWith(
      'set_my_order_meta',
      expect.anything(),
    );
  });

  it('still resolves when the meta RPC fails after a successful submit', async () => {
    setupSendMocks();
    mockRpc.mockResolvedValue({ data: null, error: new Error('meta down') });

    await expect(
      sendChecklistOrder(
        'cl-1',
        [{ itemId: 'item-1', itemName: 'Salmon', unit: 'fillet', quantity: 2 }],
        { note: 'note that will fail' },
      ),
    ).resolves.toEqual({ orderId: 'order-1' });
  });
});

describe('prepareDirectSend note handling', () => {
  it('appends the note to every supplier message and tags the groups', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'inventory_items') {
        const builder: any = {
          select: jest.fn(() => builder),
          in: jest.fn(async () => ({
            data: [
              { id: 'item-1', base_unit: 'lb', pack_unit: 'case' },
              { id: 'item-2', base_unit: 'bag', pack_unit: 'pallet' },
            ],
            error: null,
          })),
        };
        return builder;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    mockLoadSupplierLookup.mockResolvedValue({
      suppliers: [],
      supplierById: new Map(),
      supplierByNameNormalized: new Map(),
    });
    mockListSupplierContacts.mockResolvedValue([]);
    mockResolveOrderItemSupplier
      .mockReturnValueOnce({ primarySupplierId: 'sup-1', primarySupplierName: 'Ocean Fresh' })
      .mockReturnValueOnce({ primarySupplierId: 'sup-2', primarySupplierName: 'Dry Goods Co' });

    const groups = await prepareDirectSend(
      [
        { itemId: 'item-1', itemName: 'Ahi', unit: 'lb', quantity: 10 },
        { itemId: 'item-2', itemName: 'Rice', unit: 'bag', quantity: 1 },
      ],
      'poki',
      ' walk-in is full ',
    );

    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.orderNote).toBe('walk-in is full');
      expect(group.messageText.endsWith('Note: walk-in is full')).toBe(true);
    }
  });
});
