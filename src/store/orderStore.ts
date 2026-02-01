import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Order, OrderItem, OrderWithDetails, OrderStatus, UnitType } from '@/types';
import { supabase } from '@/lib/supabase';

export interface CartItem {
  inventoryItemId: string;
  quantity: number;
  unitType: UnitType;
}

// Cart items organized by location
type CartByLocation = Record<string, CartItem[]>;

interface OrderState {
  cartByLocation: CartByLocation;
  orders: Order[];
  currentOrder: OrderWithDetails | null;
  isLoading: boolean;

  // Cart actions (location-aware)
  addToCart: (locationId: string, inventoryItemId: string, quantity: number, unitType: UnitType) => void;
  updateCartItem: (locationId: string, inventoryItemId: string, quantity: number, unitType: UnitType) => void;
  removeFromCart: (locationId: string, inventoryItemId: string) => void;
  clearLocationCart: (locationId: string) => void;
  clearAllCarts: () => void;

  // Cart getters
  getCartItems: (locationId: string) => CartItem[];
  getCartItem: (locationId: string, inventoryItemId: string) => CartItem | undefined;
  getLocationCartTotal: (locationId: string) => number;
  getTotalCartCount: () => number;
  getCartLocationIds: () => string[];

  // Legacy support - for backward compatibility
  cart: CartItem[];
  clearCart: () => void;
  getCartTotal: () => number;

