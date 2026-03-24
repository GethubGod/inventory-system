const mockAsyncStorage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  multiRemove: jest.fn(async () => undefined),
};

const clearSupabaseStoredSessionMock = jest.fn(async () => undefined);
const signOutMock = jest.fn();
const getSessionMock = jest.fn(async () => ({ data: { session: null } }));
const onAuthStateChangeMock = jest.fn();
const removeChannelMock = jest.fn();

const orderStoreMock = {
  getInitialState: jest.fn(() => ({})),
  setState: jest.fn(),
  persist: { clearStorage: jest.fn(async () => undefined) },
};
const draftStoreMock = {
  getInitialState: jest.fn(() => ({})),
  setState: jest.fn(),
  persist: { clearStorage: jest.fn(async () => undefined) },
};
const inventoryStoreMock = {
  getInitialState: jest.fn(() => ({})),
  setState: jest.fn(),
  persist: { clearStorage: jest.fn(async () => undefined) },
};
const stockStoreMock = {
  getInitialState: jest.fn(() => ({})),
  setState: jest.fn(),
  persist: { clearStorage: jest.fn(async () => undefined) },
};
const fulfillmentStoreMock = {
  getInitialState: jest.fn(() => ({})),
  setState: jest.fn(),
  persist: { clearStorage: jest.fn(async () => undefined) },
};
const tunaSpecialistStoreMock = {
  getInitialState: jest.fn(() => ({})),
  setState: jest.fn(),
  persist: { clearStorage: jest.fn(async () => undefined) },
};

function createLocationsQuery() {
  return {
    eq: jest.fn(() => ({
      order: jest.fn(async () => ({ data: [] })),
    })),
  };
}

const fromMock = jest.fn((table: string) => {
  if (table === 'locations') {
    return {
      select: jest.fn(() => createLocationsQuery()),
    };
  }

  throw new Error(`Unexpected table mock request: ${table}`);
});

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'babytuna://auth/callback'),
}));
jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
}));

jest.mock('@/lib/api/client', () => ({
  getUserContext: jest.fn(async () => ({ data: null })),
  registerSessionGetter: jest.fn(),
}));

jest.mock('@/services/accessCodes', () => ({
  validateAccessCode: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: signOutMock,
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
    from: fromMock,
    removeChannel: removeChannelMock,
  },
  clearSupabaseStoredSession: clearSupabaseStoredSessionMock,
}));

jest.mock('../store/orderStore', () => ({ useOrderStore: orderStoreMock }));
jest.mock('../store/draftStore', () => ({ useDraftStore: draftStoreMock }));
jest.mock('../store/inventoryStore', () => ({ useInventoryStore: inventoryStoreMock }));
jest.mock('../store/stockStore', () => ({ useStockStore: stockStoreMock }));
jest.mock('../store/fulfillmentStore', () => ({ useFulfillmentStore: fulfillmentStoreMock }));
jest.mock('../store/tunaSpecialistStore', () => ({ useTunaSpecialistStore: tunaSpecialistStoreMock }));

import { useAuthStore } from '../store/authStore';

async function flushMicrotasks(iterations = 8) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe('useAuthStore sign-out flow', () => {
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let authChangeCallback: ((event: string, session: any) => void) | null;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    authChangeCallback = null;
    signOutMock.mockResolvedValue({ error: null });
    getSessionMock.mockResolvedValue({ data: { session: null } });
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
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  test('clears local auth state and resolves even if Supabase signOut never resolves', async () => {
    signOutMock.mockImplementation(() => new Promise(() => {}));

    useAuthStore.setState(
      {
        ...useAuthStore.getInitialState(),
        session: { user: { id: 'user-1', email: 'manager@example.com' } } as any,
        user: {
          id: 'user-1',
          email: 'manager@example.com',
          name: 'Manager',
          role: 'manager',
          default_location_id: 'loc-1',
        } as any,
        profile: {
          id: 'user-1',
          role: 'manager',
          profile_completed: true,
          is_suspended: false,
        } as any,
        location: { id: 'loc-1', name: 'Main', short_code: 'MN' } as any,
        orgId: 'org-1',
        viewMode: 'manager',
        isInitialized: true,
        isLoading: false,
      },
      true
    );

    const signOutPromise = useAuthStore.getState().signOut();

    jest.advanceTimersByTime(5_000);

    await expect(signOutPromise).resolves.toBeUndefined();

    const state = useAuthStore.getState();
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.profile).toBeNull();
    expect(state.location).toBeNull();
    expect(state.orgId).toBeNull();
    expect(state.viewMode).toBe('employee');
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('babytuna-auth');
    expect(mockAsyncStorage.multiRemove).toHaveBeenCalled();
    expect(clearSupabaseStoredSessionMock).toHaveBeenCalledTimes(1);

    jest.runOnlyPendingTimers();
    await Promise.resolve();
  });

  test('clears state after a verified signed-out auth listener event', async () => {
    await useAuthStore.getState().initialize();

    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);
    expect(authChangeCallback).not.toBeNull();

    jest.clearAllMocks();

    useAuthStore.setState(
      {
        ...useAuthStore.getInitialState(),
        session: { user: { id: 'user-2', email: 'employee@example.com' } } as any,
        user: {
          id: 'user-2',
          email: 'employee@example.com',
          name: 'Employee',
          role: 'employee',
          default_location_id: null,
        } as any,
        profile: {
          id: 'user-2',
          role: 'employee',
          profile_completed: true,
          is_suspended: false,
        } as any,
        orgId: 'org-2',
        viewMode: 'manager',
        isInitialized: true,
        isLoading: false,
      },
      true
    );

    const callbackResult = authChangeCallback?.('SIGNED_OUT', null);

    expect(callbackResult).toBeUndefined();

    jest.runOnlyPendingTimers();
    await flushMicrotasks();

    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().profile).toBeNull();
    expect(useAuthStore.getState().orgId).toBeNull();
    expect(useAuthStore.getState().viewMode).toBe('employee');
  });

  test('ignores INITIAL_SESSION callbacks with a null session', async () => {
    await useAuthStore.getState().initialize();

    expect(authChangeCallback).not.toBeNull();

    jest.clearAllMocks();

    useAuthStore.setState(
      {
        ...useAuthStore.getInitialState(),
        session: { user: { id: 'user-3', email: 'employee@example.com' }, access_token: 'token-1' } as any,
        user: {
          id: 'user-3',
          email: 'employee@example.com',
          name: 'Employee',
          role: 'employee',
          default_location_id: null,
        } as any,
        profile: {
          id: 'user-3',
          role: 'employee',
          profile_completed: true,
          is_suspended: false,
        } as any,
        orgId: 'org-3',
        isInitialized: true,
        isLoading: false,
      },
      true
    );

    const callbackResult = authChangeCallback?.('INITIAL_SESSION', null);

    expect(callbackResult).toBeUndefined();
    expect(useAuthStore.getState().session).not.toBeNull();
    expect(useAuthStore.getState().user).not.toBeNull();
    expect(useAuthStore.getState().profile).not.toBeNull();
    expect(mockAsyncStorage.removeItem).not.toHaveBeenCalledWith('babytuna-auth');
    expect(clearSupabaseStoredSessionMock).not.toHaveBeenCalled();
  });
});
