import React from 'react';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { EmployeeBrowseInventoryScreen } from '@/features/browse/EmployeeBrowseInventoryScreen';
import { isBrowseCategory } from '@/features/browse/config';
import { glassColors } from '@/design/tokens';
import { useAuthStore, useDisplayStore } from '@/store';

function getParamValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export default function InventoryBrowseRoute() {
  const { session, profile } = useAuthStore();
  const reduceMotion = useDisplayStore((state) => state.reduceMotion);
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

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!profile?.profile_completed) {
    return <Redirect href="/(auth)/complete-profile" />;
  }

  if (profile.is_suspended) {
    return <Redirect href="/suspended" />;
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
