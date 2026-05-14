/**
 * "What did I order last time?" suggestions for the Quick Order quantity sheet.
 *
 * Scoped to the **current employee** and the **selected location**: it never
 * surfaces another user's history. The async fetch is a thin wrapper around a
 * single Supabase query; all of the "which previous order should we show"
 * decision logic lives in {@link pickPreviousItemQuantitySuggestion}, which is
 * pure and unit-tested.
 */

import { supabase } from '@/lib/supabase';
import { normalizeQuickOrderUnit } from './quickOrderItems';

/** Shape shown on the "LAST SUNDAY — 2 cases — Use this" card. */
export type PreviousQuantitySuggestion = {
  item_id: string;
  item_name: string;
  quantity: number;
  /** A unit that is currently valid for the item (derived from the catalog row). */
  unit: string;
  /** `"LAST SUNDAY"` (same weekday) or `"LAST ORDER"` (most recent prior order). */
  label: string;
  source_order_id: string;
  ordered_at: string;
};

/** One historical line, with its unit already resolved from `unit_type` + catalog. */
export type HistoryOrderLine = {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
};

export type HistoryOrder = {
  id: string;
  orderedAt: string;
  lines: HistoryOrderLine[];
};

type OrderItemRow = {
  inventory_item_id: string;
  quantity: number | string | null;
  unit_type: 'base' | 'pack' | null;
  inventory_item: {
    id: string;
    name: string;
    base_unit: string | null;
    pack_unit: string | null;
  } | null;
};

type OrderRow = {
  id: string;
  created_at: string;
  order_items: OrderItemRow[] | null;
};

const HISTORY_ORDER_LIMIT = 40;

const WEEKDAY_NAMES = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

const ORDER_HISTORY_SELECT = `
  id,
  created_at,
  order_items (
    inventory_item_id,
    quantity,
    unit_type,
    inventory_item:inventory_items (
      id,
      name,
      base_unit,
      pack_unit
    )
  )
` as const;

/** Maps a raw `orders` row to a {@link HistoryOrder}, dropping unusable lines. */
export function normalizeHistoryOrder(row: OrderRow): HistoryOrder | null {
  if (!row?.id || typeof row.created_at !== 'string') return null;

  const lines: HistoryOrderLine[] = [];
  for (const item of row.order_items ?? []) {
    const inventory = item?.inventory_item;
    if (!inventory?.id) continue;

    const quantity = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const unit = (
      (item.unit_type === 'pack' ? inventory.pack_unit : inventory.base_unit)?.trim() ||
      inventory.base_unit?.trim() ||
      inventory.pack_unit?.trim()
    );
    if (!unit) continue;

    lines.push({
      itemId: item.inventory_item_id || inventory.id,
      itemName: inventory.name,
      quantity,
      unit,
    });
  }

  if (lines.length === 0) return null;
  return { id: row.id, orderedAt: row.created_at, lines };
}

function calendarKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function pickBestLine(lines: HistoryOrderLine[], itemId: string): HistoryOrderLine | null {
  let best: HistoryOrderLine | null = null;
  for (const line of lines) {
    if (line.itemId !== itemId) continue;
    if (!best || line.quantity > best.quantity) best = line;
  }
  return best;
}

/**
 * Chooses the previous-order quantity to suggest for `itemId`:
 *   1. The most recent prior order *on the same weekday as today* that contains
 *      the item — labelled "LAST <WEEKDAY>".
 *   2. Otherwise the most recent prior order that contains it — labelled
 *      "LAST ORDER".
 * Orders dated *today* are ignored (we want a previous order, not the one just
 * placed). Returns `null` when the item has no usable history.
 *
 * `orders` is assumed to already be scoped to the right user + location (that
 * happens in {@link fetchPreviousQuantitySuggestions}); this function is pure.
 */
export function pickPreviousItemQuantitySuggestion(
  orders: readonly HistoryOrder[],
  itemId: string,
  now: Date,
  validUnits: readonly string[] = [],
): PreviousQuantitySuggestion | null {
  if (!itemId) return null;

  const todayKey = calendarKey(now);
  const todayWeekday = now.getDay();
  const validUnitKeys = new Set(validUnits.map(normalizeQuickOrderUnit).filter(Boolean));

  const candidates = orders
    .map((order) => {
      const line = pickBestLine(order.lines, itemId);
      if (!line) return null;
      if (validUnitKeys.size > 0 && !validUnitKeys.has(normalizeQuickOrderUnit(line.unit))) return null;
      const date = new Date(order.orderedAt);
      const time = date.getTime();
      if (!Number.isFinite(time)) return null;
      return { order, line, time, weekday: date.getDay(), key: calendarKey(date) };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null && entry.key !== todayKey)
    .sort((a, b) => b.time - a.time);

  if (candidates.length === 0) return null;

  const sameWeekday = candidates.find((entry) => entry.weekday === todayWeekday);
  const chosen = sameWeekday ?? candidates[0];
  const label = sameWeekday ? `LAST ${WEEKDAY_NAMES[todayWeekday]}` : 'LAST ORDER';

  return {
    item_id: itemId,
    item_name: chosen.line.itemName,
    quantity: chosen.line.quantity,
    unit: chosen.line.unit,
    label,
    source_order_id: chosen.order.id,
    ordered_at: chosen.order.orderedAt,
  };
}

/**
 * Loads this employee's recent submitted orders at the given location and
 * derives a {@link PreviousQuantitySuggestion} per requested item id. Best
 * effort — on any failure it resolves to an empty map and never throws.
 */
export async function fetchPreviousQuantitySuggestions(params: {
  userId: string | null | undefined;
  locationId: string | null | undefined;
  itemIds: readonly (string | null | undefined)[];
  validUnitsByItemId?: ReadonlyMap<string, readonly string[]>;
}): Promise<Map<string, PreviousQuantitySuggestion>> {
  const result = new Map<string, PreviousQuantitySuggestion>();
  const itemIds = Array.from(
    new Set(params.itemIds.filter((id): id is string => Boolean(id && id.trim()))),
  );
  if (!params.userId || !params.locationId || itemIds.length === 0) return result;

  try {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_HISTORY_SELECT)
      .eq('location_id', params.locationId)
      .eq('user_id', params.userId)
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(HISTORY_ORDER_LIMIT);

    if (error) throw error;

    const orders = ((data ?? []) as unknown as OrderRow[])
      .map(normalizeHistoryOrder)
      .filter((order): order is HistoryOrder => order != null);

    const now = new Date();
    for (const itemId of itemIds) {
      const suggestion = pickPreviousItemQuantitySuggestion(
        orders,
        itemId,
        now,
        params.validUnitsByItemId?.get(itemId) ?? [],
      );
      if (suggestion) result.set(itemId, suggestion);
    }

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('[QuickOrder] previous-quantity suggestions', {
        scannedOrders: orders.length,
        requested: itemIds.length,
        matched: result.size,
      });
    }
  } catch (error) {
    console.warn('[QuickOrder] Failed to load previous-quantity suggestions:', error);
  }

  return result;
}
