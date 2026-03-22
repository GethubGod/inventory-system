import { Alert } from 'react-native';
import { useCallback } from 'react';
import { useOrderStore } from '@/store';
import { triggerConfirmationHaptic } from '@/lib/haptics';
import { useResolvedActiveLocation } from './useResolvedActiveLocation';
import type { HistoricalOrderSummary, PredictedOrderItem } from '@/features/ordering/orderInsights';
import type { InventoryItem, UnitType } from '@/types';
import type { AddToCartOptions } from '@/store/orderStore';

function isAcceptedAdd(quantity: number, options?: Omit<AddToCartOptions, 'context'>) {
  const inputMode = options?.inputMode ?? 'quantity';

  if (inputMode === 'remaining') {
    return Number.isFinite(quantity) && quantity >= 0;
  }

  return Number.isFinite(quantity) && quantity > 0;
}

export function useEmployeeCartActions() {
  const { location } = useResolvedActiveLocation();
  const addToCart = useOrderStore((state) => state.addToCart);

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
        context: 'employee',
      });
      void triggerConfirmationHaptic();
      return true;
    },
    [addToCart, resolveLocationId],
  );

  const addInventoryItem = useCallback(
    (item: InventoryItem) =>
      addLineItem(item.id, 1, 'pack', {
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

  const reorderHistoricalOrder = useCallback(
    (order: HistoricalOrderSummary) => {
      const locationId = resolveLocationId();
      if (!locationId) {
        return false;
      }

      order.items.forEach((item) => {
        addToCart(locationId, item.inventoryItemId, item.quantity, item.unitType, {
          context: 'employee',
          inputMode: 'quantity',
          quantityRequested: item.quantity,
          note: item.note,
        });
      });
      return true;
    },
    [addToCart, resolveLocationId],
  );

  return {
    activeLocationId: location?.id ?? null,
    addInventoryItem,
    addPredictedItem,
    addLineItem,
    reorderHistoricalOrder,
  };
}
