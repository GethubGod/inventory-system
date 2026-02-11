import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InventoryItem, ItemCategory, SupplierCategory } from '@/types';
import { supabase } from '@/lib/supabase';

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

export const useInventoryStore = create<InventoryState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      lastFetched: null,
      hasFetchedThisSession: false,
      selectedCategory: null,
      selectedSupplierCategory: null,
      searchQuery: '',

      fetchItems: async (options) => {
        const force = options?.force === true;
        const { lastFetched, items, hasFetchedThisSession } = get();

        // Only reuse cache after one fresh fetch in the current app session.
        // This prevents stale persisted data after app relaunch.
        if (!force && hasFetchedThisSession && lastFetched && items.length > 0) {
          const cacheAge = Date.now() - lastFetched;
          if (cacheAge < CACHE_DURATION) {
            return;
          }
        }

        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('inventory_items')
            .select('*')
            .eq('active', true)
            .order('category')
            .order('name');

          if (error) throw error;

          set({
            items: data || [],
            lastFetched: Date.now(),
            hasFetchedThisSession: true,
          });
        } finally {
          set({ isLoading: false });
        }
      },

      addItem: async (item) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('inventory_items')
            .insert({
              ...item,
              active: true,
            })
            .select()
            .single();

          if (error) throw error;
          if (data) {
            // Add to local state
            set((state) => ({
              items: [...state.items, data].sort((a, b) => {
                if (a.category !== b.category) {
                  return a.category.localeCompare(b.category);
                }
                return a.name.localeCompare(b.name);
              }),
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
      partialize: (state) => ({
        items: state.items,
      }),
    }
  )
);
