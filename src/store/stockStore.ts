import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AreaItemWithDetails,
  CheckFrequency,
  QuickSelectRanges,
  QuickSelectValue,
  ReorderSuggestion,
  StockCheckSession,
  StockLevel,
  StockScanMethod,
  StockUpdateMethod,
  StorageAreaWithStatus,
} from '@/types';
import { useAuthStore } from '@/store/authStore';
import {
  createStockCheckSession,
  getAreaItems,
  getStorageAreas,
  saveStockUpdate,
  updateAreaItemQuantity,
  updateStockCheckSession,
  updateStorageAreaLastChecked,
} from '@/lib/api/stock';

export type SessionItemStatus = 'counted' | 'skipped';

export interface PendingUpdate {
  id: string;
  areaItemId: string;
  areaId: string;
  inventoryItemId: string;
  previousQuantity: number | null;
  newQuantity: number;
  updateMethod: StockUpdateMethod;
  quickSelectValue?: QuickSelectValue | null;
  photoUrl?: string | null;
  notes?: string | null;
  updatedBy: string;
  createdAt: string;
}

export interface SessionItemUpdate {
  areaItemId: string;
  areaId: string;
  areaName: string;
  inventoryItemId: string;
  itemName: string;
  unitType: string;
  previousQuantity: number;
  newQuantity: number;
  status: SessionItemStatus;
  updateMethod: StockUpdateMethod;
  quickSelectValue?: QuickSelectValue | null;
  photoUrl?: string | null;
  notes?: string | null;
  updatedBy: string;
  updatedAt: string;
}

export interface PausedStockSession {
  session: StockCheckSession;
  areaId: string;
  areaName: string;
  locationId: string | null;
  currentItemIndex: number;
  skippedItemCounts: Record<string, number>;
  sessionItemUpdates: Record<string, SessionItemUpdate>;
  pausedAt: string;
}

interface UpdateItemStockOptions {
  quickSelectValue?: QuickSelectValue | null;
  photoUrl?: string | null;
  notes?: string | null;
  updatedBy?: string | null;
}

interface StockState {
  storageAreas: StorageAreaWithStatus[];
  areaItemsById: Record<string, AreaItemWithDetails[]>;
  currentAreaItems: AreaItemWithDetails[];
  currentSession: StockCheckSession | null;
  currentAreaId: string | null;
  currentItemIndex: number;
  isLoading: boolean;
  error: string | null;
  pendingUpdates: PendingUpdate[];
  isOnline: boolean;
  lastSyncAt: string | null;
  skippedItemCounts: Record<string, number>;
  sessionItemUpdates: Record<string, SessionItemUpdate>;
  pausedSession: PausedStockSession | null;
  sessionNotice: string | null;

  fetchStorageAreas: (locationId: string) => Promise<void>;
  fetchAreaItems: (areaId: string) => Promise<void>;
  prefetchAreaItems: (areaIds: string[]) => Promise<void>;
  startSession: (areaId: string, scanMethod: StockScanMethod) => Promise<void>;
  completeSession: () => Promise<void>;
  abandonSession: () => Promise<void>;
  updateItemStock: (
    areaItemId: string,
    quantity: number,
    method: StockUpdateMethod,
    options?: UpdateItemStockOptions
  ) => Promise<void>;
  skipItem: () => void;
  nextItem: () => void;
  previousItem: () => void;
  goToItem: (index: number) => void;
  setSessionItemQuantity: (areaItemId: string, quantity: number) => void;
  getSessionItemUpdates: (areaId?: string | null) => SessionItemUpdate[];
  pauseCurrentSession: (locationId: string | null) => void;
  resumePausedSession: (areaId?: string | null) => boolean;
  discardPausedSession: () => void;
  setSessionNotice: (message: string | null) => void;
  queueUpdate: (update: PendingUpdate) => void;
  syncPendingUpdates: () => Promise<void>;
  setOnlineStatus: (isOnline: boolean) => void;

  getReorderSuggestions: () => ReorderSuggestion[];
}

