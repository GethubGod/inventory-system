import { Alert, Platform } from 'react-native';
import { useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore, useOrderStore } from '@/store';
import type { HistoricalOrderSummary, PredictedOrderItem } from '@/features/ordering/orderInsights';
import type { InventoryItem, UnitType } from '@/types';
import type { AddToCartOptions } from '@/store/orderStore';

function triggerLightHaptic() {
  if (Platform.OS !== 'web') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

export function useEmployeeCartActions() {
  const {
    location,
    locations,
    setLocation,
  } = useAuthStore(
    useShallow((state) => ({
      location: state.location,
      locations: state.locations,
      setLocation: state.setLocation,
    })),
  );
  const addToCart = useOrderStore((state) => state.addToCart);

  const resolveLocationId = useCallback(() => {
    const activeLocation = location ?? locations[0] ?? null;

    if (!activeLocation?.id) {
      Alert.alert('Select a location', 'Choose a location before adding items.');
      return null;
    }

    if (!location) {
      setLocation(activeLocation);
    }

    return activeLocation.id;
  }, [location, locations, setLocation]);

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

      addToCart(locationId, inventoryItemId, quantity, unitType, {
        ...options,
        context: 'employee',
      });
      triggerLightHaptic();
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
      triggerLightHaptic();
      return true;
    },
    [addToCart, resolveLocationId],
  );

  return {
    activeLocationId: location?.id ?? locations[0]?.id ?? null,
    addInventoryItem,
    addPredictedItem,
    addLineItem,
    reorderHistoricalOrder,
  };
}
