// Past-order and last-ordered-quantity helper functions for orderStore.

import { Order, UnitType } from '@/types';
import type {
  FulfillmentLocationGroup,
  LastOrderedQuantityCacheValue,
  LastOrderedQuantityLookupInput,
  LastOrderedQuantityLookupResult,
  PastOrder,
  PastOrderItem,
  PastOrderShareMethod,
  PastOrderSyncStatus,
  PendingPastOrderSyncJob,
  FinalizedPastOrderLineItemInput,
} from '../orderStore.types';
import {
  createFulfillmentId,
  normalizeHistoryLookupUnit,
  normalizeLocationGroup,
  normalizeSupplierId,
  toIsoString,
  toJsonObject,
  toStringArray,
} from './sharedHelpers';
import { normalizeNote, toValidNumber } from './cartHelpers';

// ---------------------------------------------------------------------------
// Last-ordered quantity cache
// ---------------------------------------------------------------------------

export function createLastOrderedAnyKey(itemId: string, unit: string): string {
  return `${itemId}::${unit}::any`;
}

export function createLastOrderedLocationIdKey(itemId: string, unit: string, locationId: string): string {
  return `${itemId}::${unit}::loc:${locationId}`;
}

export function createLastOrderedLocationGroupKey(
  itemId: string,
  unit: string,
  locationGroup: FulfillmentLocationGroup
): string {
  return `${itemId}::${unit}::group:${locationGroup}`;
}

export function normalizeLastOrderedLookupInput(
  input: LastOrderedQuantityLookupInput
): LastOrderedQuantityLookupInput | null {
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  const itemId = typeof input.itemId === 'string' ? input.itemId.trim() : '';
  const unit = normalizeHistoryLookupUnit(input.unit);
  if (!key || !itemId || !unit) return null;

  return {
    key,
    itemId,
    unit,
    locationId:
      typeof input.locationId === 'string' && input.locationId.trim().length > 0
        ? input.locationId.trim()
        : null,
    locationGroup: normalizeLocationGroup(input.locationGroup),
  };
}

export function resolveLastOrderedFromCache(
  cache: Record<string, LastOrderedQuantityCacheValue>,
  input: LastOrderedQuantityLookupInput
): LastOrderedQuantityLookupResult | null {
  const lookupOrder: { key: string; matchedBy: LastOrderedQuantityLookupResult['matchedBy'] }[] = [];
  if (input.locationId) {
    lookupOrder.push({
      key: createLastOrderedLocationIdKey(input.itemId, input.unit, input.locationId),
      matchedBy: 'location',
    });
  }
  if (input.locationGroup) {
    lookupOrder.push({
      key: createLastOrderedLocationGroupKey(input.itemId, input.unit, input.locationGroup),
      matchedBy: 'location',
    });
  }
  lookupOrder.push({
    key: createLastOrderedAnyKey(input.itemId, input.unit),
    matchedBy: 'supplier',
  });

  for (const lookup of lookupOrder) {
    const found = cache[lookup.key];
    if (!found || !Number.isFinite(found.quantity) || found.quantity <= 0) continue;
    return {
      quantity: found.quantity,
      orderedAt: found.orderedAt,
      matchedBy: lookup.matchedBy,
    };
  }

  return null;
}

export function upsertLastOrderedCacheValue(
  cache: Record<string, LastOrderedQuantityCacheValue>,
  key: string,
  next: LastOrderedQuantityCacheValue
) {
  const existing = cache[key];
  if (!existing) {
    cache[key] = next;
    return;
  }

  const existingAt = new Date(existing.orderedAt).getTime();
  const nextAt = new Date(next.orderedAt).getTime();
  if (Number.isFinite(nextAt) && (!Number.isFinite(existingAt) || nextAt > existingAt)) {
    cache[key] = next;
  }
}

// ---------------------------------------------------------------------------
// Past-order normalization
// ---------------------------------------------------------------------------

export function getPastOrderCountsFromPayload(payload: Record<string, unknown>): {
  itemCount: number;
  remainingCount: number;
} {
  const regularItems = Array.isArray(payload.regularItems)
    ? payload.regularItems
    : Array.isArray(payload.regular_items)
      ? payload.regular_items
      : [];
  const remainingItems = Array.isArray(payload.remainingItems)
    ? payload.remainingItems
    : Array.isArray(payload.remaining_items)
      ? payload.remaining_items
      : [];
  const totalRaw =
    typeof payload.totalItemCount === 'number'
      ? payload.totalItemCount
      : typeof payload.total_item_count === 'number'
        ? payload.total_item_count
        : regularItems.length + remainingItems.length;
  const remainingRaw =
    typeof payload.remainingCount === 'number'
      ? payload.remainingCount
      : typeof payload.remaining_count === 'number'
        ? payload.remaining_count
        : remainingItems.length;

  const itemCount = Number.isFinite(totalRaw) ? Math.max(0, Number(totalRaw)) : 0;
  const remainingCount = Number.isFinite(remainingRaw) ? Math.max(0, Number(remainingRaw)) : 0;
  return { itemCount, remainingCount };
}

