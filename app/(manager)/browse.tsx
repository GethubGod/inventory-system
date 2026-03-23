import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ManagerBrowseInventoryScreen } from '@/features/browse/ManagerBrowseInventoryScreen';
import { isBrowseCategory } from '@/features/browse/config';

function getParamValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export default function ManagerBrowseRoute() {
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

  return (
    <ManagerBrowseInventoryScreen
      initialCategory={isBrowseCategory(categoryParam) ? categoryParam : null}
      autoFocusSearch={focusSearchParam === '1'}
      initialFocusItemId={focusItemIdParam ?? null}
      autoExpandFocusedItem={expandItemParam === '1'}
      addFocusedItemOnArrival={addItemParam === '1'}
      focusRequestId={requestIdParam ?? null}
    />
  );
}
