import { CATEGORY_LABELS, SUPPLIER_CATEGORY_LABELS } from '@/constants';
import { supabase } from '@/lib/supabase';
import type {
  InventoryItem,
  ItemCategory,
  SupplierCategory,
  UnitType,
} from '@/types';

type OrderHistoryInventoryItem = Pick<
  InventoryItem,
  | 'id'
  | 'name'
  | 'category'
  | 'supplier_category'
  | 'base_unit'
  | 'pack_unit'
  | 'pack_size'
  | 'supplier_id'
>;

interface OrderHistoryItemRow {
  inventory_item_id: string;
  quantity: number;
  unit_type: UnitType;
  note: string | null;
  inventory_item: OrderHistoryInventoryItem | null;
}

interface OrderHistoryRow {
  id: string;
  created_at: string;
  location_id: string;
  order_items: OrderHistoryItemRow[] | null;
}

export interface HistoricalOrderItem {
  inventoryItemId: string;
  name: string;
  category: ItemCategory;
  supplierCategory: SupplierCategory;
  quantity: number;
  unitType: UnitType;
  baseUnit: string;
  packUnit: string;
  packSize: number;
  note: string | null;
}

export interface HistoricalOrderSummary {
  id: string;
  createdAt: string;
  locationId: string;
  items: HistoricalOrderItem[];
  itemCount: number;
}

export interface PredictedOrderItem extends HistoricalOrderItem {
  occurrenceCount: number;
}

export interface LocationOrderInsights {
  recentOrders: HistoricalOrderSummary[];
  predictedItems: PredictedOrderItem[];
  reorderOrder: HistoricalOrderSummary | null;
}

function toHistoricalOrderItem(
  row: OrderHistoryItemRow,
): HistoricalOrderItem | null {
  if (!row.inventory_item) {
    return null;
  }

  return {
    inventoryItemId: row.inventory_item_id,
    name: row.inventory_item.name,
    category: row.inventory_item.category,
    supplierCategory: row.inventory_item.supplier_category,
    quantity: row.quantity,
    unitType: row.unit_type,
    baseUnit: row.inventory_item.base_unit,
    packUnit: row.inventory_item.pack_unit,
    packSize: row.inventory_item.pack_size,
    note: row.note,
  };
}

function toHistoricalOrderSummary(
  row: OrderHistoryRow,
): HistoricalOrderSummary | null {
  const items = (row.order_items ?? [])
    .map(toHistoricalOrderItem)
    .filter((item): item is HistoricalOrderItem => item !== null)
    .filter((item) => item.quantity > 0);

  if (items.length === 0) {
    return null;
  }

  return {
    id: row.id,
    createdAt: row.created_at,
    locationId: row.location_id,
    items,
    itemCount: items.length,
  };
}

function getDayKey(dateString: string): number {
  return new Date(dateString).getDay();
}

function groupPredictedItems(
  orders: HistoricalOrderSummary[],
  targetDay: number,
): PredictedOrderItem[] {
  const grouped = new Map<
    string,
    {
      occurrenceCount: number;
      latest: HistoricalOrderItem;
    }
  >();

  orders
    .filter((order) => getDayKey(order.createdAt) === targetDay)
    .forEach((order) => {
      const seenInOrder = new Set<string>();

      order.items.forEach((item) => {
        const itemKey = `${item.inventoryItemId}:${item.unitType}`;
        if (seenInOrder.has(itemKey)) {
          return;
        }

        seenInOrder.add(itemKey);
        const existing = grouped.get(itemKey);
        if (existing) {
          existing.occurrenceCount += 1;
          return;
        }

        grouped.set(itemKey, {
          occurrenceCount: 1,
          latest: item,
        });
      });
    });

  return Array.from(grouped.values())
    .filter((entry) => entry.occurrenceCount >= 3)
    .map((entry) => ({
      ...entry.latest,
      occurrenceCount: entry.occurrenceCount,
    }))
    .sort((left, right) => {
      if (right.occurrenceCount !== left.occurrenceCount) {
        return right.occurrenceCount - left.occurrenceCount;
      }

      return left.name.localeCompare(right.name);
    });
}

export async function fetchLocationOrderInsights(
  locationId: string,
  limit = 12,
): Promise<LocationOrderInsights> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      `
        id,
        created_at,
        location_id,
        order_items (
          inventory_item_id,
          quantity,
          unit_type,
          note,
          inventory_item:inventory_items (
            id,
            name,
            category,
            supplier_category,
            base_unit,
            pack_unit,
            pack_size,
            supplier_id
          )
        )
      `,
    )
    .eq('location_id', locationId)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(Math.max(limit, 12));

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as unknown as OrderHistoryRow[])
    .map(toHistoricalOrderSummary)
    .filter((row): row is HistoricalOrderSummary => row !== null);
  const todayDay = new Date().getDay();

  return {
    recentOrders: rows.slice(0, 6),
    predictedItems: groupPredictedItems(rows, todayDay),
    reorderOrder:
      rows.find((row) => getDayKey(row.createdAt) === todayDay) ?? rows[0] ?? null,
  };
}

export function formatOrderDateLabel(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatOrderDayLabel(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'long',
  });
}

export function summarizeOrderItems(
  order: HistoricalOrderSummary,
  maxItems = 3,
): string {
  const names = Array.from(new Set(order.items.map((item) => item.name)));
  if (names.length <= maxItems) {
    return names.join(', ');
  }

  const remaining = names.length - maxItems;
  return `${names.slice(0, maxItems).join(', ')} +${remaining} more`;
}

export function getItemMetaLabel(item: HistoricalOrderItem): string {
  return `${CATEGORY_LABELS[item.category]} · ${
    item.unitType === 'base' ? item.baseUnit : `per ${item.packUnit}`
  }`;
}

export function getItemSupplierLabel(item: HistoricalOrderItem): string {
  return SUPPLIER_CATEGORY_LABELS[item.supplierCategory];
}