const CHECK_FREQUENCY_DAYS: Record<CheckFrequency, number> = {
  daily: 1,
  every_2_days: 2,
  every_3_days: 3,
  weekly: 7,
};

export function getCheckStatus(area: {
  last_checked_at: string | null;
  check_frequency: CheckFrequency;
}): StorageAreaWithStatus['check_status'] {
  if (!area.last_checked_at) return 'overdue';

  const lastChecked = new Date(area.last_checked_at).getTime();
  if (Number.isNaN(lastChecked)) return 'overdue';

  const intervalDays = CHECK_FREQUENCY_DAYS[area.check_frequency];
  const diffDays = (Date.now() - lastChecked) / (1000 * 60 * 60 * 24);

  if (diffDays >= intervalDays) return 'overdue';

  const dueSoonThreshold = intervalDays * 0.75;
  if (diffDays >= dueSoonThreshold) return 'due_soon';

  return 'ok';
}

export function getStockLevel(item: {
  current_quantity: number;
  min_quantity: number;
  max_quantity: number;
}): StockLevel {
  const current = item.current_quantity;
  const min = item.min_quantity;
  const max = item.max_quantity;

  if (current <= 0) return 'empty';
  if (current < min) return 'critical';
  if (current >= max) return 'full';

  const midpoint = min + (max - min) * 0.5;
  if (current < midpoint) return 'low';

  return 'good';
}

export function getQuickSelectRanges(min: number, max: number): QuickSelectRanges {
  const safeMin = Math.max(0, Math.round(min));
  const safeMax = Math.max(safeMin, Math.round(max));

  if (safeMax === 0) {
    return {
      empty: { min: 0, max: 0 },
      low: { min: 0, max: 0 },
      good: { min: 0, max: 0 },
      full: { min: 0, max: 0 },
    };
  }

  const lowMax = safeMin > 0 ? safeMin : Math.max(1, Math.round(safeMax * 0.3));
  const goodMin = Math.min(lowMax + 1, safeMax);
  const goodMax = Math.max(goodMin, Math.round((safeMin + safeMax) / 2));
  const fullMin = Math.min(Math.max(goodMax + 1, safeMax), safeMax);

  return {
    empty: { min: 0, max: 0 },
    low: { min: 1, max: Math.max(1, lowMax) },
    good: { min: goodMin, max: Math.max(goodMin, Math.min(goodMax, safeMax)) },
    full: { min: fullMin, max: safeMax },
  };
}

function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function applySessionUpdatesToItems(
  items: AreaItemWithDetails[],
  updates: Record<string, SessionItemUpdate>
): AreaItemWithDetails[] {
  return items.map((item) => {
    const sessionEntry = updates[item.id];
    if (!sessionEntry) return item;

    const nextQuantity =
      sessionEntry.status === 'counted' ? sessionEntry.newQuantity : sessionEntry.previousQuantity;

    return {
      ...item,
      current_quantity: nextQuantity,
      last_updated_at: sessionEntry.updatedAt,
      last_updated_by: sessionEntry.updatedBy,
      stock_level: getStockLevel({
        ...item,
        current_quantity: nextQuantity,
      }),
    };
  });
}

