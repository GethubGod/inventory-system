import React from 'react';
import { MANAGER_ORDERING_MODE } from '@/features/ordering/modes';
import {
  BrowseInventoryScreenView,
  type BrowseInventoryScreenViewProps,
} from './BrowseInventoryScreenView';

type ManagerBrowseInventoryScreenProps = Omit<
  BrowseInventoryScreenViewProps,
  'mode' | 'fallbackRoute'
>;

export function ManagerBrowseInventoryScreen(
  props: ManagerBrowseInventoryScreenProps,
) {
  return (
    <BrowseInventoryScreenView
      mode={MANAGER_ORDERING_MODE}
      fallbackRoute="/(manager)"
      {...props}
    />
  );
}
