const storage = { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) };
const from = jest.fn();
const scheduleNotification = jest.fn();
const cancelNotification = jest.fn(async (_id: string | null) => undefined);
jest.mock('../store/orderStore.helpers', () => ({
  ...jest.requireActual('../store/orderStore.helpers'),
  scheduleOrderLaterNotification: (...args: unknown[]) => scheduleNotification(...args),
  cancelOrderLaterNotification: (id: string | null) => cancelNotification(id),
}));
const getAreaItems = jest.fn();
const saveStockUpdate = jest.fn();
const updateAreaItemQuantity = jest.fn();
const updateStockCheckSession = jest.fn();
const createStockCheckSession = jest.fn();
const getStorageAreas = jest.fn();
const updateStorageAreaLastChecked = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => storage);
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: jest.fn(() => jest.fn()) } }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@/lib/supabase', () => ({ supabase: { from } }));
jest.mock('@/lib/perf', () => ({ perfMark: jest.fn(), perfMeasure: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ getNotificationsModule: jest.fn(async () => null) }));
jest.mock('@/services/fulfillmentDataSource', () => ({ loadPendingFulfillmentData: jest.fn() }));
jest.mock('@/services/orderSubmission', () => ({ generateUUID: jest.fn(() => 'order-1'), submitOrder: jest.fn(), syncProfileAfterOrder: jest.fn() }));
jest.mock('@/store/inventoryStore', () => ({ useInventoryStore: { getState: () => ({ items: [] }) } }));
jest.mock('@/store/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 'employee-a' } }) } }));
jest.mock('@/lib/api/stock', () => ({ getAreaItems, saveStockUpdate, updateAreaItemQuantity, updateStockCheckSession, createStockCheckSession, getStorageAreas, updateStorageAreaLastChecked }));

/* eslint-disable import/first -- Native dependencies are mocked before store imports. */
import { invalidatePendingOrderRequests, useOrderStore } from '../store/orderStore';
import type { OrderLaterItem, PastOrder, PendingPastOrderSyncJob } from '../store/orderStore.types';
import { tableFlags } from '../store/orderStore.helpers';
import { invalidatePendingStockRequests, useStockStore, type PendingUpdate } from '../store/stockStore';
/* eslint-enable import/first */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function resetOrderAccount() {
  invalidatePendingOrderRequests();
  useOrderStore.setState(useOrderStore.getInitialState(), true);
}
function resetStockAccount() {
  invalidatePendingStockRequests();
  useStockStore.setState(useStockStore.getInitialState(), true);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetOrderAccount();
  resetStockAccount();
});

