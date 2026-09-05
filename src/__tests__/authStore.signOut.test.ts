const mockAsyncStorage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  multiRemove: jest.fn(async () => undefined),
};

const clearSupabaseStoredSessionMock = jest.fn(async () => undefined);
const signOutMock = jest.fn();
const clearDeviceNotificationsMock = jest.fn();
const deactivateCurrentDevicePushTokenMock = jest.fn();
jest.mock('@/services/notificationService', () => ({
  clearDeviceNotifications: clearDeviceNotificationsMock,
  deactivateCurrentDevicePushToken: deactivateCurrentDevicePushTokenMock,
}));
const getSessionMock = jest.fn(async () => ({ data: { session: null } }));
const setSessionMock = jest.fn();
const refreshSessionMock = jest.fn();
const onAuthStateChangeMock = jest.fn();
const removeChannelMock = jest.fn();

const invalidatePendingOrderRequestsMock = jest.fn();
const invalidatePendingStockRequestsMock = jest.fn();

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
      setSession: setSessionMock,
      refreshSession: refreshSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
    from: fromMock,
    removeChannel: removeChannelMock,
  },
  clearSupabaseStoredSession: clearSupabaseStoredSessionMock,
}));

jest.mock('../store/orderStore', () => ({ useOrderStore: orderStoreMock, invalidatePendingOrderRequests: invalidatePendingOrderRequestsMock }));
jest.mock('../store/draftStore', () => ({ useDraftStore: draftStoreMock }));
jest.mock('../store/inventoryStore', () => ({ useInventoryStore: inventoryStoreMock }));
jest.mock('../store/stockStore', () => ({ useStockStore: stockStoreMock, invalidatePendingStockRequests: invalidatePendingStockRequestsMock }));
jest.mock('../store/fulfillmentStore', () => ({ useFulfillmentStore: fulfillmentStoreMock }));
jest.mock('../store/tunaSpecialistStore', () => ({ useTunaSpecialistStore: tunaSpecialistStoreMock }));