  // Order actions
  fetchOrders: (locationId: string) => Promise<void>;
  fetchUserOrders: (userId: string) => Promise<void>;
  fetchManagerOrders: (locationId?: string | null, status?: OrderStatus | null) => Promise<void>;
  fetchOrder: (orderId: string) => Promise<void>;
  createOrder: (locationId: string, userId: string) => Promise<Order>;
  createAndSubmitOrder: (locationId: string, userId: string) => Promise<OrderWithDetails>;
  submitOrder: (orderId: string) => Promise<void>;
  updateOrderStatus: (orderId: string, status: OrderStatus, fulfilledBy?: string) => Promise<void>;
  fulfillOrder: (orderId: string, fulfilledBy: string) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;
}

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      cartByLocation: {},
      orders: [],
      currentOrder: null,
      isLoading: false,

      // Legacy cart property - returns flattened cart for backward compatibility
      get cart() {
        const { cartByLocation } = get();
        return Object.values(cartByLocation).flat();
      },

      addToCart: (locationId, inventoryItemId, quantity, unitType) => {
        const { cartByLocation } = get();
        const locationCart = cartByLocation[locationId] || [];
        const existing = locationCart.find((item) => item.inventoryItemId === inventoryItemId);

        if (existing) {
          set({
            cartByLocation: {
              ...cartByLocation,
              [locationId]: locationCart.map((item) =>
                item.inventoryItemId === inventoryItemId
                  ? { ...item, quantity: item.quantity + quantity, unitType }
                  : item
              ),
            },
          });
        } else {
          set({
            cartByLocation: {
              ...cartByLocation,
              [locationId]: [...locationCart, { inventoryItemId, quantity, unitType }],
            },
          });
        }
      },

      updateCartItem: (locationId, inventoryItemId, quantity, unitType) => {
        const { cartByLocation } = get();
        const locationCart = cartByLocation[locationId] || [];

        if (quantity <= 0) {
          set({
            cartByLocation: {
              ...cartByLocation,
              [locationId]: locationCart.filter((item) => item.inventoryItemId !== inventoryItemId),
            },
          });
        } else {
          set({
            cartByLocation: {
              ...cartByLocation,
              [locationId]: locationCart.map((item) =>
                item.inventoryItemId === inventoryItemId
                  ? { ...item, quantity, unitType }
                  : item
              ),
            },
          });
        }
      },

      removeFromCart: (locationId, inventoryItemId) => {
        const { cartByLocation } = get();
        const locationCart = cartByLocation[locationId] || [];
        set({
          cartByLocation: {
            ...cartByLocation,
            [locationId]: locationCart.filter((item) => item.inventoryItemId !== inventoryItemId),
          },
        });
      },

      clearLocationCart: (locationId) => {
        const { cartByLocation } = get();
        const { [locationId]: _, ...rest } = cartByLocation;
        set({ cartByLocation: rest });
      },

      clearAllCarts: () => set({ cartByLocation: {} }),

      // Legacy clearCart - clears all carts
      clearCart: () => set({ cartByLocation: {} }),

      getCartItems: (locationId) => {
        const { cartByLocation } = get();
        return cartByLocation[locationId] || [];
      },

      getCartItem: (locationId, inventoryItemId) => {
        const { cartByLocation } = get();
        const locationCart = cartByLocation[locationId] || [];
        return locationCart.find((item) => item.inventoryItemId === inventoryItemId);
      },

      getLocationCartTotal: (locationId) => {
        const { cartByLocation } = get();
        const locationCart = cartByLocation[locationId] || [];
        return locationCart.reduce((total, item) => total + item.quantity, 0);
      },

      getTotalCartCount: () => {
        const { cartByLocation } = get();
        return Object.values(cartByLocation).reduce(
          (total, items) => total + items.length,
          0
        );
      },

      getCartLocationIds: () => {
        const { cartByLocation } = get();
        return Object.keys(cartByLocation).filter(
          (locId) => cartByLocation[locId].length > 0
        );
      },

      // Legacy getCartTotal - returns total across all locations
      getCartTotal: () => {
        const { cartByLocation } = get();
        return Object.values(cartByLocation).reduce(
          (total, items) => total + items.length,
          0
        );
      },

      fetchOrders: async (locationId) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('orders')
            .select(`
              *,
              user:users!orders_user_id_fkey(*),
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

      fetchUserOrders: async (userId) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('orders')
            .select(`
              *,
              user:users!orders_user_id_fkey(*),
              location:locations(*),
              order_items(
                *,
                inventory_item:inventory_items(*)
              )
            `)
            .eq('user_id', userId)
            .neq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(50);

          if (error) throw error;

          set({ orders: data || [] });
        } finally {
          set({ isLoading: false });
        }
      },

      fetchManagerOrders: async (locationId, status) => {
        set({ isLoading: true });
        try {
          let query = supabase
            .from('orders')
            .select(`
              *,
              user:users!orders_user_id_fkey(*),
              location:locations(*),
              order_items(
                *,
                inventory_item:inventory_items(*)
              )
            `)
            .neq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(100);

          if (locationId) {
            query = query.eq('location_id', locationId);
          }

          if (status) {
            query = query.eq('status', status);
          }

          const { data, error } = await query;

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
              user:users!orders_user_id_fkey(*),
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
        const { cartByLocation, clearLocationCart } = get();
        const locationCart = cartByLocation[locationId] || [];

        if (locationCart.length === 0) {
          throw new Error('Cart is empty for this location');
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
          const orderItems: Omit<OrderItem, 'id' | 'created_at'>[] = locationCart.map((item) => ({
            order_id: order.id,
            inventory_item_id: item.inventoryItemId,
            quantity: item.quantity,
            unit_type: item.unitType,
          }));

          const { error: itemsError } = await supabase
            .from('order_items')
            .insert(orderItems);

          if (itemsError) throw itemsError;

          clearLocationCart(locationId);
          return order;
        } finally {
          set({ isLoading: false });
        }
      },

      createAndSubmitOrder: async (locationId, userId) => {
        const { cartByLocation, clearLocationCart } = get();
        const locationCart = cartByLocation[locationId] || [];

        if (locationCart.length === 0) {
          throw new Error('Cart is empty for this location');
        }

        set({ isLoading: true });
        try {
          // Create order with status 'submitted' directly
          const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert({
              location_id: locationId,
              user_id: userId,
              status: 'submitted',
            })
            .select(`
              *,
              location:locations(*)
            `)
            .single();

          if (orderError) throw orderError;

          // Create order items
          const orderItemsToInsert: Omit<OrderItem, 'id' | 'created_at'>[] = locationCart.map((item) => ({
            order_id: order.id,
            inventory_item_id: item.inventoryItemId,
            quantity: item.quantity,
            unit_type: item.unitType,
          }));

          const { data: createdItems, error: itemsError } = await supabase
            .from('order_items')
            .insert(orderItemsToInsert)
            .select(`
              *,
              inventory_item:inventory_items(*)
            `);

          if (itemsError) throw itemsError;

          // Build the full order with details
          const orderWithDetails: OrderWithDetails = {
            ...order,
            user: { id: userId } as any, // User info not critical for confirmation
            order_items: createdItems || [],
          };

          clearLocationCart(locationId);
          set({ currentOrder: orderWithDetails });
          return orderWithDetails;
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

      updateOrderStatus: async (orderId, status, fulfilledBy) => {
        set({ isLoading: true });
        try {
          const updateData: Record<string, any> = { status };

          if (status === 'fulfilled' && fulfilledBy) {
            updateData.fulfilled_at = new Date().toISOString();
            updateData.fulfilled_by = fulfilledBy;
          }

          const { error } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', orderId);

          if (error) throw error;

          // Refresh the current order if it matches
          const { currentOrder } = get();
          if (currentOrder && currentOrder.id === orderId) {
            await get().fetchOrder(orderId);
          }
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
        cartByLocation: state.cartByLocation,
      }),
    }
  )
);
