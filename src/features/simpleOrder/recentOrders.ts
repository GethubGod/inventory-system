import { supabase } from '@/lib/supabase';
import type { ReorderItem } from './checklistSelection';

/**
 * Lightweight self-only view over past_orders for the checklist screen's
 * "Recent orders" sheet. Read-only: supplier, date, item count, and the
 * archived message text. Mapping helpers are pure and unit-tested in
 * src/__tests__/simpleOrderRecentOrders.test.ts.
 */

export interface RecentOrder {
  id: string;
  supplierName: string;
  createdAt: string;
  itemCount: number | null;
  messageText: string;
  /** Lines that can be loaded back into today's checklist via Reorder. */
  reorderItems: ReorderItem[];
}

type RecentOrderRow = {
  id: string;
  supplier_name: string | null;
  created_at: string | null;
  message_text: string | null;
  payload: unknown;
};

/**
 * Item count from an archived payload. Both fulfillment finalization and
 * direct-send archives write totalItemCount; older/foreign payloads fall back
 * to counting the item arrays, and unknown shapes report null (count hidden).
 */
export function countItemsInPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  const total = record.totalItemCount;
  if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
    return total;
  }

  const regular = record.regularItems;
  const remaining = record.remainingItems;
  if (Array.isArray(regular) || Array.isArray(remaining)) {
    return (
      (Array.isArray(regular) ? regular.length : 0) +
      (Array.isArray(remaining) ? remaining.length : 0)
    );
  }

  return null;
}

export function mapRecentOrderRow(row: RecentOrderRow): RecentOrder {
  return {
    id: row.id,
    supplierName: row.supplier_name?.trim() || 'Supplier',
    createdAt: row.created_at ?? '',
    itemCount: countItemsInPayload(row.payload),
    messageText: row.message_text ?? '',
    reorderItems: buildReorderItemsFromPayload(row.payload),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today" / "Yesterday" / "Aug 3" (with year when not the current year). */
export function formatRecentOrderDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';

  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);

  if (dayDelta === 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';

  const monthDay = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  if (date.getFullYear() !== now.getFullYear()) {
    return `${monthDay}, ${date.getFullYear()}`;
  }
  return monthDay;
}

/** "Today" / "Yesterday" / "Tuesday, Aug 18" for History cards. */
export function formatHistoryDate(iso: string, now: Date = new Date()): string {
  const relative = formatRecentOrderDate(iso, now);
  if (relative === 'Today' || relative === 'Yesterday' || relative === '') {
    return relative;
  }
  const date = new Date(iso);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  return `${weekday}, ${relative}`;
}

/** "9:14 AM" for the history card's "N items · sent 9:14 AM" line. */
export function formatSentTime(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isLikelyInventoryId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Turns an archived past_orders payload back into reorderable checklist
 * lines. Both fulfillment finalization and direct-send archives write
 * regularItems with inventoryItemId/name/quantity/unitLabel; anything that
 * doesn't parse cleanly is skipped rather than guessed.
 */
export function buildReorderItemsFromPayload(payload: unknown): ReorderItem[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const rawItems = ([] as unknown[]).concat(
    Array.isArray(record.regularItems) ? record.regularItems : [],
    Array.isArray(record.remainingItems) ? record.remainingItems : [],
  );

  const items: ReorderItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const quantity = typeof entry.quantity === 'number' ? entry.quantity : Number(entry.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) continue;

    items.push({
      itemId: isLikelyInventoryId(entry.inventoryItemId) ? entry.inventoryItemId : null,
      itemName: name,
      unit: typeof entry.unitLabel === 'string' && entry.unitLabel.trim().length > 0
        ? entry.unitLabel.trim()
        : null,
      quantity,
    });
  }
  return items;
}

export async function listMyRecentOrders(limit = 20): Promise<RecentOrder[]> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) {
    throw new Error('You must be signed in to view recent orders.');
  }

  const { data, error } = await supabase
    .from('past_orders')
    .select('id,supplier_name,created_at,message_text,payload')
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as RecentOrderRow[]).map(mapRecentOrderRow);
}
