import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Order, OrderItem, OrderWithDetails, OrderStatus, UnitType } from '@/types';
import { supabase } from '@/lib/supabase';

export type OrderInputMode = 'quantity' | 'remaining';

export interface CartItem {
  id: string;
  inventoryItemId: string;
  quantity: number;
  unitType: UnitType;
  inputMode: OrderInputMode;
  quantityRequested: number | null;
  remainingReported: number | null;
  decidedQuantity: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}

export interface AddToCartOptions {
  inputMode?: OrderInputMode;
  quantityRequested?: number | null;
  remainingReported?: number | null;
  decidedQuantity?: number | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  note?: string | null;
}

interface UpdateCartItemOptions {
  cartItemId?: string;
  inputMode?: OrderInputMode;
  quantityRequested?: number | null;
  remainingReported?: number | null;
  clearDecision?: boolean;
}

// Cart items organized by location
type CartByLocation = Record<string, CartItem[]>;

interface OrderState {
  cartByLocation: CartByLocation;
  orders: Order[];
  currentOrder: OrderWithDetails | null;
  isLoading: boolean;

  // Cart actions (location-aware)
  addToCart: (
    locationId: string,
    inventoryItemId: string,
    quantity: number,
    unitType: UnitType,
    options?: AddToCartOptions
  ) => void;
  updateCartItem: (
    locationId: string,
    inventoryItemId: string,
    quantity: number,
    unitType: UnitType,
    options?: UpdateCartItemOptions
  ) => void;
  removeFromCart: (locationId: string, inventoryItemId: string, cartItemId?: string) => void;
  moveCartItem: (
    fromLocationId: string,
    toLocationId: string,
    inventoryItemId: string,
    unitType: UnitType,
    cartItemId?: string
  ) => void;
  moveLocationCartItems: (fromLocationId: string, toLocationId: string) => void;
  moveAllCartItemsToLocation: (toLocationId: string) => void;
  clearLocationCart: (locationId: string) => void;
  clearAllCarts: () => void;
  setCartItemDecision: (
    locationId: string,
    cartItemId: string,
    decidedQuantity: number,
    decidedBy: string
  ) => void;
  setCartItemNote: (locationId: string, cartItemId: string, note: string | null) => void;

