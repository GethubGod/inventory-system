const mockAsyncStorage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
};

const mockNetInfo = {
  addEventListener: jest.fn(() => jest.fn()),
};

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: mockNetInfo,
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/perf', () => ({ perfMark: jest.fn(), perfMeasure: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ getNotificationsModule: jest.fn(async () => null) }));
jest.mock('@/services/fulfillmentDataSource', () => ({
  loadPendingFulfillmentData: jest.fn(),
}));
jest.mock('@/services/orderSubmission', () => ({
  generateUUID: jest.fn(() => 'order-1'),
  submitOrder: jest.fn(),
  syncProfileAfterOrder: jest.fn(),
}));
jest.mock('@/store/inventoryStore', () => ({
  useInventoryStore: { getState: () => ({ items: [] }) },
}));

/* eslint-disable import/first -- Dependencies must be mocked before importing the store. */
import { useOrderStore } from '../store/orderStore';
import type { FinalizeSupplierOrderInput, PastOrder } from '../store/orderStore.types';

const finalizedPastOrder: PastOrder = {
  id: 'past-1',
  supplierId: 'supplier-1',
  supplierName: 'Supplier',
  createdBy: 'manager-1',
  createdAt: '2026-09-01T12:00:00.000Z',
  payload: {},
  messageText: 'Supplier order',
  shareMethod: 'copy',
  syncStatus: 'synced',
  pendingSyncJobId: null,
  syncError: null,
  itemCount: 1,
  remainingCount: 0,
};

const finalizeInput: FinalizeSupplierOrderInput = {
  supplierId: 'supplier-1',
  supplierName: 'Supplier',
  createdBy: 'manager-1',
  messageText: 'Supplier order',
  shareMethod: 'copy',
  payload: {},
};

describe('order store fulfillment refresh signal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useOrderStore.setState(useOrderStore.getInitialState(), true);
  });

  test('increments after a supplier order is finalized', async () => {
    const createPastOrder = jest.fn(
      async (_input: FinalizeSupplierOrderInput): Promise<PastOrder> => finalizedPastOrder,
    );
    useOrderStore.setState({ createPastOrder });

    await useOrderStore.getState().finalizeSupplierOrder(finalizeInput);

    const state = useOrderStore.getState();
    const revision = 'fulfillmentDataRevision' in state ? state.fulfillmentDataRevision : undefined;
    expect(revision).toBe(1);
  });
});
