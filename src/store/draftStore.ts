import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InventoryItem, UnitType } from '@/types';

export interface DraftItem {
  inventoryItem: InventoryItem;
  quantity: number;
  unit: UnitType;
  addedAt: number;
}

// Items organized by location
type ItemsByLocation = Record<string, Record<string, DraftItem>>;

interface DraftState {
  itemsByLocation: ItemsByLocation;
  selectedLocationId: string | null;

  // Actions
  setSelectedLocation: (locationId: string) => void;
  addItem: (locationId: string, inventoryItem: InventoryItem, quantity: number, unit: UnitType) => void;
  updateItem: (locationId: string, itemId: string, quantity: number, unit: UnitType) => void;
  removeItem: (locationId: string, itemId: string) => void;
  clearLocationDraft: (locationId: string) => void;
  clearAllDrafts: () => void;

  // Getters
  getItemCount: (locationId: string) => number;
  getTotalItemCount: () => number;
  getItems: (locationId: string) => DraftItem[];
  getAllLocationIds: () => string[];
  getLocationItemCount: (locationId: string) => number;
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      itemsByLocation: {},
      selectedLocationId: null,

      setSelectedLocation: (locationId) => set({ selectedLocationId: locationId }),

      addItem: (locationId, inventoryItem, quantity, unit) => {
        const { itemsByLocation } = get();
        const locationItems = itemsByLocation[locationId] || {};
        const existingItem = locationItems[inventoryItem.id];

        if (existingItem) {
          // Update existing item - add to quantity
          set({
            itemsByLocation: {
              ...itemsByLocation,
              [locationId]: {
                ...locationItems,
                [inventoryItem.id]: {
                  ...existingItem,
                  quantity: existingItem.quantity + quantity,
                  unit,
                  addedAt: Date.now(),
                },
              },
            },
          });
        } else {
          // Add new item
          set({
            itemsByLocation: {
              ...itemsByLocation,
              [locationId]: {
                ...locationItems,
                [inventoryItem.id]: {
                  inventoryItem,
                  quantity,
                  unit,
                  addedAt: Date.now(),
                },
              },
            },
          });
        }
      },

      updateItem: (locationId, itemId, quantity, unit) => {
        const { itemsByLocation } = get();
        const locationItems = itemsByLocation[locationId];
        if (!locationItems) return;

        const existingItem = locationItems[itemId];
        if (!existingItem) return;

        if (quantity <= 0) {
          // Remove item if quantity is 0 or less
          const { [itemId]: _, ...rest } = locationItems;
          set({
            itemsByLocation: {
              ...itemsByLocation,
              [locationId]: rest,
            },
          });
        } else {
          set({
            itemsByLocation: {
              ...itemsByLocation,
              [locationId]: {
                ...locationItems,
                [itemId]: {
                  ...existingItem,
                  quantity,
                  unit,
                },
              },
            },
          });
        }
      },

      removeItem: (locationId, itemId) => {
        const { itemsByLocation } = get();
        const locationItems = itemsByLocation[locationId];
        if (!locationItems) return;

        const { [itemId]: _, ...rest } = locationItems;
        set({
          itemsByLocation: {
            ...itemsByLocation,
            [locationId]: rest,
          },
        });
      },

      clearLocationDraft: (locationId) => {
        const { itemsByLocation } = get();
        const { [locationId]: _, ...rest } = itemsByLocation;
        set({ itemsByLocation: rest });
      },

      clearAllDrafts: () => set({ itemsByLocation: {} }),

      getItemCount: (locationId) => {
        const { itemsByLocation } = get();
        const locationItems = itemsByLocation[locationId];
        return locationItems ? Object.keys(locationItems).length : 0;
      },

      getTotalItemCount: () => {
        const { itemsByLocation } = get();
        return Object.values(itemsByLocation).reduce(
          (total, items) => total + Object.keys(items).length,
          0
        );
      },

      getItems: (locationId) => {
        const { itemsByLocation } = get();
        const locationItems = itemsByLocation[locationId];
        if (!locationItems) return [];
        return Object.values(locationItems).sort((a, b) => b.addedAt - a.addedAt);
      },

      getAllLocationIds: () => {
        const { itemsByLocation } = get();
        return Object.keys(itemsByLocation).filter(
          (locId) => Object.keys(itemsByLocation[locId]).length > 0
        );
      },

      getLocationItemCount: (locationId) => {
        const { itemsByLocation } = get();
        const locationItems = itemsByLocation[locationId];
        return locationItems ? Object.keys(locationItems).length : 0;
      },
    }),
    {
      name: 'draft-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        itemsByLocation: state.itemsByLocation,
        selectedLocationId: state.selectedLocationId,
      }),
    }
  )
);