  // Cart getters
  getCartItems: (locationId: string) => CartItem[];
  getCartItem: (locationId: string, inventoryItemId: string) => CartItem | undefined;
  getLocationCartTotal: (locationId: string) => number;
  getTotalCartCount: () => number;
  getCartLocationIds: () => string[];
  hasUndecidedRemaining: (locationId: string) => boolean;
  getUndecidedRemainingItems: (locationId: string) => CartItem[];

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

const createCartItemId = () =>
  `cart_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

let orderItemsNoteColumnAvailable: boolean | null = null;

function toValidNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getEffectiveQuantity(item: CartItem): number {
  if (item.inputMode === 'quantity') {
    return item.quantityRequested ?? 0;
  }
  return item.decidedQuantity ?? 0;
}

function normalizeCartItem(raw: any): CartItem | null {
  const inputMode: OrderInputMode = raw?.inputMode === 'remaining' ? 'remaining' : 'quantity';
  const unitType: UnitType = raw?.unitType === 'base' ? 'base' : 'pack';
  const id = typeof raw?.id === 'string' && raw.id ? raw.id : createCartItemId();
  const inventoryItemId =
    typeof raw?.inventoryItemId === 'string' && raw.inventoryItemId ? raw.inventoryItemId : null;

  if (!inventoryItemId) return null;

  if (inputMode === 'quantity') {
    const legacyQuantity = toValidNumber(raw?.quantity);
    const quantityRequested = toValidNumber(raw?.quantityRequested ?? legacyQuantity);
    if (quantityRequested === null || quantityRequested <= 0) return null;

    const decidedQuantityRaw = toValidNumber(raw?.decidedQuantity);
    const decidedQuantity = decidedQuantityRaw !== null && decidedQuantityRaw >= 0 ? decidedQuantityRaw : null;

    const item: CartItem = {
      id,
      inventoryItemId,
      quantity: quantityRequested,
      unitType,
      inputMode,
      quantityRequested,
      remainingReported: null,
      decidedQuantity,
      decidedBy: typeof raw?.decidedBy === 'string' ? raw.decidedBy : null,
      decidedAt: typeof raw?.decidedAt === 'string' ? raw.decidedAt : null,
      note: normalizeNote(raw?.note),
    };
    return item;
  }

  const remainingLegacy = toValidNumber(raw?.remainingReported ?? raw?.quantity);
  if (remainingLegacy === null || remainingLegacy < 0) return null;

  const decidedQuantityRaw = toValidNumber(raw?.decidedQuantity);
  const decidedQuantity = decidedQuantityRaw !== null && decidedQuantityRaw >= 0 ? decidedQuantityRaw : null;

  const item: CartItem = {
    id,
    inventoryItemId,
    quantity: decidedQuantity ?? 0,
    unitType,
    inputMode,
    quantityRequested: null,
    remainingReported: remainingLegacy,
    decidedQuantity,
    decidedBy: typeof raw?.decidedBy === 'string' ? raw.decidedBy : null,
    decidedAt: typeof raw?.decidedAt === 'string' ? raw.decidedAt : null,
    note: normalizeNote(raw?.note),
  };
  return item;
}

function normalizeLocationCart(rawCart: unknown): CartItem[] {
  if (!Array.isArray(rawCart)) return [];
  return rawCart
    .map((item) => normalizeCartItem(item))
    .filter((item): item is CartItem => Boolean(item));
}

function getLocationCart(cartByLocation: CartByLocation, locationId: string): CartItem[] {
  return normalizeLocationCart(cartByLocation[locationId] || []);
}

function mergeCartItem(
  destination: CartItem[],
  incoming: CartItem
): CartItem[] {
  if (incoming.inputMode === 'quantity') {
    const existingIndex = destination.findIndex(
      (item) =>
        item.inventoryItemId === incoming.inventoryItemId &&
        item.unitType === incoming.unitType &&
        item.inputMode === 'quantity'
    );

    if (existingIndex >= 0) {
      const existing = destination[existingIndex];
      const nextQuantity = (existing.quantityRequested ?? 0) + (incoming.quantityRequested ?? 0);
      const merged: CartItem = {
        ...existing,
        unitType: incoming.unitType,
        quantityRequested: nextQuantity,
        quantity: nextQuantity,
        note: existing.note ?? incoming.note ?? null,
      };
      return destination.map((item, idx) => (idx === existingIndex ? merged : item));
    }

    return [...destination, incoming];
  }

  // Remaining-mode merge rule: replace existing remaining row for same item+unit.
  const existingRemainingIndex = destination.findIndex(
    (item) =>
      item.inventoryItemId === incoming.inventoryItemId &&
      item.unitType === incoming.unitType &&
      item.inputMode === 'remaining'
  );

  if (existingRemainingIndex >= 0) {
    return destination.map((item, idx) => (idx === existingRemainingIndex ? incoming : item));
  }

  return [...destination, incoming];
}

function findCartItemIndex(
  locationCart: CartItem[],
  inventoryItemId: string,
  unitType: UnitType,
  cartItemId?: string
): number {
  if (cartItemId) {
    const byId = locationCart.findIndex((item) => item.id === cartItemId);
    if (byId >= 0) return byId;
  }

  const byInventoryAndUnit = locationCart.findIndex(
    (item) => item.inventoryItemId === inventoryItemId && item.unitType === unitType
  );
  if (byInventoryAndUnit >= 0) return byInventoryAndUnit;

  return locationCart.findIndex((item) => item.inventoryItemId === inventoryItemId);
}

function toOrderItemInsert(orderId: string, item: CartItem): Omit<OrderItem, 'id' | 'created_at'> {
  const quantity = getEffectiveQuantity(item);

  return {
    order_id: orderId,
    inventory_item_id: item.inventoryItemId,
    quantity,
    unit_type: item.unitType,
    input_mode: item.inputMode,
    quantity_requested: item.quantityRequested,
    remaining_reported: item.remainingReported,
    decided_quantity: item.decidedQuantity,
    decided_by: item.decidedBy,
    decided_at: item.decidedAt,
    note: item.note,
  };
}

function stripOrderItemNote(
  item: Omit<OrderItem, 'id' | 'created_at'>
): Omit<Omit<OrderItem, 'id' | 'created_at'>, 'note'> {
  const { note: _note, ...rest } = item;
  return rest;
}

function isMissingOrderItemNoteColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  if (err.code !== 'PGRST204') return false;
  const message = typeof err.message === 'string' ? err.message : '';
  return message.includes("'note'") && message.includes("'order_items'");
}

async function insertOrderItemsWithFallback(
  orderItems: Omit<OrderItem, 'id' | 'created_at'>[],
  options?: { includeInventorySelect?: boolean }
) {
  const includeInventorySelect = options?.includeInventorySelect === true;
  const shouldSendNote = orderItemsNoteColumnAvailable !== false;
  const payload = shouldSendNote ? orderItems : orderItems.map(stripOrderItemNote);

  let query = (supabase as any).from('order_items').insert(payload);
  if (includeInventorySelect) {
    query = query.select(`
      *,
      inventory_item:inventory_items(*)
    `);
  }

  const firstAttempt = await query;
  if (!firstAttempt.error) {
    if (shouldSendNote) {
      orderItemsNoteColumnAvailable = true;
    }
    return firstAttempt;
  }

  if (!shouldSendNote || !isMissingOrderItemNoteColumnError(firstAttempt.error)) {
    throw firstAttempt.error;
  }

  // Fallback for environments that have not applied the note migration yet.
  orderItemsNoteColumnAvailable = false;
  const fallbackPayload = orderItems.map(stripOrderItemNote);
  let fallbackQuery = (supabase as any).from('order_items').insert(fallbackPayload);
  if (includeInventorySelect) {
    fallbackQuery = fallbackQuery.select(`
      *,
      inventory_item:inventory_items(*)
    `);
  }

  const fallbackAttempt = await fallbackQuery;
  if (fallbackAttempt.error) {
    throw fallbackAttempt.error;
  }
  return fallbackAttempt;
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
        return Object.values(cartByLocation).flatMap((items) => normalizeLocationCart(items));
      },

      addToCart: (locationId, inventoryItemId, quantity, unitType, options) => {
        const { cartByLocation } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);

        const inputMode: OrderInputMode = options?.inputMode ?? 'quantity';
        const note = normalizeNote(options?.note);

        if (inputMode === 'quantity') {
          const quantityRequested = toValidNumber(options?.quantityRequested ?? quantity);
          if (quantityRequested === null || quantityRequested <= 0) return;

          const nextItem: CartItem = {
            id: createCartItemId(),
            inventoryItemId,
            unitType,
            inputMode,
            quantityRequested,
            remainingReported: null,
            decidedQuantity:
              toValidNumber(options?.decidedQuantity) !== null &&
              (toValidNumber(options?.decidedQuantity) as number) >= 0
                ? (toValidNumber(options?.decidedQuantity) as number)
                : null,
            decidedBy: typeof options?.decidedBy === 'string' ? options.decidedBy : null,
            decidedAt: typeof options?.decidedAt === 'string' ? options.decidedAt : null,
            quantity: quantityRequested,
            note,
          };

          const mergedCart = mergeCartItem(locationCart, nextItem);
          set({
            cartByLocation: {
              ...cartByLocation,
              [locationId]: mergedCart,
            },
          });
          return;
        }

        const remainingReported = toValidNumber(options?.remainingReported ?? quantity);
        if (remainingReported === null || remainingReported < 0) return;

        const decidedQuantityRaw = toValidNumber(options?.decidedQuantity);
        const decidedQuantity =
          decidedQuantityRaw !== null && decidedQuantityRaw >= 0 ? decidedQuantityRaw : null;

        const nextItem: CartItem = {
          id: createCartItemId(),
          inventoryItemId,
          unitType,
          inputMode: 'remaining',
          quantityRequested: null,
          remainingReported,
          decidedQuantity,
          decidedBy: typeof options?.decidedBy === 'string' ? options.decidedBy : null,
          decidedAt: typeof options?.decidedAt === 'string' ? options.decidedAt : null,
          quantity: decidedQuantity ?? 0,
          note,
        };

        const mergedCart = mergeCartItem(locationCart, nextItem);

        set({
          cartByLocation: {
            ...cartByLocation,
            [locationId]: mergedCart,
          },
        });
      },

      updateCartItem: (locationId, inventoryItemId, quantity, unitType, options) => {
        const { cartByLocation } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);

        const index = findCartItemIndex(
          locationCart,
          inventoryItemId,
          unitType,
          options?.cartItemId
        );

        if (index < 0) return;

        const existing = locationCart[index];
        const nextMode: OrderInputMode = options?.inputMode ?? existing.inputMode;

        if (nextMode === 'quantity') {
          const nextQuantity = toValidNumber(options?.quantityRequested ?? quantity);

          if (nextQuantity === null || nextQuantity <= 0) {
            const nextCart = locationCart.filter((_, idx) => idx !== index);
            set({
              cartByLocation: {
                ...cartByLocation,
                [locationId]: nextCart,
              },
            });
            return;
          }

          const updated: CartItem = {
            ...existing,
            unitType,
            inputMode: 'quantity',
            quantityRequested: nextQuantity,
            remainingReported: null,
            quantity: nextQuantity,
            decidedQuantity: options?.clearDecision ? null : existing.decidedQuantity,
            decidedBy: options?.clearDecision ? null : existing.decidedBy,
            decidedAt: options?.clearDecision ? null : existing.decidedAt,
          };

          const nextCart = locationCart.map((item, idx) => (idx === index ? updated : item));
          set({
            cartByLocation: {
              ...cartByLocation,
              [locationId]: nextCart,
            },
          });
          return;
        }

        const nextRemaining = toValidNumber(options?.remainingReported ?? quantity);
        if (nextRemaining === null || nextRemaining < 0) {
          const nextCart = locationCart.filter((_, idx) => idx !== index);
          set({
            cartByLocation: {
              ...cartByLocation,
              [locationId]: nextCart,
            },
          });
          return;
        }

        const updated: CartItem = {
          ...existing,
          unitType,
          inputMode: 'remaining',
          quantityRequested: null,
          remainingReported: nextRemaining,
          quantity: 0,
          decidedQuantity: null,
          decidedBy: null,
          decidedAt: null,
        };

        const nextCart = locationCart.map((item, idx) => (idx === index ? updated : item));
        set({
          cartByLocation: {
            ...cartByLocation,
            [locationId]: nextCart,
          },
        });
      },

      removeFromCart: (locationId, inventoryItemId, cartItemId) => {
        const { cartByLocation } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);

        const nextCart = cartItemId
          ? locationCart.filter((item) => item.id !== cartItemId)
          : locationCart.filter((item) => item.inventoryItemId !== inventoryItemId);

        set({
          cartByLocation: {
            ...cartByLocation,
            [locationId]: nextCart,
          },
        });
      },

      moveCartItem: (fromLocationId, toLocationId, inventoryItemId, unitType, cartItemId) => {
        if (fromLocationId === toLocationId) return;

        const { cartByLocation } = get();
        const fromCart = getLocationCart(cartByLocation, fromLocationId);
        const toCart = getLocationCart(cartByLocation, toLocationId);

        const index = findCartItemIndex(fromCart, inventoryItemId, unitType, cartItemId);
        if (index < 0) return;

        const itemToMove = fromCart[index];
        const newFromCart = fromCart.filter((_, idx) => idx !== index);
        const newToCart = mergeCartItem(toCart, { ...itemToMove });

        set({
          cartByLocation: {
            ...cartByLocation,
            [fromLocationId]: newFromCart,
            [toLocationId]: newToCart,
          },
        });
      },

      moveLocationCartItems: (fromLocationId, toLocationId) => {
        if (fromLocationId === toLocationId) return;

        const { cartByLocation } = get();
        const fromCart = getLocationCart(cartByLocation, fromLocationId);
        const toCart = getLocationCart(cartByLocation, toLocationId);

        if (fromCart.length === 0) return;

        let merged = [...toCart];
        fromCart.forEach((item) => {
          merged = mergeCartItem(merged, { ...item });
        });

        const nextCartByLocation = { ...cartByLocation };
        delete nextCartByLocation[fromLocationId];
        nextCartByLocation[toLocationId] = merged;

        set({ cartByLocation: nextCartByLocation });
      },

      moveAllCartItemsToLocation: (toLocationId) => {
        const { cartByLocation } = get();
        const allItems = Object.values(cartByLocation).flatMap((items) => normalizeLocationCart(items));

        if (allItems.length === 0) {
          return;
        }

        let merged: CartItem[] = [];
        allItems.forEach((item) => {
          merged = mergeCartItem(merged, { ...item });
        });

        set({
          cartByLocation: {
            [toLocationId]: merged,
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

      setCartItemDecision: (locationId, cartItemId, decidedQuantity, decidedBy) => {
        const { cartByLocation } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);

        const normalizedQuantity = Math.max(0, decidedQuantity);

        const nextCart = locationCart.map((item) => {
          if (item.id !== cartItemId) return item;
          if (item.inputMode !== 'remaining') return item;

          return {
            ...item,
            decidedQuantity: normalizedQuantity,
            decidedBy,
            decidedAt: new Date().toISOString(),
            quantity: normalizedQuantity,
          };
        });

        set({
          cartByLocation: {
            ...cartByLocation,
            [locationId]: nextCart,
          },
        });
      },

      setCartItemNote: (locationId, cartItemId, note) => {
        const { cartByLocation } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);
        const normalized = normalizeNote(note);

        const nextCart = locationCart.map((item) => {
          if (item.id !== cartItemId) return item;
          return {
            ...item,
            note: normalized,
          };
        });

        set({
          cartByLocation: {
            ...cartByLocation,
            [locationId]: nextCart,
          },
        });
      },

      getCartItems: (locationId) => {
        const { cartByLocation } = get();
        return getLocationCart(cartByLocation, locationId);
      },

      getCartItem: (locationId, inventoryItemId) => {
        const { cartByLocation } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);

        const quantityMode = locationCart.find(
          (item) => item.inventoryItemId === inventoryItemId && item.inputMode === 'quantity'
        );
        if (quantityMode) return quantityMode;

        return locationCart.find((item) => item.inventoryItemId === inventoryItemId);
      },

      getLocationCartTotal: (locationId) => {
        const { cartByLocation } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);

        return locationCart.reduce((total, item) => {
          if (item.inputMode === 'quantity') {
            return total + (item.quantityRequested ?? 0);
          }
          return total + 1;
        }, 0);
      },

      getTotalCartCount: () => {
        const { cartByLocation } = get();
        return Object.values(cartByLocation).reduce((total, rawItems) => {
          const items = normalizeLocationCart(rawItems);
          return total + items.length;
        }, 0);
      },

      getCartLocationIds: () => {
        const { cartByLocation } = get();
        return Object.keys(cartByLocation).filter((locId) => {
          const items = normalizeLocationCart(cartByLocation[locId]);
          return items.length > 0;
        });
      },

      hasUndecidedRemaining: (locationId) => {
        const { cartByLocation } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);
        return locationCart.some(
          (item) => item.inputMode === 'remaining' && (item.decidedQuantity === null || item.decidedQuantity < 0)
        );
      },

      getUndecidedRemainingItems: (locationId) => {
        const { cartByLocation } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);
        return locationCart.filter(
          (item) => item.inputMode === 'remaining' && (item.decidedQuantity === null || item.decidedQuantity < 0)
        );
      },

      // Legacy getCartTotal - returns total across all locations
      getCartTotal: () => {
        const { cartByLocation } = get();
        return Object.values(cartByLocation).reduce((total, rawItems) => {
          const items = normalizeLocationCart(rawItems);
          return total + items.length;
        }, 0);
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
        const locationCart = getLocationCart(cartByLocation, locationId);

        if (locationCart.length === 0) {
          throw new Error('Cart is empty for this location');
        }

        set({ isLoading: true });
        try {
          // Create order
          const orderResponse = await (supabase as any)
            .from('orders')
            .insert({
              location_id: locationId,
              user_id: userId,
              status: 'draft',
            })
            .select()
            .single();

          const order = orderResponse.data as any;
          const orderError = orderResponse.error;

          if (orderError) throw orderError;
          if (!order?.id) throw new Error('Failed to create order');

          // Create order items
          const orderItems: Omit<OrderItem, 'id' | 'created_at'>[] = locationCart.map((item) =>
            toOrderItemInsert(order.id, item)
          );

          await insertOrderItemsWithFallback(orderItems);

          clearLocationCart(locationId);
          return order;
        } finally {
          set({ isLoading: false });
        }
      },

      createAndSubmitOrder: async (locationId, userId) => {
        const { cartByLocation, clearLocationCart } = get();
        const locationCart = getLocationCart(cartByLocation, locationId);

        if (locationCart.length === 0) {
          throw new Error('Cart is empty for this location');
        }

        set({ isLoading: true });
        try {
          // Create order with status 'submitted' directly
          const orderResponse = await (supabase as any)
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

          const order = orderResponse.data as any;
          const orderError = orderResponse.error;

          if (orderError) throw orderError;
          if (!order?.id) throw new Error('Failed to create order');

          // Create order items
          const orderItemsToInsert: Omit<OrderItem, 'id' | 'created_at'>[] = locationCart.map((item) =>
            toOrderItemInsert(order.id, item)
          );

          const { data: createdItems } = await insertOrderItemsWithFallback(orderItemsToInsert, {
            includeInventorySelect: true,
          });

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
          const { error } = await (supabase as any)
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

          const { error } = await (supabase as any)
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
          const { error } = await (supabase as any)
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
          const { error } = await (supabase as any)
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
