const mockAsyncStorage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
};

const signOutMock = jest.fn(async () => undefined);
const listInventoryMock = jest.fn();
const supabaseMock = {
  from: jest.fn(),
};

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('../lib/supabase', () => ({
  supabase: supabaseMock,
}));
jest.mock('../lib/api/client', () => ({
  listInventory: listInventoryMock,
}));
jest.mock('../store/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      signOut: signOutMock,
    }),
  },
}));

import { useInventoryStore } from '../store/inventoryStore';

describe('useInventoryStore.fetchItems', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    useInventoryStore.setState(useInventoryStore.getInitialState(), true);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  test('surfaces the auth error without forcing sign-out when the API reports an expired session', async () => {
    listInventoryMock.mockResolvedValue({
      data: null,
      error: 'Session expired. Please sign in again.',
    });

    await expect(useInventoryStore.getState().fetchItems()).resolves.toBeUndefined();

    expect(signOutMock).not.toHaveBeenCalled();
    expect(useInventoryStore.getState().error).toBe(
      'Session expired. Please sign in again.'
    );
    expect(useInventoryStore.getState().isLoading).toBe(false);
  });

  test('captures non-auth inventory errors without rejecting', async () => {
    listInventoryMock.mockResolvedValue({
      data: null,
      error: 'Network error — please check your connection.',
    });

    await expect(useInventoryStore.getState().fetchItems()).resolves.toBeUndefined();

    expect(signOutMock).not.toHaveBeenCalled();
    expect(useInventoryStore.getState().error).toBe(
      'Network error — please check your connection.'
    );
    expect(useInventoryStore.getState().isLoading).toBe(false);
  });
});
