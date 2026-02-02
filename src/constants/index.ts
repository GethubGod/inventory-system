export * from './theme';

export const CATEGORY_LABELS: Record<string, string> = {
  fish: 'Fish & Seafood',
  protein: 'Protein',
  produce: 'Produce',
  dry: 'Dry Goods',
  dairy_cold: 'Dairy & Cold',
  frozen: 'Frozen',
  sauces: 'Sauces',
  packaging: 'Packaging',
};

export const SUPPLIER_CATEGORY_LABELS: Record<string, string> = {
  fish_supplier: 'Fish Supplier',
  main_distributor: 'Main Distributor',
  asian_market: 'Asian Market',
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Pending',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};
