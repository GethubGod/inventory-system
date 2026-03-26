const netInfoFetchMock = jest.fn(async () => ({ isConnected: true }));
const getSessionMock = jest.fn(async () => ({ data: { session: null } }));
const refreshSessionMock = jest.fn();
const setSessionMock = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: netInfoFetchMock,
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      refreshSession: refreshSessionMock,
      setSession: setSessionMock,
    },
  },
}));

import { deleteSelfAccountRequest, registerSessionGetter } from '../lib/api/client';

describe('deleteSelfAccountRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerSessionGetter(() => ({
      access_token: 'expired-token',
      refresh_token: 'refresh-token',
    }));
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    registerSessionGetter(() => null);
  });

  test('retries with a session restored from the in-memory auth state after a 401', async () => {
    (global as any).fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: jest.fn(async () => ({ error: 'Unauthorized' })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn(async () => ({ ok: true })),
      });

    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: new Error('missing persisted session'),
    });
    setSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'fresh-token',
          refresh_token: 'fresh-refresh-token',
        },
      },
      error: null,
    });

    const result = await deleteSelfAccountRequest('DELETE');

    expect(result).toEqual({
      data: { ok: true },
      error: null,
    });
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(setSessionMock).toHaveBeenCalledWith({
      access_token: 'expired-token',
      refresh_token: 'refresh-token',
    });
    expect((global as any).fetch).toHaveBeenCalledTimes(2);
    expect((global as any).fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/delete-self'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fresh-token',
        }),
      })
    );
  });
});
