import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAreaItems, getStorageAreas } from '@/lib/api/stock';
import type { ItemCategory, UnitType } from '@/types';
import type {
  AreaProgress,
  StockCheckArea,
  StockCheckItem,
  StockCheckProgress,
  StockCheckStatus,
} from './types';
import { computeNeedToOrder, totalStockInBase } from './utils/stockMath';

const STORAGE_KEY = 'stock-check-store-v1';
const STORAGE_VERSION = 1;
/** How long offline-edited UI state is retained per location (7 days). */
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface PersistedRow {
  orderQuantity: number;
  checked: boolean;
  checkedAt?: number | null;
  hasNote: boolean;
  noteText: string;
  /**
   * Optional so older caches keep loading. When absent, hydration falls
   * back to the inventory item's configured `unit_type` or 'pack'.
   */
  unitType?: UnitType;
  /**
   * Wheel-picker stock entry (introduced with the Set-Stock bottom sheet).
   * Optional so older caches keep loading; absence is treated as "no stock
   * entry yet" and the row hydrates to (configured unit, 0, 0).
   */
  stockUnit?: UnitType;
  stockAmount?: number;
  stockPieces?: number;
}

interface PersistedLocationState {
  rows: Record<string, PersistedRow>;
  selectedAreaId: string | null;
  /**
   * Legacy field from a previous build that auto-sorted checked items to
   * the bottom. The behavior has been reverted (items now stay in place).
   * The field is kept optional purely so we can read older caches without
   * crashing — it is no longer written on save.
   */
  checkedOrder?: string[];
  cachedAt: number;
}

interface StockCheckState {
  /** Current location loaded into the UI. */
  locationId: string | null;
  /** All areas for the location, in display order. */
  areas: StockCheckArea[];
  /** Items keyed by id for O(1) updates. */
  itemsById: Record<string, StockCheckItem>;
  /** Currently focused storage-area pill. */
  selectedAreaId: string | null;
  /** Currently expanded note editor (single-edit-at-a-time UX). */
  expandingItemId: string | null;
  /** Persisted offline edits per location. */
  perLocationState: Record<string, PersistedLocationState>;
  /** Loading + error UI flags. */
  isLoading: boolean;
  loadError: string | null;