export function normalizePastOrder(raw: unknown): PastOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const supplierName = typeof value.supplier_name === 'string'
    ? value.supplier_name.trim()
    : typeof value.supplierName === 'string'
      ? value.supplierName.trim()
      : '';
  const messageText = typeof value.message_text === 'string'
    ? value.message_text
    : typeof value.messageText === 'string'
      ? value.messageText
      : '';
  if (!supplierName || !messageText) return null;

  const shareMethod: PastOrderShareMethod =
    value.share_method === 'copy' || value.shareMethod === 'copy' ? 'copy' : 'share';
  const payload = toJsonObject(value.payload);
  const counts = getPastOrderCountsFromPayload(payload);
  const syncStatus: PastOrderSyncStatus =
    value.sync_status === 'pending_sync' || value.syncStatus === 'pending_sync'
      ? 'pending_sync'
      : 'synced';

  return {
    id:
      typeof value.id === 'string' && value.id.trim().length > 0
        ? value.id
        : createFulfillmentId('past'),
    supplierId:
      typeof value.supplier_id === 'string' && value.supplier_id.trim().length > 0
        ? value.supplier_id
        : typeof value.supplierId === 'string' && value.supplierId.trim().length > 0
          ? value.supplierId
          : null,
    supplierName,
    createdBy:
      typeof value.created_by === 'string' && value.created_by.trim().length > 0
        ? value.created_by
        : typeof value.createdBy === 'string' && value.createdBy.trim().length > 0
          ? value.createdBy
          : null,
    createdAt: toIsoString(value.created_at ?? value.createdAt),
    payload,
    messageText,
    shareMethod,
    syncStatus,
    pendingSyncJobId:
      typeof value.pendingSyncJobId === 'string' && value.pendingSyncJobId.trim().length > 0
        ? value.pendingSyncJobId
        : null,
    syncError:
      typeof value.syncError === 'string' && value.syncError.trim().length > 0
        ? value.syncError
        : null,
    itemCount:
      typeof value.itemCount === 'number' && Number.isFinite(value.itemCount)
        ? Math.max(0, value.itemCount)
        : counts.itemCount,
    remainingCount:
      typeof value.remainingCount === 'number' && Number.isFinite(value.remainingCount)
        ? Math.max(0, value.remainingCount)
        : counts.remainingCount,
  };
}

export function normalizePastOrders(raw: unknown): PastOrder[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizePastOrder(item))
    .filter((item): item is PastOrder => Boolean(item))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function normalizePastOrderItem(raw: unknown): PastOrderItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const pastOrderId =
    typeof value.past_order_id === 'string'
      ? value.past_order_id.trim()
      : typeof value.pastOrderId === 'string'
        ? value.pastOrderId.trim()
        : '';
  const itemId =
    typeof value.item_id === 'string'
      ? value.item_id.trim()
      : typeof value.itemId === 'string'
        ? value.itemId.trim()
        : '';
  const itemName =
    typeof value.item_name === 'string'
      ? value.item_name.trim()
      : typeof value.itemName === 'string'
        ? value.itemName.trim()
        : '';
  const unit = normalizeHistoryLookupUnit(value.unit);
  const quantity = toValidNumber(value.quantity);
  if (!pastOrderId || !itemId || !itemName || !unit || quantity === null || quantity <= 0) return null;

  const id =
    typeof value.id === 'string' && value.id.trim().length > 0
      ? value.id
      : createFulfillmentId('past_item');
  const locationGroup = normalizeLocationGroup(value.location_group ?? value.locationGroup);

  return {
    id,
    pastOrderId,
    supplierId:
      typeof value.supplier_id === 'string' && value.supplier_id.trim().length > 0
        ? value.supplier_id
        : typeof value.supplierId === 'string' && value.supplierId.trim().length > 0
          ? value.supplierId
          : null,
    createdBy:
      typeof value.created_by === 'string' && value.created_by.trim().length > 0
        ? value.created_by
        : typeof value.createdBy === 'string' && value.createdBy.trim().length > 0
          ? value.createdBy
          : null,
    itemId,
    itemName,
    unit,
    quantity: Math.max(0, quantity),
    locationId:
      typeof value.location_id === 'string' && value.location_id.trim().length > 0
        ? value.location_id
        : typeof value.locationId === 'string' && value.locationId.trim().length > 0
          ? value.locationId
          : null,
    locationName:
      typeof value.location_name === 'string' && value.location_name.trim().length > 0
        ? value.location_name
        : typeof value.locationName === 'string' && value.locationName.trim().length > 0
          ? value.locationName
          : null,
    locationGroup,
    unitType: value.unit_type === 'base' || value.unit_type === 'pack'
      ? value.unit_type
      : value.unitType === 'base' || value.unitType === 'pack'
        ? value.unitType
        : null,
    orderedAt: toIsoString(value.ordered_at ?? value.orderedAt),
    createdAt: toIsoString(value.created_at ?? value.createdAt),
    note: normalizeNote(value.note),
  };
}

