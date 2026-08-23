const mockAuthGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: mockAuthGetUser },
    from: mockFrom,
    rpc: mockRpc,
  },
}));

import {
  createHolidayTemplate,
  createHolidayTemplateItem,
  getMyChecklistHolidayOverlay,
  listHolidayTemplates,
  updateHolidayTemplateItem,
} from '../services/holidayTemplates';

type QueryResult = { data: unknown; error: unknown };

function singleQuery(result: QueryResult) {
  const query: any = {
    insert: jest.fn(),
    update: jest.fn(),
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn(),
  };
  query.insert.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.single.mockResolvedValue(result);
  return query;
}

function listQuery(result: QueryResult) {
  const query: any = { select: jest.fn(), order: jest.fn(), data: result.data, error: result.error };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    name: 'New Year',
    starts_on: '2026-12-30',
    ends_on: '2027-01-02',
    active: true,
    created_by: 'manager-1',
    created_at: '2026-11-01T12:00:00.000Z',
    updated_at: '2026-11-01T12:00:00.000Z',
    holiday_template_items: [{
      template_id: 'template-1',
      item_id: 'item-tuna',
      adjustment_kind: 'scale',
      quantity: '1.5',
      note: 'Busy dinner service',
      inventory_item: {
        id: 'item-tuna', name: 'Tuna', base_unit: 'lb', pack_unit: 'case', default_order_unit: 'case',
      },
    }],
    ...overrides,
  };
}

describe('holidayTemplates service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'employee-1' } }, error: null });
  });

  test('creates an active dated template and maps its inventory-backed items', async () => {
    const query = singleQuery({ data: templateRow(), error: null });
    mockFrom.mockReturnValue(query);

    await expect(createHolidayTemplate({
      name: '  New Year  ',
      startsOn: '2026-12-30',
      endsOn: '2027-01-02',
    })).resolves.toEqual(expect.objectContaining({
      id: 'template-1',
      name: 'New Year',
      startsOn: '2026-12-30',
      items: [expect.objectContaining({
        itemId: 'item-tuna',
        adjustmentKind: 'scale',
        quantity: 1.5,
        inventoryItem: expect.objectContaining({ name: 'Tuna', defaultOrderUnit: 'case' }),
      })],
    }));

    expect(mockFrom).toHaveBeenCalledWith('holiday_templates');
    expect(query.insert).toHaveBeenCalledWith({
      name: 'New Year', starts_on: '2026-12-30', ends_on: '2027-01-02', active: true,
    });
  });

  test('lists templates in date order and keeps inactive rows available to authenticated readers', async () => {
    const query = listQuery({
      data: [templateRow(), templateRow({ id: 'template-2', active: false, name: 'Closed holiday' })],
      error: null,
    });
    mockFrom.mockReturnValue(query);

    await expect(listHolidayTemplates()).resolves.toEqual([
      expect.objectContaining({ id: 'template-1', active: true }),
      expect.objectContaining({ id: 'template-2', active: false }),
    ]);
    expect(query.order).toHaveBeenNthCalledWith(1, 'starts_on', { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, 'name', { ascending: true });
  });

  test('creates and updates inventory-referenced adjustments', async () => {
    const createQuery = singleQuery({
      data: templateRow().holiday_template_items[0],
      error: null,
    });
    const updateQuery = singleQuery({
      data: {
        ...templateRow().holiday_template_items[0], adjustment_kind: 'set_qty', quantity: '12', note: null,
      },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(createQuery)
      .mockReturnValueOnce(updateQuery);

    await expect(createHolidayTemplateItem('template-1', {
      itemId: 'item-tuna', adjustmentKind: 'scale', quantity: 1.5, note: 'Busy dinner service',
    })).resolves.toEqual(expect.objectContaining({ itemId: 'item-tuna', quantity: 1.5 }));
    expect(createQuery.insert).toHaveBeenCalledWith({
      template_id: 'template-1', item_id: 'item-tuna', adjustment_kind: 'scale', quantity: 1.5, note: 'Busy dinner service',
    });

    await expect(updateHolidayTemplateItem('template-1', 'item-tuna', {
      adjustmentKind: 'set_qty', quantity: 12, note: null,
    })).resolves.toEqual(expect.objectContaining({ adjustmentKind: 'set_qty', quantity: 12, note: null }));
    expect(updateQuery.update).toHaveBeenCalledWith({ adjustment_kind: 'set_qty', quantity: 12, note: null });
    expect(updateQuery.eq).toHaveBeenNthCalledWith(1, 'template_id', 'template-1');
    expect(updateQuery.eq).toHaveBeenNthCalledWith(2, 'item_id', 'item-tuna');
  });

  test('returns the active banner plus only the non-persisted checklist overlay rows', async () => {
    const templateQuery = singleQuery({ data: { id: 'template-1', name: 'New Year' }, error: null });
    mockFrom.mockReturnValue(templateQuery);
    mockRpc
      .mockResolvedValueOnce({ data: 'template-1', error: null })
      .mockResolvedValueOnce({
        data: [
          {
            item_id: 'item-tuna', item_name: 'Tuna', unit: 'case', adjustment_kind: 'scale', quantity: '1.5',
            template_name: 'New Year',
          },
          {
            item_id: 'item-nori', item_name: 'Nori', unit: 'pack', adjustment_kind: 'add', quantity: '4',
            template_name: 'New Year',
          },
        ],
        error: null,
      });

    await expect(getMyChecklistHolidayOverlay('sushi')).resolves.toEqual({
      templateId: 'template-1',
      templateName: 'New Year',
      adjustments: [
        { itemId: 'item-tuna', itemName: 'Tuna', unit: 'case', adjustmentKind: 'scale', quantity: 1.5 },
        { itemId: 'item-nori', itemName: 'Nori', unit: 'pack', adjustmentKind: 'add', quantity: 4 },
      ],
    });
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'active_holiday_for', { p_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'get_checklist_holiday_overlay', expect.objectContaining({
      p_user_id: 'employee-1', p_location_group: 'sushi',
    }));
  });

  test('does not ask for overlay rows when no holiday window is active', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await expect(getMyChecklistHolidayOverlay('poki')).resolves.toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid template windows before a database write', async () => {
    await expect(createHolidayTemplate({
      name: 'Bad dates', startsOn: '2026-12-31', endsOn: '2026-12-30',
    })).rejects.toThrow('endsOn cannot be before startsOn');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
