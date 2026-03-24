import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InventoryItem, ItemCategory, SupplierCategory } from '@/types';
import { supabase } from '@/lib/supabase';
import { listInventory } from '@/lib/api/client';

export interface NewInventoryItem {
  name: string;
  category: ItemCategory;
  supplier_category: SupplierCategory;
  base_unit: string;
  pack_unit: string;
  pack_size: number;
  created_by?: string;
}

interface InventoryState {
  items: InventoryItem[];
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;
  hasFetchedThisSession: boolean;
  selectedCategory: ItemCategory | null;
  selectedSupplierCategory: SupplierCategory | null;
  searchQuery: string;

  // Actions
  fetchItems: (options?: { force?: boolean }) => Promise<void>;
  addItem: (item: NewInventoryItem) => Promise<InventoryItem>;
  updateItem: (id: string, updates: Partial<NewInventoryItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  setSelectedCategory: (category: ItemCategory | null) => void;
  setSelectedSupplierCategory: (category: SupplierCategory | null) => void;
  setSearchQuery: (query: string) => void;
  getFilteredItems: () => InventoryItem[];
  getItemsByCategory: (category: ItemCategory) => InventoryItem[];
  getItemsBySupplierCategory: (category: SupplierCategory) => InventoryItem[];
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const INVENTORY_FETCH_LIMIT = 5000;
const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';
const DIRECT_INVENTORY_OPTIONAL_COLUMNS = ['supplier_id', 'created_by'] as const;

type DirectInventoryRow = {
  id: string;
  name: string;
  category: ItemCategory;
  supplier_category?: SupplierCategory | null;
  supplier_id?: string | null;
  base_unit: string;
  pack_unit?: string | null;
  pack_size?: number | null;
  active?: boolean | null;
  created_at?: string | null;
  created_by?: string | null;
};

function extractMissingSchemaColumn(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const err = error as { code?: string; message?: string };
  if (err.code !== 'PGRST204') return null;
  const message = typeof err.message === 'string' ? err.message : '';
  const matches = Array.from(message.matchAll(/'([^']+)'/g)).map((match) => match[1]);
  return matches.length > 0 ? matches[0] : null;
}

function isSessionExpiredErrorMessage(error: unknown): boolean {
  if (typeof error !== 'string') return false;
  return error.trim().toLowerCase() === SESSION_EXPIRED_MESSAGE.toLowerCase();
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as {
    code?: string;
    details?: string;
    hint?: string;
    message?: string;
  };
  const text = `${err.message ?? ''} ${err.details ?? ''} ${err.hint ?? ''}`.toLowerCase();
  if (!text.includes(columnName.toLowerCase())) return false;
  return (
    err.code === 'PGRST204' ||
    err.code === '42703' ||
    text.includes('could not find') ||
    text.includes('does not exist')
  );
}

function sortInventoryItems(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });
}

function mapDirectInventoryRow(row: DirectInventoryRow): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    supplier_category: row.supplier_category ?? 'main_distributor',
    supplier_id: row.supplier_id ?? null,
    base_unit: row.base_unit,
    pack_unit: row.pack_unit ?? '',
    pack_size: row.pack_size ?? 1,
    active: row.active !== false,
    created_at: row.created_at ?? '',
    created_by: row.created_by ?? null,
  };
}

async function listInventoryDirect(options?: {
  limit?: number;
}): Promise<InventoryItem[]> {
  let selectColumns = [
    'id',
    'name',
    'category',
    'supplier_category',
    'supplier_id',
    'base_unit',
    'pack_unit',
    'pack_size',
    'active',
    'created_at',
    'created_by',
  ];
  let attempts = 0;

  while (attempts < 4) {
    let query = supabase
      .from('inventory_items')
      .select(selectColumns.join(','))
      .eq('active', true);

    const { data, error } = await query.limit(options?.limit ?? INVENTORY_FETCH_LIMIT);

    if (!error) {
      return sortInventoryItems(
        (data ?? []).map((row: unknown) =>
          mapDirectInventoryRow(row as DirectInventoryRow)
        )
      );
    }

    const optionalColumn = DIRECT_INVENTORY_OPTIONAL_COLUMNS.find(
      (column) =>
        selectColumns.includes(column) && isMissingColumnError(error, column)
    );

    if (optionalColumn) {
      selectColumns = selectColumns.filter((column) => column !== optionalColumn);
      attempts += 1;
      continue;
    }

    throw error;
  }

  throw new Error('Failed to load inventory from the database.');
}

