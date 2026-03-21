import type { ItemCategory } from '@/types';

export const BROWSE_INVENTORY_ROUTE = '/inventory-browse' as const;

export interface BrowseInventoryRouteParams {
  [key: string]: string | undefined;
  category?: string;
  focusSearch?: '1';
  focusItemId?: string;
  expandItem?: '1';
  addItem?: '1';
  requestId?: string;
}

export interface BrowseInventoryNavigationOptions {
  category?: ItemCategory | null;
  focusSearch?: boolean;
  focusItemId?: string | null;
  expandItem?: boolean;
  addItem?: boolean;
  requestId?: string | null;
}

export const CATEGORY_ORDER: ItemCategory[] = [
  'fish',
  'protein',
  'produce',
  'dry',
  'dairy_cold',
  'frozen',
  'sauces',
  'alcohol',
  'packaging',
];

export const CATEGORY_SHORT_LABELS: Record<ItemCategory, string> = {
  fish: 'Fish',
  protein: 'Protein',
  produce: 'Produce',
  dry: 'Dry',
  dairy_cold: 'Dairy',
  frozen: 'Frozen',
  sauces: 'Sauces',
  alcohol: 'Alcohol',
  packaging: 'Packaging',
};

export function isBrowseCategory(value: string | null | undefined): value is ItemCategory {
  if (!value) {
    return false;
  }

  return CATEGORY_ORDER.includes(value as ItemCategory);
}

export function createBrowseInventoryRouteParams({
  category = null,
  focusSearch = false,
  focusItemId = null,
  expandItem = false,
  addItem = false,
  requestId = null,
}: BrowseInventoryNavigationOptions = {}): BrowseInventoryRouteParams {
  return {
    ...(category ? { category } : {}),
    ...(focusSearch ? { focusSearch: '1' } : {}),
    ...(focusItemId ? { focusItemId } : {}),
    ...(expandItem ? { expandItem: '1' } : {}),
    ...(addItem ? { addItem: '1' } : {}),
    ...(requestId ? { requestId } : {}),
  };
}
