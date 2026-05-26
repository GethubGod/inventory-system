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

function createInventoryQueryResult(result: { data: unknown; error: unknown }) {
  const query: {
    select: jest.Mock;
    eq: jest.Mock;
    limit: jest.Mock;
  } = {
    select: jest.fn(),
    eq: jest.fn(),
    limit: jest.fn(async () => result),
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);

  return query;
}

describe('useInventoryStore.fetchItems', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    listInventoryMock.mockReset();
    signOutMock.mockReset();
    supabaseMock.from.mockReset();
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
    const fallbackQuery = createInventoryQueryResult({
      data: null,
      error: new Error('fallback failed'),
    });
    supabaseMock.from.mockReturnValue(fallbackQuery);

    await expect(useInventoryStore.getState().fetchItems()).resolves.toBeUndefined();

    expect(signOutMock).not.toHaveBeenCalled();
    expect(useInventoryStore.getState().error).toBe(
      'Network error — please check your connection.'
    );
    expect(useInventoryStore.getState().isLoading).toBe(false);
  });

  test('falls back to a direct inventory query when the API returns no items', async () => {
    listInventoryMock.mockResolvedValue({
      data: [],
      error: null,
    });
    const fallbackQuery = createInventoryQueryResult({
      data: [
        {
          id: 'item-1',
          name: 'Salmon',
          category: 'fish',
          supplier_category: 'fish_supplier',
          supplier_id: 'supplier-1',
          base_unit: 'lb',
          pack_unit: 'case',
          pack_size: 1,
          active: true,
          created_at: '2026-03-23T00:00:00.000Z',
          created_by: 'user-1',
        },
      ],
      error: null,
    });
    supabaseMock.from.mockReturnValue(fallbackQuery);

    await expect(useInventoryStore.getState().fetchItems()).resolves.toBeUndefined();

    expect(listInventoryMock).toHaveBeenCalledWith({
      limit: 5000,
    });
    expect(supabaseMock.from).toHaveBeenCalledWith('inventory_items');
    expect(fallbackQuery.eq.mock.calls).toContainEqual(['active', true]);
    expect(useInventoryStore.getState().items).toEqual([
      {
        id: 'item-1',
        name: 'Salmon',
        category: 'fish',
        supplier_category: 'fish_supplier',
        supplier_id: 'supplier-1',
        base_unit: 'lb',
        pack_unit: 'case',
        pack_size: 1,
        active: true,
        location_id: null,
        created_at: '2026-03-23T00:00:00.000Z',
        created_by: 'user-1',
      },
    ]);
    expect(useInventoryStore.getState().error).toBeNull();
  });
});
