import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function InventoryBrowseRoute() {
  const params = useLocalSearchParams<{
    category?: string | string[];
    focusSearch?: string | string[];
    focusItemId?: string | string[];
    expandItem?: string | string[];
    addItem?: string | string[];
    requestId?: string | string[];
  }>();

  return (
    <Redirect
      href={{
        pathname: '/(tabs)/inventory-browse',
        params,
      }}
    />
  );
}
