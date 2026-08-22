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
  getOrGenerateMyChecklist,
  regenerateMyChecklist,
  sendChecklistOrder,
  prepareDirectSend,
  archiveDirectSend,
} from '../services/orderChecklist';

type QueryResult = { data: unknown; error: unknown };

function query(result: QueryResult, terminal: 'maybeSingle' | 'single' | 'in' = 'maybeSingle') {
  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
  };
  builder[terminal] = jest.fn(async () => result);
  return builder;
}

function archivePastOrderQuery(result: QueryResult) {
  const builder: any = {
    insert: jest.fn(),
    select: jest.fn(),
    single: jest.fn(),
  };
  builder.insert.mockReturnValue(builder);
  builder.select.mockReturnValue(builder);
  builder.single.mockResolvedValue(result);
  return builder;
}

function archiveItemsQuery(result: QueryResult) {
  return {
    insert: jest.fn().mockResolvedValue(result),
  };
}

function checklistRow() {
  return {
    id: 'checklist-1',
    location_group: 'sushi',
    generated_at: '2026-08-12T12:00:00.000Z',
    order_checklist_items: [
      {
        id: 'rare-item',
        item_id: 'inventory-rare',
        item_name: 'Rare Item',
        unit: 'each',
        default_checked: false,
        recommended_qty: '1.5',
        staleness_bucket: 'rare',
        last_ordered_at: null,
        sort_order: 2,
      },
      {
        id: 'frequent-item',
        item_id: 'inventory-frequent',
        item_name: 'Frequent Item',
        unit: 'case',
        default_checked: true,
        recommended_qty: '4',
        staleness_bucket: 'frequent',
        last_ordered_at: '2026-08-11T10:00:00.000Z',
        sort_order: 0,
      },
    ],
  };
}

