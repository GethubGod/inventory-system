// Helper / utility functions extracted from orderStore.ts.
// These are pure functions (or thin wrappers) used by the Zustand store and
// its persistence layer. Keeping them separate makes the store file easier to
// navigate and test.

import { Platform } from 'react-native';
import { Order, UnitType } from '@/types';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { getNotificationsModule } from '@/lib/notifications';
import type { OrderItemPayload } from '@/services/orderSubmission';
import type {
  CartByLocation,
  CartContext,
  CartItem,
  FinalizedPastOrderLineItemInput,
  FulfillmentLocationGroup,
  LastOrderedQuantityCacheValue,
  LastOrderedQuantityLookupInput,
  LastOrderedQuantityLookupResult,
  OrderInputMode,
  OrderLaterItem,
  OrderState,
  PastOrder,
  PastOrderItem,
  PastOrderShareMethod,
  PastOrderSyncStatus,
  PendingPastOrderSyncJob,
  SupplierDraftItem,
  SupplierDraftsBySupplier,
} from './orderStore.types';

// ---------------------------------------------------------------------------
// Module-level mutable state
// ---------------------------------------------------------------------------

export const tableFlags = {
  pastOrdersTableAvailable: null as boolean | null,
  orderLaterItemsTableAvailable: null as boolean | null,
  pastOrderItemsTableAvailable: null as boolean | null,
  pastOrderItemsNoteColumnAvailable: null as boolean | null,
  orderItemsStatusColumnAvailable: null as boolean | null,
  pastOrderSyncListenerInitialized: false,
};

