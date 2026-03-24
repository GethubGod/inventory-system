import React from 'react';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { AuthLoadingScreen } from '@/components';
import { EmployeeBrowseInventoryScreen } from '@/features/browse/EmployeeBrowseInventoryScreen';
import { isBrowseCategory } from '@/features/browse/config';
import { glassColors } from '@/theme/design';
import { useDisplayStore } from '@/store';
import { useProtectedAuthGuard } from '@/hooks';

function getParamValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export default function InventoryBrowseRoute() {
  const reduceMotion = useDisplayStore((state) => state.reduceMotion);
  const guard = useProtectedAuthGuard();
  const params = useLocalSearchParams<{
    category?: string | string[];
    focusSearch?: string | string[];
    focusItemId?: string | string[];
    expandItem?: string | string[];
    addItem?: string | string[];
    requestId?: string | string[];
  }>();
  const categoryParam = getParamValue(params.category);
  const focusSearchParam = getParamValue(params.focusSearch);
  const focusItemIdParam = getParamValue(params.focusItemId);
  const expandItemParam = getParamValue(params.expandItem);
  const addItemParam = getParamValue(params.addItem);
  const requestIdParam = getParamValue(params.requestId);

  if (guard.isChecking) {
    return <AuthLoadingScreen />;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          contentStyle: { backgroundColor: glassColors.background },
          gestureEnabled: true,
          animation: reduceMotion ? 'none' : 'simple_push',
        }}
      />
      <EmployeeBrowseInventoryScreen
        initialCategory={isBrowseCategory(categoryParam) ? categoryParam : null}
        autoFocusSearch={focusSearchParam === '1'}
        initialFocusItemId={focusItemIdParam ?? null}
        autoExpandFocusedItem={expandItemParam === '1'}
        addFocusedItemOnArrival={addItemParam === '1'}
        focusRequestId={requestIdParam ?? null}
      />
    </>
  );
}