describe('orderChecklist service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mockLoadSupplierLookup.mockResolvedValue({
      suppliers: [],
      supplierById: new Map(),
      supplierByNameNormalized: new Map(),
    });
    mockListSupplierContacts.mockResolvedValue([]);
  });

  test('returns an existing checklist without generating it', async () => {
    mockFrom.mockReturnValue(query({ data: checklistRow(), error: null }));

    const checklist = await getOrGenerateMyChecklist('sushi');

    expect(mockRpc).not.toHaveBeenCalled();
    expect(checklist).toEqual({
      id: 'checklist-1',
      locationGroup: 'sushi',
      generatedAt: '2026-08-12T12:00:00.000Z',
      items: [
        expect.objectContaining({
          id: 'frequent-item',
          recommendedQty: 4,
          sortOrder: 0,
          stalenessBucket: 'frequent',
        }),
        expect.objectContaining({
          id: 'rare-item',
          recommendedQty: 1.5,
          sortOrder: 2,
          stalenessBucket: 'rare',
        }),
      ],
    });
  });

  test('generates only when the requested checklist does not exist', async () => {
    mockFrom
      .mockReturnValueOnce(query({ data: null, error: null }))
      .mockReturnValueOnce(query({ data: checklistRow(), error: null }));
    mockRpc.mockResolvedValue({ data: 'checklist-1', error: null });

    const checklist = await getOrGenerateMyChecklist('sushi');

    expect(mockRpc).toHaveBeenCalledWith('generate_order_checklist', {
      p_user_id: 'user-1',
      p_location_group: 'sushi',
    });
    expect(checklist.id).toBe('checklist-1');
  });

  test('always regenerates before returning the refreshed checklist', async () => {
    mockFrom.mockReturnValue(query({ data: checklistRow(), error: null }));
    mockRpc.mockResolvedValue({ data: 'checklist-1', error: null });

    await regenerateMyChecklist('sushi');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('generate_order_checklist', {
      p_user_id: 'user-1',
      p_location_group: 'sushi',
    });
  });

  test('submits selected matched lines through submit_order_rpc with the checklist tag', async () => {
    const checklistQuery = query({ data: { id: 'checklist-1' }, error: null }, 'single');
    const userQuery = query({ data: { default_location_id: 'location-1' }, error: null }, 'single');
    const inventoryQuery = query({
      data: [
        { id: 'inventory-frequent', base_unit: 'each', pack_unit: 'case' },
        { id: 'inventory-base', base_unit: 'lb', pack_unit: 'case' },
      ],
      error: null,
    }, 'in');
    mockFrom
      .mockReturnValueOnce(checklistQuery)
      .mockReturnValueOnce(userQuery)
      .mockReturnValueOnce(inventoryQuery);
    mockGenerateUUID.mockReturnValue('order-1');
    mockSubmitOrder.mockResolvedValue({ order: { id: 'saved-order-1' }, wasExisting: false });

    await expect(
      sendChecklistOrder('checklist-1', [
        { itemId: 'inventory-frequent', itemName: 'Frequent Item', unit: 'case', quantity: 4 },
        { itemId: 'inventory-base', itemName: 'Base Item', unit: 'lb', quantity: 2 },
      ]),
    ).resolves.toEqual({ orderId: 'saved-order-1' });

    expect(mockSubmitOrder).toHaveBeenCalledWith({
      orderId: 'order-1',
      locationId: 'location-1',
      userId: 'user-1',
      status: 'submitted',
      entryMethod: 'simple_checklist',
      quickSessionId: null,
      items: [
        {
          inventory_item_id: 'inventory-frequent',
          quantity: 4,
          unit_type: 'pack',
          input_mode: 'quantity',
          quantity_requested: 4,
          remaining_reported: null,
          decided_quantity: null,
          decided_by: null,
          decided_at: null,
          note: null,
        },
        {
          inventory_item_id: 'inventory-base',
          quantity: 2,
          unit_type: 'base',
          input_mode: 'quantity',
          quantity_requested: 2,
          remaining_reported: null,
          decided_quantity: null,
          decided_by: null,
          decided_at: null,
          note: null,
        },
      ],
    });
  });

  test('rejects unresolved historical lines before attempting submission', async () => {
    await expect(
      sendChecklistOrder('checklist-1', [
        { itemId: null, itemName: 'Unmatched History Item', unit: 'case', quantity: 1 },
      ]),
    ).rejects.toThrow('not matched to inventory');

    expect(mockSubmitOrder).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test('groups direct sends by fulfillment supplier resolution and builds the Phase 1 message text', async () => {
    const inventoryQuery = query({
      data: [
        { id: 'salmon', name: 'Salmon', supplier_id: 'fish-1', base_unit: 'lbs', pack_unit: 'case' },
        { id: 'nori', name: 'Nori', supplier_id: 'dry-1', base_unit: 'pack', pack_unit: null },
      ],
      error: null,
    }, 'in');
    mockFrom.mockReturnValue(inventoryQuery);
    mockListSupplierContacts.mockResolvedValue([
      {
        supplierId: 'fish-1',
        supplierName: 'Bluefin Fish',
        contactPhone: '+15550100',
        contactChannel: 'sms',
        contactName: null,
        contactNotes: null,
      },
    ]);
    mockResolveOrderItemSupplier.mockImplementation(({ inventoryItem }) => (
      inventoryItem.id === 'salmon'
        ? { primarySupplierId: 'fish-1', primarySupplierName: 'Bluefin Fish' }
        : { primarySupplierId: 'dry-1', primarySupplierName: 'Dry Goods' }
    ));

    const groups = await prepareDirectSend([
      { itemId: 'salmon', itemName: 'Salmon', unit: 'lb', quantity: 2 },
      { itemId: 'nori', itemName: 'Nori', unit: 'pack', quantity: 4 },
    ], 'poki');

    expect(mockResolveOrderItemSupplier).toHaveBeenCalledTimes(2);
    expect(groups).toEqual([
      expect.objectContaining({
        supplierId: 'fish-1',
        supplierName: 'Bluefin Fish',
        contact: expect.objectContaining({ supplierId: 'fish-1', contactChannel: 'sms' }),
        lines: [{ itemId: 'salmon', itemName: 'Salmon', unit: 'lb', quantity: 2 }],
        messageText: '- Salmon: 2 lbs\n\nThank you!',
        locationGroup: 'poki',
      }),
      expect.objectContaining({
        supplierId: 'dry-1',
        supplierName: 'Dry Goods',
        contact: null,
        lines: [{ itemId: 'nori', itemName: 'Nori', unit: 'pack', quantity: 4 }],
        messageText: '- Nori: 4 pack\n\nThank you!',
        locationGroup: 'poki',
      }),
    ]);
  });

  test('places unresolved inventory and supplier mappings in one Unassigned share-sheet group', async () => {
    const inventoryQuery = query({
      data: [
        { id: 'unknown-supplier', supplier_id: null, base_unit: 'each', pack_unit: null },
      ],
      error: null,
    }, 'in');
    mockFrom.mockReturnValue(inventoryQuery);
    mockResolveOrderItemSupplier.mockReturnValue({
      primarySupplierId: null,
      primarySupplierName: null,
    });

    const groups = await prepareDirectSend([
      { itemId: 'unknown-supplier', itemName: 'Mystery Item', unit: 'each', quantity: 1 },
      { itemId: null, itemName: 'Historical Item', unit: 'box', quantity: 3 },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        supplierId: null,
        supplierName: 'Unassigned',
        contact: null,
        lines: [
          { itemId: 'unknown-supplier', itemName: 'Mystery Item', unit: 'each', quantity: 1 },
          { itemId: null, itemName: 'Historical Item', unit: 'box', quantity: 3 },
        ],
        messageText:
          '- Historical Item: 3 box\n- Mystery Item: 1 each\n\nThank you!',
      }),
    ]);
  });

  test('archives a direct-send card as the employee without creating a review order', async () => {
    const inventoryQuery = query({
      data: [{ id: 'salmon', base_unit: 'lb', pack_unit: 'case' }],
      error: null,
    }, 'in');
    const pastOrderQuery = archivePastOrderQuery({
      data: { id: 'past-1', created_at: '2026-08-12T14:00:00.000Z' },
      error: null,
    });
    const pastItemsQuery = archiveItemsQuery({ data: null, error: null });
    mockFrom
      .mockReturnValueOnce(inventoryQuery)
      .mockReturnValueOnce(pastOrderQuery)
      .mockReturnValueOnce(pastItemsQuery);

    await archiveDirectSend({
      supplierId: 'fish-1',
      supplierName: 'Bluefin Fish',
      contact: null,
      lines: [{ itemId: 'salmon', itemName: 'Salmon', unit: 'case', quantity: 2 }],
      messageText: '- Salmon: 2 case\n\nThank you!',
      locationGroup: 'sushi',
    }, 'share');

    expect(mockFrom).toHaveBeenNthCalledWith(1, 'inventory_items');
    expect(mockFrom).toHaveBeenNthCalledWith(2, 'past_orders');
    expect(mockFrom).toHaveBeenNthCalledWith(3, 'past_order_items');
    expect(pastOrderQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      supplier_id: 'fish-1',
      supplier_name: 'Bluefin Fish',
      created_by: 'user-1',
      share_method: 'share',
      message_text: '- Salmon: 2 case\n\nThank you!',
      payload: expect.objectContaining({
        entryMethod: 'simple_checklist_direct',
        totalItemCount: 1,
      }),
    }));
    expect(pastItemsQuery.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        past_order_id: 'past-1',
        supplier_id: 'fish-1',
        created_by: 'user-1',
        item_id: 'salmon',
        unit_type: 'pack',
        ordered_at: '2026-08-12T14:00:00.000Z',
        // F4 regression: generate_order_checklist filters history on
        // location_group, so archived direct sends must carry the group.
        location_group: 'sushi',
      }),
    ]);
    expect(mockSubmitOrder).not.toHaveBeenCalled();
  });

  test('archives direct sends from legacy groups without a location group as null', async () => {
    const inventoryQuery = query({
      data: [{ id: 'salmon', base_unit: 'lb', pack_unit: 'case' }],
      error: null,
    }, 'in');
    const pastOrderQuery = archivePastOrderQuery({
      data: { id: 'past-2', created_at: '2026-08-12T14:00:00.000Z' },
      error: null,
    });
    const pastItemsQuery = archiveItemsQuery({ data: null, error: null });
    mockFrom
      .mockReturnValueOnce(inventoryQuery)
      .mockReturnValueOnce(pastOrderQuery)
      .mockReturnValueOnce(pastItemsQuery);

    await archiveDirectSend({
      supplierId: 'fish-1',
      supplierName: 'Bluefin Fish',
      contact: null,
      lines: [{ itemId: 'salmon', itemName: 'Salmon', unit: 'case', quantity: 2 }],
      messageText: '- Salmon: 2 case\n\nThank you!',
    }, 'copy');

    expect(pastItemsQuery.insert).toHaveBeenCalledWith([
      expect.objectContaining({ location_group: null }),
    ]);
  });
});
