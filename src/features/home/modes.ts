import type { Href } from 'expo-router';
import {
  BROWSE_INVENTORY_ROUTE,
  createBrowseInventoryRouteParams,
  type BrowseInventoryNavigationOptions,
} from '@/features/browse/config';
import type { CartScope } from '@/features/ordering/types';

export interface HomeScreenMode {
  scope: CartScope;
  cartRoute: string;
  quickOrderRoute: string;
  identity?: string;
  buildBrowseHref: (options?: BrowseInventoryNavigationOptions) => Href;
}

export const EMPLOYEE_HOME_MODE: HomeScreenMode = {
  scope: 'employee',
  cartRoute: '/(tabs)/cart',
  quickOrderRoute: '/(tabs)/quick-order',
  buildBrowseHref: (options = {}) => ({
    pathname: BROWSE_INVENTORY_ROUTE,
    params: createBrowseInventoryRouteParams(options),
  }),
};

export const MANAGER_HOME_MODE: HomeScreenMode = {
  scope: 'manager',
  cartRoute: '/(manager)/cart',
  quickOrderRoute: '/(manager)/quick-order',
  buildBrowseHref: (options = {}) => ({
    pathname: '/(manager)/browse',
    params: createBrowseInventoryRouteParams(options),
  }),
};
