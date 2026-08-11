const mockSupabase = {
  from: jest.fn(),
};

/* eslint-disable import/first -- Dependencies must be mocked before importing the service. */
jest.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
}));

import { findStaleConsumedOrderItemIds } from '../services/orderItemFreshness';

type QueryResult = { data: unknown; error: unknown };

function createSelectInQuery(result: QueryResult) {
  const query = {
    select: jest.fn(),
    in: jest.fn(),
  };
  query.select.mockReturnValue(query);
  query.in.mockResolvedValue(result);
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findStaleConsumedOrderItemIds', () => {
  test('returns ids that are no longer pending', async () => {
    const query = createSelectInQuery({
      data: [
        { id: 'oi-1', status: 'pending' },
        { id: 'oi-2', status: 'sent' },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(query);

    await expect(findStaleConsumedOrderItemIds(['oi-1', 'oi-2'])).resolves.toEqual(['oi-2']);
    expect(mockSupabase.from).toHaveBeenCalledWith('order_items');
    expect(query.select).toHaveBeenCalledWith('id,status');
    expect(query.in).toHaveBeenCalledWith('id', ['oi-1', 'oi-2']);
  });

  test('ids missing from the result count as stale', async () => {
    const query = createSelectInQuery({
      data: [{ id: 'oi-1', status: 'pending' }],
      error: null,
    });
    mockSupabase.from.mockReturnValue(query);

    await expect(findStaleConsumedOrderItemIds(['oi-1', 'oi-gone'])).resolves.toEqual(['oi-gone']);
  });

  test('returns empty when everything is still pending', async () => {
    const query = createSelectInQuery({
      data: [
        { id: 'oi-1', status: 'pending' },
        { id: 'oi-2', status: 'pending' },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(query);

    await expect(findStaleConsumedOrderItemIds(['oi-1', 'oi-2', 'oi-1'])).resolves.toEqual([]);
    // Duplicate ids are normalized away before querying.
    expect(query.in).toHaveBeenCalledWith('id', ['oi-1', 'oi-2']);
  });

  test('blank and empty inputs short-circuit without querying', async () => {
    await expect(findStaleConsumedOrderItemIds([])).resolves.toEqual([]);
    await expect(findStaleConsumedOrderItemIds(['', '   '])).resolves.toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  test('throws when the freshness query fails so callers can degrade to best-effort', async () => {
    const failure = new Error('network down');
    const query = createSelectInQuery({ data: null, error: failure });
    mockSupabase.from.mockReturnValue(query);

    await expect(findStaleConsumedOrderItemIds(['oi-1'])).rejects.toBe(failure);
  });
});
