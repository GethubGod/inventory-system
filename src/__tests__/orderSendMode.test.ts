const mockAuthGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: mockAuthGetUser },
    from: mockFrom,
  },
}));

import {
  getMyOrderSendMode,
  getOrderSendMode,
  setOrderSendMode,
} from '../services/orderSendMode';

function selectQuery(result: { data: unknown; error: unknown }) {
  const query: any = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.single.mockResolvedValue(result);
  return query;
}

function updateQuery(result: { error: unknown }) {
  const query: any = {
    update: jest.fn(),
    eq: jest.fn(),
  };
  query.update.mockReturnValue(query);
  query.eq
    .mockReturnValueOnce(query)
    .mockResolvedValueOnce(result);
  return query;
}

describe('order send mode service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'employee-1' } }, error: null });
  });

  it('reads the signed-in employee mode from canonical profiles', async () => {
    const query = selectQuery({ data: { order_send_mode: 'direct' }, error: null });
    mockFrom.mockReturnValue(query);

    await expect(getMyOrderSendMode()).resolves.toBe('direct');

    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(query.select).toHaveBeenCalledWith('order_send_mode');
    expect(query.eq).toHaveBeenCalledWith('id', 'employee-1');
  });

  it('defaults unexpected persisted values to review during a rolling deployment', async () => {
    mockFrom.mockReturnValue(selectQuery({ data: { order_send_mode: null }, error: null }));

    await expect(getOrderSendMode('employee-2')).resolves.toBe('review');
  });

  it('updates only an employee profile for manager use', async () => {
    const query = updateQuery({ error: null });
    mockFrom.mockReturnValue(query);

    await expect(setOrderSendMode('employee-2', 'direct')).resolves.toBeUndefined();

    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(query.update).toHaveBeenCalledWith({ order_send_mode: 'direct' });
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'employee-2');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'role', 'employee');
  });

  it('requires a signed-in user for getMyOrderSendMode', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(getMyOrderSendMode()).rejects.toThrow('signed in');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
