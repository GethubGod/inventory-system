export * from './theme';

const KNOWN_CATEGORY_LABELS: Record<string, string> = {
  fish: 'Fish & Seafood',
  protein: 'Protein',
  produce: 'Produce',
  dry: 'Dry Goods',
  dairy_cold: 'Dairy & Cold',
  frozen: 'Frozen',
  sauces: 'Sauces',
  packaging: 'Packaging',
  alcohol: 'Alcohol & Beverages',
};

export const CATEGORY_LABELS: Record<string, string> = KNOWN_CATEGORY_LABELS;

function formatUnknownKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getCategoryLabel(category: string): string {
  return KNOWN_CATEGORY_LABELS[category] ?? formatUnknownKey(category);
}

const KNOWN_SUPPLIER_CATEGORY_LABELS: Record<string, string> = {
  fish_supplier: 'Fish Supplier',
  main_distributor: 'Main Distributor',
  asian_market: 'Asian Market',
};

export const SUPPLIER_CATEGORY_LABELS: Record<string, string> = KNOWN_SUPPLIER_CATEGORY_LABELS;

export function getSupplierCategoryLabel(category: string): string {
  return KNOWN_SUPPLIER_CATEGORY_LABELS[category] ?? formatUnknownKey(category);
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Pending',
  processing: 'Processing',
  fulfilled: 'Fulfilled',
  cancel_requested: 'Cancel Requested',
  cancelled: 'Cancelled',
};
