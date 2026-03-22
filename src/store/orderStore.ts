// PHASE 3: Order lifecycle, past orders, order-later — direct Supabase calls,
// no matching edge functions yet. Covers shared data that the dashboard also reads.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {
  Order,
  OrderWithDetails,
  UnitType,
} from '@/types';
import { supabase } from '@/lib/supabase';
import { perfMark, perfMeasure } from '@/lib/perf';
import {
  loadPendingFulfillmentData,
} from '@/services/fulfillmentDataSource';
import {
  submitOrder as submitOrderService,
  syncProfileAfterOrder as syncProfileService,
  generateUUID,
} from '@/services/orderSubmission';

export * from './orderStore.types';
import type {
  CartByLocation,
  CartContext,
  CartItem,
  FulfillmentLocationGroup,
  LastOrderedQuantityCacheValue,
  LastOrderedQuantityLookupInput,
  LastOrderedQuantityLookupResult,
  OrderInputMode,
  OrderLaterItem,
  OrderLaterItemStatus,
  OrderState,
  PastOrder,
  PastOrderItem,
  PendingPastOrderSyncJob,
  SupplierDraftItem,
  SupplierDraftsBySupplier,
} from './orderStore.types';

import {
  tableFlags,
  orderLaterMoveInFlightIds,
  createCartItemId,
  resolveCurrentOrgId,
  toValidNumber,
  normalizeNote,
  getEffectiveQuantity,
  isSubmittableCartItem,
  normalizeCartItem,
  normalizeLocationCart,
  getLocationCart,
  normalizeCartByLocation,
  normalizeCartContext,
  getCartByContext,
  mergeCartItem,
  findCartItemIndex,
  cartItemToPayload,
  createFulfillmentId,
  toIsoString,
  toJsonObject,
  normalizeSupplierId,
  normalizeLocationGroup,
  toStringArray,
  normalizeHistoryLookupUnit,
  createLastOrderedAnyKey,
  createLastOrderedLocationIdKey,
  createLastOrderedLocationGroupKey,
  normalizeLastOrderedLookupInput,
  resolveLastOrderedFromCache,
  upsertLastOrderedCacheValue,
  isNetworkLikeError,
  isMissingTableError,
  isMissingColumnError,
  normalizeSupplierDrafts,
  normalizeOrderLaterItem,
  normalizeOrderLaterQueue,
  getPastOrderCountsFromPayload,
  normalizePastOrder,
  normalizePastOrders,
  normalizePastOrderItems,
  createPastOrderSyncJobId,
  normalizePendingPastOrderSyncQueue,
  mergeRemoteAndPendingPastOrders,
  extractPastOrderItemsFromPayload,
  extractConsumedOrderItemIds,
  removeConsumedOrderItems,
  cancelOrderLaterNotification,
  scheduleOrderLaterNotification,
  createOrderLaterInAppNotification,
} from './orderStore.helpers';

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      cartByLocation: {},
      managerCartByLocation: {},
      orders: [],
      currentOrder: null,
      isLoading: false,
      supplierDrafts: {},
      orderLaterQueue: [],
      pastOrders: [],
      pendingPastOrderSyncQueue: [],
      lastOrderedCacheBySupplier: {},
      isFulfillmentLoading: false,
      isPastOrderSyncing: false,

      // Legacy cart property - returns flattened cart for backward compatibility
      get cart() {
        const { cartByLocation } = get();
        return Object.entries(cartByLocation).flatMap(([locationId, items]) =>
          normalizeLocationCart(items, locationId)
        );
      },

      addToCart: (locationId, inventoryItemId, quantity, unitType, options) => {
        const resolvedContext = normalizeCartContext(options?.context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
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
          const nextCartByLocation = {
            ...cartByLocation,
            [locationId]: mergedCart,
          };
          // Unified cart: always write to cartByLocation for cross-mode sync
          set({ cartByLocation: nextCartByLocation });
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
        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: mergedCart,
        };
        // Unified cart: always write to cartByLocation for cross-mode sync
        set({ cartByLocation: nextCartByLocation });
      },

      updateCartItem: (locationId, inventoryItemId, quantity, unitType, options) => {
        const resolvedContext = normalizeCartContext(options?.context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
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
            const nextCartByLocation = {
              ...cartByLocation,
              [locationId]: nextCart,
            };
            // Unified cart: always write to cartByLocation for cross-mode sync
            set({ cartByLocation: nextCartByLocation });
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
          const nextCartByLocation = {
            ...cartByLocation,
            [locationId]: nextCart,
          };
          // Unified cart: always write to cartByLocation for cross-mode sync
          set({ cartByLocation: nextCartByLocation });
          return;
        }

        const nextRemaining = toValidNumber(options?.remainingReported ?? quantity);
        if (nextRemaining === null || nextRemaining < 0) {
          const nextCart = locationCart.filter((_, idx) => idx !== index);
          const nextCartByLocation = {
            ...cartByLocation,
            [locationId]: nextCart,
          };
          // Unified cart: always write to cartByLocation for cross-mode sync
          set({ cartByLocation: nextCartByLocation });
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
        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: nextCart,
        };
        // Unified cart: always write to cartByLocation for cross-mode sync
        set({ cartByLocation: nextCartByLocation });
      },

      removeFromCart: (locationId, inventoryItemId, cartItemId, context) => {
        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);

        const nextCart = cartItemId
          ? locationCart.filter((item) => item.id !== cartItemId)
          : locationCart.filter((item) => item.inventoryItemId !== inventoryItemId);

        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: nextCart,
        };
        // Unified cart: always write to cartByLocation for cross-mode sync
        set({ cartByLocation: nextCartByLocation });
      },

      moveCartItem: (fromLocationId, toLocationId, inventoryItemId, unitType, cartItemId, context) => {
        if (fromLocationId === toLocationId) return;

        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const fromCart = getLocationCart(cartByLocation, fromLocationId);
        const toCart = getLocationCart(cartByLocation, toLocationId);

        const index = findCartItemIndex(fromCart, inventoryItemId, unitType, cartItemId);
        if (index < 0) return;

        const itemToMove = fromCart[index];
        const newFromCart = fromCart.filter((_, idx) => idx !== index);
        const newToCart = mergeCartItem(toCart, { ...itemToMove });

        const nextCartByLocation = {
          ...cartByLocation,
          [fromLocationId]: newFromCart,
          [toLocationId]: newToCart,
        };
        // Unified cart: always write to cartByLocation for cross-mode sync
        set({ cartByLocation: nextCartByLocation });
      },

      moveLocationCartItems: (fromLocationId, toLocationId, context) => {
        if (fromLocationId === toLocationId) return;

        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
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

        // Unified cart: always write to cartByLocation for cross-mode sync
        set({ cartByLocation: nextCartByLocation });
      },

      moveAllCartItemsToLocation: (toLocationId, context) => {
        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const allItems = Object.entries(cartByLocation).flatMap(([locationId, items]) =>
          normalizeLocationCart(items, locationId)
        );

        if (allItems.length === 0) {
          return;
        }

        let merged: CartItem[] = [];
        allItems.forEach((item) => {
          merged = mergeCartItem(merged, { ...item });
        });

        // Unified cart: always write to cartByLocation for cross-mode sync
        set({
          cartByLocation: {
            [toLocationId]: merged,
          },
        });
      },

      clearLocationCart: (locationId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        const { [locationId]: _, ...rest } = cartByLocation;
        // Unified cart: always write to cartByLocation for cross-mode sync
        set({ cartByLocation: rest });
      },

      clearAllCarts: () => {
        // Unified cart: always write to cartByLocation for cross-mode sync
        set({ cartByLocation: {} });
      },

      // Legacy clearCart - clears all carts
      clearCart: () => set({ cartByLocation: {} }),

      setCartItemDecision: (locationId, cartItemId, decidedQuantity, decidedBy, context) => {
        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
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

        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: nextCart,
        };
        // Unified cart: always write to cartByLocation for cross-mode sync
        set({ cartByLocation: nextCartByLocation });
      },

      setCartItemNote: (locationId, cartItemId, note, context) => {
        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);
        const normalized = normalizeNote(note);

        const nextCart = locationCart.map((item) => {
          if (item.id !== cartItemId) return item;
          return {
            ...item,
            note: normalized,
          };
        });

        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: nextCart,
        };
        // Unified cart: always write to cartByLocation for cross-mode sync
        set({ cartByLocation: nextCartByLocation });
      },

      getCartItems: (locationId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        return getLocationCart(cartByLocation, locationId);
      },

      getCartItem: (locationId, inventoryItemId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        const locationCart = getLocationCart(cartByLocation, locationId);

        const quantityMode = locationCart.find(
          (item) => item.inventoryItemId === inventoryItemId && item.inputMode === 'quantity'
        );
        if (quantityMode) return quantityMode;

        return locationCart.find((item) => item.inventoryItemId === inventoryItemId);
      },

      getLocationCartTotal: (locationId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        const locationCart = getLocationCart(cartByLocation, locationId);

        return locationCart.reduce((total, item) => {
          if (item.inputMode === 'quantity') {
            return total + (item.quantityRequested ?? 0);
          }
          return total + 1;
        }, 0);
      },

      getTotalCartCount: (context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        return Object.entries(cartByLocation).reduce((total, [locationId, rawItems]) => {
          const items = normalizeLocationCart(rawItems, locationId);
          return total + items.length;
        }, 0);
      },

      getCartLocationIds: (context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        return Object.keys(cartByLocation).filter((locId) => {
          const items = normalizeLocationCart(cartByLocation[locId], locId);
          return items.length > 0;
        });
      },

      hasUndecidedRemaining: (locationId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        const locationCart = getLocationCart(cartByLocation, locationId);
        return locationCart.some(
          (item) => item.inputMode === 'remaining' && (item.decidedQuantity === null || item.decidedQuantity < 0)
        );
      },

      getUndecidedRemainingItems: (locationId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        const locationCart = getLocationCart(cartByLocation, locationId);
        return locationCart.filter(
          (item) => item.inputMode === 'remaining' && (item.decidedQuantity === null || item.decidedQuantity < 0)
        );
      },

      // Legacy getCartTotal - returns total across all locations
      getCartTotal: () => {
        const { cartByLocation } = get();
        return Object.entries(cartByLocation).reduce((total, [locationId, rawItems]) => {
          const items = normalizeLocationCart(rawItems, locationId);
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

      createOrder: async (locationId, userId, context) => {
        const resolvedContext = normalizeCartContext(context);
        const { clearLocationCart } = get();
        const cartByLocation = getCartByContext(get(), resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);

        if (locationCart.length === 0) {
          throw new Error('Cart is empty for this location');
        }

        const cartItemsForInsert = locationCart.filter(isSubmittableCartItem);
        if (cartItemsForInsert.length === 0) {
          throw new Error('All cart items are zero quantity. Update at least one item before submit.');
        }

        set({ isLoading: true });
        try {
          const result = await submitOrderService({
            orderId: generateUUID(),
            orgId: resolveCurrentOrgId(),
            locationId,
            userId,
            status: 'draft',
            items: cartItemsForInsert.map(cartItemToPayload),
          });

          syncProfileService(userId, result.order.created_at);
          clearLocationCart(locationId, resolvedContext);
          return result.order;
        } finally {
          set({ isLoading: false });
        }
      },

      createAndSubmitOrder: async (locationId, userId, context) => {
        const resolvedContext = normalizeCartContext(context);
        const { clearLocationCart } = get();
        const cartByLocation = getCartByContext(get(), resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);

        if (locationCart.length === 0) {
          throw new Error('Cart is empty for this location');
        }

        const cartItemsForInsert = locationCart.filter(isSubmittableCartItem);
        if (cartItemsForInsert.length === 0) {
          throw new Error('All cart items are zero quantity. Update at least one item before submit.');
        }

        set({ isLoading: true });
        try {
          const result = await submitOrderService({
            orderId: generateUUID(),
            orgId: resolveCurrentOrgId(),
            locationId,
            userId,
            status: 'submitted',
            items: cartItemsForInsert.map(cartItemToPayload),
          });

          syncProfileService(userId, result.order.created_at);
          clearLocationCart(locationId, resolvedContext);
          set({ currentOrder: result.order });
          return result.order;
        } finally {
          set({ isLoading: false });
        }
      },

      createAndSubmitOrderFromSourceLocation: async (
        sourceLocationId,
        submitLocationId,
        userId,
        context
      ) => {
        const resolvedContext = normalizeCartContext(context);
        const { clearLocationCart } = get();
        const cartByLocation = getCartByContext(get(), resolvedContext);
        const sourceLocationCart = getLocationCart(cartByLocation, sourceLocationId);

        if (sourceLocationCart.length === 0) {
          throw new Error('Cart is empty for this location');
        }

        const cartItemsForInsert = sourceLocationCart.filter(isSubmittableCartItem);
        if (cartItemsForInsert.length === 0) {
          throw new Error('All cart items are zero quantity. Update at least one item before submit.');
        }

        set({ isLoading: true });
        try {
          const result = await submitOrderService({
            orderId: generateUUID(),
            orgId: resolveCurrentOrgId(),
            locationId: submitLocationId,
            userId,
            status: 'submitted',
            items: cartItemsForInsert.map(cartItemToPayload),
          });

          syncProfileService(userId, result.order.created_at);
          clearLocationCart(sourceLocationId, resolvedContext);
          set({ currentOrder: result.order });
          return result.order;
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

      createPastOrder: async (input) => {
        const now = new Date().toISOString();
        const payloadFromInput = toJsonObject(input.payload);
        const payloadSourceOrderItemIds = Array.from(
          new Set([
            ...toStringArray(payloadFromInput.sourceOrderItemIds),
            ...toStringArray(payloadFromInput.source_order_item_ids),
          ])
        );
        const consumedOrderItemIds = Array.from(
          new Set(
            [
              ...(input.consumedOrderItemIds || []),
              ...payloadSourceOrderItemIds,
            ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          )
        );
        const consumedDraftItemIds = Array.from(
          new Set(
            (input.consumedDraftItemIds || [])
              .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          )
        );
        const normalizedLineItems = (input.lineItems || [])
          .map((line) => {
            const itemId = typeof line.itemId === 'string' ? line.itemId.trim() : '';
            const itemName = typeof line.itemName === 'string' ? line.itemName.trim() : '';
            const unit = normalizeHistoryLookupUnit(line.unit);
            const quantity = toValidNumber(line.quantity);
            if (!itemId || !itemName || !unit || quantity === null || quantity <= 0) {
              return null;
            }

            return {
              itemId,
              itemName,
              unit,
              quantity: Math.max(0, quantity),
              locationId:
                typeof line.locationId === 'string' && line.locationId.trim().length > 0
                  ? line.locationId.trim()
                  : null,
              locationName:
                typeof line.locationName === 'string' && line.locationName.trim().length > 0
                  ? line.locationName.trim()
                  : null,
              locationGroup: normalizeLocationGroup(line.locationGroup),
              unitType: line.unitType === 'base' || line.unitType === 'pack' ? line.unitType : null,
              note: normalizeNote(line.note),
            };
          })
          .filter((line): line is {
            itemId: string;
            itemName: string;
            unit: string;
            quantity: number;
            locationId: string | null;
            locationName: string | null;
            locationGroup: FulfillmentLocationGroup | null;
            unitType: UnitType | null;
            note: string | null;
          } => Boolean(line));

        const payload = {
          ...payloadFromInput,
          sourceOrderItemIds: consumedOrderItemIds,
          source_order_item_ids: consumedOrderItemIds,
          sourceDraftItemIds: consumedDraftItemIds,
          source_draft_item_ids: consumedDraftItemIds,
        };
        const counts = getPastOrderCountsFromPayload(payload);

        let nextPastOrder: PastOrder = {
          id: createFulfillmentId('past'),
          supplierId: input.supplierId,
          supplierName: input.supplierName,
          createdBy: input.createdBy,
          createdAt: now,
          payload,
          messageText: input.messageText,
          shareMethod: input.shareMethod,
          syncStatus: 'synced',
          pendingSyncJobId: null,
          syncError: null,
          itemCount: counts.itemCount,
          remainingCount: counts.remainingCount,
        };

        const syncJobId = createPastOrderSyncJobId();
        let queueJob: PendingPastOrderSyncJob | null = null;
        let persistedPastOrderId: string | null = null;

        const queueForSync = (errorMessage: string, existingPastOrderId: string | null) => {
          if (!queueJob) {
            queueJob = {
              id: syncJobId,
              localPastOrderId: nextPastOrder.id,
              existingPastOrderId,
              queuedAt: now,
              supplierId: input.supplierId,
              supplierName: input.supplierName,
              createdBy: input.createdBy,
              messageText: input.messageText,
              shareMethod: input.shareMethod,
              payload,
              lineItems: normalizedLineItems,
              consumedOrderItemIds,
              consumedDraftItemIds,
              retryCount: 0,
              lastError: errorMessage,
            };
          } else {
            queueJob = {
              ...queueJob,
              existingPastOrderId: queueJob.existingPastOrderId || existingPastOrderId,
              lastError: errorMessage,
            };
          }
          nextPastOrder = {
            ...nextPastOrder,
            syncStatus: 'pending_sync',
            pendingSyncJobId: syncJobId,
            syncError: errorMessage,
          };
        };

        if (tableFlags.pastOrdersTableAvailable !== false) {
          const { data, error } = await (supabase as any)
            .from('past_orders')
            .insert({
              supplier_id: input.supplierId,
              supplier_name: input.supplierName,
              created_by: input.createdBy,
              payload,
              message_text: input.messageText,
              share_method: input.shareMethod,
            })
            .select('*')
            .single();

          if (error) {
            if (isMissingTableError(error, 'past_orders')) {
              tableFlags.pastOrdersTableAvailable = false;
            }
            if (isNetworkLikeError(error) || isMissingTableError(error, 'past_orders')) {
              queueForSync(error?.message || 'Pending sync while offline.', null);
            } else {
              throw error;
            }
          } else {
            tableFlags.pastOrdersTableAvailable = true;
            if (typeof data?.id === 'string' && data.id.trim().length > 0) {
              persistedPastOrderId = data.id;
            }
            const parsed = normalizePastOrder(data);
            if (parsed) {
              nextPastOrder = {
                ...parsed,
                syncStatus: 'synced',
                pendingSyncJobId: null,
                syncError: null,
              };
              persistedPastOrderId = parsed.id;
            }
          }
        } else {
          queueForSync('Past orders table unavailable. Pending sync.', null);
        }

        if (
          persistedPastOrderId &&
          normalizedLineItems.length > 0 &&
          tableFlags.pastOrderItemsTableAvailable !== false
        ) {
          const buildRows = (includeNote: boolean) =>
            normalizedLineItems.map((line) => ({
              past_order_id: persistedPastOrderId,
              supplier_id: input.supplierId,
              created_by: input.createdBy,
              item_id: line.itemId,
              item_name: line.itemName,
              unit: line.unit,
              quantity: line.quantity,
              location_id: line.locationId,
              location_name: line.locationName,
              location_group: line.locationGroup,
              unit_type: line.unitType,
              ordered_at: nextPastOrder.createdAt,
              ...(includeNote ? { note: line.note } : {}),
            }));

          let includeNote = tableFlags.pastOrderItemsNoteColumnAvailable !== false;
          let { error } = await (supabase as any)
            .from('past_order_items')
            .insert(buildRows(includeNote));

          if (error && includeNote && isMissingColumnError(error, 'note')) {
            tableFlags.pastOrderItemsNoteColumnAvailable = false;
            includeNote = false;
            ({ error } = await (supabase as any)
              .from('past_order_items')
              .insert(buildRows(includeNote)));
          }

          if (error) {
            if (isMissingTableError(error, 'past_order_items')) {
              tableFlags.pastOrderItemsTableAvailable = false;
            }
            if (isNetworkLikeError(error) || isMissingTableError(error, 'past_order_items')) {
              queueForSync(
                error?.message || 'Pending sync for past-order items.',
                persistedPastOrderId
              );
            } else {
              throw error;
            }
          } else {
            tableFlags.pastOrderItemsTableAvailable = true;
            if (includeNote) {
              tableFlags.pastOrderItemsNoteColumnAvailable = true;
            }
          }
        }

        if (!persistedPastOrderId && !queueJob) {
          queueForSync('Pending sync while offline.', null);
        }

        if (consumedOrderItemIds.length > 0) {
          const marked = await get().markOrderItemsStatus(consumedOrderItemIds, 'sent');
          if (!marked && !queueJob) {
            queueForSync('Unable to mark order items as sent. Pending sync.', persistedPastOrderId);
          }
        }

        set((state) => {
          const nextQueue = queueJob
            ? normalizePendingPastOrderSyncQueue([
                ...state.pendingPastOrderSyncQueue.filter((job) => job.id !== queueJob?.id),
                queueJob,
              ])
            : state.pendingPastOrderSyncQueue;
          const nextPastOrders = normalizePastOrders([
            nextPastOrder,
            ...state.pastOrders.filter((row) => row.id !== nextPastOrder.id),
          ]);
          const nextConsumedIds = extractConsumedOrderItemIds(nextPastOrders);
          const nextOrders = removeConsumedOrderItems(state.orders, nextConsumedIds);

          const nextLastOrderedCacheBySupplier = { ...state.lastOrderedCacheBySupplier };
          if (normalizedLineItems.length > 0) {
            const supplierCache = { ...(nextLastOrderedCacheBySupplier[input.supplierId] || {}) };
            normalizedLineItems.forEach((line) => {
              const cacheValue: LastOrderedQuantityCacheValue = {
                quantity: line.quantity,
                orderedAt: nextPastOrder.createdAt,
              };

              upsertLastOrderedCacheValue(
                supplierCache,
                createLastOrderedAnyKey(line.itemId, line.unit),
                cacheValue
              );

              if (line.locationId) {
                upsertLastOrderedCacheValue(
                  supplierCache,
                  createLastOrderedLocationIdKey(line.itemId, line.unit, line.locationId),
                  cacheValue
                );
              }
              if (line.locationGroup) {
                upsertLastOrderedCacheValue(
                  supplierCache,
                  createLastOrderedLocationGroupKey(line.itemId, line.unit, line.locationGroup),
                  cacheValue
                );
              }
            });

            nextLastOrderedCacheBySupplier[input.supplierId] = supplierCache;
          }

          return {
            pastOrders: nextPastOrders,
            pendingPastOrderSyncQueue: nextQueue,
            orders: nextOrders,
            lastOrderedCacheBySupplier: nextLastOrderedCacheBySupplier,
          };
        });

        return nextPastOrder;
      },

      flushPendingPastOrderSync: async (managerId) => {
        const queueSnapshot = [...get().pendingPastOrderSyncQueue];
        if (queueSnapshot.length === 0) return;
        if (get().isPastOrderSyncing) return;

        set({ isPastOrderSyncing: true });
        try {
          let nextQueue: PendingPastOrderSyncJob[] = [];
          let nextPastOrders = [...get().pastOrders];

          for (const job of queueSnapshot) {
            let persistedPastOrderId = job.existingPastOrderId;
            let syncedOrder: PastOrder | null = null;
            let retryError: string | null = null;

            try {
              if (!persistedPastOrderId) {
                if (tableFlags.pastOrdersTableAvailable === false) {
                  throw new Error('past_orders table unavailable');
                }

                const { data, error } = await (supabase as any)
                  .from('past_orders')
                  .insert({
                    supplier_id: job.supplierId,
                    supplier_name: job.supplierName,
                    created_by: job.createdBy,
                    payload: job.payload,
                    message_text: job.messageText,
                    share_method: job.shareMethod,
                  })
                  .select('*')
                  .single();

                if (error) throw error;
                tableFlags.pastOrdersTableAvailable = true;
                const parsed = normalizePastOrder(data);
                if (parsed) {
                  syncedOrder = parsed;
                  persistedPastOrderId = parsed.id;
                } else if (typeof data?.id === 'string' && data.id.trim().length > 0) {
                  persistedPastOrderId = data.id;
                }
              }

              if (persistedPastOrderId && job.lineItems.length > 0) {
                if (tableFlags.pastOrderItemsTableAvailable === false) {
                  throw new Error('past_order_items table unavailable');
                }

                // Make retries idempotent for an already-created past order.
                await (supabase as any)
                  .from('past_order_items')
                  .delete()
                  .eq('past_order_id', persistedPastOrderId)
                  .eq('created_by', job.createdBy);

                const buildRows = (includeNote: boolean) =>
                  job.lineItems.map((line) => ({
                    past_order_id: persistedPastOrderId,
                    supplier_id: job.supplierId,
                    created_by: job.createdBy,
                    item_id: line.itemId,
                    item_name: line.itemName,
                    unit: line.unit,
                    quantity: line.quantity,
                    location_id: line.locationId ?? null,
                    location_name: line.locationName ?? null,
                    location_group: line.locationGroup ?? null,
                    unit_type: line.unitType ?? null,
                    ordered_at: syncedOrder?.createdAt || new Date().toISOString(),
                    ...(includeNote ? { note: line.note ?? null } : {}),
                  }));

                let includeNote = tableFlags.pastOrderItemsNoteColumnAvailable !== false;
                let { error } = await (supabase as any)
                  .from('past_order_items')
                  .insert(buildRows(includeNote));

                if (error && includeNote && isMissingColumnError(error, 'note')) {
                  tableFlags.pastOrderItemsNoteColumnAvailable = false;
                  includeNote = false;
                  ({ error } = await (supabase as any)
                    .from('past_order_items')
                    .insert(buildRows(includeNote)));
                }

                if (error) throw error;
                tableFlags.pastOrderItemsTableAvailable = true;
                if (includeNote) {
                  tableFlags.pastOrderItemsNoteColumnAvailable = true;
                }
              }

              if (job.consumedOrderItemIds.length > 0) {
                const sentMarked = await get().markOrderItemsStatus(job.consumedOrderItemIds, 'sent');
                if (!sentMarked) {
                  throw new Error('Unable to mark order items as sent during sync.');
                }
              }

              if (!syncedOrder) {
                const existing = nextPastOrders.find(
                  (row) => row.id === (persistedPastOrderId || job.localPastOrderId)
                );
                syncedOrder = {
                  ...(existing || {
                    id: persistedPastOrderId || job.localPastOrderId,
                    supplierId: job.supplierId,
                    supplierName: job.supplierName,
                    createdBy: job.createdBy,
                    createdAt: new Date().toISOString(),
                    payload: job.payload,
                    messageText: job.messageText,
                    shareMethod: job.shareMethod,
                    itemCount: getPastOrderCountsFromPayload(job.payload).itemCount,
                    remainingCount: getPastOrderCountsFromPayload(job.payload).remainingCount,
                  }),
                  id: persistedPastOrderId || job.localPastOrderId,
                  syncStatus: 'synced',
                  pendingSyncJobId: null,
                  syncError: null,
                };
              } else {
                syncedOrder = {
                  ...syncedOrder,
                  syncStatus: 'synced',
                  pendingSyncJobId: null,
                  syncError: null,
                };
              }

              nextPastOrders = normalizePastOrders([
                syncedOrder,
                ...nextPastOrders.filter(
                  (row) => row.id !== job.localPastOrderId && row.id !== syncedOrder?.id
                ),
              ]);
            } catch (error: any) {
              if (isMissingTableError(error, 'past_orders')) tableFlags.pastOrdersTableAvailable = false;
              if (isMissingTableError(error, 'past_order_items')) tableFlags.pastOrderItemsTableAvailable = false;
              retryError = error?.message || 'Pending sync failed.';
            }

            if (retryError) {
              nextQueue.push({
                ...job,
                existingPastOrderId: persistedPastOrderId || job.existingPastOrderId,
                retryCount: job.retryCount + 1,
                lastError: retryError,
              });
              nextPastOrders = normalizePastOrders(
                nextPastOrders.map((row) =>
                  row.id === job.localPastOrderId
                    ? {
                        ...row,
                        syncStatus: 'pending_sync',
                        pendingSyncJobId: job.id,
                        syncError: retryError,
                      }
                    : row
                )
              );
            }
          }

          set({
            pendingPastOrderSyncQueue: normalizePendingPastOrderSyncQueue(nextQueue),
            pastOrders: nextPastOrders,
          });

          const userId =
            typeof managerId === 'string' && managerId.trim().length > 0 ? managerId : null;
          if (userId) {
            await get().fetchPastOrders(userId);
          }
        } finally {
          set({ isPastOrderSyncing: false });
        }
      },

      fetchPastOrders: async (managerId) => {
        let remotePastOrders: PastOrder[] | null = null;
        if (tableFlags.pastOrdersTableAvailable !== false) {
          const { data, error } = await (supabase as any)
            .from('past_orders')
            .select('id,supplier_id,supplier_name,created_by,created_at,payload,message_text,share_method')
            .order('created_at', { ascending: false })
            .limit(500);

          if (error) {
            if (isMissingTableError(error, 'past_orders')) {
              tableFlags.pastOrdersTableAvailable = false;
            } else {
              console.warn('Unable to load past_orders, using local fallback.', error);
            }
          } else {
            tableFlags.pastOrdersTableAvailable = true;
            remotePastOrders = normalizePastOrders(data || []);
          }
        }

        if (remotePastOrders && remotePastOrders.length > 0 && tableFlags.pastOrderItemsTableAvailable !== false) {
          const ids = remotePastOrders.map((row) => row.id);
          const { data, error } = await (supabase as any)
            .from('past_order_items')
            .select('past_order_id')
            .in('past_order_id', ids)
            .limit(12000);

          if (error) {
            if (isMissingTableError(error, 'past_order_items')) {
              tableFlags.pastOrderItemsTableAvailable = false;
            } else {
              console.warn('Unable to load past_order_items counts.', error);
            }
          } else {
            tableFlags.pastOrderItemsTableAvailable = true;
            const countsByPastOrderId = new Map<string, number>();
            (data || []).forEach((row: any) => {
              const pastOrderId =
                typeof row?.past_order_id === 'string' && row.past_order_id.trim().length > 0
                  ? row.past_order_id
                  : '';
              if (!pastOrderId) return;
              countsByPastOrderId.set(pastOrderId, (countsByPastOrderId.get(pastOrderId) || 0) + 1);
            });

            remotePastOrders = remotePastOrders.map((row) => ({
              ...row,
              itemCount: countsByPastOrderId.get(row.id) ?? row.itemCount,
            }));
          }
        }

        const merged = remotePastOrders
          ? mergeRemoteAndPendingPastOrders(
              remotePastOrders,
              get().pastOrders,
              get().pendingPastOrderSyncQueue
            )
          : normalizePastOrders(get().pastOrders);

        set({ pastOrders: merged });
        return merged;
      },

      fetchPastOrderById: async (pastOrderId, managerId) => {
        const normalizedPastOrderId =
          typeof pastOrderId === 'string' && pastOrderId.trim().length > 0 ? pastOrderId.trim() : '';
        if (!normalizedPastOrderId) return null;

        let order = get().pastOrders.find((row) => row.id === normalizedPastOrderId) || null;
        if (tableFlags.pastOrdersTableAvailable !== false) {
          const { data, error } = await (supabase as any)
            .from('past_orders')
            .select('*')
            .eq('id', normalizedPastOrderId)
            .maybeSingle();

          if (error) {
            if (isMissingTableError(error, 'past_orders')) {
              tableFlags.pastOrdersTableAvailable = false;
            } else {
              console.warn('Unable to load past_orders detail.', error);
            }
          } else if (data) {
            tableFlags.pastOrdersTableAvailable = true;
            const parsed = normalizePastOrder(data);
            if (parsed) {
              const existingPending = get().pastOrders.find((row) => row.id === parsed.id);
              order = existingPending?.syncStatus === 'pending_sync'
                ? {
                    ...parsed,
                    syncStatus: existingPending.syncStatus,
                    pendingSyncJobId: existingPending.pendingSyncJobId,
                    syncError: existingPending.syncError,
                  }
                : parsed;
            }
          }
        }

        if (!order) return null;

        let items: PastOrderItem[] = [];
        if (tableFlags.pastOrderItemsTableAvailable !== false) {
          const { data, error } = await (supabase as any)
            .from('past_order_items')
            .select('*')
            .eq('past_order_id', normalizedPastOrderId)
            .order('ordered_at', { ascending: true });

          if (error) {
            if (isMissingTableError(error, 'past_order_items')) {
              tableFlags.pastOrderItemsTableAvailable = false;
            } else {
              console.warn('Unable to load past_order_items detail.', error);
            }
          } else {
            tableFlags.pastOrderItemsTableAvailable = true;
            items = normalizePastOrderItems(data || []);
          }
        }

        if (items.length === 0) {
          items = extractPastOrderItemsFromPayload(order);
        }

        return { order, items };
      },

      loadFulfillmentData: async (managerId, locationIds) => {
        perfMark('loadFulfillmentData');
        const userId =
          typeof managerId === 'string' && managerId.trim().length > 0
            ? managerId
            : null;
        const normalizedLocationIds = Array.from(
          new Set(
            (locationIds || [])
              .filter((id): id is string => typeof id === 'string')
              .map((id) => id.trim())
              .filter((id) => id.length > 0)
          )
        );

        set({ isFulfillmentLoading: true });
        try {
          await get().flushPendingPastOrderSync(userId);

          const nextPastOrders = await get().fetchPastOrders(userId);
          let nextOrderLaterQueue = get().orderLaterQueue;

          if (tableFlags.orderLaterItemsTableAvailable !== false) {
            const baseQuery = () =>
              (supabase as any)
                .from('order_later_items')
                .select('*')
                .eq('status', 'queued')
                .order('scheduled_at', { ascending: true });
            const rowsById = new Map<string, unknown>();
            let hadSuccess = false;
            let hadError = false;

            const mergeRows = (rows: unknown) => {
              if (!Array.isArray(rows)) return;
              rows.forEach((row) => {
                const id = typeof (row as any)?.id === 'string' ? (row as any).id : '';
                if (!id) return;
                rowsById.set(id, row);
              });
            };

            if (normalizedLocationIds.length > 0) {
              const { data, error } = await baseQuery()
                .in('location_id', normalizedLocationIds)
                .limit(800);
              if (error) {
                hadError = true;
                if (isMissingTableError(error, 'order_later_items')) {
                  tableFlags.orderLaterItemsTableAvailable = false;
                } else {
                  console.warn('Unable to load shared order_later_items rows.', error);
                }
              } else {
                hadSuccess = true;
                tableFlags.orderLaterItemsTableAvailable = true;
                mergeRows(data);
              }

              if (userId) {
                const { data: unassignedRows, error: unassignedError } = await baseQuery()
                  .eq('created_by', userId)
                  .is('location_id', null)
                  .limit(200);
                if (unassignedError) {
                  hadError = true;
                  if (!isMissingTableError(unassignedError, 'order_later_items')) {
                    console.warn('Unable to load unassigned order_later_items rows.', unassignedError);
                  }
                } else {
                  hadSuccess = true;
                  tableFlags.orderLaterItemsTableAvailable = true;
                  mergeRows(unassignedRows);
                }
              }
            } else if (userId) {
              const { data, error } = await baseQuery()
                .eq('created_by', userId)
                .limit(600);
              if (error) {
                hadError = true;
                if (isMissingTableError(error, 'order_later_items')) {
                  tableFlags.orderLaterItemsTableAvailable = false;
                } else {
                  console.warn('Unable to load order_later_items, using local fallback.', error);
                }
              } else {
                hadSuccess = true;
                tableFlags.orderLaterItemsTableAvailable = true;
                mergeRows(data);
              }
            }

            if (hadSuccess) {
              nextOrderLaterQueue = normalizeOrderLaterQueue(Array.from(rowsById.values()));
            } else if (hadError && tableFlags.orderLaterItemsTableAvailable !== false) {
              console.warn('Falling back to local order-later queue.');
            }
          }

          set((state) => {
            const consumed = extractConsumedOrderItemIds(nextPastOrders);
            return {
              pastOrders: nextPastOrders,
              orderLaterQueue: nextOrderLaterQueue,
              orders: removeConsumedOrderItems(state.orders, consumed),
            };
          });

          const queueSnapshot = [...get().orderLaterQueue];
          let queueChanged = false;
          for (const row of queueSnapshot) {
            const scheduledAtMs = new Date(row.scheduledAt).getTime();
            if (row.notificationId || !Number.isFinite(scheduledAtMs) || scheduledAtMs <= Date.now()) {
              continue;
            }

            const notificationId = await scheduleOrderLaterNotification({
              orderLaterItemId: row.id,
              itemName: row.itemName,
              scheduledAt: row.scheduledAt,
            });

            if (!notificationId) continue;

            queueChanged = true;
            row.notificationId = notificationId;

            if (tableFlags.orderLaterItemsTableAvailable !== false) {
              try {
                await (supabase as any)
                  .from('order_later_items')
                  .update({ notification_id: notificationId })
                  .eq('id', row.id);
              } catch {
                // Best-effort sync only.
              }
            }
          }

          if (queueChanged) {
            set({ orderLaterQueue: normalizeOrderLaterQueue(queueSnapshot) });
          }
        } finally {
          set({ isFulfillmentLoading: false });
          perfMeasure('loadFulfillmentData');
        }
      },

      fetchPendingFulfillmentOrders: async (locationIds) => {
        perfMark('fetchPendingFulfillmentOrders');
        set({ isFulfillmentLoading: true });
        try {
          // Use pastOrders already in state (loadFulfillmentData refreshes them
          // before this runs). Avoids a redundant fetchPastOrders round-trip.
          const currentPastOrders = get().pastOrders;
          const consumedOrderItemIds = extractConsumedOrderItemIds(currentPastOrders);
          if (__DEV__) {
            const consumedPreview = Array.from(consumedOrderItemIds.values()).slice(0, 10);
            console.log(
              '[FulfillmentStore] consumed order_item ids from past orders:',
              consumedOrderItemIds.size,
              consumedPreview
            );
          }
          const result = await loadPendingFulfillmentData({
            consumedOrderItemIds,
            includeInventoryAudit: __DEV__,
            locationIds,
          });
          set({ orders: result.orders });
        } finally {
          set({ isFulfillmentLoading: false });
          perfMeasure('fetchPendingFulfillmentOrders');
        }
      },

      addSupplierDraftItem: (input) => {
        const now = new Date().toISOString();
        const safeQuantity = Math.max(0, toValidNumber(input.quantity) ?? 0);
        if (safeQuantity <= 0) {
          throw new Error('Draft quantity must be greater than zero.');
        }

        const supplierId = input.supplierId;
        const unitType: UnitType = input.unitType === 'pack' ? 'pack' : 'base';
        const nextItem: SupplierDraftItem = {
          id: createFulfillmentId('draft'),
          supplierId,
          inventoryItemId:
            typeof input.inventoryItemId === 'string' && input.inventoryItemId.trim().length > 0
              ? input.inventoryItemId
              : null,
          name: input.name.trim(),
          category:
            typeof input.category === 'string' && input.category.trim().length > 0
              ? input.category
              : 'dry',
          quantity: safeQuantity,
          unitType,
          unitLabel:
            typeof input.unitLabel === 'string' && input.unitLabel.trim().length > 0
              ? input.unitLabel.trim()
              : unitType === 'pack'
                ? 'pack'
                : 'unit',
          locationGroup: input.locationGroup === 'poki' ? 'poki' : 'sushi',
          locationId:
            typeof input.locationId === 'string' && input.locationId.trim().length > 0
              ? input.locationId
              : null,
          locationName:
            typeof input.locationName === 'string' && input.locationName.trim().length > 0
              ? input.locationName.trim()
              : null,
          note: normalizeNote(input.note),
          createdAt: now,
          sourceOrderLaterItemId:
            typeof input.sourceOrderLaterItemId === 'string' &&
            input.sourceOrderLaterItemId.trim().length > 0
              ? input.sourceOrderLaterItemId
              : null,
        };

        let createdItem = nextItem;
        set((state) => {
          const supplierRows = state.supplierDrafts[supplierId] || [];
          const existingIndex = supplierRows.findIndex((row) => {
            const sameInventory =
              row.inventoryItemId && nextItem.inventoryItemId
                ? row.inventoryItemId === nextItem.inventoryItemId
                : row.name.toLowerCase() === nextItem.name.toLowerCase();
            return (
              sameInventory &&
              row.locationGroup === nextItem.locationGroup &&
              row.unitType === nextItem.unitType
            );
          });

          if (existingIndex >= 0) {
            const merged: SupplierDraftItem = {
              ...supplierRows[existingIndex],
              quantity: supplierRows[existingIndex].quantity + nextItem.quantity,
              note: supplierRows[existingIndex].note ?? nextItem.note,
              createdAt: now,
            };
            createdItem = merged;
            return {
              supplierDrafts: {
                ...state.supplierDrafts,
                [supplierId]: supplierRows.map((row, index) =>
                  index === existingIndex ? merged : row
                ),
              },
            };
          }

          createdItem = nextItem;
          return {
            supplierDrafts: {
              ...state.supplierDrafts,
              [supplierId]: [nextItem, ...supplierRows],
            },
          };
        });

        return createdItem;
      },

      updateSupplierDraftItemQuantity: (draftItemId, quantity) => {
        const safeQuantity = Math.max(0, toValidNumber(quantity) ?? 0);
        if (safeQuantity <= 0) {
          get().removeSupplierDraftItem(draftItemId);
          return;
        }

        set((state) => {
          const nextDrafts: SupplierDraftsBySupplier = {};
          Object.entries(state.supplierDrafts).forEach(([supplierId, rows]) => {
            const normalizedRows = rows.map((row) =>
              row.id === draftItemId
                ? { ...row, quantity: safeQuantity, createdAt: new Date().toISOString() }
                : row
            );
            if (normalizedRows.length > 0) {
              nextDrafts[supplierId] = normalizedRows;
            }
          });
          return { supplierDrafts: nextDrafts };
        });
      },

      removeSupplierDraftItem: (draftItemId) => {
        set((state) => {
          const nextDrafts: SupplierDraftsBySupplier = {};
          Object.entries(state.supplierDrafts).forEach(([supplierId, rows]) => {
            const nextRows = rows.filter((row) => row.id !== draftItemId);
            if (nextRows.length > 0) {
              nextDrafts[supplierId] = nextRows;
            }
          });
          return { supplierDrafts: nextDrafts };
        });
      },

      removeSupplierDraftItems: (draftItemIds) => {
        const idSet = new Set(
          draftItemIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        );
        if (idSet.size === 0) return;

        set((state) => {
          const nextDrafts: SupplierDraftsBySupplier = {};
          Object.entries(state.supplierDrafts).forEach(([supplierId, rows]) => {
            const nextRows = rows.filter((row) => !idSet.has(row.id));
            if (nextRows.length > 0) {
              nextDrafts[supplierId] = nextRows;
            }
          });
          return { supplierDrafts: nextDrafts };
        });
      },

      getSupplierDraftItems: (supplierId) => {
        const supplierRows = get().supplierDrafts[supplierId] || [];
        return [...supplierRows].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      },

      createOrderLaterItem: async (input) => {
        const createdAt = new Date().toISOString();
        const scheduledAt = toIsoString(input.scheduledAt);
        const payload = toJsonObject(input.payload);
        const payloadQuantity = toValidNumber(payload.quantity);
        const inputQuantity = toValidNumber(input.quantity);
        const normalizedQuantity = Math.max(0, inputQuantity ?? payloadQuantity ?? 1);
        const normalizedInput = {
          createdBy: input.createdBy,
          quantity: normalizedQuantity,
          itemId:
            typeof input.itemId === 'string' && input.itemId.trim().length > 0
              ? input.itemId
              : null,
          itemName: input.itemName.trim(),
          unit: input.unit.trim().length > 0 ? input.unit.trim() : 'unit',
          locationId:
            typeof input.locationId === 'string' && input.locationId.trim().length > 0
              ? input.locationId
              : null,
          locationName:
            typeof input.locationName === 'string' && input.locationName.trim().length > 0
              ? input.locationName.trim()
              : null,
          notes: normalizeNote(input.notes),
          suggestedSupplierId: normalizeSupplierId(input.suggestedSupplierId),
          preferredSupplierId: normalizeSupplierId(input.preferredSupplierId),
          preferredLocationGroup: normalizeLocationGroup(input.preferredLocationGroup),
          sourceOrderItemId:
            typeof input.sourceOrderItemId === 'string' && input.sourceOrderItemId.trim().length > 0
              ? input.sourceOrderItemId
              : null,
          sourceOrderItemIds: Array.from(
            new Set(
              (input.sourceOrderItemIds || [])
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
                .map((id) => id.trim())
            )
          ),
          sourceOrderId:
            typeof input.sourceOrderId === 'string' && input.sourceOrderId.trim().length > 0
              ? input.sourceOrderId
              : null,
          payload: {
            ...payload,
            quantity: normalizedQuantity,
          },
        };
        const normalizedSourceOrderItemIds =
          normalizedInput.sourceOrderItemIds.length > 0
            ? normalizedInput.sourceOrderItemIds
            : normalizedInput.sourceOrderItemId
              ? [normalizedInput.sourceOrderItemId]
              : [];

        if (normalizedSourceOrderItemIds.length > 0) {
          const sourceIdSet = new Set(normalizedSourceOrderItemIds);
          const hasSourceOverlap = (item: OrderLaterItem) => {
            if (item.status !== 'queued') return false;
            if (item.sourceOrderItemId && sourceIdSet.has(item.sourceOrderItemId)) return true;
            return item.sourceOrderItemIds.some((id) => sourceIdSet.has(id));
          };

          const localExisting = get().orderLaterQueue.find(hasSourceOverlap);
          if (localExisting) {
            return localExisting;
          }

          if (tableFlags.orderLaterItemsTableAvailable !== false) {
            let remoteRows: any[] = [];

            const { data: sourceOrderItemRows, error: sourceOrderItemError } = await (supabase as any)
              .from('order_later_items')
              .select('*')
              .in('status', ['queued', 'added'])
              .in('source_order_item_id', normalizedSourceOrderItemIds)
              .order('created_at', { ascending: false })
              .limit(1);

            if (sourceOrderItemError) {
              if (isMissingTableError(sourceOrderItemError, 'order_later_items')) {
                tableFlags.orderLaterItemsTableAvailable = false;
              } else {
                console.warn('Unable to check order_later_items duplicates (source_order_item_id).', sourceOrderItemError);
              }
            } else {
              tableFlags.orderLaterItemsTableAvailable = true;
              remoteRows = Array.isArray(sourceOrderItemRows) ? sourceOrderItemRows : [];
            }

            if (remoteRows.length === 0 && tableFlags.orderLaterItemsTableAvailable !== false) {
              const { data: overlapRows, error: overlapError } = await (supabase as any)
                .from('order_later_items')
                .select('*')
                .in('status', ['queued', 'added'])
                .overlaps('original_order_item_ids', normalizedSourceOrderItemIds)
                .order('created_at', { ascending: false })
                .limit(1);

              if (overlapError) {
                if (isMissingTableError(overlapError, 'order_later_items')) {
                  tableFlags.orderLaterItemsTableAvailable = false;
                } else if (!isMissingColumnError(overlapError, 'original_order_item_ids')) {
                  console.warn('Unable to check order_later_items duplicates (original_order_item_ids).', overlapError);
                }
              } else {
                tableFlags.orderLaterItemsTableAvailable = true;
                remoteRows = Array.isArray(overlapRows) ? overlapRows : [];
              }
            }

            const remoteExisting = normalizeOrderLaterItem(remoteRows[0]);
            if (remoteExisting && hasSourceOverlap(remoteExisting)) {
              set((state) => ({
                orderLaterQueue: normalizeOrderLaterQueue([
                  remoteExisting,
                  ...state.orderLaterQueue.filter((row) => row.id !== remoteExisting.id),
                ]),
              }));
              return remoteExisting;
            }
          }
        }

        let orderLaterItem: OrderLaterItem | null = null;

        if (tableFlags.orderLaterItemsTableAvailable !== false) {
          const insertPayloadWithExtended: Record<string, unknown> = {
            created_by: normalizedInput.createdBy,
            scheduled_at: scheduledAt,
            qty: normalizedInput.quantity,
            item_id: normalizedInput.itemId,
            item_name: normalizedInput.itemName,
            unit: normalizedInput.unit,
            location_id: normalizedInput.locationId,
            location_name: normalizedInput.locationName,
            notes: normalizedInput.notes,
            suggested_supplier_id: normalizedInput.suggestedSupplierId,
            preferred_supplier_id: normalizedInput.preferredSupplierId,
            preferred_location_group: normalizedInput.preferredLocationGroup,
            source_order_item_id: normalizedInput.sourceOrderItemId,
            original_order_item_ids:
              normalizedInput.sourceOrderItemIds.length > 0
                ? normalizedInput.sourceOrderItemIds
                : normalizedInput.sourceOrderItemId
                  ? [normalizedInput.sourceOrderItemId]
                  : [],
            source_order_id: normalizedInput.sourceOrderId,
            status: 'queued',
            payload: normalizedInput.payload,
          };

          let { data, error } = await (supabase as any)
            .from('order_later_items')
            .insert(insertPayloadWithExtended)
            .select('*')
            .single();

          if (
            error &&
            (isMissingColumnError(error, 'qty') ||
              isMissingColumnError(error, 'suggested_supplier_id') ||
              isMissingColumnError(error, 'original_order_item_ids'))
          ) {
            const legacyPayload = {
              created_by: normalizedInput.createdBy,
              scheduled_at: scheduledAt,
              item_id: normalizedInput.itemId,
              item_name: normalizedInput.itemName,
              unit: normalizedInput.unit,
              location_id: normalizedInput.locationId,
              location_name: normalizedInput.locationName,
              notes: normalizedInput.notes,
              preferred_supplier_id: normalizedInput.preferredSupplierId,
              preferred_location_group: normalizedInput.preferredLocationGroup,
              source_order_item_id: normalizedInput.sourceOrderItemId,
              source_order_id: normalizedInput.sourceOrderId,
              status: 'queued',
              payload: normalizedInput.payload,
            };

            ({ data, error } = await (supabase as any)
              .from('order_later_items')
              .insert(legacyPayload)
              .select('*')
              .single());
          }

          if (error) {
            if (isMissingTableError(error, 'order_later_items')) {
              tableFlags.orderLaterItemsTableAvailable = false;
            } else {
              console.warn('Unable to persist order_later_items row; using local fallback.', error);
            }
          } else {
            tableFlags.orderLaterItemsTableAvailable = true;
            orderLaterItem = normalizeOrderLaterItem(data);
          }
        }

        if (!orderLaterItem) {
          orderLaterItem = {
            id: createFulfillmentId('later'),
            createdBy: normalizedInput.createdBy,
            createdAt,
            scheduledAt,
            quantity: normalizedInput.quantity,
            itemId: normalizedInput.itemId,
            itemName: normalizedInput.itemName,
            unit: normalizedInput.unit,
            locationId: normalizedInput.locationId,
            locationName: normalizedInput.locationName,
            notes: normalizedInput.notes,
            suggestedSupplierId: normalizedInput.suggestedSupplierId,
            preferredSupplierId: normalizedInput.preferredSupplierId,
            preferredLocationGroup: normalizedInput.preferredLocationGroup,
            sourceOrderItemId: normalizedInput.sourceOrderItemId,
            sourceOrderItemIds:
              normalizedInput.sourceOrderItemIds.length > 0
                ? normalizedInput.sourceOrderItemIds
                : normalizedInput.sourceOrderItemId
                  ? [normalizedInput.sourceOrderItemId]
                  : [],
            sourceOrderId: normalizedInput.sourceOrderId,
            notificationId: null,
            status: 'queued',
            payload: normalizedInput.payload,
          };
        }

        const notificationId = await scheduleOrderLaterNotification({
          orderLaterItemId: orderLaterItem.id,
          itemName: orderLaterItem.itemName,
          scheduledAt: orderLaterItem.scheduledAt,
        });

        if (notificationId) {
          orderLaterItem = { ...orderLaterItem, notificationId };

          if (tableFlags.orderLaterItemsTableAvailable !== false) {
            try {
              await (supabase as any)
                .from('order_later_items')
                .update({ notification_id: notificationId })
                .eq('id', orderLaterItem.id);
            } catch {
              // Best-effort sync only.
            }
          }
        }

        set((state) => ({
          orderLaterQueue: normalizeOrderLaterQueue([orderLaterItem, ...state.orderLaterQueue]),
        }));

        void createOrderLaterInAppNotification({
          userId: normalizedInput.createdBy,
          itemName: normalizedInput.itemName,
          scheduledAt: orderLaterItem.scheduledAt,
        });

        return orderLaterItem;
      },

      updateOrderLaterItemSchedule: async (itemId, scheduledAt) => {
        const current = get().orderLaterQueue.find((item) => item.id === itemId);
        if (!current) return null;

        await cancelOrderLaterNotification(current.notificationId);
        const normalizedScheduledAt = toIsoString(scheduledAt);
        const nextNotificationId = await scheduleOrderLaterNotification({
          orderLaterItemId: current.id,
          itemName: current.itemName,
          scheduledAt: normalizedScheduledAt,
        });

        const updatedItem: OrderLaterItem = {
          ...current,
          scheduledAt: normalizedScheduledAt,
          notificationId: nextNotificationId,
        };

        set((state) => ({
          orderLaterQueue: normalizeOrderLaterQueue(
            state.orderLaterQueue.map((item) => (item.id === itemId ? updatedItem : item))
          ),
        }));

        if (tableFlags.orderLaterItemsTableAvailable !== false) {
          const { error } = await (supabase as any)
            .from('order_later_items')
            .update({
              scheduled_at: normalizedScheduledAt,
              notification_id: nextNotificationId,
            })
            .eq('id', itemId);

          if (error) {
            if (isMissingTableError(error, 'order_later_items')) {
              tableFlags.orderLaterItemsTableAvailable = false;
            } else {
              console.warn('Unable to update order_later_items schedule.', error);
            }
          } else {
            tableFlags.orderLaterItemsTableAvailable = true;
          }
        }

        void createOrderLaterInAppNotification({
          userId: current.createdBy,
          itemName: current.itemName,
          scheduledAt: normalizedScheduledAt,
        });

        return updatedItem;
      },

      removeOrderLaterItem: async (itemId) => {
        const existing = get().orderLaterQueue.find((item) => item.id === itemId);
        if (!existing) return;

        await cancelOrderLaterNotification(existing.notificationId);

        set((state) => ({
          orderLaterQueue: state.orderLaterQueue.filter((item) => item.id !== itemId),
        }));

        if (tableFlags.orderLaterItemsTableAvailable !== false) {
          const { error } = await (supabase as any)
            .from('order_later_items')
            .update({
              status: 'cancelled',
              cancelled_at: new Date().toISOString(),
              notification_id: null,
            })
            .eq('id', itemId);

          if (error) {
            if (isMissingTableError(error, 'order_later_items')) {
              tableFlags.orderLaterItemsTableAvailable = false;
            } else {
              console.warn('Unable to update order_later_items status.', error);
            }
          } else {
            tableFlags.orderLaterItemsTableAvailable = true;
          }
        }
      },

      moveOrderLaterItemToSupplierDraft: async (itemId, supplierId, locationGroup, options) => {
        const normalizedItemId =
          typeof itemId === 'string' && itemId.trim().length > 0 ? itemId.trim() : '';
        if (!normalizedItemId) {
          throw new Error('Order-later item id is required.');
        }
        if (orderLaterMoveInFlightIds.has(normalizedItemId)) {
          throw new Error('This order-later item is already being added.');
        }

        orderLaterMoveInFlightIds.add(normalizedItemId);
        try {
          const queuedItem = get().orderLaterQueue.find((item) => item.id === normalizedItemId);
          if (!queuedItem) {
            throw new Error('This order-later item was already updated. Pull to refresh and try again.');
          }

          const payload = toJsonObject(queuedItem.payload);
          const normalizedSourceOrderItemIds =
            queuedItem.sourceOrderItemIds.length > 0
              ? queuedItem.sourceOrderItemIds
              : queuedItem.sourceOrderItemId
                ? [queuedItem.sourceOrderItemId]
                : [];
          const shouldRestoreSourceOrderItems = normalizedSourceOrderItemIds.length > 0;
          const nextOrderLaterStatus: OrderLaterItemStatus = shouldRestoreSourceOrderItems
            ? 'cancelled'
            : 'added';
          const statusTimestamp = new Date().toISOString();

          let draftItem: SupplierDraftItem | null = null;

          if (shouldRestoreSourceOrderItems) {
            const restored = await get().markOrderItemsStatus(normalizedSourceOrderItemIds, 'pending');
            if (!restored) {
              throw new Error(
                'This item was already updated on another device. Pull to refresh and try again.'
              );
            }

            const normalizedSupplierId = normalizeSupplierId(supplierId);
            if (normalizedSupplierId) {
              const overrideUpdated = await get().setSupplierOverride(
                normalizedSourceOrderItemIds,
                normalizedSupplierId
              );
              if (!overrideUpdated && __DEV__) {
                console.warn(
                  '[OrderStore] moveOrderLaterItemToSupplierDraft: unable to set supplier override for restored source order items.'
                );
              }
            }
          } else {
            const quantityFromPayload = toValidNumber(payload.quantity);
            const decidedQuantityFromPayload = toValidNumber(payload.decidedQuantity);
            const reportedRemainingFromPayload = toValidNumber(payload.reportedRemaining);
            const quantityFromOption = toValidNumber(options?.quantity);
            const quantityCandidates = [
              quantityFromOption,
              toValidNumber(queuedItem.quantity),
              quantityFromPayload,
              decidedQuantityFromPayload,
              reportedRemainingFromPayload,
            ];
            const firstPositiveQuantity = quantityCandidates.find(
              (value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
            );
            const quantity = firstPositiveQuantity ?? 1;

            draftItem = get().addSupplierDraftItem({
              supplierId,
              inventoryItemId: queuedItem.itemId,
              name: queuedItem.itemName,
              category:
                typeof payload.category === 'string' && payload.category.trim().length > 0
                  ? payload.category
                  : 'dry',
              quantity,
              unitType: payload.unitType === 'pack' ? 'pack' : 'base',
              unitLabel:
                typeof payload.unitLabel === 'string' && payload.unitLabel.trim().length > 0
                  ? payload.unitLabel
                  : queuedItem.unit,
              locationGroup,
              locationId: options?.locationId ?? queuedItem.locationId,
              locationName: options?.locationName ?? queuedItem.locationName,
              note: queuedItem.notes,
              sourceOrderLaterItemId: queuedItem.id,
            });
          }

          await cancelOrderLaterNotification(queuedItem.notificationId);

          set((state) => ({
            orderLaterQueue: state.orderLaterQueue.filter((item) => item.id !== normalizedItemId),
          }));

          if (tableFlags.orderLaterItemsTableAvailable !== false) {
            const { error } = await (supabase as any)
              .from('order_later_items')
              .update({
                status: nextOrderLaterStatus,
                added_at: nextOrderLaterStatus === 'added' ? statusTimestamp : null,
                cancelled_at: nextOrderLaterStatus === 'cancelled' ? statusTimestamp : null,
                preferred_supplier_id: supplierId,
                preferred_location_group: locationGroup,
                notification_id: null,
              })
              .eq('id', normalizedItemId);

            if (error) {
              if (isMissingTableError(error, 'order_later_items')) {
                tableFlags.orderLaterItemsTableAvailable = false;
              } else {
                console.warn('Unable to update order_later_items add-back status.', error);
              }
            } else {
              tableFlags.orderLaterItemsTableAvailable = true;
            }
          }

          return draftItem;
        } finally {
          orderLaterMoveInFlightIds.delete(normalizedItemId);
        }
      },

      getLastOrderedQuantities: async ({ supplierId, managerId, items, forceRefresh }) => {
        const normalizedItems = Array.from(
          new Map(
            items
              .map((item) => normalizeLastOrderedLookupInput(item))
              .filter((item): item is LastOrderedQuantityLookupInput => Boolean(item))
              .map((item) => [item.key, item])
          ).values()
        );

        if (normalizedItems.length === 0) {
          return {
            values: {},
            fromCache: true,
            historyUnavailableOffline: false,
          };
        }

        const existingCache = { ...(get().lastOrderedCacheBySupplier[supplierId] || {}) };
        const buildValuesFromCache = (cache: Record<string, LastOrderedQuantityCacheValue>) =>
          normalizedItems.reduce<Record<string, LastOrderedQuantityLookupResult>>((acc, item) => {
            const resolved = resolveLastOrderedFromCache(cache, item);
            if (resolved) {
              acc[item.key] = resolved;
            }
            return acc;
          }, {});

        const cachedValues = buildValuesFromCache(existingCache);
        const hasCompleteCache = normalizedItems.every((item) => Boolean(cachedValues[item.key]));
        if (hasCompleteCache && !forceRefresh) {
          return {
            values: cachedValues,
            fromCache: true,
            historyUnavailableOffline: false,
          };
        }

        if (!managerId || tableFlags.pastOrderItemsTableAvailable === false) {
          return {
            values: cachedValues,
            fromCache: true,
            historyUnavailableOffline: false,
          };
        }

        const itemIds = Array.from(new Set(normalizedItems.map((item) => item.itemId)));
        const units = Array.from(new Set(normalizedItems.map((item) => item.unit)));
        let nextCache = existingCache;

        const { data, error } = await (supabase as any)
          .from('past_order_items')
          .select('item_id, unit, quantity, location_id, location_group, ordered_at, created_at')
          .eq('created_by', managerId)
          .eq('supplier_id', supplierId)
          .in('item_id', itemIds)
          .in('unit', units)
          .order('ordered_at', { ascending: false })
          .limit(Math.min(2500, Math.max(600, normalizedItems.length * 120)));

        if (error) {
          if (isMissingTableError(error, 'past_order_items')) {
            tableFlags.pastOrderItemsTableAvailable = false;
          } else {
            console.warn('Unable to load past_order_items history.', error);
          }
          return {
            values: cachedValues,
            fromCache: true,
            historyUnavailableOffline: isNetworkLikeError(error) && !hasCompleteCache,
          };
        }

        tableFlags.pastOrderItemsTableAvailable = true;
        nextCache = { ...existingCache };
        (data || []).forEach((rawRow: any) => {
          const itemId =
            typeof rawRow?.item_id === 'string' && rawRow.item_id.trim().length > 0
              ? rawRow.item_id.trim()
              : '';
          const unit = normalizeHistoryLookupUnit(rawRow?.unit);
          const quantity = toValidNumber(rawRow?.quantity);
          if (!itemId || !unit || quantity === null || quantity <= 0) return;

          const cacheValue: LastOrderedQuantityCacheValue = {
            quantity: Math.max(0, quantity),
            orderedAt: toIsoString(rawRow?.ordered_at ?? rawRow?.created_at),
          };

          upsertLastOrderedCacheValue(nextCache, createLastOrderedAnyKey(itemId, unit), cacheValue);

          const locationId =
            typeof rawRow?.location_id === 'string' && rawRow.location_id.trim().length > 0
              ? rawRow.location_id.trim()
              : null;
          if (locationId) {
            upsertLastOrderedCacheValue(
              nextCache,
              createLastOrderedLocationIdKey(itemId, unit, locationId),
              cacheValue
            );
          }

          const locationGroup = normalizeLocationGroup(rawRow?.location_group);
          if (locationGroup) {
            upsertLastOrderedCacheValue(
              nextCache,
              createLastOrderedLocationGroupKey(itemId, unit, locationGroup),
              cacheValue
            );
          }
        });

        set((state) => ({
          lastOrderedCacheBySupplier: {
            ...state.lastOrderedCacheBySupplier,
            [supplierId]: nextCache,
          },
        }));

        return {
          values: buildValuesFromCache(nextCache),
          fromCache: false,
          historyUnavailableOffline: false,
        };
      },

      markOrderItemsStatus: async (orderItemIds, status) => {
        const normalizedIds = Array.from(
          new Set(
            orderItemIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          )
        );

        if (normalizedIds.length === 0) return true;
        const requiresPendingGuard = status !== 'pending';
        let updatedIds = normalizedIds;
        let conflictDetected = false;

        try {
          if (tableFlags.orderItemsStatusColumnAvailable !== false) {
            let updateQuery = supabase
              .from('order_items')
              .update({ status } as any)
              .in('id', normalizedIds);
            if (requiresPendingGuard) {
              updateQuery = updateQuery.eq('status', 'pending');
            }

            const { data, error } = await updateQuery.select('id');

            if (error) {
              if (isMissingColumnError(error, 'status')) {
                tableFlags.orderItemsStatusColumnAvailable = false;
              } else {
                throw error;
              }
            } else {
              tableFlags.orderItemsStatusColumnAvailable = true;
              if (Array.isArray(data)) {
                updatedIds = data
                  .map((row: any) => (typeof row?.id === 'string' ? row.id.trim() : ''))
                  .filter((id) => id.length > 0);
                if (requiresPendingGuard && updatedIds.length !== normalizedIds.length) {
                  conflictDetected = true;
                }
              }
            }
          }

          if (tableFlags.orderItemsStatusColumnAvailable === false) {
            if (__DEV__) {
              console.warn(
                '[OrderStore] markOrderItemsStatus skipped: order_items.status column is missing. Apply fulfillment status migration first.'
              );
            }
            return false;
          }

          if (conflictDetected) {
            if (__DEV__) {
              const missingIds = normalizedIds.filter((id) => !updatedIds.includes(id));
              console.warn(
                '[OrderStore] markOrderItemsStatus conflict: some rows were already updated on another device.',
                { requested: normalizedIds.length, updated: updatedIds.length, missingIds: missingIds.slice(0, 8) }
              );
            }
            return false;
          }

          set((state) => {
            const idSet = new Set(updatedIds);
            const patchOrder = (orderLike: any) => {
              if (!orderLike || !Array.isArray(orderLike.order_items)) return orderLike;

              if (status === 'pending') {
                let changed = false;
                const nextItems = orderLike.order_items.map((orderItem: any) => {
                  if (!idSet.has(orderItem?.id)) return orderItem;
                  changed = true;
                  return { ...orderItem, status: 'pending' };
                });
                return changed ? { ...orderLike, order_items: nextItems } : orderLike;
              }

              const nextItems = orderLike.order_items.filter((orderItem: any) => !idSet.has(orderItem?.id));
              if (nextItems.length === orderLike.order_items.length) return orderLike;
              return { ...orderLike, order_items: nextItems };
            };

            return {
              orders: Array.isArray(state.orders)
                ? state.orders.map((order: any) => patchOrder(order))
                : state.orders,
              currentOrder: patchOrder(state.currentOrder),
            };
          });

          return true;
        } catch (error) {
          console.error('markOrderItemsStatus failed:', error);
          return false;
        }
      },

      setSupplierOverride: async (orderItemIds, supplierId) => {
        if (orderItemIds.length === 0) return true;
        try {
          const { error } = await supabase
            .from('order_items')
            .update({ supplier_override_id: supplierId } as any)
            .in('id', orderItemIds);
          if (error) throw error;

          set((state) => {
            const idSet = new Set(orderItemIds);
            const patchOrder = (orderLike: any) => {
              if (!orderLike || !Array.isArray(orderLike.order_items)) return orderLike;
              let changed = false;
              const nextItems = orderLike.order_items.map((oi: any) => {
                if (!idSet.has(oi?.id)) return oi;
                changed = true;
                return { ...oi, supplier_override_id: supplierId };
              });
              return changed ? { ...orderLike, order_items: nextItems } : orderLike;
            };
            return {
              orders: Array.isArray(state.orders)
                ? state.orders.map((o: any) => patchOrder(o))
                : state.orders,
              currentOrder: patchOrder(state.currentOrder),
            };
          });
          return true;
        } catch (error) {
          console.error('setSupplierOverride failed:', error);
          return false;
        }
      },

      clearSupplierOverride: async (orderItemIds) => {
        if (orderItemIds.length === 0) return true;
        try {
          const { error } = await supabase
            .from('order_items')
            .update({ supplier_override_id: null } as any)
            .in('id', orderItemIds);
          if (error) throw error;

          set((state) => {
            const idSet = new Set(orderItemIds);
            const patchOrder = (orderLike: any) => {
              if (!orderLike || !Array.isArray(orderLike.order_items)) return orderLike;
              let changed = false;
              const nextItems = orderLike.order_items.map((oi: any) => {
                if (!idSet.has(oi?.id)) return oi;
                changed = true;
                return { ...oi, supplier_override_id: null };
              });
              return changed ? { ...orderLike, order_items: nextItems } : orderLike;
            };
            return {
              orders: Array.isArray(state.orders)
                ? state.orders.map((o: any) => patchOrder(o))
                : state.orders,
              currentOrder: patchOrder(state.currentOrder),
            };
          });
          return true;
        } catch (error) {
          console.error('clearSupplierOverride failed:', error);
          return false;
        }
      },

      finalizeSupplierOrder: async (input) => {
        const consumedDraftItemIds = Array.from(
          new Set(
            (input.consumedDraftItemIds || [])
              .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          )
        );
        const nextPastOrder = await get().createPastOrder(input);

        set((state) => {
          const draftRemovalSet = new Set(consumedDraftItemIds);
          const nextSupplierDrafts: SupplierDraftsBySupplier = {};
          Object.entries(state.supplierDrafts).forEach(([supplierKey, rows]) => {
            const filteredRows = rows.filter((row) => !draftRemovalSet.has(row.id));
            if (filteredRows.length > 0) {
              nextSupplierDrafts[supplierKey] = filteredRows;
            }
          });
          return {
            supplierDrafts: nextSupplierDrafts,
          };
        });

        if (nextPastOrder.syncStatus === 'pending_sync') {
          void get().flushPendingPastOrderSync(input.createdBy);
        }

        return nextPastOrder;
      },
    }),
    {
      name: 'order-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cartByLocation: state.cartByLocation,
        managerCartByLocation: state.managerCartByLocation,
        supplierDrafts: state.supplierDrafts,
        orderLaterQueue: state.orderLaterQueue,
        pastOrders: state.pastOrders,
        pendingPastOrderSyncQueue: state.pendingPastOrderSyncQueue,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<OrderState>;
        // Migrate: merge any leftover managerCartByLocation items into
        // cartByLocation so the unified cart picks them up on upgrade.
        const normalizedMain = normalizeCartByLocation(persisted.cartByLocation);
        const normalizedManager = normalizeCartByLocation(persisted.managerCartByLocation);
        const mergedCart: CartByLocation = { ...normalizedMain };
        for (const [locId, managerItems] of Object.entries(normalizedManager)) {
          if (!mergedCart[locId] || mergedCart[locId].length === 0) {
            mergedCart[locId] = managerItems;
          } else {
            // Merge items, avoiding duplicates by inventoryItemId+unitType
            const existing = new Set(
              mergedCart[locId].map((i) => `${i.inventoryItemId}:${i.unitType}`)
            );
            for (const item of managerItems) {
              if (!existing.has(`${item.inventoryItemId}:${item.unitType}`)) {
                mergedCart[locId].push(item);
              }
            }
          }
        }
        return {
          ...currentState,
          ...persisted,
          cartByLocation: mergedCart,
          managerCartByLocation: {},
          supplierDrafts: normalizeSupplierDrafts((persistedState as any)?.supplierDrafts),
          orderLaterQueue: normalizeOrderLaterQueue((persistedState as any)?.orderLaterQueue),
          pastOrders: normalizePastOrders((persistedState as any)?.pastOrders),
          pendingPastOrderSyncQueue: normalizePendingPastOrderSyncQueue(
            (persistedState as any)?.pendingPastOrderSyncQueue
          ),
        };
      },
    }
  )
);

if (!tableFlags.pastOrderSyncListenerInitialized) {
  tableFlags.pastOrderSyncListenerInitialized = true;
  NetInfo.addEventListener((state) => {
    const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
    if (!online) return;
    const store = useOrderStore.getState();
    if (store.pendingPastOrderSyncQueue.length === 0) return;
    void store.flushPendingPastOrderSync();
  });
}
