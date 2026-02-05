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
            areaItemsById: { ...get().areaItemsById, [areaId]: withStock },
          });
        } catch (error: any) {
          const cached = areaItemsById[areaId];
          if (cached) {
            set({
              currentAreaItems: cached,
              currentAreaId: areaId,
              currentItemIndex: 0,
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
          } catch (_) {
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
          });
        } catch (error: any) {
          set({ error: error?.message ?? 'Failed to start stock check session.' });
        } finally {
          set({ isLoading: false });
        }
      },

      completeSession: async () => {
        const { currentSession, currentAreaId } = get();
        if (!currentSession) return;

        const userId = useAuthStore.getState().user?.id ?? null;
        const completedAt = new Date().toISOString();

        set({ isLoading: true, error: null });
        try {
          if (get().isOnline) {
            await updateStockCheckSession(currentSession.id, {
              status: 'completed',
              completed_at: completedAt,
              items_checked: currentSession.items_checked,
              items_skipped: currentSession.items_skipped,
              items_total: currentSession.items_total,
            });

            if (currentAreaId) {
              await updateStorageAreaLastChecked(currentAreaId, {
                last_checked_at: completedAt,
                last_checked_by: userId,
              });
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

          set({ currentSession: null });
        } catch (error: any) {
          set({ error: error?.message ?? 'Failed to complete session.' });
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

          set({ currentSession: null });
        } catch (error: any) {
          set({ error: error?.message ?? 'Failed to abandon session.' });
        } finally {
          set({ isLoading: false });
        }
      },

      updateItemStock: async (areaItemId, quantity, method, options) => {
        const { currentAreaItems, isOnline } = get();
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
        const pendingUpdate: PendingUpdate = {
          id: `pending-${Date.now()}`,
          areaItemId,
          areaId: item.area_id,
          inventoryItemId: item.inventory_item_id,
          previousQuantity: item.current_quantity,
          newQuantity: quantity,
          updateMethod: method,
          quickSelectValue: options?.quickSelectValue ?? null,
          photoUrl: options?.photoUrl ?? null,
          notes: options?.notes ?? null,
          updatedBy: userId,
          createdAt: now,
        };

        set((state) => {
          const updatedItems = state.currentAreaItems.map((entry) =>
            entry.id === areaItemId
              ? {
                  ...entry,
                  current_quantity: quantity,
                  last_updated_at: now,
                  last_updated_by: userId,
                  stock_level: getStockLevel({
                    ...entry,
                    current_quantity: quantity,
                  }),
                }
              : entry
          );
          const areaId = item.area_id;
          return {
            currentAreaItems: updatedItems,
            areaItemsById: { ...state.areaItemsById, [areaId]: updatedItems },
            currentSession: state.currentSession
              ? {
                  ...state.currentSession,
                  items_checked: state.currentSession.items_checked + 1,
                }
              : state.currentSession,
          };
        });

        if (!isOnline) {
          get().queueUpdate(pendingUpdate);
          return;
        }

        try {
          await saveStockUpdate({
            area_id: item.area_id,
            inventory_item_id: item.inventory_item_id,
            previous_quantity: item.current_quantity,
            new_quantity: quantity,
            updated_by: userId,
            update_method: method,
            quick_select_value: options?.quickSelectValue ?? null,
            photo_url: options?.photoUrl ?? null,
            notes: options?.notes ?? null,
            created_at: now,
          });

          await updateAreaItemQuantity(areaItemId, quantity, {
            updated_by: userId,
            updated_at: now,
          });
        } catch (error: any) {
          get().queueUpdate(pendingUpdate);
          set({ error: error?.message ?? 'Failed to save stock update. Will retry.' });
        }
      },

      skipItem: () => {
        const { currentAreaItems, currentItemIndex, currentSession } = get();
        if (currentAreaItems.length === 0) return;

        const nextIndex = Math.min(currentItemIndex + 1, currentAreaItems.length - 1);
        set({ currentItemIndex: nextIndex });

        if (currentSession) {
          set({
            currentSession: {
              ...currentSession,
              items_skipped: currentSession.items_skipped + 1,
            },
          });
        }
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
          } catch (error) {
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
      }),
    }
  )
);
