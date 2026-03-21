import type { ItemCategory } from '@/types';

export const BROWSE_INVENTORY_ROUTE = '/inventory-browse' as const;

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
