import { getDailySuggestions, type DailySuggestionsResponseDTO } from '@/lib/api/client';

export interface SuggestionItem {
  item_id: string;
  item_name: string;
  suggested_qty: number;
  unit_type: 'base' | 'pack';
  unit: string | null;
  supplier_name: string | null;
  frequency: number;
  times_ordered: number;
  total_orders: number;
  confidence_tier: 'high' | 'medium' | 'low';
}

export interface RecentOrderItem {
  item_id: string;
  item_name: string;
  quantity: number;
  unit_type: 'base' | 'pack';
  unit: string | null;
  supplier_name: string | null;
}

export interface RecentOrder {
  id: string;
  created_at: string;
  display_date: string;
  day_of_week: number;
  item_count: number;
  suppliers: string[];
  items: RecentOrderItem[];
}

export interface SuggestionsData {
  day_label: string;
  total_past_orders: number;
  source: 'heuristic' | 'lightgbm';
  items: SuggestionItem[];
}

export interface SmartOrderData {
  suggestions: SuggestionsData;
  recentOrders: RecentOrder[];
}

function getTodayDayLabel(): string {
  return `${new Date().toLocaleDateString('en-US', { weekday: 'long' })}s`;
}

export function createEmptySuggestions(): SuggestionsData {
  return {
    day_label: getTodayDayLabel(),
    total_past_orders: 0,
    source: 'heuristic',
    items: [],
  };
}

function createEmptyRecentOrders(): RecentOrder[] {
  return [];
}

function normalizeSuggestionsResponse(data: DailySuggestionsResponseDTO | null): SuggestionsData {
  const suggestions = data?.suggestions;
  if (!suggestions) {
    return createEmptySuggestions();
  }

  return {
    day_label:
      typeof suggestions.day_label === 'string' && suggestions.day_label.trim().length > 0
        ? suggestions.day_label
        : getTodayDayLabel(),
    total_past_orders:
      typeof suggestions.total_past_orders === 'number' && Number.isFinite(suggestions.total_past_orders)
        ? suggestions.total_past_orders
        : 0,
    source: suggestions.source === 'lightgbm' ? 'lightgbm' : 'heuristic',
    items: Array.isArray(suggestions.items)
      ? suggestions.items.map((item) => ({
          item_id: item.item_id,
          item_name: item.item_name,
          suggested_qty: Math.max(
            1,
            Number.isFinite(Number(item.suggested_qty))
              ? Number(item.suggested_qty)
              : 1,
          ),
          unit_type: item.unit_type === 'base' ? 'base' : 'pack',
          unit: typeof item.unit === 'string' ? item.unit : null,
          supplier_name: typeof item.supplier_name === 'string' ? item.supplier_name : null,
          frequency: Number.isFinite(Number(item.frequency)) ? Number(item.frequency) : 0,
          times_ordered: Number.isFinite(Number(item.times_ordered))
            ? Number(item.times_ordered)
            : 0,
          total_orders: Number.isFinite(Number(item.total_orders))
            ? Number(item.total_orders)
            : 0,
          confidence_tier:
            item.confidence_tier === 'high' || item.confidence_tier === 'low'
              ? item.confidence_tier
              : 'medium',
        }))
      : [],
  };
}

function normalizeRecentOrders(data: DailySuggestionsResponseDTO | null): RecentOrder[] {
  const orders = data?.recent_orders;
  if (!Array.isArray(orders)) {
    return createEmptyRecentOrders();
  }

  return orders
    .map<RecentOrder>((order) => {
      const items: RecentOrderItem[] = Array.isArray(order.items)
        ? order.items.map((item): RecentOrderItem => ({
            item_id: item.item_id,
            item_name: item.item_name,
            quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0,
            unit_type: item.unit_type === 'base' ? 'base' : 'pack',
            unit: typeof item.unit === 'string' ? item.unit : null,
            supplier_name: typeof item.supplier_name === 'string' ? item.supplier_name : null,
          }))
        : [];

      return {
        id: order.id,
        created_at: order.created_at,
        display_date:
          typeof order.display_date === 'string' && order.display_date.trim().length > 0
            ? order.display_date
            : new Date(order.created_at).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              }),
        day_of_week: Number.isFinite(Number(order.day_of_week)) ? Number(order.day_of_week) : 0,
        item_count: Number.isFinite(Number(order.item_count)) ? Number(order.item_count) : 0,
        suppliers: Array.isArray(order.suppliers)
          ? order.suppliers.filter(
              (supplier): supplier is string =>
                typeof supplier === 'string' && supplier.trim().length > 0,
            )
          : [],
        items,
      };
    })
    .filter((order) => order.items.length > 0);
}

export async function fetchSmartOrderData(locationId: string): Promise<SmartOrderData> {
  const result = await getDailySuggestions({ locationId });
  if (result.error) {
    throw new Error(result.error);
  }

  return {
    suggestions: normalizeSuggestionsResponse(result.data),
    recentOrders: normalizeRecentOrders(result.data),
  };
}

export async function fetchDailySuggestions(locationId: string): Promise<SuggestionsData> {
  const data = await fetchSmartOrderData(locationId);
  return data.suggestions;
}