export const useInventoryStore = create<InventoryState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      error: null,
      lastFetched: null,
      hasFetchedThisSession: false,
      selectedCategory: null,
      selectedSupplierCategory: null,
      searchQuery: '',

      fetchItems: async (options) => {
        const force = options?.force === true;
        const { lastFetched, items, hasFetchedThisSession } = get();

        if (!force && hasFetchedThisSession && lastFetched && items.length > 0) {
          const cacheAge = Date.now() - lastFetched;
          if (cacheAge < CACHE_DURATION) {
            return;
          }
        }

        set({ isLoading: true, error: null });
        try {
          const result = await listInventory({
            limit: INVENTORY_FETCH_LIMIT,
          });
          let resolvedItems = result.data ?? null;

          const shouldTryDirectFallback =
            Boolean(result.error) ||
            (Array.isArray(result.data) && result.data.length === 0);

          if (shouldTryDirectFallback) {
            try {
              const directItems = await listInventoryDirect({
                limit: INVENTORY_FETCH_LIMIT,
              });

              if (!result.error || directItems.length > 0) {
                resolvedItems = directItems;
              }

              if (result.error && directItems.length > 0) {
                console.warn(
                  'Inventory API failed; using direct inventory query fallback.',
                  result.error
                );
              }
            } catch (fallbackError) {
              if (result.error) {
                console.warn(
                  'Failed to fetch inventory items via API and direct fallback.',
                  fallbackError
                );
              }
            }
          }

          if (result.error && (!resolvedItems || resolvedItems.length === 0)) {
            console.warn('Failed to fetch inventory items.', result.error);
            set({ error: result.error });
            return;
          }

          const activeItems = sortInventoryItems(
            (resolvedItems ?? []).filter((item) => item.active)
          );

          set({
            items: activeItems,
            error: null,
            lastFetched: Date.now(),
            hasFetchedThisSession: true,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to load inventory.';

          if (isSessionExpiredErrorMessage(message)) {
            set({ error: message });
            return;
          }

          console.error('Unexpected inventory fetch failure.', error);
          set({ error: message });
        } finally {
          set({ isLoading: false });
        }
      },

      // PHASE 3: addItem stays as direct DB — v1-create-inventory-item requires
      // org_memberships row that mobile users don't have yet.
      addItem: async (item) => {
        set({ isLoading: true });
        try {
          const insertPayload: Record<string, unknown> = {
            ...item,
            active: true,
          };

          let data: any = null;
          let error: any = null;
          let insertAttempt = 0;

          while (insertAttempt < 2) {
            const response = await supabase
              .from('inventory_items')
              .insert(insertPayload as any)
              .select()
              .single();

            data = response.data;
            error = response.error;
            if (!error) break;

            const missingColumn = extractMissingSchemaColumn(error);
            if (
              missingColumn === 'created_by' &&
              Object.prototype.hasOwnProperty.call(insertPayload, 'created_by')
            ) {
              delete insertPayload.created_by;
              insertAttempt += 1;
              continue;
            }

            break;
          }

          if (error) throw error;
          if (data) {
            // Add to local state
            set((state) => ({
              items: sortInventoryItems([...state.items, data]),
              lastFetched: Date.now(),
            }));

            return data;
          }

          // Fallback: refresh items if representation wasn't returned
          set({ lastFetched: null });
          await get().fetchItems({ force: true });
          const created = get().items.find(
            (existing) =>
              existing.name.toLowerCase() === item.name.toLowerCase() &&
              existing.category === item.category &&
              existing.supplier_category === item.supplier_category
          );
          if (created) {
            return created;
          }

          throw new Error('Item was created but could not be loaded. Please refresh.');
        } finally {
          set({ isLoading: false });
        }
      },

      // PHASE 3: updateItem stays as direct DB — same org_memberships blocker.
      updateItem: async (id, updates) => {
        set({ isLoading: true });
        try {
          const { error } = await supabase
            .from('inventory_items')
            .update(updates)
            .eq('id', id);

          if (error) throw error;

          // Update local state
          set((state) => ({
            items: state.items.map((item) =>
              item.id === id ? { ...item, ...updates } : item
            ),
          }));
        } finally {
          set({ isLoading: false });
        }
      },

      // PHASE 3: deleteItem stays as direct DB — same org_memberships blocker.
      deleteItem: async (id) => {
        set({ isLoading: true });
        try {
          // Soft delete by setting active to false
          const { error } = await supabase
            .from('inventory_items')
            .update({ active: false })
            .eq('id', id);

          if (error) throw error;

          // Remove from local state
          set((state) => ({
            items: state.items.filter((item) => item.id !== id),
          }));
        } finally {
          set({ isLoading: false });
        }
      },

      setSelectedCategory: (category) => set({ selectedCategory: category }),

      setSelectedSupplierCategory: (category) =>
        set({ selectedSupplierCategory: category }),

      setSearchQuery: (query) => set({ searchQuery: query }),

      getFilteredItems: () => {
        const { items, selectedCategory, selectedSupplierCategory, searchQuery } =
          get();

        return items.filter((item) => {
          const matchesCategory =
            !selectedCategory || item.category === selectedCategory;
          const matchesSupplierCategory =
            !selectedSupplierCategory ||
            item.supplier_category === selectedSupplierCategory;
          const matchesSearch =
            !searchQuery ||
            item.name.toLowerCase().includes(searchQuery.toLowerCase());

          return matchesCategory && matchesSupplierCategory && matchesSearch;
        });
      },

      getItemsByCategory: (category) => {
        const { items } = get();
        return items.filter((item) => item.category === category);
      },

      getItemsBySupplierCategory: (category) => {
        const { items } = get();
        return items.filter((item) => item.supplier_category === category);
      },
    }),
    {
      name: 'inventory-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => {
        const MAX_CACHED_ITEMS = 2000;
        return {
          items: state.items.length > MAX_CACHED_ITEMS 
            ? state.items.slice(0, MAX_CACHED_ITEMS) 
            : state.items,
        };
      },
    }
  )
);
