import { Alert } from 'react-native';
import { useCallback } from 'react';
import { useOrderStore } from '@/store';
import { triggerConfirmationHaptic } from '@/lib/haptics';
import { useResolvedActiveLocation } from './useResolvedActiveLocation';
import type { HistoricalOrderSummary, PredictedOrderItem } from '@/features/ordering/orderInsights';
import type { RecentOrder, SuggestionItem } from '@/features/ordering/dailySuggestions';
import type { InventoryItem, UnitType } from '@/types';
import type { AddToCartOptions, CartContext } from '@/store/orderStore';
import { resolvePreferredInventoryUnitType } from '@/lib/inventoryUnits';

function isAcceptedAdd(
  quantity: number,
  options?: Omit<AddToCartOptions, 'context'>,
) {
  const inputMode = options?.inputMode ?? 'quantity';

  if (inputMode === 'remaining') {
    return Number.isFinite(quantity) && quantity >= 0;
  }

  return Number.isFinite(quantity) && quantity > 0;
}

type ReorderableOrder = HistoricalOrderSummary | RecentOrder;

function isRecentOrder(order: ReorderableOrder): order is RecentOrder {
  return 'display_date' in order;
}

export function useOrderingCartActions(context: CartContext) {
  const { location } = useResolvedActiveLocation();
  const addToCart = useOrderStore((state) => state.addToCart);
  const updateCartItem = useOrderStore((state) => state.updateCartItem);
  const getCartItems = useOrderStore((state) => state.getCartItems);

  const resolveLocationId = useCallback(() => {
    if (!location?.id) {
      Alert.alert('Select a location', 'Choose a location before adding items.');
      return null;
    }

    return location.id;
  }, [location]);

  const addLineItem = useCallback(
    (
      inventoryItemId: string,
      quantity: number,
      unitType: UnitType,
      options?: Omit<AddToCartOptions, 'context'>,
    ) => {
      const locationId = resolveLocationId();
      if (!locationId) {
        return false;
      }
      if (!isAcceptedAdd(quantity, options)) {
        return false;
      }

      addToCart(locationId, inventoryItemId, quantity, unitType, {
        ...options,
        context,
      });
      void triggerConfirmationHaptic();
      return true;
    },
    [addToCart, context, resolveLocationId],
  );

  const addInventoryItem = useCallback(
    (item: InventoryItem) =>
      addLineItem(item.id, 1, resolvePreferredInventoryUnitType(item, 'pack'), {
        inputMode: 'quantity',
        quantityRequested: 1,
      }),
    [addLineItem],
  );

  const addPredictedItem = useCallback(
    (item: PredictedOrderItem, quantityOverride?: number) => {
      const quantity = Math.max(1, quantityOverride ?? item.quantity);
      return addLineItem(item.inventoryItemId, quantity, item.unitType, {
        inputMode: 'quantity',
        quantityRequested: quantity,
        note: item.note,
      });
    },
    [addLineItem],
  );

  const addSuggestedItem = useCallback(
    (item: SuggestionItem, quantityOverride?: number) => {
      const locationId = resolveLocationId();
      if (!locationId) {
        return false;
      }

      const quantity = Math.max(1, quantityOverride ?? item.suggested_qty);
      const existing = getCartItems(locationId, context).find(
        (cartItem) =>
          cartItem.inventoryItemId === item.item_id &&
          cartItem.unitType === item.unit_type
      );

      if (existing) {
        if (existing.inputMode !== 'quantity') {
          return false;
        }

        const nextQuantity = Math.max(
          existing.quantityRequested ?? existing.quantity,
          quantity,
        );

        updateCartItem(locationId, item.item_id, nextQuantity, item.unit_type, {
          cartItemId: existing.id,
          context,
          inputMode: 'quantity',
          quantityRequested: nextQuantity,
          wasSuggested: true,
          originalSuggestedQty: item.suggested_qty,
        });
        void triggerConfirmationHaptic();
        return true;
      }

      addToCart(locationId, item.item_id, quantity, item.unit_type, {
        context,
        inputMode: 'quantity',
        quantityRequested: quantity,
        wasSuggested: true,
        originalSuggestedQty: item.suggested_qty,
      });
      void triggerConfirmationHaptic();
      return true;
    },
    [addToCart, context, getCartItems, resolveLocationId, updateCartItem],
  );

  const reorderHistoricalOrder = useCallback(
    (order: ReorderableOrder) => {
      const locationId = resolveLocationId();
      if (!locationId) {
        return false;
      }

      if (isRecentOrder(order)) {
        order.items.forEach((item) => {
          addToCart(locationId, item.item_id, item.quantity, item.unit_type, {
            context,
            inputMode: 'quantity',
            quantityRequested: item.quantity,
            wasSuggested: false,
            originalSuggestedQty: null,
          });
        });
      } else {
        order.items.forEach((item) => {
          addToCart(locationId, item.inventoryItemId, item.quantity, item.unitType, {
            context,
            inputMode: 'quantity',
            quantityRequested: item.quantity,
            note: item.note,
            wasSuggested: false,
            originalSuggestedQty: null,
          });
        });
      }

      void triggerConfirmationHaptic();
      return true;
    },
    [addToCart, context, resolveLocationId],
  );

  return {
    activeLocationId: location?.id ?? null,
    addInventoryItem,
    addPredictedItem,
    addSuggestedItem,
    addLineItem,
    reorderHistoricalOrder,
  };
}
