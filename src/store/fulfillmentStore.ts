import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Supplier {
  id: string;
  name: string;
  phone: string;
  isDefault?: boolean;
}

interface FulfillmentState {
  // Checked items by item ID
  checkedFishItems: Set<string>;
  checkedOtherItems: Set<string>;

  // Suppliers
  suppliers: Supplier[];
  selectedSupplierId: string | null;

  // Actions
  toggleFishItem: (itemId: string) => void;
  toggleOtherItem: (itemId: string) => void;
  clearFishItems: () => void;
  clearOtherItems: () => void;
  clearAllChecked: () => void;

  // Supplier actions
  addSupplier: (supplier: Omit<Supplier, 'id'>) => void;
  removeSupplier: (id: string) => void;
  setSelectedSupplier: (id: string | null) => void;
  getDefaultSupplier: () => Supplier | undefined;
}

// Default fish supplier
const defaultSuppliers: Supplier[] = [
  {
    id: 'fish-supplier-1',
    name: 'Fish Supplier',
    phone: '',
    isDefault: true,
  },
];

export const useFulfillmentStore = create<FulfillmentState>()(
  persist(
    (set, get) => ({
      checkedFishItems: new Set<string>(),
      checkedOtherItems: new Set<string>(),
      suppliers: defaultSuppliers,
      selectedSupplierId: 'fish-supplier-1',

      toggleFishItem: (itemId) => {
        set((state) => {
          const newSet = new Set(state.checkedFishItems);
          if (newSet.has(itemId)) {
            newSet.delete(itemId);
          } else {
            newSet.add(itemId);
          }
          return { checkedFishItems: newSet };
        });
      },

      toggleOtherItem: (itemId) => {
        set((state) => {
          const newSet = new Set(state.checkedOtherItems);
          if (newSet.has(itemId)) {
            newSet.delete(itemId);
          } else {
            newSet.add(itemId);
          }
          return { checkedOtherItems: newSet };
        });
      },

      clearFishItems: () => {
        set({ checkedFishItems: new Set<string>() });
      },

      clearOtherItems: () => {
        set({ checkedOtherItems: new Set<string>() });
      },

      clearAllChecked: () => {
        set({
          checkedFishItems: new Set<string>(),
          checkedOtherItems: new Set<string>(),
        });
      },

      addSupplier: (supplier) => {
        const id = `supplier-${Date.now()}`;
        set((state) => ({
          suppliers: [...state.suppliers, { ...supplier, id }],
        }));
      },

      removeSupplier: (id) => {
        set((state) => ({
          suppliers: state.suppliers.filter((s) => s.id !== id),
          selectedSupplierId:
            state.selectedSupplierId === id ? null : state.selectedSupplierId,
        }));
      },

      setSelectedSupplier: (id) => {
        set({ selectedSupplierId: id });
      },

      getDefaultSupplier: () => {
        return get().suppliers.find((s) => s.isDefault);
      },
    }),
    {
      name: 'babytuna-fulfillment',
      storage: createJSONStorage(() => AsyncStorage),
      // Custom serialization for Set objects
      partialize: (state) => ({
        checkedFishItems: Array.from(state.checkedFishItems),
        checkedOtherItems: Array.from(state.checkedOtherItems),
        suppliers: state.suppliers,
        selectedSupplierId: state.selectedSupplierId,
      }),
      // Custom deserialization for Set objects
      merge: (persistedState: any, currentState) => ({
        ...currentState,
        ...persistedState,
        checkedFishItems: new Set(persistedState?.checkedFishItems || []),
        checkedOtherItems: new Set(persistedState?.checkedOtherItems || []),
      }),
    }
  )
);
