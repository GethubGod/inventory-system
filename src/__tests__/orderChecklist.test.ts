const mockAuthGetUser = jest.fn();
const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockSubmitOrder = jest.fn();
const mockGenerateUUID = jest.fn();

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

import {
  getOrGenerateMyChecklist,
  regenerateMyChecklist,
  sendChecklistOrder,
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
});