  loadLocation: (locationId: string) => Promise<void>;
  selectArea: (areaId: string) => void;
  setExpandingItem: (itemId: string | null) => void;
  incrementItem: (itemId: string) => void;
  decrementItem: (itemId: string) => void;
  /**
   * Swipe-right shortcut: "this item is fully stocked, nothing to order".
   * Sets `orderQuantity = 0` and `status = 'at_par'` regardless of par level.
   */
  markFull: (itemId: string) => void;
  /**
   * Swipe-left shortcut: "this item is fully out". Sets the order quantity
   * to `parLevel` and `status = 'needs_order'`.
   */
  markEmpty: (itemId: string) => void;
  setItemNote: (itemId: string, noteText: string) => void;
  clearItemNote: (itemId: string) => void;
  /**
   * Swap the active unit type for one item (Pack ↔ Base). The selection is
   * persisted offline so re-entering the screen keeps the choice.
   */
  setItemUnitType: (itemId: string, unitType: UnitType) => void;
  /**
   * Atomic write from the Set-Stock bottom sheet. Persists the wheel-picker
   * triple, derives `orderQuantity` from it, marks the row `checked`, and
   * recomputes `status` in a single `set` call so subscribers see one
   * coherent update.
   */
  commitStockEntry: (
    itemId: string,
    entry: { stockUnit: UnitType; stockAmount: number; stockPieces: number },
  ) => void;
  resetSelection: () => void;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Pure helpers (testable, side-effect free)
 * ──────────────────────────────────────────────────────────────────────── */

export function deriveStatus(
  parLevel: number,
  orderQuantity: number,
  checked: boolean,
): StockCheckStatus {
  if (!checked) return 'unchecked';
  if (orderQuantity <= 0) return 'needs_order';
  if (orderQuantity >= parLevel) return 'at_par';
  return 'low';
}

/**
 * Suggested order amount displayed in the subtitle. For `needs_order`
 * (out-of-stock, user hasn't typed a count yet) we surface `parLevel` as the
 * sensible suggestion — matches "Heavy Cream · order 4" in the design spec.
 */
export function deriveDisplayedOrder(item: {
  parLevel: number;
  orderQuantity: number;
  status: StockCheckStatus;
}): number {
  if (item.status === 'needs_order' && item.orderQuantity <= 0) {
    return item.parLevel;
  }
  return item.orderQuantity;
}

export function computeAreaProgress(
  area: StockCheckArea,
  itemsById: Record<string, StockCheckItem>,
): AreaProgress {
  let checked = 0;
  let toOrder = 0;
  for (const id of area.itemIds) {
    const it = itemsById[id];
    if (!it) continue;
    if (it.checked) checked += 1;
    if (it.status === 'needs_order' || it.status === 'low') toOrder += 1;
  }
  return {
    areaId: area.id,
    areaName: area.name,
    totalItems: area.itemIds.length,
    checkedItems: checked,
    itemsToOrder: toOrder,
  };
}

export function computeOverallProgress(
  areas: StockCheckArea[],
  itemsById: Record<string, StockCheckItem>,
): StockCheckProgress {
  let total = 0;
  let checked = 0;
  let toOrder = 0;
  for (const area of areas) {
    total += area.itemIds.length;
    for (const id of area.itemIds) {
      const it = itemsById[id];
      if (!it) continue;
      if (it.checked) checked += 1;
      if (it.status === 'needs_order' || it.status === 'low') toOrder += 1;
    }
  }
  return { totalItems: total, checkedItems: checked, itemsToOrder: toOrder };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Store
 * ──────────────────────────────────────────────────────────────────────── */

const INITIAL_STATE: Pick<
  StockCheckState,
  | 'locationId'
  | 'areas'
  | 'itemsById'
  | 'selectedAreaId'
  | 'expandingItemId'
  | 'perLocationState'
  | 'isLoading'
  | 'loadError'
> = {
  locationId: null,
  areas: [],
  itemsById: {},
  selectedAreaId: null,
  expandingItemId: null,
  perLocationState: {},
  isLoading: false,
  loadError: null,
};

export const useStockCheckStore = create<StockCheckState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      loadLocation: async (locationId) => {
        if (!locationId) {
          set({ ...INITIAL_STATE });
          return;
        }

        set({ isLoading: true, loadError: null });

        try {
          const storageAreas = await getStorageAreas(locationId);
          const sorted = [...storageAreas].sort(
            (a, b) =>
              (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
              a.name.localeCompare(b.name),
          );

          const areaItemsResults = await Promise.all(
            sorted.map((area) => getAreaItems(area.id).catch(() => [])),
          );

          const persisted = get().perLocationState[locationId];
          const cachedRows = persisted?.rows ?? {};

          const itemsById: Record<string, StockCheckItem> = {};
          const areas: StockCheckArea[] = sorted.map((area, index) => {
            const rows = areaItemsResults[index] ?? [];
            const itemIds: string[] = [];
            for (const row of rows) {
              const inv = row.inventory_item;
              if (!inv) continue;
              const id = row.id;
              const par = Number(row.par_level ?? row.max_quantity ?? 0) || 0;
              const cached = cachedRows[id];
              const orderQty = cached?.orderQuantity ?? 0;
              const checked = cached?.checked ?? false;
              const checkedAt =
                typeof cached?.checkedAt === 'number' ? cached.checkedAt : null;
              const hasNote = cached?.hasNote ?? false;
              const noteText = cached?.noteText ?? '';
              const status = deriveStatus(par, orderQty, checked);

              // Resolve unit metadata. The configured `row.unit_type` from
              // `area_items` is the inventory team's preferred default; any
              // user override stored in the offline cache wins.
              const packUnit = inv.pack_unit ?? '';
              const baseUnit = inv.base_unit ?? '';
              const packSize = Number(inv.pack_size ?? 0) || 0;
              const configuredUnitType: UnitType =
                row.unit_type === 'base' ? 'base' : 'pack';
              const unitType: UnitType =
                cached?.unitType ?? configuredUnitType;
              // Hydrate the wheel-picker triple. Older caches missing these
              // fields fall back to the configured unit + zero stock so the
              // sheet always opens to a valid position.
              const stockUnit: UnitType = cached?.stockUnit ?? unitType;
              const stockAmount =
                Number.isFinite(cached?.stockAmount)
                  ? Math.max(0, Math.trunc(cached!.stockAmount as number))
                  : 0;
              const stockPieces =
                Number.isFinite(cached?.stockPieces)
                  ? Math.max(0, Math.trunc(cached!.stockPieces as number))
                  : 0;
              itemsById[id] = {
                id,
                name: inv.name,
                category: inv.category as ItemCategory,
                areaId: area.id,
                areaName: area.name,
                parLevel: par,
                unitType,
                packUnit,
                baseUnit,
                packSize,
                orderQuantity: orderQty,
                checked,
                checkedAt,
                hasNote,
                noteText,
                status,
                stockUnit,
                stockAmount,
                stockPieces,
              };
              itemIds.push(id);
            }
            return {
              id: area.id,
              name: area.name,
              sortOrder: area.sort_order ?? index,
              itemIds,
            };
          });

          const previouslySelected = persisted?.selectedAreaId ?? null;
          const selectedAreaId =
            previouslySelected && areas.some((a) => a.id === previouslySelected)
              ? previouslySelected
              : (areas[0]?.id ?? null);

          set({
            locationId,
            areas,
            itemsById,
            selectedAreaId,
            isLoading: false,
            loadError: null,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to load stock check';
          set({ isLoading: false, loadError: message });
        }
      },

      selectArea: (areaId) => {
        const { selectedAreaId, locationId, perLocationState } = get();
        if (selectedAreaId === areaId) return;
        set({
          selectedAreaId: areaId,
          expandingItemId: null,
          perLocationState: locationId
            ? {
                ...perLocationState,
                [locationId]: {
                  ...(perLocationState[locationId] ?? {
                    rows: {},
                    selectedAreaId: null,
                    cachedAt: Date.now(),
                  }),
                  selectedAreaId: areaId,
                  cachedAt: Date.now(),
                },
              }
            : perLocationState,
        });
      },

      setExpandingItem: (itemId) => {
        set({ expandingItemId: itemId });
      },

      incrementItem: (itemId) => {
        const state = get();
        const item = state.itemsById[itemId];
        if (!item) return;
        const next: StockCheckItem = {
          ...item,
          orderQuantity: item.orderQuantity + 1,
          checked: true,
          checkedAt: Date.now(),
          status: deriveStatus(item.parLevel, item.orderQuantity + 1, true),
        };
        set(applyItemUpdate(state, next));
      },

      decrementItem: (itemId) => {
        const state = get();
        const item = state.itemsById[itemId];
        if (!item) return;
        if (!item.checked) {
          // First decrement on an unchecked row marks it "needs order" (count = 0).
          const next: StockCheckItem = {
            ...item,
            orderQuantity: 0,
            checked: true,
            checkedAt: Date.now(),
            status: deriveStatus(item.parLevel, 0, true),
          };
          set(applyItemUpdate(state, next));
          return;
        }
        const nextQty = Math.max(0, item.orderQuantity - 1);
        const next: StockCheckItem = {
          ...item,
          orderQuantity: nextQty,
          checkedAt: item.checkedAt ?? Date.now(),
          status: deriveStatus(item.parLevel, nextQty, true),
        };
        set(applyItemUpdate(state, next));
      },

      markFull: (itemId) => {
        const state = get();
        const item = state.itemsById[itemId];
        if (!item) return;
        if (item.checked && item.orderQuantity === 0 && item.status === 'at_par') {
          return;
        }
        // "Full" → set the wheel-picker triple so re-opening the sheet for
        // this row shows par-level stock dialed in. Keeping the wheel state
        // coherent with the row's status is critical: anything else would
        // make the sheet open to "0 0 0" and the user would lose the swipe
        // shortcut's effect when they tap > to fine-tune.
        const par = Math.max(0, item.parLevel);
        const next: StockCheckItem = {
          ...item,
          stockUnit: item.unitType,
          stockAmount: par,
          stockPieces: 0,
          orderQuantity: 0,
          checked: true,
          checkedAt: Date.now(),
          status: 'at_par',
        };
        set(applyItemUpdate(state, next));
      },

      markEmpty: (itemId) => {
        const state = get();
        const item = state.itemsById[itemId];
        if (!item) return;
        const par = Math.max(0, item.parLevel);
        if (
          item.checked &&
          item.orderQuantity === par &&
          item.status === 'needs_order'
        ) {
          return;
        }
        // "Empty" → wheel triple goes to 0/0 with the configured unit, and
        // the deficit equals par.
        const next: StockCheckItem = {
          ...item,
          stockUnit: item.unitType,
          stockAmount: 0,
          stockPieces: 0,
          orderQuantity: par,
          checked: true,
          checkedAt: Date.now(),
          status: 'needs_order',
        };
        set(applyItemUpdate(state, next));
      },

      setItemNote: (itemId, noteText) => {
        const state = get();
        const item = state.itemsById[itemId];
        if (!item) return;
        const trimmed = noteText.trim();
        const next: StockCheckItem = {
          ...item,
          noteText: trimmed,
          hasNote: trimmed.length > 0,
        };
        set(applyItemUpdate(state, next));
      },

      clearItemNote: (itemId) => {
        const state = get();
        const item = state.itemsById[itemId];
        if (!item) return;
        const next: StockCheckItem = {
          ...item,
          noteText: '',
          hasNote: false,
        };
        set(applyItemUpdate(state, next));
      },

      setItemUnitType: (itemId, unitType) => {
        const state = get();
        const item = state.itemsById[itemId];
        if (!item) return;
        if (item.unitType === unitType) return;
        // Switching units is a UI-only choice — we don't auto-convert the
        // current `orderQuantity` between pack and base. The user's intent
        // when toggling is "I'm now expressing the count in <pack/base>",
        // not "convert what I typed before". They re-enter the value if
        // they want a different unit's count.
        const next: StockCheckItem = { ...item, unitType };
        set(applyItemUpdate(state, next));
      },

      commitStockEntry: (itemId, entry) => {
        const state = get();
        const item = state.itemsById[itemId];
        if (!item) return;

        // Defensive clamp — wheel-picker callers should already pass
        // non-negative integers, but the store is the integrity boundary.
        const stockAmount = Math.max(
          0,
          Math.trunc(Number.isFinite(entry.stockAmount) ? entry.stockAmount : 0),
        );
        const stockPieces = Math.max(
          0,
          Math.trunc(Number.isFinite(entry.stockPieces) ? entry.stockPieces : 0),
        );
        const stockUnit: UnitType =
          entry.stockUnit === 'pack' || entry.stockUnit === 'base'
            ? entry.stockUnit
            : item.unitType;

        // Derive `orderQuantity` from the wheel triple so the existing cart
        // pipeline + status/progress predicates stay correct without any
        // downstream rewiring.
        const orderQuantity = computeNeedToOrder({
          parLevel: item.parLevel,
          unitType: item.unitType,
          packSize: item.packSize,
          stockUnit,
          stockAmount,
          stockPieces,
        });

        // Status is derived from the deficit + checked state. A row is
        // "at_par" when totalStockInBase >= parInBase (deficit 0 AND user
        // entered some stock). It's "needs_order" when there's a deficit
        // and the user has entered nothing yet (totalStockInBase === 0).
        // Otherwise "low" (some stock, but below par).
        const totalBase = totalStockInBase({
          stockUnit,
          stockAmount,
          stockPieces,
          packSize: item.packSize,
        });
        let status: StockCheckStatus;
        if (orderQuantity <= 0) {
          status = 'at_par';
        } else if (totalBase <= 0) {
          status = 'needs_order';
        } else {
          status = 'low';
        }

        const next: StockCheckItem = {
          ...item,
          stockUnit,
          stockAmount,
          stockPieces,
          orderQuantity,
          checked: true,
          checkedAt: Date.now(),
          status,
        };
        set(applyItemUpdate(state, next));
      },

      resetSelection: () => {
        set({ expandingItemId: null });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      // Persist only the per-location offline edits — runtime data (areas,
      // itemsById) is rehydrated from Supabase on each loadLocation.
      partialize: (state) => ({ perLocationState: state.perLocationState }),
      migrate: (persisted, _from) => {
        const state = persisted as { perLocationState?: Record<string, PersistedLocationState> } | null;
        if (!state?.perLocationState) {
          return { perLocationState: {} } as Partial<StockCheckState>;
        }
        const now = Date.now();
        const fresh: Record<string, PersistedLocationState> = {};
        for (const [locId, entry] of Object.entries(state.perLocationState)) {
          if (now - entry.cachedAt < STATE_MAX_AGE_MS) {
            fresh[locId] = entry;
          }
        }
        return { perLocationState: fresh } as Partial<StockCheckState>;
      },
    },
  ),
);

/**
 * Returns a partial state update applying a single-row change.
 *
 * Centralizes:
 *   1. The immutable update to `itemsById` (other rows keep their object
 *      identity so React.memo skips them).
 *   2. Persistence sync into `perLocationState`.
 *
 * Items are NEVER reordered as a side-effect of an update; the list always
 * renders in its original (storage-area-defined) order. The `checked` flag
 * stays on the row for the CTA's "all items checked" predicate.
 *
 * Pure — derives the next state from the previous one, no side effects.
 */
function applyItemUpdate(
  state: StockCheckState,
  next: StockCheckItem,
): Partial<StockCheckState> {
  const itemsById = { ...state.itemsById, [next.id]: next };
  const perLocationState = state.locationId
    ? syncRowToPersistence(state, next)
    : state.perLocationState;
  return { itemsById, perLocationState };
}

function syncRowToPersistence(
  state: StockCheckState,
  next: StockCheckItem,
): Record<string, PersistedLocationState> {
  const locId = state.locationId!;
  const existing = state.perLocationState[locId] ?? {
    rows: {},
    selectedAreaId: state.selectedAreaId,
    cachedAt: Date.now(),
  };
  return {
    ...state.perLocationState,
    [locId]: {
      ...existing,
      cachedAt: Date.now(),
      rows: {
        ...existing.rows,
        [next.id]: {
          orderQuantity: next.orderQuantity,
          checked: next.checked,
          checkedAt: next.checkedAt,
          hasNote: next.hasNote,
          noteText: next.noteText,
          unitType: next.unitType,
          stockUnit: next.stockUnit,
          stockAmount: next.stockAmount,
          stockPieces: next.stockPieces,
        },
      },
    },
  };
}
