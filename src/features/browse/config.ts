import type { ItemCategory, KnownItemCategory } from '@/types';
import { KNOWN_ITEM_CATEGORIES } from '@/types';

export const BROWSE_INVENTORY_ROUTE = '/(tabs)/inventory-browse' as const;

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

export const CATEGORY_ORDER: KnownItemCategory[] = [
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

const KNOWN_SHORT_LABELS: Record<string, string> = {
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

export const CATEGORY_SHORT_LABELS: Record<string, string> = KNOWN_SHORT_LABELS;

export function getCategoryShortLabel(category: string): string {
  return KNOWN_SHORT_LABELS[category] ?? category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isBrowseCategory(value: string | null | undefined): value is ItemCategory {
  if (!value) {
    return false;
  }

  return (KNOWN_ITEM_CATEGORIES as readonly string[]).includes(value);
}

export function buildCategoryList(items: { category: string }[]): string[] {
  const knownSet = new Set<string>(CATEGORY_ORDER);
  const extra = new Set<string>();
  for (const item of items) {
    if (!knownSet.has(item.category)) {
      extra.add(item.category);
    }
  }
  const sorted = Array.from(extra).sort((a, b) => a.localeCompare(b));
  return [...CATEGORY_ORDER, ...sorted];
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