/* eslint-disable import/first -- Mock factories reference initialized bindings before the subject loads. */
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { useSimpleOrderUiStore } from '../store/simpleOrderUiStore';
import { getCached, setCache } from '../lib/queryCache';
import { getHomeInsights, setHomeInsights } from '../features/home/homeInsightsCache';
/* eslint-enable import/first */

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
    clearDeviceNotificationsMock.mockResolvedValue(undefined);
    deactivateCurrentDevicePushTokenMock.mockResolvedValue(undefined);
    getSessionMock.mockResolvedValue({ data: { session: null } });
    setSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    refreshSessionMock.mockResolvedValue({ data: { session: null }, error: null });
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
        viewMode: 'manager',
        isInitialized: true,
        isLoading: false,
      },
      true
    );

    const signOutPromise = useAuthStore.getState().signOut();

    await jest.advanceTimersByTimeAsync(10_000);

    await expect(signOutPromise).resolves.toBeUndefined();

    const state = useAuthStore.getState();
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.profile).toBeNull();
    expect(state.location).toBeNull();
    expect(state.viewMode).toBe('employee');
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('babytuna-auth');
    expect(mockAsyncStorage.multiRemove).toHaveBeenCalled();
    expect(invalidatePendingOrderRequestsMock).toHaveBeenCalledTimes(1);
    expect(invalidatePendingStockRequestsMock).toHaveBeenCalledTimes(1);
    expect(invalidatePendingOrderRequestsMock.mock.invocationCallOrder[0])
      .toBeLessThan(orderStoreMock.setState.mock.invocationCallOrder[0]);
    expect(invalidatePendingStockRequestsMock.mock.invocationCallOrder[0])
      .toBeLessThan(stockStoreMock.setState.mock.invocationCallOrder[0]);
    expect(clearSupabaseStoredSessionMock).toHaveBeenCalledTimes(1);

    jest.runOnlyPendingTimers();
    await Promise.resolve();
  });

  test('deactivates the departing device before invalidating its session', async () => {
    useAuthStore.setState({ session: { user: { id: 'employee-1' } } as any });
    signOutMock.mockImplementation(async () => {
      expect(deactivateCurrentDevicePushTokenMock).toHaveBeenCalledWith('employee-1');
      return { error: null };
    });
    await useAuthStore.getState().signOut();
    expect(clearDeviceNotificationsMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().session).toBeNull();
  });

  test('still signs out locally when notification cleanup is offline', async () => {
    useAuthStore.setState({ session: { user: { id: 'employee-1' } } as any });
    deactivateCurrentDevicePushTokenMock.mockRejectedValue(new Error('Network request failed'));
    clearDeviceNotificationsMock.mockRejectedValue(new Error('Native notifications unavailable'));
    await expect(useAuthStore.getState().signOut()).resolves.toBeUndefined();
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().session).toBeNull();
  });

  test('finishes logout after a stuck notification request and expires late device cleanup', async () => {
    useAuthStore.setState({ session: { user: { id: 'employee-1' } } as any });
    let canClear: (() => boolean) | undefined;
    clearDeviceNotificationsMock.mockImplementation((shouldClear: () => boolean) => {
      canClear = shouldClear;
      return new Promise(() => {});
    });
    const logout = useAuthStore.getState().signOut();
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(logout).resolves.toBeUndefined();
    expect(canClear?.()).toBe(false);
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  test('clears personal settings, staged reorders, and cached supplier data on sign-out', async () => {
    useSettingsStore.getState().setAvatarUri('file:///private/employee-avatar.jpg');
    useSettingsStore.getState().addReminder({
      name: 'Employee private reminder',
      message: 'Private reminder',
      repeatType: 'daily',
      time: '09:00',
      selectedDays: [1],
      enabled: true,
    });
    useSimpleOrderUiStore.getState().setPendingReorder({ items: [], sourceLabel: 'Previous employee order' });
    setCache('supplier-lookup', { supplier: 'Previous account supplier' });
    setHomeInsights('employee-a', 'location-1', { predictedItems: [], reorderOrder: null, activeReminder: null, cachedAt: Date.now() });

    await useAuthStore.getState().signOut();

    expect(useSettingsStore.getState().avatarUri).toBeNull();
    expect(useSettingsStore.getState().reminders).toEqual(useSettingsStore.getInitialState().reminders);
    expect(useSimpleOrderUiStore.getState().consumePendingReorder()).toBeNull();
    expect(getCached('supplier-lookup')).toBeNull();
    expect(getHomeInsights('employee-a', 'location-1')).toBeUndefined();
    expect(mockAsyncStorage.multiRemove).toHaveBeenCalledWith(expect.arrayContaining(['app-settings']));
  });

  test('ignores the SIGNED_OUT auth event triggered by an explicit sign out', async () => {
    await useAuthStore.getState().initialize();

    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);
    expect(authChangeCallback).not.toBeNull();

    jest.clearAllMocks();
    signOutMock.mockImplementation(async () => {
      authChangeCallback?.('SIGNED_OUT', null);
      return { error: null };
    });

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
        viewMode: 'manager',
        isInitialized: true,
        isLoading: false,
      },
      true
    );

    await expect(useAuthStore.getState().signOut()).resolves.toBeUndefined();

    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
    expect(setSessionMock).not.toHaveBeenCalled();
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().profile).toBeNull();
    expect(useAuthStore.getState().location).toBeNull();
    expect(useAuthStore.getState().viewMode).toBe('employee');
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('babytuna-auth');
    expect(clearSupabaseStoredSessionMock).toHaveBeenCalledTimes(1);
  });

  test('preserves auth state after an unexpected signed-out auth listener event', async () => {
    await useAuthStore.getState().initialize();

    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);
    expect(authChangeCallback).not.toBeNull();

    jest.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { session: null } });
    setSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-2',
          refresh_token: 'refresh-2',
          user: { id: 'user-2', email: 'employee@example.com' },
        },
      },
      error: null,
    });

    useAuthStore.setState(
      {
        ...useAuthStore.getInitialState(),
        session: {
          access_token: 'token-1',
          refresh_token: 'refresh-1',
          user: { id: 'user-2', email: 'employee@example.com' },
        } as any,
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

    expect(setSessionMock).toHaveBeenCalledWith({
      access_token: 'token-1',
      refresh_token: 'refresh-1',
    });
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session).toMatchObject({
      access_token: 'token-2',
      refresh_token: 'refresh-2',
    });
    expect(useAuthStore.getState().user).toMatchObject({ id: 'user-2' });
    expect(useAuthStore.getState().profile).toMatchObject({ id: 'user-2' });
    expect(useAuthStore.getState().viewMode).toBe('manager');
    expect(mockAsyncStorage.removeItem).not.toHaveBeenCalledWith('babytuna-auth');
    expect(clearSupabaseStoredSessionMock).not.toHaveBeenCalled();
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