export const orderLaterMoveInFlightIds = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const createCartItemId = () =>
  `cart_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export function resolveCurrentOrgId(): string | null {
  const orgId = useAuthStore.getState().orgId?.trim();
  return orgId && orgId.length > 0 ? orgId : null;
}

export function toValidNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getEffectiveQuantity(item: CartItem): number {
  if (item.inputMode === 'quantity') {
    return item.quantityRequested ?? 0;
  }
  return item.decidedQuantity ?? 0;
}

/** Whether a cart item is valid for submission (non-zero quantity OR remaining-mode report). */
export function isSubmittableCartItem(item: CartItem): boolean {
  if (item.inputMode === 'remaining') {
    // Remaining-mode: employee reports how much is left; manager decides
    // order quantity later. Valid as long as remainingReported is set.
    return (item.remainingReported ?? 0) >= 0;
  }
  return getEffectiveQuantity(item) > 0;
}

export function createLegacyCartItemId(
  locationId: string,
  inventoryItemId: string,
  inputMode: OrderInputMode,
  unitType: UnitType,
  index: number
): string {
  return `legacy_cart_${locationId}_${inventoryItemId}_${inputMode}_${unitType}_${index}`;
}

export function normalizeCartItem(
  raw: any,
  options?: {
    locationId?: string;
    index?: number;
  }
): CartItem | null {
  const inputMode: OrderInputMode = raw?.inputMode === 'remaining' ? 'remaining' : 'quantity';
  const unitType: UnitType = raw?.unitType === 'base' ? 'base' : 'pack';
  const inventoryItemId =
    typeof raw?.inventoryItemId === 'string' && raw.inventoryItemId ? raw.inventoryItemId : null;

  if (!inventoryItemId) return null;

  const rawId = typeof raw?.id === 'string' ? raw.id.trim() : '';
  const id =
    rawId.length > 0
      ? rawId
      : createLegacyCartItemId(
        options?.locationId ?? 'unknown',
        inventoryItemId,
        inputMode,
        unitType,
        options?.index ?? 0
      );

  if (inputMode === 'quantity') {
    const legacyQuantity = toValidNumber(raw?.quantity);
    const quantityRequested = toValidNumber(raw?.quantityRequested ?? legacyQuantity);
    if (quantityRequested === null || quantityRequested <= 0) return null;

    const decidedQuantityRaw = toValidNumber(raw?.decidedQuantity);
    const decidedQuantity = decidedQuantityRaw !== null && decidedQuantityRaw >= 0 ? decidedQuantityRaw : null;

    const item: CartItem = {
      id,
      inventoryItemId,
      quantity: quantityRequested,
      unitType,
      inputMode,
      quantityRequested,
      remainingReported: null,
      decidedQuantity,
      decidedBy: typeof raw?.decidedBy === 'string' ? raw.decidedBy : null,
      decidedAt: typeof raw?.decidedAt === 'string' ? raw.decidedAt : null,
      note: normalizeNote(raw?.note),
    };
    return item;
  }

  const remainingLegacy = toValidNumber(raw?.remainingReported ?? raw?.quantity);
  if (remainingLegacy === null || remainingLegacy < 0) return null;

  const decidedQuantityRaw = toValidNumber(raw?.decidedQuantity);
  const decidedQuantity = decidedQuantityRaw !== null && decidedQuantityRaw >= 0 ? decidedQuantityRaw : null;

  const item: CartItem = {
    id,
    inventoryItemId,
    quantity: decidedQuantity ?? 0,
    unitType,
    inputMode,
    quantityRequested: null,
    remainingReported: remainingLegacy,
    decidedQuantity,
    decidedBy: typeof raw?.decidedBy === 'string' ? raw.decidedBy : null,
    decidedAt: typeof raw?.decidedAt === 'string' ? raw.decidedAt : null,
    note: normalizeNote(raw?.note),
  };
  return item;
}

export function normalizeLocationCart(rawCart: unknown, locationId = 'unknown'): CartItem[] {
  if (!Array.isArray(rawCart)) return [];
  return rawCart
    .map((item, index) => normalizeCartItem(item, { locationId, index }))
    .filter((item): item is CartItem => Boolean(item));
}

export function getLocationCart(cartByLocation: CartByLocation, locationId: string): CartItem[] {
  return normalizeLocationCart(cartByLocation[locationId] || [], locationId);
}

export function normalizeCartByLocation(rawCartByLocation: unknown): CartByLocation {
  if (!rawCartByLocation || typeof rawCartByLocation !== 'object') return {};

  const source = rawCartByLocation as Record<string, unknown>;
  const next: CartByLocation = {};

  Object.entries(source).forEach(([locationId, rawCart]) => {
    const normalized = normalizeLocationCart(rawCart, locationId);
    if (normalized.length > 0) {
      next[locationId] = normalized;
    }
  });

  return next;
}

export function normalizeCartContext(context?: CartContext): CartContext {
  return context === 'manager' ? 'manager' : 'employee';
}

export function getCartByContext(
  state: Pick<OrderState, 'cartByLocation' | 'managerCartByLocation'>,
  _context?: CartContext
): CartByLocation {
  // Unified cart: both employee and manager modes share the same cart
  // for the authenticated user. The managerCartByLocation field is kept
  // for persistence migration but all reads go through cartByLocation.
  return state.cartByLocation;
}

export function mergeCartItem(
  destination: CartItem[],
  incoming: CartItem
): CartItem[] {
  if (incoming.inputMode === 'quantity') {
    const existingIndex = destination.findIndex(
      (item) =>
        item.inventoryItemId === incoming.inventoryItemId &&
        item.unitType === incoming.unitType &&
        item.inputMode === 'quantity'
    );

    if (existingIndex >= 0) {
      const existing = destination[existingIndex];
      const nextQuantity = (existing.quantityRequested ?? 0) + (incoming.quantityRequested ?? 0);
      const merged: CartItem = {
        ...existing,
        unitType: incoming.unitType,
        quantityRequested: nextQuantity,
        quantity: nextQuantity,
        note: existing.note ?? incoming.note ?? null,
      };
      return destination.map((item, idx) => (idx === existingIndex ? merged : item));
    }

    return [...destination, incoming];
  }

  // Remaining-mode merge rule: replace existing remaining row for same item+unit.
  const existingRemainingIndex = destination.findIndex(
    (item) =>
      item.inventoryItemId === incoming.inventoryItemId &&
      item.unitType === incoming.unitType &&
      item.inputMode === 'remaining'
  );

  if (existingRemainingIndex >= 0) {
    return destination.map((item, idx) => (idx === existingRemainingIndex ? incoming : item));
  }

  return [...destination, incoming];
}

export function findCartItemIndex(
  locationCart: CartItem[],
  inventoryItemId: string,
  unitType: UnitType,
  cartItemId?: string
): number {
  if (cartItemId) {
    const byId = locationCart.findIndex((item) => item.id === cartItemId);
    if (byId >= 0) return byId;
  }

  const byInventoryAndUnit = locationCart.findIndex(
    (item) => item.inventoryItemId === inventoryItemId && item.unitType === unitType
  );
  if (byInventoryAndUnit >= 0) return byInventoryAndUnit;

  return locationCart.findIndex((item) => item.inventoryItemId === inventoryItemId);
}

/** Convert a CartItem to the OrderItemPayload format expected by the RPC. */
export function cartItemToPayload(item: CartItem): OrderItemPayload {
  // For remaining-mode the employee hasn't specified an order quantity — the
  // manager will decide later. Use remainingReported as the DB quantity so it
  // satisfies any legacy `quantity > 0` constraint; fulfillment reads
  // remaining_reported / decided_quantity directly, not this field.
  const quantity =
    item.inputMode === 'remaining'
      ? Math.max(item.remainingReported ?? 0, 1)
      : getEffectiveQuantity(item);

  return {
    inventory_item_id: item.inventoryItemId,
    quantity,
    unit_type: item.unitType,
    input_mode: item.inputMode,
    quantity_requested: item.quantityRequested,
    remaining_reported: item.remainingReported,
    decided_quantity: item.decidedQuantity,
    decided_by: item.decidedBy,
    decided_at: item.decidedAt,
    note: item.note,
  };
}

export function createFulfillmentId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function toIsoString(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  return fallback;
}

export function toJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function normalizeSupplierId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeLocationGroup(value: unknown): FulfillmentLocationGroup | null {
  if (value === 'sushi' || value === 'poki') return value;
  return null;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

export function normalizeHistoryLookupUnit(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

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

export function isNetworkLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { message?: string; details?: string };
  const text = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return (
    text.includes('network') ||
    text.includes('offline') ||
    text.includes('failed to fetch') ||
    text.includes('connection') ||
    text.includes('timed out')
  );
}

export function isMissingTableError(error: unknown, tableName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string; details?: string };
  const message = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  if (!message.includes(tableName.toLowerCase())) return false;
  return (
    err.code === 'PGRST205' ||
    err.code === 'PGRST204' ||
    err.code === '42P01' ||
    message.includes('does not exist') ||
    message.includes('could not find')
  );
}

export function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.toLowerCase();
  if (!text.includes(columnName.toLowerCase())) return false;
  return (
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    text.includes('column') && text.includes('does not exist')
  );
}

export function normalizeSupplierDraftItem(raw: unknown): SupplierDraftItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const supplierId = normalizeSupplierId(value.supplierId);
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!supplierId || name.length === 0) return null;

  const unitType: UnitType = value.unitType === 'pack' ? 'pack' : 'base';
  const quantity = toValidNumber(value.quantity);
  if (quantity === null || quantity <= 0) return null;

  return {
    id:
      typeof value.id === 'string' && value.id.trim().length > 0
        ? value.id
        : createFulfillmentId('draft'),
    supplierId,
    inventoryItemId:
      typeof value.inventoryItemId === 'string' && value.inventoryItemId.trim().length > 0
        ? value.inventoryItemId
        : null,
    name,
    category:
      typeof value.category === 'string' && value.category.trim().length > 0
        ? value.category
        : 'dry',
    quantity: Math.max(0, quantity),
    unitType,
    unitLabel:
      typeof value.unitLabel === 'string' && value.unitLabel.trim().length > 0
        ? value.unitLabel
        : unitType === 'pack'
          ? 'pack'
          : 'unit',
    locationGroup: normalizeLocationGroup(value.locationGroup) ?? 'sushi',
    locationId:
      typeof value.locationId === 'string' && value.locationId.trim().length > 0
        ? value.locationId
        : null,
    locationName:
      typeof value.locationName === 'string' && value.locationName.trim().length > 0
        ? value.locationName
        : null,
    note: normalizeNote(value.note),
    createdAt: toIsoString(value.createdAt),
    sourceOrderLaterItemId:
      typeof value.sourceOrderLaterItemId === 'string' && value.sourceOrderLaterItemId.trim().length > 0
        ? value.sourceOrderLaterItemId
        : null,
  };
}

export function normalizeSupplierDrafts(raw: unknown): SupplierDraftsBySupplier {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const next: SupplierDraftsBySupplier = {};

  Object.entries(source).forEach(([supplierId, rows]) => {
    const normalizedSupplierId = normalizeSupplierId(supplierId);
    if (!normalizedSupplierId || !Array.isArray(rows)) return;
    const normalizedRows = rows
      .map((row) => normalizeSupplierDraftItem(row))
      .filter((row): row is SupplierDraftItem => Boolean(row));
    if (normalizedRows.length > 0) {
      next[normalizedSupplierId] = normalizedRows;
    }
  });

  return next;
}

export function normalizeOrderLaterItem(raw: unknown): OrderLaterItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const itemName = typeof value.item_name === 'string'
    ? value.item_name.trim()
    : typeof value.itemName === 'string'
      ? value.itemName.trim()
      : '';
  const createdBy = typeof value.created_by === 'string'
    ? value.created_by
    : typeof value.createdBy === 'string'
      ? value.createdBy
      : '';
  if (!itemName || !createdBy) return null;

  const statusValue =
    value.status === 'added' || value.status === 'cancelled' ? value.status : 'queued';

  return {
    id:
      typeof value.id === 'string' && value.id.trim().length > 0
        ? value.id
        : createFulfillmentId('later'),
    createdBy,
    createdAt: toIsoString(value.created_at ?? value.createdAt),
    scheduledAt: toIsoString(value.scheduled_at ?? value.scheduledAt),
    quantity: Math.max(
      0,
      toValidNumber(value.qty ?? value.quantity ?? (toJsonObject(value.payload).quantity as unknown) ?? 1) ?? 1
    ),
    itemId:
      typeof value.item_id === 'string' && value.item_id.trim().length > 0
        ? value.item_id
        : typeof value.itemId === 'string' && value.itemId.trim().length > 0
          ? value.itemId
          : null,
    itemName,
    unit:
      typeof value.unit === 'string' && value.unit.trim().length > 0
        ? value.unit.trim()
        : 'unit',
    locationId:
      typeof value.location_id === 'string' && value.location_id.trim().length > 0
        ? value.location_id
        : typeof value.locationId === 'string' && value.locationId.trim().length > 0
          ? value.locationId
          : null,
    locationName:
      typeof value.location_name === 'string' && value.location_name.trim().length > 0
        ? value.location_name.trim()
        : typeof value.locationName === 'string' && value.locationName.trim().length > 0
          ? value.locationName.trim()
          : null,
    notes: normalizeNote(value.notes),
    suggestedSupplierId: normalizeSupplierId(
      value.suggested_supplier_id ?? value.suggestedSupplierId
    ),
    preferredSupplierId: normalizeSupplierId(value.preferred_supplier_id ?? value.preferredSupplierId),
    preferredLocationGroup: normalizeLocationGroup(
      value.preferred_location_group ?? value.preferredLocationGroup
    ),
    sourceOrderItemId:
      typeof value.source_order_item_id === 'string' && value.source_order_item_id.trim().length > 0
        ? value.source_order_item_id
        : typeof value.sourceOrderItemId === 'string' && value.sourceOrderItemId.trim().length > 0
          ? value.sourceOrderItemId
          : null,
    sourceOrderItemIds: (() => {
      const fromArray = Array.isArray(value.original_order_item_ids)
        ? toStringArray(value.original_order_item_ids)
        : Array.isArray(value.sourceOrderItemIds)
          ? toStringArray(value.sourceOrderItemIds)
          : [];
      if (fromArray.length > 0) return fromArray;
      const single =
        typeof value.source_order_item_id === 'string' && value.source_order_item_id.trim().length > 0
          ? value.source_order_item_id
          : typeof value.sourceOrderItemId === 'string' && value.sourceOrderItemId.trim().length > 0
            ? value.sourceOrderItemId
            : null;
      return single ? [single] : [];
    })(),
    sourceOrderId:
      typeof value.source_order_id === 'string' && value.source_order_id.trim().length > 0
        ? value.source_order_id
        : typeof value.sourceOrderId === 'string' && value.sourceOrderId.trim().length > 0
          ? value.sourceOrderId
          : null,
    notificationId:
      typeof value.notification_id === 'string' && value.notification_id.trim().length > 0
        ? value.notification_id
        : typeof value.notificationId === 'string' && value.notificationId.trim().length > 0
          ? value.notificationId
          : null,
    status: statusValue,
    payload: toJsonObject(value.payload),
  };
}

export function normalizeOrderLaterQueue(raw: unknown): OrderLaterItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeOrderLaterItem(item))
    .filter((item): item is OrderLaterItem => Boolean(item))
    .filter((item) => item.status === 'queued')
    .sort((a, b) => {
      const aTime = new Date(a.scheduledAt).getTime();
      const bTime = new Date(b.scheduledAt).getTime();
      return aTime - bTime;
    });
}

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
        const itemId = typeof line.itemId === 'string' ? line.itemId.trim() : '';
        const itemName = typeof line.itemName === 'string' ? line.itemName.trim() : '';
        const unit = normalizeHistoryLookupUnit(line.unit);
        const quantity = toValidNumber(line.quantity);
        if (!itemId || !itemName || !unit || quantity === null || quantity <= 0) {
          return acc;
        }

        acc.push({
          itemId,
          itemName,
          unit,
          quantity: Math.max(0, quantity),
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
      const itemId =
        typeof value.inventoryItemId === 'string'
          ? value.inventoryItemId.trim()
          : typeof value.itemId === 'string'
            ? value.itemId.trim()
            : '';
      const itemName =
        typeof value.name === 'string'
          ? value.name.trim()
          : typeof value.itemName === 'string'
            ? value.itemName.trim()
            : '';
      const unit = normalizeHistoryLookupUnit(value.unitLabel ?? value.unit);
      const quantity = toValidNumber(value.quantity ?? value.decidedQuantity ?? value.decided_quantity);
      if (!itemId || !itemName || !unit || quantity === null || quantity <= 0) return null;

      const itemIdForRow = `payload_item_${order.id}_${index}`;
      const locationGroup = normalizeLocationGroup(value.locationGroup ?? value.location_group);
      const note = normalizeNote(value.note);
      return {
        id: itemIdForRow,
        pastOrderId: order.id,
        supplierId: order.supplierId,
        createdBy: order.createdBy,
        itemId,
        itemName,
        unit,
        quantity: Math.max(0, quantity),
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
        locationGroup,
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

export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = await getNotificationsModule();
  if (!Notifications || Platform.OS === 'web') {
    return false;
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

export async function cancelOrderLaterNotification(notificationId: string | null) {
  if (!notificationId) return;
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return;

    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Ignore stale notification identifiers.
  }
}

export async function scheduleOrderLaterNotification(input: {
  orderLaterItemId: string;
  itemName: string;
  scheduledAt: string;
}): Promise<string | null> {
  const targetDate = new Date(input.scheduledAt);
  if (Number.isNaN(targetDate.getTime())) return null;

  const granted = await ensureNotificationPermission().catch(() => false);
  if (!granted) return null;

  const minimum = Date.now() + 2_000;
  const safeTarget = targetDate.getTime() < minimum ? new Date(minimum) : targetDate;

  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return null;

    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `Order later reminder: ${input.itemName}`,
        body: 'Tap to add this item to a supplier order.',
        data: {
          type: 'order-later-reminder',
          orderLaterItemId: input.orderLaterItemId,
        },
        sound: true,
      },
      trigger: safeTarget as any,
    });
  } catch {
    return null;
  }
}

export async function createOrderLaterInAppNotification(params: {
  userId: string;
  itemName: string;
  scheduledAt: string;
}) {
  try {
    await (supabase as any).from('notifications').insert({
      user_id: params.userId,
      title: `Order later scheduled: ${params.itemName}`,
      body: `Reminder set for ${new Date(params.scheduledAt).toLocaleString()}.`,
      notification_type: 'order_later_scheduled',
      payload: {
        itemName: params.itemName,
        scheduledAt: params.scheduledAt,
      },
    });
  } catch {
    // Best-effort signal only.
  }
}