export const useStockStore = create<StockState>()(
  persist(
    (set, get) => ({
      storageAreas: [],
      areaItemsById: {},
      currentAreaItems: [],
      currentSession: null,
      currentAreaId: null,
      currentItemIndex: 0,
      isLoading: false,
      error: null,
      pendingUpdates: [],
      isOnline: true,
      lastSyncAt: null,
      skippedItemCounts: {},
      sessionItemUpdates: {},
      pausedSession: null,
      sessionNotice: null,

      fetchStorageAreas: async (locationId) => {
        set({ isLoading: true, error: null });
        try {
          const areas = await getStorageAreas(locationId);
          const withStatus = areas.map((area) => ({
            ...area,
            check_status: getCheckStatus(area),
          }));
          set({ storageAreas: withStatus });
        } catch (error: any) {
          set({ error: error?.message ?? 'Failed to load storage areas.' });
        } finally {
          set({ isLoading: false });
        }
      },

      fetchAreaItems: async (areaId) => {
        const { isOnline, areaItemsById } = get();
        if (!isOnline) {
          const cached = areaItemsById[areaId];
          if (cached) {
            set({
              currentAreaItems: cached,
              currentAreaId: areaId,
              currentItemIndex: 0,
              skippedItemCounts: {},
              sessionItemUpdates: {},
              error: 'Offline mode: showing cached data.',
            });
            return;
          }
        }

        set({ isLoading: true, error: null });
        try {
          const items = await getAreaItems(areaId);
          const withStock = items.map((item) => ({
            ...item,
            stock_level: getStockLevel(item),
          }));
          set({
            currentAreaItems: withStock,
            currentAreaId: areaId,
            currentItemIndex: 0,
            skippedItemCounts: {},
            sessionItemUpdates: {},
            areaItemsById: { ...get().areaItemsById, [areaId]: withStock },
          });
        } catch (error: any) {
          const cached = areaItemsById[areaId];
          if (cached) {
            set({
              currentAreaItems: cached,
              currentAreaId: areaId,
              currentItemIndex: 0,
              skippedItemCounts: {},
              sessionItemUpdates: {},
              error: 'Offline mode: showing cached data.',
            });
          } else {
            set({ error: error?.message ?? 'Failed to load area items.' });
          }
        } finally {
          set({ isLoading: false });
        }
      },

      prefetchAreaItems: async (areaIds) => {
        if (!get().isOnline || areaIds.length === 0) return;
        for (const areaId of areaIds) {
          try {
            const items = await getAreaItems(areaId);
            const withStock = items.map((item) => ({
              ...item,
              stock_level: getStockLevel(item),
            }));
            set((state) => ({
              areaItemsById: { ...state.areaItemsById, [areaId]: withStock },
            }));
          } catch {
            // Ignore prefetch failures
          }
        }
      },

      startSession: async (areaId, scanMethod) => {
        const userId = useAuthStore.getState().user?.id;
        if (!userId) {
          set({ error: 'User not available. Please sign in again.' });
          return;
        }

        set({ isLoading: true, error: null });
        try {
          const itemsTotal = get().currentAreaId === areaId ? get().currentAreaItems.length : 0;
          const session = await createStockCheckSession({
            area_id: areaId,
            user_id: userId,
            scan_method: scanMethod,
            items_total: itemsTotal,
          });
          set({
            currentSession: session,
            currentAreaId: areaId,
            currentItemIndex: 0,
            skippedItemCounts: {},
            sessionItemUpdates: {},
            pausedSession: null,
          });
        } catch (error: any) {
          set({ error: error?.message ?? 'Failed to start stock check session.' });
        } finally {
          set({ isLoading: false });
        }
      },

      completeSession: async () => {
        const { currentSession, currentAreaId, sessionItemUpdates, isOnline } = get();
        if (!currentSession) return;

        const userId = useAuthStore.getState().user?.id ?? null;
        const completedAt = new Date().toISOString();
        const sessionUpdates = Object.values(sessionItemUpdates);
        const countedItems = sessionUpdates.filter((entry) => entry.status === 'counted');
        const skippedItems = sessionUpdates.filter((entry) => entry.status === 'skipped');
        let syncError = false;

        set({ isLoading: true, error: null });
        try {
          for (const entry of countedItems) {
            const payload: PendingUpdate = {
              id: `pending-${entry.areaItemId}`,
              areaItemId: entry.areaItemId,
              areaId: entry.areaId,
              inventoryItemId: entry.inventoryItemId,
              previousQuantity: entry.previousQuantity,
              newQuantity: entry.newQuantity,
              updateMethod: entry.updateMethod,
              quickSelectValue: entry.quickSelectValue ?? null,
              photoUrl: entry.photoUrl ?? null,
              notes: entry.notes ?? null,
              updatedBy: entry.updatedBy,
              createdAt: entry.updatedAt,
            };

            if (!isOnline) {
              get().queueUpdate(payload);
              continue;
            }

            try {
              await saveStockUpdate({
                area_id: entry.areaId,
                inventory_item_id: entry.inventoryItemId,
                previous_quantity: entry.previousQuantity,
                new_quantity: entry.newQuantity,
                updated_by: entry.updatedBy,
                update_method: entry.updateMethod,
                quick_select_value: entry.quickSelectValue ?? null,
                photo_url: entry.photoUrl ?? null,
                notes: entry.notes ?? null,
                created_at: entry.updatedAt,
              });

              await updateAreaItemQuantity(entry.areaItemId, entry.newQuantity, {
                updated_by: entry.updatedBy,
                updated_at: entry.updatedAt,
              });
            } catch {
              syncError = true;
              get().queueUpdate(payload);
            }
          }

          if (isOnline) {
            try {
              await updateStockCheckSession(currentSession.id, {
                status: 'completed',
                completed_at: completedAt,
                items_checked: countedItems.length,
                items_skipped: skippedItems.length,
                items_total: currentSession.items_total,
              });
            } catch {
              syncError = true;
            }

            if (currentAreaId) {
              try {
                await updateStorageAreaLastChecked(currentAreaId, {
                  last_checked_at: completedAt,
                  last_checked_by: userId,
                });
              } catch {
                syncError = true;
              }
            }
          }

          if (currentAreaId) {
            set((state) => ({
              storageAreas: state.storageAreas.map((area) =>
                area.id === currentAreaId
                  ? {
                      ...area,
                      last_checked_at: completedAt,
                      last_checked_by: userId,
                      check_status: 'ok',
                    }
                  : area
              ),
            }));
          }

          set({
            currentSession: null,
            currentItemIndex: 0,
            skippedItemCounts: {},
            sessionItemUpdates: {},
            pausedSession: null,
            error: syncError ? 'Some stock updates will sync later.' : null,
          });
        } catch (error: any) {
          set({ error: error?.message ?? 'Failed to complete session.', isLoading: false });
          return;
        } finally {
          set({ isLoading: false });
        }
      },

      abandonSession: async () => {
        const { currentSession } = get();
        if (!currentSession) return;

        set({ isLoading: true, error: null });
        try {
          if (get().isOnline) {
            await updateStockCheckSession(currentSession.id, {
              status: 'abandoned',
              completed_at: new Date().toISOString(),
              items_checked: currentSession.items_checked,
              items_skipped: currentSession.items_skipped,
              items_total: currentSession.items_total,
            });
          }

          set({
            currentSession: null,
            currentItemIndex: 0,
            skippedItemCounts: {},
            sessionItemUpdates: {},
            pausedSession: null,
          });
        } catch (error: any) {
          set({ error: error?.message ?? 'Failed to abandon session.' });
        } finally {
          set({ isLoading: false });
        }
      },

      updateItemStock: async (areaItemId, quantity, method, options) => {
        const { currentAreaItems } = get();
        const item = currentAreaItems.find((entry) => entry.id === areaItemId);

        if (!item) {
          set({ error: 'Item not found in current area.' });
          return;
        }

        const userId = options?.updatedBy ?? useAuthStore.getState().user?.id;
        if (!userId) {
          set({ error: 'User not available. Please sign in again.' });
          return;
        }

        set({ error: null });
        const now = new Date().toISOString();
        const nextQuantity = normalizeQuantity(quantity);
        const sessionEntry = get().sessionItemUpdates[areaItemId];
        const previousQuantity = sessionEntry?.previousQuantity ?? item.current_quantity;
        const previousStatus = sessionEntry?.status ?? null;

        set((state) => {
          const updatedCurrentItems = state.currentAreaItems.map((entry) =>
            entry.id === areaItemId
              ? {
                  ...entry,
                  current_quantity: nextQuantity,
                  last_updated_at: now,
                  last_updated_by: userId,
                  stock_level: getStockLevel({
                    ...entry,
                    current_quantity: nextQuantity,
                  }),
                }
              : entry
          );

          const areaId = item.area_id;
          const updatedAreaItems = (state.areaItemsById[areaId] || []).map((entry) =>
            entry.id === areaItemId
              ? {
                  ...entry,
                  current_quantity: nextQuantity,
                  last_updated_at: now,
                  last_updated_by: userId,
                  stock_level: getStockLevel({
                    ...entry,
                    current_quantity: nextQuantity,
                  }),
                }
              : entry
          );
          const areaName =
            state.storageAreas.find((area) => area.id === item.area_id)?.name ?? item.area_id;
          const nextSessionEntry: SessionItemUpdate = {
            areaItemId,
            areaId: item.area_id,
            areaName,
            inventoryItemId: item.inventory_item_id,
            itemName: item.inventory_item.name,
            unitType: item.unit_type,
            previousQuantity,
            newQuantity: nextQuantity,
            status: 'counted',
            updateMethod: method,
            quickSelectValue: options?.quickSelectValue ?? null,
            photoUrl: options?.photoUrl ?? null,
            notes: options?.notes ?? null,
            updatedBy: userId,
            updatedAt: now,
          };

          const checkedDelta = previousStatus === 'counted' ? 0 : 1;
          const skippedDelta = previousStatus === 'skipped' ? -1 : 0;
          return {
            currentAreaItems: updatedCurrentItems,
            areaItemsById: { ...state.areaItemsById, [areaId]: updatedAreaItems },
            sessionItemUpdates: {
              ...state.sessionItemUpdates,
              [areaItemId]: nextSessionEntry,
            },
            currentSession: state.currentSession
              ? {
                  ...state.currentSession,
                  items_checked: Math.max(0, state.currentSession.items_checked + checkedDelta),
                  items_skipped: Math.max(0, state.currentSession.items_skipped + skippedDelta),
                }
              : state.currentSession,
          };
        });
      },

      skipItem: () => {
        const { currentAreaItems, currentItemIndex, currentSession, skippedItemCounts, currentAreaId } =
          get();
        if (currentAreaItems.length === 0) return;

        const item = currentAreaItems[currentItemIndex];
        if (!item) return;

        const prevCount = skippedItemCounts[item.id] ?? 0;
        const nextCount = Math.min(prevCount + 1, 2);
        const nextCounts = { ...skippedItemCounts, [item.id]: nextCount };
        const shouldCountAsSkipped = nextCount === 2;
        const previousSessionEntry = get().sessionItemUpdates[item.id];
        const skipUserId =
          useAuthStore.getState().user?.id ??
          currentSession?.user_id ??
          previousSessionEntry?.updatedBy ??
          item.last_updated_by ??
          'system';
        const now = new Date().toISOString();
        const resetQuantity = previousSessionEntry?.previousQuantity ?? item.current_quantity;

        const reordered = [...currentAreaItems];
        reordered.splice(currentItemIndex, 1);
        reordered.push(
          shouldCountAsSkipped
            ? {
                ...item,
                current_quantity: resetQuantity,
                last_updated_at: now,
                last_updated_by: skipUserId,
                stock_level: getStockLevel({
                  ...item,
                  current_quantity: resetQuantity,
                }),
              }
            : item
        );

        const nextIndex = currentItemIndex < reordered.length - 1 ? currentItemIndex : 0;

        set((state) => ({
          currentAreaItems: reordered,
          areaItemsById: currentAreaId
            ? { ...state.areaItemsById, [currentAreaId]: reordered }
            : state.areaItemsById,
          currentItemIndex: nextIndex,
          skippedItemCounts: nextCounts,
          sessionItemUpdates: shouldCountAsSkipped
            ? {
                ...state.sessionItemUpdates,
                [item.id]: {
                  areaItemId: item.id,
                  areaId: item.area_id,
                  areaName:
                    state.storageAreas.find((area) => area.id === item.area_id)?.name ??
                    item.area_id,
                  inventoryItemId: item.inventory_item_id,
                  itemName: item.inventory_item.name,
                  unitType: item.unit_type,
                  previousQuantity: resetQuantity,
                  newQuantity: resetQuantity,
                  status: 'skipped',
                  updateMethod: previousSessionEntry?.updateMethod ?? 'manual',
                  quickSelectValue: previousSessionEntry?.quickSelectValue ?? null,
                  photoUrl: previousSessionEntry?.photoUrl ?? null,
                  notes: previousSessionEntry?.notes ?? null,
                  updatedBy: skipUserId,
                  updatedAt: now,
                },
              }
            : state.sessionItemUpdates,
          currentSession:
            state.currentSession
              ? {
                  ...state.currentSession,
                  items_checked:
                    shouldCountAsSkipped && previousSessionEntry?.status === 'counted'
                      ? Math.max(0, state.currentSession.items_checked - 1)
                      : state.currentSession.items_checked,
                  items_skipped:
                    !shouldCountAsSkipped
                      ? state.currentSession.items_skipped
                      : previousSessionEntry?.status === 'counted'
                        ? state.currentSession.items_skipped + 1
                        : previousSessionEntry?.status === 'skipped'
                          ? state.currentSession.items_skipped
                          : state.currentSession.items_skipped + 1,
                }
              : state.currentSession,
        }));
      },

      nextItem: () => {
        const { currentAreaItems, currentItemIndex } = get();
        if (currentAreaItems.length === 0) return;

        set({ currentItemIndex: Math.min(currentItemIndex + 1, currentAreaItems.length - 1) });
      },

      previousItem: () => {
        const { currentItemIndex } = get();
        set({ currentItemIndex: Math.max(currentItemIndex - 1, 0) });
      },

      goToItem: (index) => {
        const { currentAreaItems } = get();
        if (index < 0 || index >= currentAreaItems.length) return;
        set({ currentItemIndex: index });
      },

      setSessionItemQuantity: (areaItemId, quantity) => {
        const nextQuantity = normalizeQuantity(quantity);
        const existing = get().sessionItemUpdates[areaItemId];
        if (!existing || existing.status !== 'counted') return;

        const now = new Date().toISOString();

        set((state) => {
          const nextSessionItem: SessionItemUpdate = {
            ...existing,
            newQuantity: nextQuantity,
            updatedAt: now,
          };

          const updateItem = (entry: AreaItemWithDetails) =>
            entry.id === areaItemId
              ? {
                  ...entry,
                  current_quantity: nextQuantity,
                  last_updated_at: now,
                  last_updated_by: nextSessionItem.updatedBy,
                  stock_level: getStockLevel({
                    ...entry,
                    current_quantity: nextQuantity,
                  }),
                }
              : entry;

          const nextCurrentAreaItems =
            state.currentAreaId === existing.areaId
              ? state.currentAreaItems.map(updateItem)
              : state.currentAreaItems;
          const nextAreaItems = (state.areaItemsById[existing.areaId] || []).map(updateItem);

          return {
            sessionItemUpdates: {
              ...state.sessionItemUpdates,
              [areaItemId]: nextSessionItem,
            },
            currentAreaItems: nextCurrentAreaItems,
            areaItemsById: {
              ...state.areaItemsById,
              [existing.areaId]: nextAreaItems,
            },
          };
        });
      },

      getSessionItemUpdates: (areaId) => {
        const updates = Object.values(get().sessionItemUpdates);
        if (!areaId) return updates;
        return updates.filter((entry) => entry.areaId === areaId);
      },

      pauseCurrentSession: (locationId) => {
        const {
          currentSession,
          currentAreaId,
          currentItemIndex,
          skippedItemCounts,
          sessionItemUpdates,
          storageAreas,
        } = get();

        if (!currentSession || !currentAreaId) return;

        const areaName =
          storageAreas.find((area) => area.id === currentAreaId)?.name ?? currentAreaId;

        const pausedSession: PausedStockSession = {
          session: currentSession,
          areaId: currentAreaId,
          areaName,
          locationId,
          currentItemIndex,
          skippedItemCounts: { ...skippedItemCounts },
          sessionItemUpdates: { ...sessionItemUpdates },
          pausedAt: new Date().toISOString(),
        };

        set({
          pausedSession,
          currentSession: null,
          currentAreaId: null,
          currentAreaItems: [],
          currentItemIndex: 0,
          skippedItemCounts: {},
          sessionItemUpdates: {},
        });
      },

      resumePausedSession: (areaId) => {
        const { pausedSession, areaItemsById } = get();
        if (!pausedSession) return false;
        if (areaId && pausedSession.areaId !== areaId) return false;

        const cachedAreaItems = areaItemsById[pausedSession.areaId] ?? [];
        const hydratedAreaItems = applySessionUpdatesToItems(
          cachedAreaItems,
          pausedSession.sessionItemUpdates
        );
        const maxIndex = Math.max(0, hydratedAreaItems.length - 1);
        const restoredIndex = hydratedAreaItems.length
          ? Math.min(pausedSession.currentItemIndex, maxIndex)
          : 0;

        set((state) => ({
          currentSession: pausedSession.session,
          currentAreaId: pausedSession.areaId,
          currentAreaItems: hydratedAreaItems,
          currentItemIndex: restoredIndex,
          skippedItemCounts: { ...pausedSession.skippedItemCounts },
          sessionItemUpdates: { ...pausedSession.sessionItemUpdates },
          areaItemsById: {
            ...state.areaItemsById,
            [pausedSession.areaId]: hydratedAreaItems,
          },
          pausedSession: null,
        }));

        return true;
      },

      discardPausedSession: () => {
        set({ pausedSession: null });
      },

      setSessionNotice: (message) => {
        set({ sessionNotice: message });
      },

      queueUpdate: (update) => {
        set((state) => {
          const existingIndex = state.pendingUpdates.findIndex(
            (entry) => entry.areaItemId === update.areaItemId
          );

          if (existingIndex >= 0) {
            const next = [...state.pendingUpdates];
            next[existingIndex] = { ...update, id: state.pendingUpdates[existingIndex].id };
            return { pendingUpdates: next };
          }

          return { pendingUpdates: [...state.pendingUpdates, update] };
        });
      },

      syncPendingUpdates: async () => {
        const { pendingUpdates, isOnline } = get();
        if (!isOnline || pendingUpdates.length === 0) return;

        set({ isLoading: true, error: null });

        const sorted = [...pendingUpdates].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        const remaining: PendingUpdate[] = [];

        for (const update of sorted) {
          try {
            await saveStockUpdate({
              area_id: update.areaId,
              inventory_item_id: update.inventoryItemId,
              previous_quantity: update.previousQuantity,
              new_quantity: update.newQuantity,
              updated_by: update.updatedBy,
              update_method: update.updateMethod,
              quick_select_value: update.quickSelectValue ?? null,
              photo_url: update.photoUrl ?? null,
              notes: update.notes ?? null,
              created_at: update.createdAt,
            });

            await updateAreaItemQuantity(update.areaItemId, update.newQuantity, {
              updated_by: update.updatedBy,
              updated_at: update.createdAt,
            });
          } catch {
            remaining.push(update);
          }
        }

        set({
          pendingUpdates: remaining,
          lastSyncAt: remaining.length === 0 ? new Date().toISOString() : get().lastSyncAt,
          isLoading: false,
          error: remaining.length === 0 ? null : 'Some updates failed to sync.',
        });
      },

      setOnlineStatus: (isOnline) => {
        set({ isOnline });
        if (isOnline) {
          get().syncPendingUpdates();
        }
      },

      getReorderSuggestions: () => {
        const { currentAreaItems } = get();
        return currentAreaItems
          .filter((item) => item.current_quantity < item.min_quantity)
          .map((item) => {
            const stockLevel = getStockLevel(item);
            const urgency = stockLevel === 'empty' ? 'high' : 'medium';
            return {
              areaItem: item,
              reorderQuantity: Math.max(item.max_quantity - item.current_quantity, 0),
              urgency,
            };
          });
      },
    }),
    {
      name: 'stock-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        storageAreas: state.storageAreas,
        areaItemsById: state.areaItemsById,
        pendingUpdates: state.pendingUpdates,
        lastSyncAt: state.lastSyncAt,
        pausedSession: state.pausedSession,
      }),
    }
  )
);