it('discards the previous employee orders without clearing the new account loading state', async () => {
  const request = deferred<{ data: { id: string; user_id: string }[]; error: null }>();
  const query = { select: jest.fn(), eq: jest.fn(), neq: jest.fn(), order: jest.fn(), limit: jest.fn(() => request.promise) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.neq.mockReturnValue(query); query.order.mockReturnValue(query);
  from.mockReturnValue(query);
  const load = useOrderStore.getState().fetchUserOrders('employee-a');
  resetOrderAccount();
  useOrderStore.setState({ isLoading: true });
  request.resolve({ data: [{ id: 'private-order-a', user_id: 'employee-a' }], error: null });
  await load;
  expect(useOrderStore.getState().orders).toEqual([]);
  expect(useOrderStore.getState().isLoading).toBe(true);
});

it('does not restore an old stock area after account reset', async () => {
  const request = deferred<{ id: string; current_quantity: number; min_quantity: number; max_quantity: number }[]>();
  getAreaItems.mockReturnValue(request.promise);
  const load = useStockStore.getState().fetchAreaItems('area-a');
  resetStockAccount();
  useStockStore.setState({ isLoading: true });
  request.resolve([{ id: 'item-a', current_quantity: 4, min_quantity: 1, max_quantity: 5 }]);
  await load;
  expect(useStockStore.getState().areaItemsById).toEqual({});
  expect(useStockStore.getState().currentAreaItems).toEqual([]);
  expect(useStockStore.getState().isLoading).toBe(true);
});

const pendingA: PendingUpdate = { id: 'update-a', areaItemId: 'area-item-a', areaId: 'area-a', inventoryItemId: 'inventory-a', previousQuantity: 1, newQuantity: 2, updateMethod: 'manual', updatedBy: 'employee-a', createdAt: '2026-09-01T12:00:00Z' };
const pendingB: PendingUpdate = { ...pendingA, id: 'update-b', updatedBy: 'employee-b' };

it.each(['success', 'failure'])('stops old stock sync after reset on %s and preserves the new queue', async (outcome) => {
  const request = deferred<void>();
  saveStockUpdate.mockReturnValue(request.promise);
  useStockStore.setState({ pendingUpdates: [pendingA, { ...pendingA, id: 'update-a-2' }], isOnline: true });
  const syncing = useStockStore.getState().syncPendingUpdates();
  resetStockAccount();
  useStockStore.setState({ pendingUpdates: [pendingB] });
  if (outcome === 'success') request.resolve(); else request.reject(new Error('Network request failed'));
  await syncing;
  expect(updateAreaItemQuantity).not.toHaveBeenCalled();
  expect(saveStockUpdate).toHaveBeenCalledTimes(1);
  expect(useStockStore.getState().pendingUpdates).toEqual([pendingB]);
});

it('does not prefetch another old area after account reset', async () => {
  const request = deferred<[]>();
  getAreaItems.mockReturnValue(request.promise);
  const prefetch = useStockStore.getState().prefetchAreaItems(['area-a', 'area-a-2']);
  resetStockAccount();
  request.resolve([]);
  await prefetch;
  expect(getAreaItems).toHaveBeenCalledTimes(1);
  expect(useStockStore.getState().areaItemsById).toEqual({});
});

it('retains normal stock sync behavior within the current account', async () => {
  saveStockUpdate.mockResolvedValue(undefined);
  updateAreaItemQuantity.mockResolvedValue(undefined);
  useStockStore.setState({ pendingUpdates: [pendingA], isOnline: true });
  await useStockStore.getState().syncPendingUpdates();
  expect(updateAreaItemQuantity).toHaveBeenCalledWith('area-item-a', 2, expect.objectContaining({ updated_by: 'employee-a' }));
  expect(useStockStore.getState().pendingUpdates).toEqual([]);
});


it('cancels only the old reminder when scheduling finishes after account reset', async () => {
  const request = deferred<string>();
  scheduleNotification.mockReturnValue(request.promise);
  const scheduled: OrderLaterItem = { id: 'later-a', createdBy: 'employee-a', createdAt: '2026-09-01T12:00:00Z', scheduledAt: '2026-09-07T12:00:00Z', quantity: 1, itemId: null, itemName: 'Private item', unit: 'lb', locationId: null, locationName: null, notes: null, suggestedSupplierId: null, preferredSupplierId: null, preferredLocationGroup: null, sourceOrderItemId: null, sourceOrderItemIds: [], sourceOrderId: null, notificationId: null, status: 'queued', payload: {} };
  useOrderStore.setState({ orderLaterQueue: [scheduled] });
  const updating = useOrderStore.getState().updateOrderLaterItemSchedule('later-a', '2026-09-08T12:00:00Z');
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
  expect(scheduleNotification).toHaveBeenCalledTimes(1);
  resetOrderAccount();
  request.resolve('old-session-notification');
  await expect(updating).resolves.toBeNull();
  expect(cancelNotification).toHaveBeenLastCalledWith('old-session-notification');
  expect(useOrderStore.getState().orderLaterQueue).toEqual([]);
  expect(from).not.toHaveBeenCalled();
});

it.each(['success', 'failure'])('stops old fulfillment sync on %s after reset and keeps the new queue', async (outcome) => {
  const request = deferred<{ data: { id: string }; error: null }>();
  const query = { insert: jest.fn(), select: jest.fn(), single: jest.fn(() => request.promise) };
  query.insert.mockReturnValue(query); query.select.mockReturnValue(query); from.mockReturnValue(query);
  tableFlags.pastOrdersTableAvailable = true;
  const job: PendingPastOrderSyncJob = { id: 'job-a', localPastOrderId: 'local-a', existingPastOrderId: null, queuedAt: '2026-09-01T12:00:00Z', supplierId: 'supplier-a', supplierName: 'Supplier A', createdBy: 'employee-a', messageText: 'Private order', shareMethod: 'copy', payload: {}, lineItems: [{ itemId: 'item-a', itemName: 'Rice', unit: 'bag', quantity: 1 }], consumedOrderItemIds: [], consumedDraftItemIds: [], retryCount: 0, lastError: null };
  useOrderStore.setState({ pendingPastOrderSyncQueue: [job] });
  const syncing = useOrderStore.getState().flushPendingPastOrderSync('employee-a');
  resetOrderAccount();
  const nextJob = { ...job, id: 'job-b', createdBy: 'employee-b' };
  useOrderStore.setState({ pendingPastOrderSyncQueue: [nextJob] });
  if (outcome === 'success') request.resolve({ data: { id: 'remote-a' }, error: null });
  else request.reject(new Error('Network request failed'));
  await syncing;
  expect(from).toHaveBeenCalledTimes(1);
  expect(useOrderStore.getState().pendingPastOrderSyncQueue).toEqual([nextJob]);
  expect(useOrderStore.getState().pastOrders).toEqual([]);
});

it.each(['success', 'failure'])('keeps stock additions and same-ID replacements queued during sync %s', async (outcome) => {
  const request = deferred<void>();
  saveStockUpdate.mockReturnValue(request.promise);
  updateAreaItemQuantity.mockResolvedValue(undefined);
  useStockStore.setState({ pendingUpdates: [pendingA], isOnline: true });
  const syncing = useStockStore.getState().syncPendingUpdates();
  useStockStore.getState().queueUpdate({ ...pendingA, newQuantity: 9 });
  const added = { ...pendingA, id: 'added', areaItemId: 'another-area-item' };
  useStockStore.getState().queueUpdate(added);
  if (outcome === 'success') request.resolve();
  else request.reject(new Error('Network request failed'));
  await syncing;
  expect(useStockStore.getState().pendingUpdates).toEqual([{ ...pendingA, newQuantity: 9 }, added]);
});

it('does not run duplicate stock sync passes', async () => {
  const request = deferred<void>();
  saveStockUpdate.mockReturnValue(request.promise);
  updateAreaItemQuantity.mockResolvedValue(undefined);
  useStockStore.setState({ pendingUpdates: [pendingA], isOnline: true });
  const first = useStockStore.getState().syncPendingUpdates();
  const second = useStockStore.getState().syncPendingUpdates();
  expect(saveStockUpdate).toHaveBeenCalledTimes(1);
  request.resolve();
  await Promise.all([first, second]);
});

it('does not release the new account stock sync lock when an old pass ends', async () => {
  const oldRequest = deferred<void>();
  const newRequest = deferred<void>();
  saveStockUpdate.mockReturnValueOnce(oldRequest.promise).mockReturnValue(newRequest.promise);
  updateAreaItemQuantity.mockResolvedValue(undefined);
  useStockStore.setState({ pendingUpdates: [pendingA], isOnline: true });
  const oldPass = useStockStore.getState().syncPendingUpdates();
  resetStockAccount();
  useStockStore.setState({ pendingUpdates: [pendingB], isOnline: true });
  const newPass = useStockStore.getState().syncPendingUpdates();
  oldRequest.resolve();
  await oldPass;
  const duplicate = useStockStore.getState().syncPendingUpdates();
  expect(saveStockUpdate).toHaveBeenCalledTimes(2);
  newRequest.resolve();
  await Promise.all([newPass, duplicate]);
});

it.each(['success', 'failure'])('retains newly queued fulfillment work and history after sync %s', async (outcome) => {
  const request = deferred<{ data: { id: string }; error: null }>();
  const query = { insert: jest.fn(), select: jest.fn(), single: jest.fn(() => request.promise) };
  query.insert.mockReturnValue(query); query.select.mockReturnValue(query); from.mockReturnValue(query);
  tableFlags.pastOrdersTableAvailable = true;
  const job: PendingPastOrderSyncJob = { id: 'job-a', localPastOrderId: 'local-a', existingPastOrderId: null, queuedAt: '2026-09-01T12:00:00Z', supplierId: 'supplier-a', supplierName: 'Supplier A', createdBy: 'employee-a', messageText: 'Order A', shareMethod: 'copy', payload: {}, lineItems: [], consumedOrderItemIds: [], consumedDraftItemIds: [], retryCount: 0, lastError: null };
  useOrderStore.setState({ pendingPastOrderSyncQueue: [job] });
  const syncing = useOrderStore.getState().flushPendingPastOrderSync();
  const addedJob = { ...job, id: 'job-new', localPastOrderId: 'local-new' };
  const addedHistory: PastOrder = { id: 'local-new', supplierId: 'supplier-a', supplierName: 'Supplier A', createdBy: 'employee-a', createdAt: '2026-09-01T12:00:00.000Z', payload: {}, messageText: 'New order', shareMethod: 'copy', syncStatus: 'pending_sync', pendingSyncJobId: addedJob.id, syncError: null, itemCount: 0, remainingCount: 0 };
  useOrderStore.setState((state) => ({ pendingPastOrderSyncQueue: [...state.pendingPastOrderSyncQueue, addedJob], pastOrders: [...state.pastOrders, addedHistory] }));
  if (outcome === 'success') request.resolve({ data: { id: 'remote-a' }, error: null });
  else request.reject(new Error('Network request failed'));
  await syncing;
  expect(useOrderStore.getState().pendingPastOrderSyncQueue).toEqual(expect.arrayContaining([expect.objectContaining({ id: addedJob.id })]));
  expect(useOrderStore.getState().pastOrders).toEqual(expect.arrayContaining([expect.objectContaining({ id: addedHistory.id, messageText: 'New order' })]));
  expect(from).toHaveBeenCalledTimes(1);
});


it('preserves a fulfillment job replaced under the same ID during sync', async () => {
  const request = deferred<{ data: { id: string }; error: null }>();
  const query = { insert: jest.fn(), select: jest.fn(), single: jest.fn(() => request.promise) };
  query.insert.mockReturnValue(query); query.select.mockReturnValue(query); from.mockReturnValue(query);
  tableFlags.pastOrdersTableAvailable = true;
  const job: PendingPastOrderSyncJob = { id: 'job-a', localPastOrderId: 'local-a', existingPastOrderId: null, queuedAt: '2026-09-01T12:00:00Z', supplierId: 'supplier-a', supplierName: 'Supplier A', createdBy: 'employee-a', messageText: 'Order A', shareMethod: 'copy', payload: {}, lineItems: [], consumedOrderItemIds: [], consumedDraftItemIds: [], retryCount: 0, lastError: null };
  useOrderStore.setState({ pendingPastOrderSyncQueue: [job] });
  const syncing = useOrderStore.getState().flushPendingPastOrderSync();
  const replacement = { ...job, messageText: 'New version' };
  useOrderStore.setState({ pendingPastOrderSyncQueue: [replacement] });
  request.resolve({ data: { id: 'remote-a' }, error: null });
  await syncing;
  expect(useOrderStore.getState().pendingPastOrderSyncQueue).toEqual([replacement]);
  expect(useOrderStore.getState().pastOrders).toEqual([]);
});
