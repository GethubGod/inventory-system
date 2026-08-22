const mockAuthGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: mockAuthGetUser },
    from: mockFrom,
  },
}));

import {
  countItemsInPayload,
  formatRecentOrderDate,
  listMyRecentOrders,
  mapRecentOrderRow,
} from '../features/simpleOrder/recentOrders';

describe('countItemsInPayload', () => {
  it('prefers totalItemCount', () => {
    expect(countItemsInPayload({ totalItemCount: 7, regularItems: [1] })).toBe(7);
  });

  it('falls back to item array lengths', () => {
    expect(
      countItemsInPayload({ regularItems: [1, 2], remainingItems: [3] }),
    ).toBe(3);
    expect(countItemsInPayload({ regularItems: [] })).toBe(0);
  });

  it('reports null for unknown shapes', () => {
    expect(countItemsInPayload(null)).toBeNull();
    expect(countItemsInPayload('text')).toBeNull();
    expect(countItemsInPayload({ totalItemCount: 'x' })).toBeNull();
  });
});

describe('mapRecentOrderRow', () => {
  it('maps a past_orders row', () => {
    expect(
      mapRecentOrderRow({
        id: 'po-1',
        supplier_name: ' True World ',
        created_at: '2026-08-10T12:00:00Z',
        message_text: 'Order text',
        payload: { totalItemCount: 4 },
      }),
    ).toEqual({
      id: 'po-1',
      supplierName: 'True World',
      createdAt: '2026-08-10T12:00:00Z',
      itemCount: 4,
      messageText: 'Order text',
    });
  });

  it('defaults blank fields safely', () => {
    const mapped = mapRecentOrderRow({
      id: 'po-2',
      supplier_name: null,
      created_at: null,
      message_text: null,
      payload: null,
    });
    expect(mapped).toEqual({
      id: 'po-2',
      supplierName: 'Supplier',
      createdAt: '',
      itemCount: null,
      messageText: '',
    });
  });
});

describe('formatRecentOrderDate', () => {
  const now = new Date('2026-08-11T15:00:00');

  it('labels today and yesterday', () => {
    expect(formatRecentOrderDate('2026-08-11T09:00:00', now)).toBe('Today');
    expect(formatRecentOrderDate('2026-08-10T23:00:00', now)).toBe('Yesterday');
  });

  it('uses month/day within the current year', () => {
    expect(formatRecentOrderDate('2026-08-03T09:00:00', now)).toBe('Aug 3');
  });

  it('appends the year for older orders', () => {
    expect(formatRecentOrderDate('2025-12-30T09:00:00', now)).toBe('Dec 30, 2025');
  });

  it('returns empty for invalid input', () => {
    expect(formatRecentOrderDate('', now)).toBe('');
    expect(formatRecentOrderDate('not-a-date', now)).toBe('');
  });
});

describe('listMyRecentOrders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockQuery(result: { data: unknown; error: unknown }) {
    const builder: any = {
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      order: jest.fn(() => builder),
      limit: jest.fn(async () => result),
    };
    mockFrom.mockReturnValue(builder);
    return builder;
  }

  it('queries only the signed-in user and maps rows', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    const builder = mockQuery({
      data: [
        {
          id: 'po-1',
          supplier_name: 'True World',
          created_at: '2026-08-10T12:00:00Z',
          message_text: 'Order text',
          payload: { totalItemCount: 2 },
        },
      ],
      error: null,
    });

    const orders = await listMyRecentOrders(5);

    expect(mockFrom).toHaveBeenCalledWith('past_orders');
    expect(builder.eq).toHaveBeenCalledWith('created_by', 'user-1');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(5);
    expect(orders).toEqual([
      {
        id: 'po-1',
        supplierName: 'True World',
        createdAt: '2026-08-10T12:00:00Z',
        itemCount: 2,
        messageText: 'Order text',
      },
    ]);
  });

  it('rejects when signed out', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(listMyRecentOrders()).rejects.toThrow(
      'You must be signed in to view recent orders.',
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('propagates query errors', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockQuery({ data: null, error: new Error('boom') });
    await expect(listMyRecentOrders()).rejects.toThrow('boom');
  });
});
