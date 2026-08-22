const mockSupabase = {
  auth: {
    getUser: jest.fn(),
  },
  rpc: jest.fn(),
  from: jest.fn(),
  channel: jest.fn(),
  removeChannel: jest.fn(),
};

/* eslint-disable import/first -- Dependencies must be mocked before importing the service. */
jest.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
}));

import {
  getModulesForUser,
  getMyModules,
  setUserModule,
  subscribeToMyModules,
} from '../services/userModules';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('user modules service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'current-user-id' } },
      error: null,
    });
  });

  it('gets the current user module set through get_effective_modules', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [
        { module_key: 'ordering_simple', enabled: false },
        { module_key: 'stock_check', enabled: true },
        { module_key: 'unknown_module', enabled: true },
      ],
      error: null,
    });

    await expect(getMyModules()).resolves.toEqual([
      { key: 'ordering_simple', enabled: false },
      { key: 'stock_check', enabled: true },
    ]);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_effective_modules', {
      p_user_id: 'current-user-id',
    });
  });

  it('gets a managed user module set through get_effective_modules', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [{ module_key: 'fulfillment', enabled: true }],
      error: null,
    });

    await expect(getModulesForUser('managed-user-id')).resolves.toEqual([
      { key: 'fulfillment', enabled: true },
    ]);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_effective_modules', {
      p_user_id: 'managed-user-id',
    });
  });

  it('surfaces RPC errors', async () => {
    const error = new Error('Not authorized');
    mockSupabase.rpc.mockResolvedValue({ data: null, error });

    await expect(getModulesForUser('other-user-id')).rejects.toThrow('Not authorized');
  });

  it('upserts a module override and records the manager who changed it', async () => {
    const query = { upsert: jest.fn().mockResolvedValue({ error: null }) };
    mockSupabase.from.mockReturnValue(query);

    await expect(
      setUserModule('employee-id', 'tips', true),
    ).resolves.toBeUndefined();

    expect(mockSupabase.from).toHaveBeenCalledWith('user_modules');
    expect(query.upsert).toHaveBeenCalledWith(
      {
        user_id: 'employee-id',
        module_key: 'tips',
        enabled: true,
        updated_by: 'current-user-id',
      },
      { onConflict: 'user_id,module_key' },
    );
  });

  it('surfaces module override write errors', async () => {
    const error = new Error('Managers only');
    const query = { upsert: jest.fn().mockResolvedValue({ error }) };
    mockSupabase.from.mockReturnValue(query);

    await expect(
      setUserModule('employee-id', 'tips', true),
    ).rejects.toThrow('Managers only');
  });

  it('subscribes to only the current user module rows and removes the channel', async () => {
    const onChange = jest.fn();
    const channel = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    mockSupabase.channel.mockReturnValue(channel);
    mockSupabase.removeChannel.mockResolvedValue('ok');

    const unsubscribe = subscribeToMyModules(onChange);
    await flushPromises();

    expect(mockSupabase.channel).toHaveBeenCalledWith(
      'user-module-updates-current-user-id',
    );
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'user_modules',
        filter: 'user_id=eq.current-user-id',
      },
      onChange,
    );
    expect(channel.subscribe).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(channel);
  });
});