export function normalizePastOrderItems(raw: unknown): PastOrderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizePastOrderItem(item))
    .filter((item): item is PastOrderItem => Boolean(item))
    .sort((a, b) => new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime());
}

export function createPastOrderSyncJobId() {
  return `past_sync_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizePendingPastOrderSyncJob(raw: unknown): PendingPastOrderSyncJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const id =
    typeof value.id === 'string' && value.id.trim().length > 0
      ? value.id
      : createPastOrderSyncJobId();
  const localPastOrderId =
    typeof value.localPastOrderId === 'string' && value.localPastOrderId.trim().length > 0
      ? value.localPastOrderId
      : '';
  const supplierId =
    typeof value.supplierId === 'string' && value.supplierId.trim().length > 0
      ? value.supplierId
      : '';
  const supplierName =
    typeof value.supplierName === 'string' && value.supplierName.trim().length > 0
      ? value.supplierName
      : '';
  const createdBy =
    typeof value.createdBy === 'string' && value.createdBy.trim().length > 0
      ? value.createdBy
      : '';
  const messageText =
    typeof value.messageText === 'string' && value.messageText.trim().length > 0
      ? value.messageText
      : '';
  if (!localPastOrderId || !supplierId || !supplierName || !createdBy || !messageText) return null;

  const shareMethod: PastOrderShareMethod = value.shareMethod === 'copy' ? 'copy' : 'share';
  const lineItems: FinalizedPastOrderLineItemInput[] = Array.isArray(value.lineItems)
    ? value.lineItems.reduce<FinalizedPastOrderLineItemInput[]>((acc, rawLine) => {
        const line = rawLine as Record<string, unknown>;
        const lineItemId = typeof line.itemId === 'string' ? line.itemId.trim() : '';
        const lineItemName = typeof line.itemName === 'string' ? line.itemName.trim() : '';
        const lineUnit = normalizeHistoryLookupUnit(line.unit);
        const lineQuantity = toValidNumber(line.quantity);
        if (!lineItemId || !lineItemName || !lineUnit || lineQuantity === null || lineQuantity <= 0) {
          return acc;
        }

        acc.push({
          itemId: lineItemId,
          itemName: lineItemName,
          unit: lineUnit,
          quantity: Math.max(0, lineQuantity),
          locationId:
            typeof line.locationId === 'string' && line.locationId.trim().length > 0
              ? line.locationId.trim()
              : null,
          locationName:
            typeof line.locationName === 'string' && line.locationName.trim().length > 0
              ? line.locationName.trim()
              : null,
          locationGroup: normalizeLocationGroup(line.locationGroup),
          unitType: line.unitType === 'base' || line.unitType === 'pack' ? line.unitType : null,
          note: normalizeNote(line.note),
        });

        return acc;
      }, [])
    : [];

  return {
    id,
    localPastOrderId,
    existingPastOrderId:
      typeof value.existingPastOrderId === 'string' && value.existingPastOrderId.trim().length > 0
        ? value.existingPastOrderId
        : null,
    queuedAt: toIsoString(value.queuedAt),
    supplierId,
    supplierName,
    createdBy,
    messageText,
    shareMethod,
    payload: toJsonObject(value.payload),
    lineItems,
    consumedOrderItemIds: toStringArray(value.consumedOrderItemIds),
    consumedDraftItemIds: toStringArray(value.consumedDraftItemIds),
    retryCount:
      typeof value.retryCount === 'number' && Number.isFinite(value.retryCount)
        ? Math.max(0, Math.floor(value.retryCount))
        : 0,
    lastError:
      typeof value.lastError === 'string' && value.lastError.trim().length > 0
        ? value.lastError.trim()
        : null,
  };
}

export function normalizePendingPastOrderSyncQueue(raw: unknown): PendingPastOrderSyncJob[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizePendingPastOrderSyncJob(entry))
    .filter((entry): entry is PendingPastOrderSyncJob => Boolean(entry))
    .sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime());
}

export function mergeRemoteAndPendingPastOrders(
  remote: PastOrder[],
  local: PastOrder[],
  queue: PendingPastOrderSyncJob[]
): PastOrder[] {
  const remoteById = new Set(remote.map((row) => row.id));
  const queueByOrderId = new Set(queue.map((job) => job.localPastOrderId));
  const pendingLocal = local.filter(
    (row) => row.syncStatus === 'pending_sync' || queueByOrderId.has(row.id)
  );
  const unsyncedOnly = pendingLocal.filter((row) => !remoteById.has(row.id));
  return [...unsyncedOnly, ...remote].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function extractPastOrderItemsFromPayload(order: PastOrder): PastOrderItem[] {
  const payload = toJsonObject(order.payload);
  const regularItems = Array.isArray(payload.regularItems)
    ? payload.regularItems
    : Array.isArray(payload.regular_items)
      ? payload.regular_items
      : [];
  const remainingItems = Array.isArray(payload.remainingItems)
    ? payload.remainingItems
    : Array.isArray(payload.remaining_items)
      ? payload.remaining_items
      : [];
  const rows = [...regularItems, ...remainingItems];

  return rows
    .map((row, index) => {
      if (!row || typeof row !== 'object') return null;
      const value = row as Record<string, unknown>;
      const rowItemId =
        typeof value.inventoryItemId === 'string'
          ? value.inventoryItemId.trim()
          : typeof value.itemId === 'string'
            ? value.itemId.trim()
            : '';
      const rowItemName =
        typeof value.name === 'string'
          ? value.name.trim()
          : typeof value.itemName === 'string'
            ? value.itemName.trim()
            : '';
      const rowUnit = normalizeHistoryLookupUnit(value.unitLabel ?? value.unit);
      const rowQuantity = toValidNumber(value.quantity ?? value.decidedQuantity ?? value.decided_quantity);
      if (!rowItemId || !rowItemName || !rowUnit || rowQuantity === null || rowQuantity <= 0) return null;

      const itemIdForRow = `payload_item_${order.id}_${index}`;
      const rowLocationGroup = normalizeLocationGroup(value.locationGroup ?? value.location_group);
      const note = normalizeNote(value.note);
      return {
        id: itemIdForRow,
        pastOrderId: order.id,
        supplierId: order.supplierId,
        createdBy: order.createdBy,
        itemId: rowItemId,
        itemName: rowItemName,
        unit: rowUnit,
        quantity: Math.max(0, rowQuantity),
        locationId:
          typeof value.locationId === 'string' && value.locationId.trim().length > 0
            ? value.locationId.trim()
            : typeof value.location_id === 'string' && value.location_id.trim().length > 0
              ? value.location_id.trim()
              : null,
        locationName:
          typeof value.locationName === 'string' && value.locationName.trim().length > 0
            ? value.locationName.trim()
            : typeof value.location_name === 'string' && value.location_name.trim().length > 0
              ? value.location_name.trim()
              : null,
        locationGroup: rowLocationGroup,
        unitType: value.unitType === 'base' || value.unitType === 'pack'
          ? value.unitType
          : value.unit_type === 'base' || value.unit_type === 'pack'
            ? value.unit_type
            : null,
        orderedAt: order.createdAt,
        createdAt: order.createdAt,
        note,
      } satisfies PastOrderItem;
    })
    .filter((row): row is PastOrderItem => Boolean(row));
}

export function extractConsumedOrderItemIds(pastOrders: PastOrder[]): Set<string> {
  const ids = new Set<string>();

  pastOrders.forEach((row) => {
    const payload = toJsonObject(row.payload);
    const camel = toStringArray(payload.sourceOrderItemIds);
    const snake = toStringArray(payload.source_order_item_ids);
    [...camel, ...snake].forEach((id) => ids.add(id));
  });

  return ids;
}

export function removeConsumedOrderItems(
  orders: Order[],
  consumedOrderItemIds: Set<string>
): Order[] {
  if (consumedOrderItemIds.size === 0) return orders;

  return (orders as any[])
    .map((order) => {
      if (!Array.isArray(order?.order_items)) return order;
      const nextItems = order.order_items.filter(
        (item: any) => !consumedOrderItemIds.has(item?.id)
      );
      return { ...order, order_items: nextItems };
    })
    .filter((order) => {
      if (!Array.isArray((order as any)?.order_items)) return true;
      return (order as any).order_items.length > 0;
    });
}
