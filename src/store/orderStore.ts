import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Order, OrderItem, OrderWithDetails, UnitType } from '@/types';
import { supabase } from '@/lib/supabase';

interface CartItem {
  inventoryItemId: string;
  quantity: number;
  unitType: UnitType;
}

interface OrderState {
  cart: CartItem[];
  orders: Order[];
  currentOrder: OrderWithDetails | null;
  isLoading: boolean;

  // Cart actions
  addToCart: (inventoryItemId: string, quantity: number, unitType: UnitType) => void;
  updateCartItem: (inventoryItemId: string, quantity: number, unitType: UnitType) => void;
  removeFromCart: (inventoryItemId: string) => void;
  clearCart: () => void;
  getCartItem: (inventoryItemId: string) => CartItem | undefined;
  getCartTotal: () => number;

  // Order actions
  fetchOrders: (locationId: string) => Promise<void>;
  fetchOrder: (orderId: string) => Promise<void>;
  createOrder: (locationId: string, userId: string) => Promise<Order>;
  submitOrder: (orderId: string) => Promise<void>;
  fulfillOrder: (orderId: string, fulfilledBy: string) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;
}

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      cart: [],
      orders: [],
      currentOrder: null,
      isLoading: false,

      addToCart: (inventoryItemId, quantity, unitType) => {
        const { cart } = get();
        const existing = cart.find((item) => item.inventoryItemId === inventoryItemId);

        if (existing) {
          set({
            cart: cart.map((item) =>
              item.inventoryItemId === inventoryItemId
                ? { ...item, quantity: item.quantity + quantity, unitType }
                : item
            ),
          });
        } else {
          set({
            cart: [...cart, { inventoryItemId, quantity, unitType }],
          });
        }
      },

      updateCartItem: (inventoryItemId, quantity, unitType) => {
        const { cart } = get();
        if (quantity <= 0) {
          set({
            cart: cart.filter((item) => item.inventoryItemId !== inventoryItemId),
          });
        } else {
          set({
            cart: cart.map((item) =>
              item.inventoryItemId === inventoryItemId
                ? { ...item, quantity, unitType }
                : item
            ),
          });
        }
      },

      removeFromCart: (inventoryItemId) => {
        const { cart } = get();
        set({
          cart: cart.filter((item) => item.inventoryItemId !== inventoryItemId),
        });
      },

      clearCart: () => set({ cart: [] }),

      getCartItem: (inventoryItemId) => {
        const { cart } = get();
        return cart.find((item) => item.inventoryItemId === inventoryItemId);
      },

      getCartTotal: () => {
        const { cart } = get();
        return cart.reduce((total, item) => total + item.quantity, 0);
      },

      fetchOrders: async (locationId) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('orders')
            .select(`
              *,
              user:users(*),
              location:locations(*)
            `)
            .eq('location_id', locationId)
            .order('created_at', { ascending: false })
            .limit(50);

          if (error) throw error;

          set({ orders: data || [] });
        } finally {
          set({ isLoading: false });
        }
      },

      fetchOrder: async (orderId) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('orders')
            .select(`
              *,
              user:users(*),
              location:locations(*),
              order_items(
                *,
                inventory_item:inventory_items(*)
              )
            `)
            .eq('id', orderId)
            .single();

          if (error) throw error;

          set({ currentOrder: data as OrderWithDetails });
        } finally {
          set({ isLoading: false });
        }
      },

      createOrder: async (locationId, userId) => {
        const { cart, clearCart } = get();

        if (cart.length === 0) {
          throw new Error('Cart is empty');
        }

        set({ isLoading: true });
        try {
          // Create order
          const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert({
              location_id: locationId,
              user_id: userId,
              status: 'draft',
            })
            .select()
            .single();

          if (orderError) throw orderError;

          // Create order items
          const orderItems: Omit<OrderItem, 'id' | 'created_at'>[] = cart.map((item) => ({
            order_id: order.id,
            inventory_item_id: item.inventoryItemId,
            quantity: item.quantity,
            unit_type: item.unitType,
          }));

          const { error: itemsError } = await supabase
            .from('order_items')
            .insert(orderItems);

          if (itemsError) throw itemsError;

          clearCart();
          return order;
        } finally {
          set({ isLoading: false });
        }
      },

      submitOrder: async (orderId) => {
        set({ isLoading: true });
        try {
          const { error } = await supabase
            .from('orders')
            .update({ status: 'submitted' })
            .eq('id', orderId);

          if (error) throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      fulfillOrder: async (orderId, fulfilledBy) => {
        set({ isLoading: true });
        try {
          const { error } = await supabase
            .from('orders')
            .update({
              status: 'fulfilled',
              fulfilled_at: new Date().toISOString(),
              fulfilled_by: fulfilledBy,
            })
            .eq('id', orderId);

          if (error) throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      cancelOrder: async (orderId) => {
        set({ isLoading: true });
        try {
          const { error } = await supabase
            .from('orders')
            .update({ status: 'cancelled' })
            .eq('id', orderId);

          if (error) throw error;
        } finally {
          set({ isLoading: false });
        }
      },
    }),
    {
      name: 'order-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cart: state.cart,
      }),
    }
  )
);
