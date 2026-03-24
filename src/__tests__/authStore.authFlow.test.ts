const mockAsyncStorage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  multiRemove: jest.fn(async () => undefined),
};

const signInWithPasswordMock = jest.fn();
const signUpMock = jest.fn();
const getSessionMock = jest.fn(async () => ({ data: { session: null } }));
const onAuthStateChangeMock = jest.fn();
const clearSupabaseStoredSessionMock = jest.fn(async () => undefined);

const profileMaybeSingleMock = jest.fn();
const profileUpdateEqMock = jest.fn(async () => ({ error: null }));
const userMaybeSingleMock = jest.fn();
const rpcMock = jest.fn();
const channelOnMock = jest.fn();
const channelSubscribeMock = jest.fn();

const createChannelMock = () => {
  channelOnMock.mockImplementation(() => ({
    on: channelOnMock,
    subscribe: channelSubscribeMock,
  }));
  return {
    on: channelOnMock,
    subscribe: channelSubscribeMock,
  };
};

const fromMock = jest.fn((table: string) => {
  if (table === 'locations') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(async () => ({ data: [] })),
        })),
      })),
    };
  }

  if (table === 'profiles') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: profileMaybeSingleMock,
        })),
      })),
      update: jest.fn(() => ({
        eq: profileUpdateEqMock,
      })),
    };
  }

  if (table === 'users') {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: userMaybeSingleMock,
        })),
      })),
    };
  }

  throw new Error(`Unexpected table mock request: ${table}`);
});

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'babytunasystems://auth/callback'),
}));
jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

const getUserContextMock = jest.fn(async () => ({ data: null }));

jest.mock('@/lib/api/client', () => ({
  getUserContext: getUserContextMock,
  registerSessionGetter: jest.fn(),
}));

const validateAccessCodeMock = jest.fn();

jest.mock('@/services/accessCodes', () => ({
  validateAccessCode: validateAccessCodeMock,
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signUp: signUpMock,
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
    from: fromMock,
    rpc: rpcMock,
    channel: jest.fn(() => createChannelMock()),
    removeChannel: jest.fn(),
  },
  clearSupabaseStoredSession: clearSupabaseStoredSessionMock,
}));

import { useAuthStore } from '../store/authStore';

describe('useAuthStore auth flow reliability', () => {
  let authChangeCallback: ((event: string, session: any) => void) | null;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    authChangeCallback = null;
    onAuthStateChangeMock.mockImplementation((callback: (event: string, session: any) => void) => {
      authChangeCallback = callback;
      return {
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      };
    });
    useAuthStore.setState(useAuthStore.getInitialState(), true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns confirmation_required when signup succeeds without an authenticated session', async () => {
    validateAccessCodeMock.mockResolvedValue('employee');
    signUpMock.mockResolvedValue({
      data: {
        user: { id: 'user-1', email: 'new.user@example.com' },
        session: null,
      },
      error: null,
    });

    useAuthStore.setState(
      {
        ...useAuthStore.getInitialState(),
        session: { user: { id: 'stale-user', email: 'stale@example.com' } } as any,
        user: {
          id: 'stale-user',
          email: 'stale@example.com',
          name: 'Stale User',
          role: 'manager',
          default_location_id: null,
        } as any,
        profile: {
          id: 'stale-user',
          email: 'stale@example.com',
          full_name: 'Stale User',
          role: 'manager',
          is_suspended: false,
          suspended_at: null,
          suspended_by: null,
          notifications_enabled: true,
          last_active_at: null,
          last_order_at: null,
          profile_completed: true,
          provider: 'email',
          created_at: '2026-03-22T00:00:00.000Z',
          updated_at: '2026-03-22T00:00:00.000Z',
        } as any,
        viewMode: 'manager',
      },
      true
    );

    await expect(
      useAuthStore.getState().signUp('new.user@example.com', 'Password123', 'New User', '1234')
    ).resolves.toEqual({
      status: 'confirmation_required',
      email: 'new.user@example.com',
    });

    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.profile).toBeNull();
    expect(state.viewMode).toBe('employee');
    expect(fromMock).not.toHaveBeenCalled();
  });

  test('repairs the public.users row during sign in when auth succeeded but the app user row is missing', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'manager-1',
            email: 'manager@example.com',
            user_metadata: {},
            app_metadata: {},
          },
        },
      },
      error: null,
    });

    profileMaybeSingleMock.mockResolvedValue({
      data: {
        id: 'manager-1',
        email: 'manager@example.com',
        full_name: 'Manager One',
        role: 'manager',
        is_suspended: false,
        suspended_at: null,
        suspended_by: null,
        notifications_enabled: true,
        last_active_at: '2026-03-22T00:00:00.000Z',
        last_order_at: null,
        profile_completed: true,
        provider: 'email',
        created_at: '2026-03-22T00:00:00.000Z',
        updated_at: '2026-03-22T00:00:00.000Z',
      },
      error: null,
    });

    userMaybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Function ensure_current_user_identity not found',
      },
    });

    await expect(
      useAuthStore.getState().signIn('manager@example.com', 'Password123')
    ).resolves.toMatchObject({
      id: 'manager-1',
      email: 'manager@example.com',
      name: 'Manager One',
      role: 'manager',
    });

    expect(rpcMock).toHaveBeenCalledWith('ensure_current_user_identity');
    expect(useAuthStore.getState().user).toMatchObject({
      id: 'manager-1',
      name: 'Manager One',
      role: 'manager',
    });
  });

  test('falls back to client-side hydration when the identity repair RPC is permission denied', async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'employee-2',
            email: 'employee2@example.com',
            user_metadata: {},
            app_metadata: {},
          },
        },
      },
      error: null,
    });

    profileMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    userMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'permission denied for function ensure_current_user_identity',
      },
    });

    await expect(
      useAuthStore.getState().signIn('employee2@example.com', 'Password123')
    ).resolves.toMatchObject({
      id: 'employee-2',
      email: 'employee2@example.com',
      role: 'employee',
    });

    expect(useAuthStore.getState().profile).toMatchObject({
      id: 'employee-2',
      email: 'employee2@example.com',
      profile_completed: true,
    });
    expect(useAuthStore.getState().user).toMatchObject({
      id: 'employee-2',
      email: 'employee2@example.com',
      role: 'employee',
    });
  });

  test('cancels deferred signed-out cleanup when a newer sign-in starts', async () => {
    await useAuthStore.getState().initialize();

    expect(authChangeCallback).not.toBeNull();

    jest.clearAllMocks();

    authChangeCallback?.('SIGNED_OUT', null);

    signInWithPasswordMock.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'employee-1',
            email: 'employee@example.com',
            user_metadata: {},
            app_metadata: {},
          },
        },
      },
      error: null,
    });

    profileMaybeSingleMock.mockResolvedValue({
      data: {
        id: 'employee-1',
        email: 'employee@example.com',
        full_name: 'Employee One',
        role: 'employee',
        is_suspended: false,
        suspended_at: null,
        suspended_by: null,
        notifications_enabled: true,
        last_active_at: '2026-03-22T00:00:00.000Z',
        last_order_at: null,
        profile_completed: true,
        provider: 'email',
        created_at: '2026-03-22T00:00:00.000Z',
        updated_at: '2026-03-22T00:00:00.000Z',
      },
      error: null,
    });

    userMaybeSingleMock.mockResolvedValue({
      data: {
        id: 'employee-1',
        email: 'employee@example.com',
        name: 'Employee One',
        role: 'employee',
        default_location_id: null,
        created_at: '2026-03-22T00:00:00.000Z',
      },
      error: null,
    });

    await expect(
      useAuthStore.getState().signIn('employee@example.com', 'Password123')
    ).resolves.toMatchObject({
      id: 'employee-1',
      email: 'employee@example.com',
      role: 'employee',
    });

    jest.runOnlyPendingTimers();
    await Promise.resolve();

    expect(clearSupabaseStoredSessionMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session?.user?.id).toBe('employee-1');
  });
});
