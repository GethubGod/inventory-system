import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import NetInfo from '@react-native-community/netinfo';
import {
  ItemCategory,
  Order,
  OrderItem,
  OrderStatus,
  OrderWithDetails,
  UnitType,
} from '@/types';
import { supabase } from '@/lib/supabase';
import { perfMark, perfMeasure } from '@/lib/perf';
import {
  loadPendingFulfillmentData,
} from '@/services/fulfillmentDataSource';

export type OrderInputMode = 'quantity' | 'remaining';
export type CartContext = 'employee' | 'manager';

export interface CartItem {
  id: string;
  inventoryItemId: string;
  quantity: number;
  unitType: UnitType;
  inputMode: OrderInputMode;
  quantityRequested: number | null;
  remainingReported: number | null;
  decidedQuantity: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}

export interface AddToCartOptions {
  inputMode?: OrderInputMode;
  quantityRequested?: number | null;
  remainingReported?: number | null;
  decidedQuantity?: number | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  note?: string | null;
  context?: CartContext;
}

interface UpdateCartItemOptions {
  cartItemId?: string;
  inputMode?: OrderInputMode;
  quantityRequested?: number | null;
  remainingReported?: number | null;
  clearDecision?: boolean;
  context?: CartContext;
}

// Cart items organized by location
type CartByLocation = Record<string, CartItem[]>;

export type FulfillmentLocationGroup = 'sushi' | 'poki';
export type OrderLaterItemStatus = 'queued' | 'added' | 'cancelled';
export type PastOrderShareMethod = 'share' | 'copy';
export type PastOrderSyncStatus = 'synced' | 'pending_sync';
export type OrderItemFulfillmentStatus = 'pending' | 'order_later' | 'sent' | 'cancelled';

export interface SupplierDraftItem {
  id: string;
  supplierId: string;
  inventoryItemId: string | null;
  name: string;
  category: ItemCategory | string;
  quantity: number;
  unitType: UnitType;
  unitLabel: string;
  locationGroup: FulfillmentLocationGroup;
  locationId: string | null;
  locationName: string | null;
  note: string | null;
  createdAt: string;
  sourceOrderLaterItemId: string | null;
}

export interface SupplierDraftItemInput {
  supplierId: string;
  inventoryItemId?: string | null;
  name: string;
  category?: ItemCategory | string;
  quantity: number;
  unitType?: UnitType;
  unitLabel?: string;
  locationGroup: FulfillmentLocationGroup;
  locationId?: string | null;
  locationName?: string | null;
  note?: string | null;
  sourceOrderLaterItemId?: string | null;
}

export interface OrderLaterItem {
  id: string;
  createdBy: string;
  createdAt: string;
  scheduledAt: string;
  quantity: number;
  itemId: string | null;
  itemName: string;
  unit: string;
  locationId: string | null;
  locationName: string | null;
  notes: string | null;
  suggestedSupplierId: string | null;
  preferredSupplierId: string | null;
  preferredLocationGroup: FulfillmentLocationGroup | null;
  sourceOrderItemId: string | null;
  sourceOrderItemIds: string[];
  sourceOrderId: string | null;
  notificationId: string | null;
  status: OrderLaterItemStatus;
  payload: Record<string, unknown>;
}

export interface CreateOrderLaterItemInput {
  createdBy: string;
  scheduledAt: string;
  quantity?: number;
  itemId?: string | null;
  itemName: string;
  unit: string;
  locationId?: string | null;
  locationName?: string | null;
  notes?: string | null;
  suggestedSupplierId?: string | null;
  preferredSupplierId?: string | null;
  preferredLocationGroup?: FulfillmentLocationGroup | null;
  sourceOrderItemId?: string | null;
  sourceOrderItemIds?: string[];
  sourceOrderId?: string | null;
  payload?: Record<string, unknown>;
}

export interface PastOrder {
  id: string;
  supplierId: string | null;
  supplierName: string;
  createdBy: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
  messageText: string;
  shareMethod: PastOrderShareMethod;
  syncStatus: PastOrderSyncStatus;
  pendingSyncJobId: string | null;
  syncError: string | null;
  itemCount: number;
  remainingCount: number;
}

export interface PastOrderItem {
  id: string;
  pastOrderId: string;
  supplierId: string | null;
  createdBy: string | null;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  locationId: string | null;
  locationName: string | null;
  locationGroup: FulfillmentLocationGroup | null;
  unitType: UnitType | null;
  orderedAt: string;
  createdAt: string;
  note: string | null;
}

export interface PastOrderDetail {
  order: PastOrder;
  items: PastOrderItem[];
}

interface PendingPastOrderSyncJob {
  id: string;
  localPastOrderId: string;
  existingPastOrderId: string | null;
  queuedAt: string;
  supplierId: string;
  supplierName: string;
  createdBy: string;
  messageText: string;
  shareMethod: PastOrderShareMethod;
  payload: Record<string, unknown>;
  lineItems: FinalizedPastOrderLineItemInput[];
  consumedOrderItemIds: string[];
  consumedDraftItemIds: string[];
  retryCount: number;
  lastError: string | null;
}

export interface FinalizeSupplierOrderInput {
  supplierId: string;
  supplierName: string;
  createdBy: string;
  messageText: string;
  shareMethod: PastOrderShareMethod;
  payload: Record<string, unknown>;
  lineItems?: FinalizedPastOrderLineItemInput[];
  consumedOrderItemIds?: string[];
  consumedDraftItemIds?: string[];
}

export interface FinalizedPastOrderLineItemInput {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  locationId?: string | null;
  locationName?: string | null;
  locationGroup?: FulfillmentLocationGroup | null;
  unitType?: UnitType | null;
  note?: string | null;
}

export interface LastOrderedQuantityLookupInput {
  key: string;
  itemId: string;
  unit: string;
  locationId?: string | null;
  locationGroup?: FulfillmentLocationGroup | null;
}

export interface LastOrderedQuantityLookupResult {
  quantity: number;
  orderedAt: string;
  matchedBy: 'location' | 'supplier';
}

export interface LastOrderedQuantitiesResponse {
  values: Record<string, LastOrderedQuantityLookupResult>;
  fromCache: boolean;
  historyUnavailableOffline: boolean;
}

type SupplierDraftsBySupplier = Record<string, SupplierDraftItem[]>;
type LastOrderedCacheBySupplier = Record<string, Record<string, LastOrderedQuantityCacheValue>>;

interface LastOrderedQuantityCacheValue {
  quantity: number;
  orderedAt: string;
}

interface OrderState {
  cartByLocation: CartByLocation;
  managerCartByLocation: CartByLocation;
  orders: Order[];
  currentOrder: OrderWithDetails | null;
  isLoading: boolean;
  supplierDrafts: SupplierDraftsBySupplier;
  orderLaterQueue: OrderLaterItem[];
  pastOrders: PastOrder[];
  pendingPastOrderSyncQueue: PendingPastOrderSyncJob[];
  lastOrderedCacheBySupplier: LastOrderedCacheBySupplier;
  isFulfillmentLoading: boolean;
  isPastOrderSyncing: boolean;

  // Cart actions (location-aware)
  addToCart: (
    locationId: string,
    inventoryItemId: string,
    quantity: number,
    unitType: UnitType,
    options?: AddToCartOptions
  ) => void;
  updateCartItem: (
    locationId: string,
    inventoryItemId: string,
    quantity: number,
    unitType: UnitType,
    options?: UpdateCartItemOptions
  ) => void;
  removeFromCart: (
    locationId: string,
    inventoryItemId: string,
    cartItemId?: string,
    context?: CartContext
  ) => void;
  moveCartItem: (
    fromLocationId: string,
    toLocationId: string,
    inventoryItemId: string,
    unitType: UnitType,
    cartItemId?: string,
    context?: CartContext
  ) => void;
  moveLocationCartItems: (fromLocationId: string, toLocationId: string, context?: CartContext) => void;
  moveAllCartItemsToLocation: (toLocationId: string, context?: CartContext) => void;
  clearLocationCart: (locationId: string, context?: CartContext) => void;
  clearAllCarts: (context?: CartContext) => void;
  setCartItemDecision: (
    locationId: string,
    cartItemId: string,
    decidedQuantity: number,
    decidedBy: string,
    context?: CartContext
  ) => void;
  setCartItemNote: (
    locationId: string,
    cartItemId: string,
    note: string | null,
    context?: CartContext
  ) => void;

  // Cart getters
  getCartItems: (locationId: string, context?: CartContext) => CartItem[];
  getCartItem: (locationId: string, inventoryItemId: string, context?: CartContext) => CartItem | undefined;
  getLocationCartTotal: (locationId: string, context?: CartContext) => number;
  getTotalCartCount: (context?: CartContext) => number;
  getCartLocationIds: (context?: CartContext) => string[];
  hasUndecidedRemaining: (locationId: string, context?: CartContext) => boolean;
  getUndecidedRemainingItems: (locationId: string, context?: CartContext) => CartItem[];

  // Legacy support - for backward compatibility
  cart: CartItem[];
  clearCart: () => void;
  getCartTotal: () => number;

  // Order actions
  fetchOrders: (locationId: string) => Promise<void>;
  fetchUserOrders: (userId: string) => Promise<void>;
  fetchManagerOrders: (locationId?: string | null, status?: OrderStatus | null) => Promise<void>;
  fetchOrder: (orderId: string) => Promise<void>;
  createOrder: (locationId: string, userId: string, context?: CartContext) => Promise<Order>;
  createAndSubmitOrder: (
    locationId: string,
    userId: string,
    context?: CartContext
  ) => Promise<OrderWithDetails>;
  submitOrder: (orderId: string) => Promise<void>;
  updateOrderStatus: (orderId: string, status: OrderStatus, fulfilledBy?: string) => Promise<void>;
  fulfillOrder: (orderId: string, fulfilledBy: string) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;

  // Fulfillment actions/state
  loadFulfillmentData: (managerId?: string | null) => Promise<void>;
  fetchPastOrders: (managerId?: string | null) => Promise<PastOrder[]>;
  fetchPastOrderById: (
    pastOrderId: string,
    managerId?: string | null
  ) => Promise<PastOrderDetail | null>;
  flushPendingPastOrderSync: (managerId?: string | null) => Promise<void>;
  createPastOrder: (input: FinalizeSupplierOrderInput) => Promise<PastOrder>;
  fetchPendingFulfillmentOrders: (locationIds?: string[]) => Promise<void>;
  addSupplierDraftItem: (input: SupplierDraftItemInput) => SupplierDraftItem;
  updateSupplierDraftItemQuantity: (draftItemId: string, quantity: number) => void;
  removeSupplierDraftItem: (draftItemId: string) => void;
  removeSupplierDraftItems: (draftItemIds: string[]) => void;
  getSupplierDraftItems: (supplierId: string) => SupplierDraftItem[];
  createOrderLaterItem: (input: CreateOrderLaterItemInput) => Promise<OrderLaterItem>;
  updateOrderLaterItemSchedule: (itemId: string, scheduledAt: string) => Promise<OrderLaterItem | null>;
  removeOrderLaterItem: (itemId: string) => Promise<void>;
  moveOrderLaterItemToSupplierDraft: (
    itemId: string,
    supplierId: string,
    locationGroup: FulfillmentLocationGroup,
    options?: {
      locationId?: string | null;
      locationName?: string | null;
      quantity?: number;
    }
  ) => Promise<SupplierDraftItem | null>;
  getLastOrderedQuantities: (params: {
    supplierId: string;
    managerId?: string | null;
    items: LastOrderedQuantityLookupInput[];
    forceRefresh?: boolean;
  }) => Promise<LastOrderedQuantitiesResponse>;
  finalizeSupplierOrder: (input: FinalizeSupplierOrderInput) => Promise<PastOrder>;
  markOrderItemsStatus: (
    orderItemIds: string[],
    status: OrderItemFulfillmentStatus
  ) => Promise<boolean>;
  setSupplierOverride: (orderItemIds: string[], supplierId: string) => Promise<boolean>;
  clearSupplierOverride: (orderItemIds: string[]) => Promise<boolean>;
}

const createCartItemId = () =>
  `cart_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

let pastOrdersTableAvailable: boolean | null = null;
let orderLaterItemsTableAvailable: boolean | null = null;
let pastOrderItemsTableAvailable: boolean | null = null;
let pastOrderItemsNoteColumnAvailable: boolean | null = null;
let orderItemsStatusColumnAvailable: boolean | null = null;
let pastOrderSyncListenerInitialized = false;

const ORDER_ITEM_OPTIONAL_COLUMNS = [
  'input_mode',
  'quantity_requested',
  'remaining_reported',
  'decided_quantity',
  'decided_by',
  'decided_at',
  'note',
] as const;

type OrderItemOptionalColumn = (typeof ORDER_ITEM_OPTIONAL_COLUMNS)[number];

const missingOrderItemsColumns = new Set<OrderItemOptionalColumn>();

function toValidNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getEffectiveQuantity(item: CartItem): number {
  if (item.inputMode === 'quantity') {
    return item.quantityRequested ?? 0;
  }
  return item.decidedQuantity ?? 0;
}

/** Whether a cart item is valid for submission (non-zero quantity OR remaining-mode report). */
function isSubmittableCartItem(item: CartItem): boolean {
  if (item.inputMode === 'remaining') {
    // Remaining-mode: employee reports how much is left; manager decides
    // order quantity later. Valid as long as remainingReported is set.
    return (item.remainingReported ?? 0) >= 0;
  }
  return getEffectiveQuantity(item) > 0;
}

function normalizeCartItem(raw: any): CartItem | null {
  const inputMode: OrderInputMode = raw?.inputMode === 'remaining' ? 'remaining' : 'quantity';
  const unitType: UnitType = raw?.unitType === 'base' ? 'base' : 'pack';
  const id = typeof raw?.id === 'string' && raw.id ? raw.id : createCartItemId();
  const inventoryItemId =
    typeof raw?.inventoryItemId === 'string' && raw.inventoryItemId ? raw.inventoryItemId : null;

  if (!inventoryItemId) return null;

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

function normalizeLocationCart(rawCart: unknown): CartItem[] {
  if (!Array.isArray(rawCart)) return [];
  return rawCart
    .map((item) => normalizeCartItem(item))
    .filter((item): item is CartItem => Boolean(item));
}

function getLocationCart(cartByLocation: CartByLocation, locationId: string): CartItem[] {
  return normalizeLocationCart(cartByLocation[locationId] || []);
}

function normalizeCartContext(context?: CartContext): CartContext {
  return context === 'manager' ? 'manager' : 'employee';
}

function getCartByContext(
  state: Pick<OrderState, 'cartByLocation' | 'managerCartByLocation'>,
  context?: CartContext
): CartByLocation {
  const resolved = normalizeCartContext(context);
  return resolved === 'manager' ? state.managerCartByLocation : state.cartByLocation;
}

function mergeCartItem(
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

function findCartItemIndex(
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

function toOrderItemInsert(orderId: string, item: CartItem): Omit<OrderItem, 'id' | 'created_at'> {
  // For remaining-mode the employee hasn't specified an order quantity — the
  // manager will decide later. Use remainingReported as the DB quantity so it
  // satisfies any legacy `quantity > 0` constraint; fulfillment reads
  // remaining_reported / decided_quantity directly, not this field.
  const quantity =
    item.inputMode === 'remaining'
      ? Math.max(item.remainingReported ?? 0, 1)
      : getEffectiveQuantity(item);

  return {
    order_id: orderId,
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

function getMissingColumnFromSchemaCacheError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const err = error as { code?: string; message?: string };
  if (err.code !== 'PGRST204') return null;
  const message = typeof err.message === 'string' ? err.message : '';
  const matches = Array.from(message.matchAll(/'([^']+)'/g)).map((match) => match[1]);
  return matches.length > 0 ? matches[0] : null;
}

function omitOrderItemColumns(
  item: Omit<OrderItem, 'id' | 'created_at'>,
  omittedColumns: Set<OrderItemOptionalColumn>
): Record<string, unknown> {
  const row = { ...item } as Record<string, unknown>;
  ORDER_ITEM_OPTIONAL_COLUMNS.forEach((column) => {
    if (omittedColumns.has(column)) {
      delete row[column];
    }
  });
  return row;
}

async function insertOrderItemsWithFallback(
  orderItems: Omit<OrderItem, 'id' | 'created_at'>[],
  options?: { includeInventorySelect?: boolean }
) {
  const includeInventorySelect = options?.includeInventorySelect === true;
  const omittedColumns = new Set<OrderItemOptionalColumn>(missingOrderItemsColumns);
  let attemptCount = 0;

  while (attemptCount <= ORDER_ITEM_OPTIONAL_COLUMNS.length) {
    const payload = orderItems.map((item) => omitOrderItemColumns(item, omittedColumns));
    let query = (supabase as any).from('order_items').insert(payload);
    if (includeInventorySelect) {
      query = query.select(`
        *,
        inventory_item:inventory_items(*)
      `);
    }

    const attempt = await query;
    if (!attempt.error) {
      return attempt;
    }

    const missingColumn = getMissingColumnFromSchemaCacheError(attempt.error);
    if (!missingColumn) {
      throw attempt.error;
    }

    if (
      !ORDER_ITEM_OPTIONAL_COLUMNS.includes(missingColumn as OrderItemOptionalColumn) ||
      omittedColumns.has(missingColumn as OrderItemOptionalColumn)
    ) {
      throw attempt.error;
    }

    const optionalColumn = missingColumn as OrderItemOptionalColumn;
    omittedColumns.add(optionalColumn);
    missingOrderItemsColumns.add(optionalColumn);
    attemptCount += 1;
  }

  throw new Error('Unable to insert order items due to missing schema columns.');
}

function createFulfillmentId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toIsoString(value: unknown, fallback = new Date().toISOString()): string {
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

function toJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeSupplierId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLocationGroup(value: unknown): FulfillmentLocationGroup | null {
  if (value === 'sushi' || value === 'poki') return value;
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function normalizeHistoryLookupUnit(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function createLastOrderedAnyKey(itemId: string, unit: string): string {
  return `${itemId}::${unit}::any`;
}

function createLastOrderedLocationIdKey(itemId: string, unit: string, locationId: string): string {
  return `${itemId}::${unit}::loc:${locationId}`;
}

function createLastOrderedLocationGroupKey(
  itemId: string,
  unit: string,
  locationGroup: FulfillmentLocationGroup
): string {
  return `${itemId}::${unit}::group:${locationGroup}`;
}

function normalizeLastOrderedLookupInput(
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

function resolveLastOrderedFromCache(
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

function upsertLastOrderedCacheValue(
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

function isNetworkLikeError(error: unknown): boolean {
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

function isMissingTableError(error: unknown, tableName: string): boolean {
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

function isMissingColumnError(error: unknown, columnName: string): boolean {
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

function normalizeSupplierDraftItem(raw: unknown): SupplierDraftItem | null {
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

function normalizeSupplierDrafts(raw: unknown): SupplierDraftsBySupplier {
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

function normalizeOrderLaterItem(raw: unknown): OrderLaterItem | null {
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

function normalizeOrderLaterQueue(raw: unknown): OrderLaterItem[] {
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

function getPastOrderCountsFromPayload(payload: Record<string, unknown>): {
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

function normalizePastOrder(raw: unknown): PastOrder | null {
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

function normalizePastOrders(raw: unknown): PastOrder[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizePastOrder(item))
    .filter((item): item is PastOrder => Boolean(item))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function normalizePastOrderItem(raw: unknown): PastOrderItem | null {
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

function normalizePastOrderItems(raw: unknown): PastOrderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizePastOrderItem(item))
    .filter((item): item is PastOrderItem => Boolean(item))
    .sort((a, b) => new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime());
}

function createPastOrderSyncJobId() {
  return `past_sync_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePendingPastOrderSyncJob(raw: unknown): PendingPastOrderSyncJob | null {
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

function normalizePendingPastOrderSyncQueue(raw: unknown): PendingPastOrderSyncJob[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizePendingPastOrderSyncJob(entry))
    .filter((entry): entry is PendingPastOrderSyncJob => Boolean(entry))
    .sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime());
}

function mergeRemoteAndPendingPastOrders(
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

function extractPastOrderItemsFromPayload(order: PastOrder): PastOrderItem[] {
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

function extractConsumedOrderItemIds(pastOrders: PastOrder[]): Set<string> {
  const ids = new Set<string>();

  pastOrders.forEach((row) => {
    const payload = toJsonObject(row.payload);
    const camel = toStringArray(payload.sourceOrderItemIds);
    const snake = toStringArray(payload.source_order_item_ids);
    [...camel, ...snake].forEach((id) => ids.add(id));
  });

  return ids;
}

function removeConsumedOrderItems(
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

async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

async function cancelOrderLaterNotification(notificationId: string | null) {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Ignore stale notification identifiers.
  }
}

async function scheduleOrderLaterNotification(input: {
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

async function createOrderLaterInAppNotification(params: {
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

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      cartByLocation: {},
      managerCartByLocation: {},
      orders: [],
      currentOrder: null,
      isLoading: false,
      supplierDrafts: {},
      orderLaterQueue: [],
      pastOrders: [],
      pendingPastOrderSyncQueue: [],
      lastOrderedCacheBySupplier: {},
      isFulfillmentLoading: false,
      isPastOrderSyncing: false,

      // Legacy cart property - returns flattened cart for backward compatibility
      get cart() {
        const { cartByLocation } = get();
        return Object.values(cartByLocation).flatMap((items) => normalizeLocationCart(items));
      },

      addToCart: (locationId, inventoryItemId, quantity, unitType, options) => {
        const resolvedContext = normalizeCartContext(options?.context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);

        const inputMode: OrderInputMode = options?.inputMode ?? 'quantity';
        const note = normalizeNote(options?.note);

        if (inputMode === 'quantity') {
          const quantityRequested = toValidNumber(options?.quantityRequested ?? quantity);
          if (quantityRequested === null || quantityRequested <= 0) return;

          const nextItem: CartItem = {
            id: createCartItemId(),
            inventoryItemId,
            unitType,
            inputMode,
            quantityRequested,
            remainingReported: null,
            decidedQuantity:
              toValidNumber(options?.decidedQuantity) !== null &&
              (toValidNumber(options?.decidedQuantity) as number) >= 0
                ? (toValidNumber(options?.decidedQuantity) as number)
                : null,
            decidedBy: typeof options?.decidedBy === 'string' ? options.decidedBy : null,
            decidedAt: typeof options?.decidedAt === 'string' ? options.decidedAt : null,
            quantity: quantityRequested,
            note,
          };

          const mergedCart = mergeCartItem(locationCart, nextItem);
          const nextCartByLocation = {
            ...cartByLocation,
            [locationId]: mergedCart,
          };
          if (resolvedContext === 'manager') {
            set({ managerCartByLocation: nextCartByLocation });
          } else {
            set({ cartByLocation: nextCartByLocation });
          }
          return;
        }

        const remainingReported = toValidNumber(options?.remainingReported ?? quantity);
        if (remainingReported === null || remainingReported < 0) return;

        const decidedQuantityRaw = toValidNumber(options?.decidedQuantity);
        const decidedQuantity =
          decidedQuantityRaw !== null && decidedQuantityRaw >= 0 ? decidedQuantityRaw : null;

        const nextItem: CartItem = {
          id: createCartItemId(),
          inventoryItemId,
          unitType,
          inputMode: 'remaining',
          quantityRequested: null,
          remainingReported,
          decidedQuantity,
          decidedBy: typeof options?.decidedBy === 'string' ? options.decidedBy : null,
          decidedAt: typeof options?.decidedAt === 'string' ? options.decidedAt : null,
          quantity: decidedQuantity ?? 0,
          note,
        };

        const mergedCart = mergeCartItem(locationCart, nextItem);
        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: mergedCart,
        };
        if (resolvedContext === 'manager') {
          set({ managerCartByLocation: nextCartByLocation });
        } else {
          set({ cartByLocation: nextCartByLocation });
        }
      },

      updateCartItem: (locationId, inventoryItemId, quantity, unitType, options) => {
        const resolvedContext = normalizeCartContext(options?.context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);

        const index = findCartItemIndex(
          locationCart,
          inventoryItemId,
          unitType,
          options?.cartItemId
        );

        if (index < 0) return;

        const existing = locationCart[index];
        const nextMode: OrderInputMode = options?.inputMode ?? existing.inputMode;

        if (nextMode === 'quantity') {
          const nextQuantity = toValidNumber(options?.quantityRequested ?? quantity);

          if (nextQuantity === null || nextQuantity <= 0) {
            const nextCart = locationCart.filter((_, idx) => idx !== index);
            const nextCartByLocation = {
              ...cartByLocation,
              [locationId]: nextCart,
            };
            if (resolvedContext === 'manager') {
              set({ managerCartByLocation: nextCartByLocation });
            } else {
              set({ cartByLocation: nextCartByLocation });
            }
            return;
          }

          const updated: CartItem = {
            ...existing,
            unitType,
            inputMode: 'quantity',
            quantityRequested: nextQuantity,
            remainingReported: null,
            quantity: nextQuantity,
            decidedQuantity: options?.clearDecision ? null : existing.decidedQuantity,
            decidedBy: options?.clearDecision ? null : existing.decidedBy,
            decidedAt: options?.clearDecision ? null : existing.decidedAt,
          };

          const nextCart = locationCart.map((item, idx) => (idx === index ? updated : item));
          const nextCartByLocation = {
            ...cartByLocation,
            [locationId]: nextCart,
          };
          if (resolvedContext === 'manager') {
            set({ managerCartByLocation: nextCartByLocation });
          } else {
            set({ cartByLocation: nextCartByLocation });
          }
          return;
        }

        const nextRemaining = toValidNumber(options?.remainingReported ?? quantity);
        if (nextRemaining === null || nextRemaining < 0) {
          const nextCart = locationCart.filter((_, idx) => idx !== index);
          const nextCartByLocation = {
            ...cartByLocation,
            [locationId]: nextCart,
          };
          if (resolvedContext === 'manager') {
            set({ managerCartByLocation: nextCartByLocation });
          } else {
            set({ cartByLocation: nextCartByLocation });
          }
          return;
        }

        const updated: CartItem = {
          ...existing,
          unitType,
          inputMode: 'remaining',
          quantityRequested: null,
          remainingReported: nextRemaining,
          quantity: 0,
          decidedQuantity: null,
          decidedBy: null,
          decidedAt: null,
        };

        const nextCart = locationCart.map((item, idx) => (idx === index ? updated : item));
        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: nextCart,
        };
        if (resolvedContext === 'manager') {
          set({ managerCartByLocation: nextCartByLocation });
        } else {
          set({ cartByLocation: nextCartByLocation });
        }
      },

      removeFromCart: (locationId, inventoryItemId, cartItemId, context) => {
        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);

        const nextCart = cartItemId
          ? locationCart.filter((item) => item.id !== cartItemId)
          : locationCart.filter((item) => item.inventoryItemId !== inventoryItemId);

        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: nextCart,
        };
        if (resolvedContext === 'manager') {
          set({ managerCartByLocation: nextCartByLocation });
        } else {
          set({ cartByLocation: nextCartByLocation });
        }
      },

      moveCartItem: (fromLocationId, toLocationId, inventoryItemId, unitType, cartItemId, context) => {
        if (fromLocationId === toLocationId) return;

        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const fromCart = getLocationCart(cartByLocation, fromLocationId);
        const toCart = getLocationCart(cartByLocation, toLocationId);

        const index = findCartItemIndex(fromCart, inventoryItemId, unitType, cartItemId);
        if (index < 0) return;

        const itemToMove = fromCart[index];
        const newFromCart = fromCart.filter((_, idx) => idx !== index);
        const newToCart = mergeCartItem(toCart, { ...itemToMove });

        const nextCartByLocation = {
          ...cartByLocation,
          [fromLocationId]: newFromCart,
          [toLocationId]: newToCart,
        };
        if (resolvedContext === 'manager') {
          set({ managerCartByLocation: nextCartByLocation });
        } else {
          set({ cartByLocation: nextCartByLocation });
        }
      },

      moveLocationCartItems: (fromLocationId, toLocationId, context) => {
        if (fromLocationId === toLocationId) return;

        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const fromCart = getLocationCart(cartByLocation, fromLocationId);
        const toCart = getLocationCart(cartByLocation, toLocationId);

        if (fromCart.length === 0) return;

        let merged = [...toCart];
        fromCart.forEach((item) => {
          merged = mergeCartItem(merged, { ...item });
        });

        const nextCartByLocation = { ...cartByLocation };
        delete nextCartByLocation[fromLocationId];
        nextCartByLocation[toLocationId] = merged;

        if (resolvedContext === 'manager') {
          set({ managerCartByLocation: nextCartByLocation });
        } else {
          set({ cartByLocation: nextCartByLocation });
        }
      },

      moveAllCartItemsToLocation: (toLocationId, context) => {
        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const allItems = Object.values(cartByLocation).flatMap((items) => normalizeLocationCart(items));

        if (allItems.length === 0) {
          return;
        }

        let merged: CartItem[] = [];
        allItems.forEach((item) => {
          merged = mergeCartItem(merged, { ...item });
        });

        if (resolvedContext === 'manager') {
          set({
            managerCartByLocation: {
              [toLocationId]: merged,
            },
          });
        } else {
          set({
            cartByLocation: {
              [toLocationId]: merged,
            },
          });
        }
      },

      clearLocationCart: (locationId, context) => {
        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const { [locationId]: _, ...rest } = cartByLocation;
        if (resolvedContext === 'manager') {
          set({ managerCartByLocation: rest });
        } else {
          set({ cartByLocation: rest });
        }
      },

      clearAllCarts: (context) => {
        const resolvedContext = normalizeCartContext(context);
        if (resolvedContext === 'manager') {
          set({ managerCartByLocation: {} });
        } else {
          set({ cartByLocation: {} });
        }
      },

      // Legacy clearCart - clears all carts
      clearCart: () => set({ cartByLocation: {} }),

      setCartItemDecision: (locationId, cartItemId, decidedQuantity, decidedBy, context) => {
        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);

        const normalizedQuantity = Math.max(0, decidedQuantity);

        const nextCart = locationCart.map((item) => {
          if (item.id !== cartItemId) return item;
          if (item.inputMode !== 'remaining') return item;

          return {
            ...item,
            decidedQuantity: normalizedQuantity,
            decidedBy,
            decidedAt: new Date().toISOString(),
            quantity: normalizedQuantity,
          };
        });

        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: nextCart,
        };
        if (resolvedContext === 'manager') {
          set({ managerCartByLocation: nextCartByLocation });
        } else {
          set({ cartByLocation: nextCartByLocation });
        }
      },

      setCartItemNote: (locationId, cartItemId, note, context) => {
        const resolvedContext = normalizeCartContext(context);
        const state = get();
        const cartByLocation = getCartByContext(state, resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);
        const normalized = normalizeNote(note);

        const nextCart = locationCart.map((item) => {
          if (item.id !== cartItemId) return item;
          return {
            ...item,
            note: normalized,
          };
        });

        const nextCartByLocation = {
          ...cartByLocation,
          [locationId]: nextCart,
        };
        if (resolvedContext === 'manager') {
          set({ managerCartByLocation: nextCartByLocation });
        } else {
          set({ cartByLocation: nextCartByLocation });
        }
      },

      getCartItems: (locationId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        return getLocationCart(cartByLocation, locationId);
      },

      getCartItem: (locationId, inventoryItemId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        const locationCart = getLocationCart(cartByLocation, locationId);

        const quantityMode = locationCart.find(
          (item) => item.inventoryItemId === inventoryItemId && item.inputMode === 'quantity'
        );
        if (quantityMode) return quantityMode;

        return locationCart.find((item) => item.inventoryItemId === inventoryItemId);
      },

      getLocationCartTotal: (locationId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        const locationCart = getLocationCart(cartByLocation, locationId);

        return locationCart.reduce((total, item) => {
          if (item.inputMode === 'quantity') {
            return total + (item.quantityRequested ?? 0);
          }
          return total + 1;
        }, 0);
      },

      getTotalCartCount: (context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        return Object.values(cartByLocation).reduce((total, rawItems) => {
          const items = normalizeLocationCart(rawItems);
          return total + items.length;
        }, 0);
      },

      getCartLocationIds: (context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        return Object.keys(cartByLocation).filter((locId) => {
          const items = normalizeLocationCart(cartByLocation[locId]);
          return items.length > 0;
        });
      },

      hasUndecidedRemaining: (locationId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        const locationCart = getLocationCart(cartByLocation, locationId);
        return locationCart.some(
          (item) => item.inputMode === 'remaining' && (item.decidedQuantity === null || item.decidedQuantity < 0)
        );
      },

      getUndecidedRemainingItems: (locationId, context) => {
        const state = get();
        const cartByLocation = getCartByContext(state, context);
        const locationCart = getLocationCart(cartByLocation, locationId);
        return locationCart.filter(
          (item) => item.inputMode === 'remaining' && (item.decidedQuantity === null || item.decidedQuantity < 0)
        );
      },

      // Legacy getCartTotal - returns total across all locations
      getCartTotal: () => {
        const { cartByLocation } = get();
        return Object.values(cartByLocation).reduce((total, rawItems) => {
          const items = normalizeLocationCart(rawItems);
          return total + items.length;
        }, 0);
      },

      fetchOrders: async (locationId) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('orders')
            .select(`
              *,
              user:users!orders_user_id_fkey(*),
              location:locations(*)
            `)
            .eq('location_id', locationId)
            .order('created_at', { ascending: false })
            .limit(50);

          if (error) throw error;

          set({ orders: data || [] });
        } finally {
          set({ isLoading: false });
        }
      },

      fetchUserOrders: async (userId) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('orders')
            .select(`
              *,
              user:users!orders_user_id_fkey(*),
              location:locations(*),
              order_items(
                *,
                inventory_item:inventory_items(*)
              )
            `)
            .eq('user_id', userId)
            .neq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(50);

          if (error) throw error;

          set({ orders: data || [] });
        } finally {
          set({ isLoading: false });
        }
      },

      fetchManagerOrders: async (locationId, status) => {
        set({ isLoading: true });
        try {
          let query = supabase
            .from('orders')
            .select(`
              *,
              user:users!orders_user_id_fkey(*),
              location:locations(*),
              order_items(
                *,
                inventory_item:inventory_items(*)
              )
            `)
            .neq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(100);

          if (locationId) {
            query = query.eq('location_id', locationId);
          }

          if (status) {
            query = query.eq('status', status);
          }

          const { data, error } = await query;

          if (error) throw error;

          set({ orders: data || [] });
        } finally {
          set({ isLoading: false });
        }
      },

      fetchOrder: async (orderId) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('orders')
            .select(`
              *,
              user:users!orders_user_id_fkey(*),
              location:locations(*),
              order_items(
                *,
                inventory_item:inventory_items(*)
              )
            `)
            .eq('id', orderId)
            .single();

          if (error) throw error;

          set({ currentOrder: data as OrderWithDetails });
        } finally {
          set({ isLoading: false });
        }
      },

      createOrder: async (locationId, userId, context) => {
        const resolvedContext = normalizeCartContext(context);
        const { clearLocationCart } = get();
        const cartByLocation = getCartByContext(get(), resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);

        if (locationCart.length === 0) {
          throw new Error('Cart is empty for this location');
        }

        const cartItemsForInsert = locationCart.filter(isSubmittableCartItem);
        if (cartItemsForInsert.length === 0) {
          throw new Error('All cart items are zero quantity. Update at least one item before submit.');
        }

        set({ isLoading: true });
        try {
          // Create order
          const orderResponse = await (supabase as any)
            .from('orders')
            .insert({
              location_id: locationId,
              user_id: userId,
              status: 'draft',
            })
            .select()
            .single();

          const order = orderResponse.data as any;
          const orderError = orderResponse.error;

          if (orderError) throw orderError;
          if (!order?.id) throw new Error('Failed to create order');

          // Create order items
          const orderItems: Omit<OrderItem, 'id' | 'created_at'>[] = cartItemsForInsert.map((item) =>
            toOrderItemInsert(order.id, item)
          );

          await insertOrderItemsWithFallback(orderItems);

          clearLocationCart(locationId, resolvedContext);
          return order;
        } finally {
          set({ isLoading: false });
        }
      },

      createAndSubmitOrder: async (locationId, userId, context) => {
        const resolvedContext = normalizeCartContext(context);
        const { clearLocationCart } = get();
        const cartByLocation = getCartByContext(get(), resolvedContext);
        const locationCart = getLocationCart(cartByLocation, locationId);

        if (locationCart.length === 0) {
          throw new Error('Cart is empty for this location');
        }

        const cartItemsForInsert = locationCart.filter(isSubmittableCartItem);
        if (cartItemsForInsert.length === 0) {
          throw new Error('All cart items are zero quantity. Update at least one item before submit.');
        }

        set({ isLoading: true });
        try {
          // Create order with status 'submitted' directly
          const orderResponse = await (supabase as any)
            .from('orders')
            .insert({
              location_id: locationId,
              user_id: userId,
              status: 'submitted',
            })
            .select(`
              *,
              location:locations(*)
            `)
            .single();

          const order = orderResponse.data as any;
          const orderError = orderResponse.error;

          if (orderError) throw orderError;
          if (!order?.id) throw new Error('Failed to create order');

          // Create order items
          const orderItemsToInsert: Omit<OrderItem, 'id' | 'created_at'>[] = cartItemsForInsert.map((item) =>
            toOrderItemInsert(order.id, item)
          );

          const { data: createdItems } = await insertOrderItemsWithFallback(orderItemsToInsert, {
            includeInventorySelect: true,
          });

          // Build the full order with details
          const orderWithDetails: OrderWithDetails = {
            ...order,
            user: { id: userId } as any, // User info not critical for confirmation
            order_items: createdItems || [],
          };

          clearLocationCart(locationId, resolvedContext);
          set({ currentOrder: orderWithDetails });
          return orderWithDetails;
        } finally {
          set({ isLoading: false });
        }
      },

      submitOrder: async (orderId) => {
        set({ isLoading: true });
        try {
          const { error } = await (supabase as any)
            .from('orders')
            .update({ status: 'submitted' })
            .eq('id', orderId);

          if (error) throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      updateOrderStatus: async (orderId, status, fulfilledBy) => {
        set({ isLoading: true });
        try {
          const updateData: Record<string, any> = { status };

          if (status === 'fulfilled' && fulfilledBy) {
            updateData.fulfilled_at = new Date().toISOString();
            updateData.fulfilled_by = fulfilledBy;
          }

          const { error } = await (supabase as any)
            .from('orders')
            .update(updateData)
            .eq('id', orderId);

          if (error) throw error;

          // Refresh the current order if it matches
          const { currentOrder } = get();
          if (currentOrder && currentOrder.id === orderId) {
            await get().fetchOrder(orderId);
          }
        } finally {
          set({ isLoading: false });
        }
      },

      fulfillOrder: async (orderId, fulfilledBy) => {
        set({ isLoading: true });
        try {
          const { error } = await (supabase as any)
            .from('orders')
            .update({
              status: 'fulfilled',
              fulfilled_at: new Date().toISOString(),
              fulfilled_by: fulfilledBy,
            })
            .eq('id', orderId);

          if (error) throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      cancelOrder: async (orderId) => {
        set({ isLoading: true });
        try {
          const { error } = await (supabase as any)
            .from('orders')
            .update({ status: 'cancelled' })
            .eq('id', orderId);

          if (error) throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      createPastOrder: async (input) => {
        const now = new Date().toISOString();
        const payloadFromInput = toJsonObject(input.payload);
        const payloadSourceOrderItemIds = Array.from(
          new Set([
            ...toStringArray(payloadFromInput.sourceOrderItemIds),
            ...toStringArray(payloadFromInput.source_order_item_ids),
          ])
        );
        const consumedOrderItemIds = Array.from(
          new Set(
            [
              ...(input.consumedOrderItemIds || []),
              ...payloadSourceOrderItemIds,
            ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          )
        );
        const consumedDraftItemIds = Array.from(
          new Set(
            (input.consumedDraftItemIds || [])
              .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          )
        );
        const normalizedLineItems = (input.lineItems || [])
          .map((line) => {
            const itemId = typeof line.itemId === 'string' ? line.itemId.trim() : '';
            const itemName = typeof line.itemName === 'string' ? line.itemName.trim() : '';
            const unit = normalizeHistoryLookupUnit(line.unit);
            const quantity = toValidNumber(line.quantity);
            if (!itemId || !itemName || !unit || quantity === null || quantity <= 0) {
              return null;
            }

            return {
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
            };
          })
          .filter((line): line is {
            itemId: string;
            itemName: string;
            unit: string;
            quantity: number;
            locationId: string | null;
            locationName: string | null;
            locationGroup: FulfillmentLocationGroup | null;
            unitType: UnitType | null;
            note: string | null;
          } => Boolean(line));

        const payload = {
          ...payloadFromInput,
          sourceOrderItemIds: consumedOrderItemIds,
          source_order_item_ids: consumedOrderItemIds,
          sourceDraftItemIds: consumedDraftItemIds,
          source_draft_item_ids: consumedDraftItemIds,
        };
        const counts = getPastOrderCountsFromPayload(payload);

        let nextPastOrder: PastOrder = {
          id: createFulfillmentId('past'),
          supplierId: input.supplierId,
          supplierName: input.supplierName,
          createdBy: input.createdBy,
          createdAt: now,
          payload,
          messageText: input.messageText,
          shareMethod: input.shareMethod,
          syncStatus: 'synced',
          pendingSyncJobId: null,
          syncError: null,
          itemCount: counts.itemCount,
          remainingCount: counts.remainingCount,
        };

        const syncJobId = createPastOrderSyncJobId();
        let queueJob: PendingPastOrderSyncJob | null = null;
        let persistedPastOrderId: string | null = null;

        const queueForSync = (errorMessage: string, existingPastOrderId: string | null) => {
          if (!queueJob) {
            queueJob = {
              id: syncJobId,
              localPastOrderId: nextPastOrder.id,
              existingPastOrderId,
              queuedAt: now,
              supplierId: input.supplierId,
              supplierName: input.supplierName,
              createdBy: input.createdBy,
              messageText: input.messageText,
              shareMethod: input.shareMethod,
              payload,
              lineItems: normalizedLineItems,
              consumedOrderItemIds,
              consumedDraftItemIds,
              retryCount: 0,
              lastError: errorMessage,
            };
          } else {
            queueJob = {
              ...queueJob,
              existingPastOrderId: queueJob.existingPastOrderId || existingPastOrderId,
              lastError: errorMessage,
            };
          }
          nextPastOrder = {
            ...nextPastOrder,
            syncStatus: 'pending_sync',
            pendingSyncJobId: syncJobId,
            syncError: errorMessage,
          };
        };

        if (pastOrdersTableAvailable !== false) {
          const { data, error } = await (supabase as any)
            .from('past_orders')
            .insert({
              supplier_id: input.supplierId,
              supplier_name: input.supplierName,
              created_by: input.createdBy,
              payload,
              message_text: input.messageText,
              share_method: input.shareMethod,
            })
            .select('*')
            .single();

          if (error) {
            if (isMissingTableError(error, 'past_orders')) {
              pastOrdersTableAvailable = false;
            }
            if (isNetworkLikeError(error) || isMissingTableError(error, 'past_orders')) {
              queueForSync(error?.message || 'Pending sync while offline.', null);
            } else {
              throw error;
            }
          } else {
            pastOrdersTableAvailable = true;
            if (typeof data?.id === 'string' && data.id.trim().length > 0) {
              persistedPastOrderId = data.id;
            }
            const parsed = normalizePastOrder(data);
            if (parsed) {
              nextPastOrder = {
                ...parsed,
                syncStatus: 'synced',
                pendingSyncJobId: null,
                syncError: null,
              };
              persistedPastOrderId = parsed.id;
            }
          }
        } else {
          queueForSync('Past orders table unavailable. Pending sync.', null);
        }

        if (
          persistedPastOrderId &&
          normalizedLineItems.length > 0 &&
          pastOrderItemsTableAvailable !== false
        ) {
          const buildRows = (includeNote: boolean) =>
            normalizedLineItems.map((line) => ({
              past_order_id: persistedPastOrderId,
              supplier_id: input.supplierId,
              created_by: input.createdBy,
              item_id: line.itemId,
              item_name: line.itemName,
              unit: line.unit,
              quantity: line.quantity,
              location_id: line.locationId,
              location_name: line.locationName,
              location_group: line.locationGroup,
              unit_type: line.unitType,
              ordered_at: nextPastOrder.createdAt,
              ...(includeNote ? { note: line.note } : {}),
            }));

          let includeNote = pastOrderItemsNoteColumnAvailable !== false;
          let { error } = await (supabase as any)
            .from('past_order_items')
            .insert(buildRows(includeNote));

          if (error && includeNote && isMissingColumnError(error, 'note')) {
            pastOrderItemsNoteColumnAvailable = false;
            includeNote = false;
            ({ error } = await (supabase as any)
              .from('past_order_items')
              .insert(buildRows(includeNote)));
          }

          if (error) {
            if (isMissingTableError(error, 'past_order_items')) {
              pastOrderItemsTableAvailable = false;
            }
            if (isNetworkLikeError(error) || isMissingTableError(error, 'past_order_items')) {
              queueForSync(
                error?.message || 'Pending sync for past-order items.',
                persistedPastOrderId
              );
            } else {
              throw error;
            }
          } else {
            pastOrderItemsTableAvailable = true;
            if (includeNote) {
              pastOrderItemsNoteColumnAvailable = true;
            }
          }
        }

        if (!persistedPastOrderId && !queueJob) {
          queueForSync('Pending sync while offline.', null);
        }

        if (consumedOrderItemIds.length > 0) {
          const marked = await get().markOrderItemsStatus(consumedOrderItemIds, 'sent');
          if (!marked && !queueJob) {
            queueForSync('Unable to mark order items as sent. Pending sync.', persistedPastOrderId);
          }
        }

        set((state) => {
          const nextQueue = queueJob
            ? normalizePendingPastOrderSyncQueue([
                ...state.pendingPastOrderSyncQueue.filter((job) => job.id !== queueJob?.id),
                queueJob,
              ])
            : state.pendingPastOrderSyncQueue;
          const nextPastOrders = normalizePastOrders([
            nextPastOrder,
            ...state.pastOrders.filter((row) => row.id !== nextPastOrder.id),
          ]);
          const nextConsumedIds = extractConsumedOrderItemIds(nextPastOrders);
          const nextOrders = removeConsumedOrderItems(state.orders, nextConsumedIds);

          const nextLastOrderedCacheBySupplier = { ...state.lastOrderedCacheBySupplier };
          if (normalizedLineItems.length > 0) {
            const supplierCache = { ...(nextLastOrderedCacheBySupplier[input.supplierId] || {}) };
            normalizedLineItems.forEach((line) => {
              const cacheValue: LastOrderedQuantityCacheValue = {
                quantity: line.quantity,
                orderedAt: nextPastOrder.createdAt,
              };

              upsertLastOrderedCacheValue(
                supplierCache,
                createLastOrderedAnyKey(line.itemId, line.unit),
                cacheValue
              );

              if (line.locationId) {
                upsertLastOrderedCacheValue(
                  supplierCache,
                  createLastOrderedLocationIdKey(line.itemId, line.unit, line.locationId),
                  cacheValue
                );
              }
              if (line.locationGroup) {
                upsertLastOrderedCacheValue(
                  supplierCache,
                  createLastOrderedLocationGroupKey(line.itemId, line.unit, line.locationGroup),
                  cacheValue
                );
              }
            });

            nextLastOrderedCacheBySupplier[input.supplierId] = supplierCache;
          }

          return {
            pastOrders: nextPastOrders,
            pendingPastOrderSyncQueue: nextQueue,
            orders: nextOrders,
            lastOrderedCacheBySupplier: nextLastOrderedCacheBySupplier,
          };
        });

        return nextPastOrder;
      },

      flushPendingPastOrderSync: async (managerId) => {
        const queueSnapshot = [...get().pendingPastOrderSyncQueue];
        if (queueSnapshot.length === 0) return;

        set({ isPastOrderSyncing: true });
        try {
          let nextQueue: PendingPastOrderSyncJob[] = [];
          let nextPastOrders = [...get().pastOrders];

          for (const job of queueSnapshot) {
            let persistedPastOrderId = job.existingPastOrderId;
            let syncedOrder: PastOrder | null = null;
            let retryError: string | null = null;

            try {
              if (!persistedPastOrderId) {
                if (pastOrdersTableAvailable === false) {
                  throw new Error('past_orders table unavailable');
                }

                const { data, error } = await (supabase as any)
                  .from('past_orders')
                  .insert({
                    supplier_id: job.supplierId,
                    supplier_name: job.supplierName,
                    created_by: job.createdBy,
                    payload: job.payload,
                    message_text: job.messageText,
                    share_method: job.shareMethod,
                  })
                  .select('*')
                  .single();

                if (error) throw error;
                pastOrdersTableAvailable = true;
                const parsed = normalizePastOrder(data);
                if (parsed) {
                  syncedOrder = parsed;
                  persistedPastOrderId = parsed.id;
                } else if (typeof data?.id === 'string' && data.id.trim().length > 0) {
                  persistedPastOrderId = data.id;
                }
              }

              if (persistedPastOrderId && job.lineItems.length > 0) {
                if (pastOrderItemsTableAvailable === false) {
                  throw new Error('past_order_items table unavailable');
                }

                // Make retries idempotent for an already-created past order.
                await (supabase as any)
                  .from('past_order_items')
                  .delete()
                  .eq('past_order_id', persistedPastOrderId)
                  .eq('created_by', job.createdBy);

                const buildRows = (includeNote: boolean) =>
                  job.lineItems.map((line) => ({
                    past_order_id: persistedPastOrderId,
                    supplier_id: job.supplierId,
                    created_by: job.createdBy,
                    item_id: line.itemId,
                    item_name: line.itemName,
                    unit: line.unit,
                    quantity: line.quantity,
                    location_id: line.locationId ?? null,
                    location_name: line.locationName ?? null,
                    location_group: line.locationGroup ?? null,
                    unit_type: line.unitType ?? null,
                    ordered_at: syncedOrder?.createdAt || new Date().toISOString(),
                    ...(includeNote ? { note: line.note ?? null } : {}),
                  }));

                let includeNote = pastOrderItemsNoteColumnAvailable !== false;
                let { error } = await (supabase as any)
                  .from('past_order_items')
                  .insert(buildRows(includeNote));

                if (error && includeNote && isMissingColumnError(error, 'note')) {
                  pastOrderItemsNoteColumnAvailable = false;
                  includeNote = false;
                  ({ error } = await (supabase as any)
                    .from('past_order_items')
                    .insert(buildRows(includeNote)));
                }

                if (error) throw error;
                pastOrderItemsTableAvailable = true;
                if (includeNote) {
                  pastOrderItemsNoteColumnAvailable = true;
                }
              }

              if (job.consumedOrderItemIds.length > 0) {
                const sentMarked = await get().markOrderItemsStatus(job.consumedOrderItemIds, 'sent');
                if (!sentMarked) {
                  throw new Error('Unable to mark order items as sent during sync.');
                }
              }

              if (!syncedOrder) {
                const existing = nextPastOrders.find(
                  (row) => row.id === (persistedPastOrderId || job.localPastOrderId)
                );
                syncedOrder = {
                  ...(existing || {
                    id: persistedPastOrderId || job.localPastOrderId,
                    supplierId: job.supplierId,
                    supplierName: job.supplierName,
                    createdBy: job.createdBy,
                    createdAt: new Date().toISOString(),
                    payload: job.payload,
                    messageText: job.messageText,
                    shareMethod: job.shareMethod,
                    itemCount: getPastOrderCountsFromPayload(job.payload).itemCount,
                    remainingCount: getPastOrderCountsFromPayload(job.payload).remainingCount,
                  }),
                  id: persistedPastOrderId || job.localPastOrderId,
                  syncStatus: 'synced',
                  pendingSyncJobId: null,
                  syncError: null,
                };
              } else {
                syncedOrder = {
                  ...syncedOrder,
                  syncStatus: 'synced',
                  pendingSyncJobId: null,
                  syncError: null,
                };
              }

              nextPastOrders = normalizePastOrders([
                syncedOrder,
                ...nextPastOrders.filter(
                  (row) => row.id !== job.localPastOrderId && row.id !== syncedOrder?.id
                ),
              ]);
            } catch (error: any) {
              if (isMissingTableError(error, 'past_orders')) pastOrdersTableAvailable = false;
              if (isMissingTableError(error, 'past_order_items')) pastOrderItemsTableAvailable = false;
              retryError = error?.message || 'Pending sync failed.';
            }

            if (retryError) {
              nextQueue.push({
                ...job,
                existingPastOrderId: persistedPastOrderId || job.existingPastOrderId,
                retryCount: job.retryCount + 1,
                lastError: retryError,
              });
              nextPastOrders = normalizePastOrders(
                nextPastOrders.map((row) =>
                  row.id === job.localPastOrderId
                    ? {
                        ...row,
                        syncStatus: 'pending_sync',
                        pendingSyncJobId: job.id,
                        syncError: retryError,
                      }
                    : row
                )
              );
            }
          }

          set({
            pendingPastOrderSyncQueue: normalizePendingPastOrderSyncQueue(nextQueue),
            pastOrders: nextPastOrders,
          });

          const userId =
            typeof managerId === 'string' && managerId.trim().length > 0 ? managerId : null;
          if (userId) {
            await get().fetchPastOrders(userId);
          }
        } finally {
          set({ isPastOrderSyncing: false });
        }
      },

      fetchPastOrders: async (managerId) => {
        let remotePastOrders: PastOrder[] | null = null;
        if (pastOrdersTableAvailable !== false) {
          const { data, error } = await (supabase as any)
            .from('past_orders')
            .select('id,supplier_id,supplier_name,created_by,created_at,payload,message_text,share_method')
            .order('created_at', { ascending: false })
            .limit(500);

          if (error) {
            if (isMissingTableError(error, 'past_orders')) {
              pastOrdersTableAvailable = false;
            } else {
              console.warn('Unable to load past_orders, using local fallback.', error);
            }
          } else {
            pastOrdersTableAvailable = true;
            remotePastOrders = normalizePastOrders(data || []);
          }
        }

        if (remotePastOrders && remotePastOrders.length > 0 && pastOrderItemsTableAvailable !== false) {
          const ids = remotePastOrders.map((row) => row.id);
          const { data, error } = await (supabase as any)
            .from('past_order_items')
            .select('past_order_id')
            .in('past_order_id', ids)
            .limit(12000);

          if (error) {
            if (isMissingTableError(error, 'past_order_items')) {
              pastOrderItemsTableAvailable = false;
            } else {
              console.warn('Unable to load past_order_items counts.', error);
            }
          } else {
            pastOrderItemsTableAvailable = true;
            const countsByPastOrderId = new Map<string, number>();
            (data || []).forEach((row: any) => {
              const pastOrderId =
                typeof row?.past_order_id === 'string' && row.past_order_id.trim().length > 0
                  ? row.past_order_id
                  : '';
              if (!pastOrderId) return;
              countsByPastOrderId.set(pastOrderId, (countsByPastOrderId.get(pastOrderId) || 0) + 1);
            });

            remotePastOrders = remotePastOrders.map((row) => ({
              ...row,
              itemCount: countsByPastOrderId.get(row.id) ?? row.itemCount,
            }));
          }
        }

        const merged = remotePastOrders
          ? mergeRemoteAndPendingPastOrders(
              remotePastOrders,
              get().pastOrders,
              get().pendingPastOrderSyncQueue
            )
          : normalizePastOrders(get().pastOrders);

        set({ pastOrders: merged });
        return merged;
      },

      fetchPastOrderById: async (pastOrderId, managerId) => {
        const normalizedPastOrderId =
          typeof pastOrderId === 'string' && pastOrderId.trim().length > 0 ? pastOrderId.trim() : '';
        if (!normalizedPastOrderId) return null;

        let order = get().pastOrders.find((row) => row.id === normalizedPastOrderId) || null;
        if (pastOrdersTableAvailable !== false) {
          const { data, error } = await (supabase as any)
            .from('past_orders')
            .select('*')
            .eq('id', normalizedPastOrderId)
            .maybeSingle();

          if (error) {
            if (isMissingTableError(error, 'past_orders')) {
              pastOrdersTableAvailable = false;
            } else {
              console.warn('Unable to load past_orders detail.', error);
            }
          } else if (data) {
            pastOrdersTableAvailable = true;
            const parsed = normalizePastOrder(data);
            if (parsed) {
              const existingPending = get().pastOrders.find((row) => row.id === parsed.id);
              order = existingPending?.syncStatus === 'pending_sync'
                ? {
                    ...parsed,
                    syncStatus: existingPending.syncStatus,
                    pendingSyncJobId: existingPending.pendingSyncJobId,
                    syncError: existingPending.syncError,
                  }
                : parsed;
            }
          }
        }

        if (!order) return null;

        let items: PastOrderItem[] = [];
        if (pastOrderItemsTableAvailable !== false) {
          const { data, error } = await (supabase as any)
            .from('past_order_items')
            .select('*')
            .eq('past_order_id', normalizedPastOrderId)
            .order('ordered_at', { ascending: true });

          if (error) {
            if (isMissingTableError(error, 'past_order_items')) {
              pastOrderItemsTableAvailable = false;
            } else {
              console.warn('Unable to load past_order_items detail.', error);
            }
          } else {
            pastOrderItemsTableAvailable = true;
            items = normalizePastOrderItems(data || []);
          }
        }

        if (items.length === 0) {
          items = extractPastOrderItemsFromPayload(order);
        }

        return { order, items };
      },

      loadFulfillmentData: async (managerId) => {
        perfMark('loadFulfillmentData');
        const userId =
          typeof managerId === 'string' && managerId.trim().length > 0
            ? managerId
            : null;

        set({ isFulfillmentLoading: true });
        try {
          await get().flushPendingPastOrderSync(userId);

          const nextPastOrders = await get().fetchPastOrders(userId);
          let nextOrderLaterQueue = get().orderLaterQueue;

          if (userId && orderLaterItemsTableAvailable !== false) {
            const { data, error } = await (supabase as any)
              .from('order_later_items')
              .select('*')
              .eq('created_by', userId)
              .eq('status', 'queued')
              .order('scheduled_at', { ascending: true })
              .limit(600);

            if (error) {
              if (isMissingTableError(error, 'order_later_items')) {
                orderLaterItemsTableAvailable = false;
              } else {
                console.warn('Unable to load order_later_items, using local fallback.', error);
              }
            } else {
              orderLaterItemsTableAvailable = true;
              nextOrderLaterQueue = normalizeOrderLaterQueue(data || []);
            }
          }

          set((state) => {
            const consumed = extractConsumedOrderItemIds(nextPastOrders);
            return {
              pastOrders: nextPastOrders,
              orderLaterQueue: nextOrderLaterQueue,
              orders: removeConsumedOrderItems(state.orders, consumed),
            };
          });

          const queueSnapshot = [...get().orderLaterQueue];
          let queueChanged = false;
          for (const row of queueSnapshot) {
            const scheduledAtMs = new Date(row.scheduledAt).getTime();
            if (row.notificationId || !Number.isFinite(scheduledAtMs) || scheduledAtMs <= Date.now()) {
              continue;
            }

            const notificationId = await scheduleOrderLaterNotification({
              orderLaterItemId: row.id,
              itemName: row.itemName,
              scheduledAt: row.scheduledAt,
            });

            if (!notificationId) continue;

            queueChanged = true;
            row.notificationId = notificationId;

            if (orderLaterItemsTableAvailable !== false) {
              try {
                await (supabase as any)
                  .from('order_later_items')
                  .update({ notification_id: notificationId })
                  .eq('id', row.id);
              } catch {
                // Best-effort sync only.
              }
            }
          }

          if (queueChanged) {
            set({ orderLaterQueue: normalizeOrderLaterQueue(queueSnapshot) });
          }
        } finally {
          set({ isFulfillmentLoading: false });
          perfMeasure('loadFulfillmentData');
        }
      },

      fetchPendingFulfillmentOrders: async (locationIds) => {
        perfMark('fetchPendingFulfillmentOrders');
        set({ isFulfillmentLoading: true });
        try {
          // Use pastOrders already in state (loadFulfillmentData refreshes them
          // before this runs). Avoids a redundant fetchPastOrders round-trip.
          const currentPastOrders = get().pastOrders;
          const consumedOrderItemIds = extractConsumedOrderItemIds(currentPastOrders);
          if (__DEV__) {
            const consumedPreview = Array.from(consumedOrderItemIds.values()).slice(0, 10);
            console.log(
              '[FulfillmentStore] consumed order_item ids from past orders:',
              consumedOrderItemIds.size,
              consumedPreview
            );
          }
          const result = await loadPendingFulfillmentData({
            consumedOrderItemIds,
            includeInventoryAudit: __DEV__,
            locationIds,
          });
          set({ orders: result.orders });
        } finally {
          set({ isFulfillmentLoading: false });
          perfMeasure('fetchPendingFulfillmentOrders');
        }
      },

      addSupplierDraftItem: (input) => {
        const now = new Date().toISOString();
        const safeQuantity = Math.max(0, toValidNumber(input.quantity) ?? 0);
        if (safeQuantity <= 0) {
          throw new Error('Draft quantity must be greater than zero.');
        }

        const supplierId = input.supplierId;
        const unitType: UnitType = input.unitType === 'pack' ? 'pack' : 'base';
        const nextItem: SupplierDraftItem = {
          id: createFulfillmentId('draft'),
          supplierId,
          inventoryItemId:
            typeof input.inventoryItemId === 'string' && input.inventoryItemId.trim().length > 0
              ? input.inventoryItemId
              : null,
          name: input.name.trim(),
          category:
            typeof input.category === 'string' && input.category.trim().length > 0
              ? input.category
              : 'dry',
          quantity: safeQuantity,
          unitType,
          unitLabel:
            typeof input.unitLabel === 'string' && input.unitLabel.trim().length > 0
              ? input.unitLabel.trim()
              : unitType === 'pack'
                ? 'pack'
                : 'unit',
          locationGroup: input.locationGroup === 'poki' ? 'poki' : 'sushi',
          locationId:
            typeof input.locationId === 'string' && input.locationId.trim().length > 0
              ? input.locationId
              : null,
          locationName:
            typeof input.locationName === 'string' && input.locationName.trim().length > 0
              ? input.locationName.trim()
              : null,
          note: normalizeNote(input.note),
          createdAt: now,
          sourceOrderLaterItemId:
            typeof input.sourceOrderLaterItemId === 'string' &&
            input.sourceOrderLaterItemId.trim().length > 0
              ? input.sourceOrderLaterItemId
              : null,
        };

        let createdItem = nextItem;
        set((state) => {
          const supplierRows = state.supplierDrafts[supplierId] || [];
          const existingIndex = supplierRows.findIndex((row) => {
            const sameInventory =
              row.inventoryItemId && nextItem.inventoryItemId
                ? row.inventoryItemId === nextItem.inventoryItemId
                : row.name.toLowerCase() === nextItem.name.toLowerCase();
            return (
              sameInventory &&
              row.locationGroup === nextItem.locationGroup &&
              row.unitType === nextItem.unitType
            );
          });

          if (existingIndex >= 0) {
            const merged: SupplierDraftItem = {
              ...supplierRows[existingIndex],
              quantity: supplierRows[existingIndex].quantity + nextItem.quantity,
              note: supplierRows[existingIndex].note ?? nextItem.note,
              createdAt: now,
            };
            createdItem = merged;
            return {
              supplierDrafts: {
                ...state.supplierDrafts,
                [supplierId]: supplierRows.map((row, index) =>
                  index === existingIndex ? merged : row
                ),
              },
            };
          }

          createdItem = nextItem;
          return {
            supplierDrafts: {
              ...state.supplierDrafts,
              [supplierId]: [nextItem, ...supplierRows],
            },
          };
        });

        return createdItem;
      },

      updateSupplierDraftItemQuantity: (draftItemId, quantity) => {
        const safeQuantity = Math.max(0, toValidNumber(quantity) ?? 0);
        if (safeQuantity <= 0) {
          get().removeSupplierDraftItem(draftItemId);
          return;
        }

        set((state) => {
          const nextDrafts: SupplierDraftsBySupplier = {};
          Object.entries(state.supplierDrafts).forEach(([supplierId, rows]) => {
            const normalizedRows = rows.map((row) =>
              row.id === draftItemId
                ? { ...row, quantity: safeQuantity, createdAt: new Date().toISOString() }
                : row
            );
            if (normalizedRows.length > 0) {
              nextDrafts[supplierId] = normalizedRows;
            }
          });
          return { supplierDrafts: nextDrafts };
        });
      },

      removeSupplierDraftItem: (draftItemId) => {
        set((state) => {
          const nextDrafts: SupplierDraftsBySupplier = {};
          Object.entries(state.supplierDrafts).forEach(([supplierId, rows]) => {
            const nextRows = rows.filter((row) => row.id !== draftItemId);
            if (nextRows.length > 0) {
              nextDrafts[supplierId] = nextRows;
            }
          });
          return { supplierDrafts: nextDrafts };
        });
      },

      removeSupplierDraftItems: (draftItemIds) => {
        const idSet = new Set(
          draftItemIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        );
        if (idSet.size === 0) return;

        set((state) => {
          const nextDrafts: SupplierDraftsBySupplier = {};
          Object.entries(state.supplierDrafts).forEach(([supplierId, rows]) => {
            const nextRows = rows.filter((row) => !idSet.has(row.id));
            if (nextRows.length > 0) {
              nextDrafts[supplierId] = nextRows;
            }
          });
          return { supplierDrafts: nextDrafts };
        });
      },

      getSupplierDraftItems: (supplierId) => {
        const supplierRows = get().supplierDrafts[supplierId] || [];
        return [...supplierRows].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      },

      createOrderLaterItem: async (input) => {
        const createdAt = new Date().toISOString();
        const scheduledAt = toIsoString(input.scheduledAt);
        const payload = toJsonObject(input.payload);
        const payloadQuantity = toValidNumber(payload.quantity);
        const inputQuantity = toValidNumber(input.quantity);
        const normalizedQuantity = Math.max(0, inputQuantity ?? payloadQuantity ?? 1);
        const normalizedInput = {
          createdBy: input.createdBy,
          quantity: normalizedQuantity,
          itemId:
            typeof input.itemId === 'string' && input.itemId.trim().length > 0
              ? input.itemId
              : null,
          itemName: input.itemName.trim(),
          unit: input.unit.trim().length > 0 ? input.unit.trim() : 'unit',
          locationId:
            typeof input.locationId === 'string' && input.locationId.trim().length > 0
              ? input.locationId
              : null,
          locationName:
            typeof input.locationName === 'string' && input.locationName.trim().length > 0
              ? input.locationName.trim()
              : null,
          notes: normalizeNote(input.notes),
          suggestedSupplierId: normalizeSupplierId(input.suggestedSupplierId),
          preferredSupplierId: normalizeSupplierId(input.preferredSupplierId),
          preferredLocationGroup: normalizeLocationGroup(input.preferredLocationGroup),
          sourceOrderItemId:
            typeof input.sourceOrderItemId === 'string' && input.sourceOrderItemId.trim().length > 0
              ? input.sourceOrderItemId
              : null,
          sourceOrderItemIds: Array.from(
            new Set(
              (input.sourceOrderItemIds || [])
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
                .map((id) => id.trim())
            )
          ),
          sourceOrderId:
            typeof input.sourceOrderId === 'string' && input.sourceOrderId.trim().length > 0
              ? input.sourceOrderId
              : null,
          payload: {
            ...payload,
            quantity: normalizedQuantity,
          },
        };

        let orderLaterItem: OrderLaterItem | null = null;

        if (orderLaterItemsTableAvailable !== false) {
          const insertPayloadWithExtended: Record<string, unknown> = {
            created_by: normalizedInput.createdBy,
            scheduled_at: scheduledAt,
            qty: normalizedInput.quantity,
            item_id: normalizedInput.itemId,
            item_name: normalizedInput.itemName,
            unit: normalizedInput.unit,
            location_id: normalizedInput.locationId,
            location_name: normalizedInput.locationName,
            notes: normalizedInput.notes,
            suggested_supplier_id: normalizedInput.suggestedSupplierId,
            preferred_supplier_id: normalizedInput.preferredSupplierId,
            preferred_location_group: normalizedInput.preferredLocationGroup,
            source_order_item_id: normalizedInput.sourceOrderItemId,
            original_order_item_ids:
              normalizedInput.sourceOrderItemIds.length > 0
                ? normalizedInput.sourceOrderItemIds
                : normalizedInput.sourceOrderItemId
                  ? [normalizedInput.sourceOrderItemId]
                  : [],
            source_order_id: normalizedInput.sourceOrderId,
            status: 'queued',
            payload: normalizedInput.payload,
          };

          let { data, error } = await (supabase as any)
            .from('order_later_items')
            .insert(insertPayloadWithExtended)
            .select('*')
            .single();

          if (
            error &&
            (isMissingColumnError(error, 'qty') ||
              isMissingColumnError(error, 'suggested_supplier_id') ||
              isMissingColumnError(error, 'original_order_item_ids'))
          ) {
            const legacyPayload = {
              created_by: normalizedInput.createdBy,
              scheduled_at: scheduledAt,
              item_id: normalizedInput.itemId,
              item_name: normalizedInput.itemName,
              unit: normalizedInput.unit,
              location_id: normalizedInput.locationId,
              location_name: normalizedInput.locationName,
              notes: normalizedInput.notes,
              preferred_supplier_id: normalizedInput.preferredSupplierId,
              preferred_location_group: normalizedInput.preferredLocationGroup,
              source_order_item_id: normalizedInput.sourceOrderItemId,
              source_order_id: normalizedInput.sourceOrderId,
              status: 'queued',
              payload: normalizedInput.payload,
            };

            ({ data, error } = await (supabase as any)
              .from('order_later_items')
              .insert(legacyPayload)
              .select('*')
              .single());
          }

          if (error) {
            if (isMissingTableError(error, 'order_later_items')) {
              orderLaterItemsTableAvailable = false;
            } else {
              console.warn('Unable to persist order_later_items row; using local fallback.', error);
            }
          } else {
            orderLaterItemsTableAvailable = true;
            orderLaterItem = normalizeOrderLaterItem(data);
          }
        }

        if (!orderLaterItem) {
          orderLaterItem = {
            id: createFulfillmentId('later'),
            createdBy: normalizedInput.createdBy,
            createdAt,
            scheduledAt,
            quantity: normalizedInput.quantity,
            itemId: normalizedInput.itemId,
            itemName: normalizedInput.itemName,
            unit: normalizedInput.unit,
            locationId: normalizedInput.locationId,
            locationName: normalizedInput.locationName,
            notes: normalizedInput.notes,
            suggestedSupplierId: normalizedInput.suggestedSupplierId,
            preferredSupplierId: normalizedInput.preferredSupplierId,
            preferredLocationGroup: normalizedInput.preferredLocationGroup,
            sourceOrderItemId: normalizedInput.sourceOrderItemId,
            sourceOrderItemIds:
              normalizedInput.sourceOrderItemIds.length > 0
                ? normalizedInput.sourceOrderItemIds
                : normalizedInput.sourceOrderItemId
                  ? [normalizedInput.sourceOrderItemId]
                  : [],
            sourceOrderId: normalizedInput.sourceOrderId,
            notificationId: null,
            status: 'queued',
            payload: normalizedInput.payload,
          };
        }

        const notificationId = await scheduleOrderLaterNotification({
          orderLaterItemId: orderLaterItem.id,
          itemName: orderLaterItem.itemName,
          scheduledAt: orderLaterItem.scheduledAt,
        });

        if (notificationId) {
          orderLaterItem = { ...orderLaterItem, notificationId };

          if (orderLaterItemsTableAvailable !== false) {
            try {
              await (supabase as any)
                .from('order_later_items')
                .update({ notification_id: notificationId })
                .eq('id', orderLaterItem.id);
            } catch {
              // Best-effort sync only.
            }
          }
        }

        set((state) => ({
          orderLaterQueue: normalizeOrderLaterQueue([orderLaterItem, ...state.orderLaterQueue]),
        }));

        void createOrderLaterInAppNotification({
          userId: normalizedInput.createdBy,
          itemName: normalizedInput.itemName,
          scheduledAt: orderLaterItem.scheduledAt,
        });

        return orderLaterItem;
      },

      updateOrderLaterItemSchedule: async (itemId, scheduledAt) => {
        const current = get().orderLaterQueue.find((item) => item.id === itemId);
        if (!current) return null;

        await cancelOrderLaterNotification(current.notificationId);
        const normalizedScheduledAt = toIsoString(scheduledAt);
        const nextNotificationId = await scheduleOrderLaterNotification({
          orderLaterItemId: current.id,
          itemName: current.itemName,
          scheduledAt: normalizedScheduledAt,
        });

        const updatedItem: OrderLaterItem = {
          ...current,
          scheduledAt: normalizedScheduledAt,
          notificationId: nextNotificationId,
        };

        set((state) => ({
          orderLaterQueue: normalizeOrderLaterQueue(
            state.orderLaterQueue.map((item) => (item.id === itemId ? updatedItem : item))
          ),
        }));

        if (orderLaterItemsTableAvailable !== false) {
          const { error } = await (supabase as any)
            .from('order_later_items')
            .update({
              scheduled_at: normalizedScheduledAt,
              notification_id: nextNotificationId,
            })
            .eq('id', itemId);

          if (error) {
            if (isMissingTableError(error, 'order_later_items')) {
              orderLaterItemsTableAvailable = false;
            } else {
              console.warn('Unable to update order_later_items schedule.', error);
            }
          } else {
            orderLaterItemsTableAvailable = true;
          }
        }

        void createOrderLaterInAppNotification({
          userId: current.createdBy,
          itemName: current.itemName,
          scheduledAt: normalizedScheduledAt,
        });

        return updatedItem;
      },

      removeOrderLaterItem: async (itemId) => {
        const existing = get().orderLaterQueue.find((item) => item.id === itemId);
        if (!existing) return;

        await cancelOrderLaterNotification(existing.notificationId);

        set((state) => ({
          orderLaterQueue: state.orderLaterQueue.filter((item) => item.id !== itemId),
        }));

        if (orderLaterItemsTableAvailable !== false) {
          const { error } = await (supabase as any)
            .from('order_later_items')
            .update({
              status: 'cancelled',
              cancelled_at: new Date().toISOString(),
              notification_id: null,
            })
            .eq('id', itemId);

          if (error) {
            if (isMissingTableError(error, 'order_later_items')) {
              orderLaterItemsTableAvailable = false;
            } else {
              console.warn('Unable to update order_later_items status.', error);
            }
          } else {
            orderLaterItemsTableAvailable = true;
          }
        }
      },

      moveOrderLaterItemToSupplierDraft: async (itemId, supplierId, locationGroup, options) => {
        const queuedItem = get().orderLaterQueue.find((item) => item.id === itemId);
        if (!queuedItem) return null;

        const payload = toJsonObject(queuedItem.payload);
        const quantityFromPayload = toValidNumber(payload.quantity);
        const quantityFromOption = toValidNumber(options?.quantity);
        const quantity = Math.max(
          0,
          quantityFromOption ?? queuedItem.quantity ?? quantityFromPayload ?? 1
        );

        const draftItem = get().addSupplierDraftItem({
          supplierId,
          inventoryItemId: queuedItem.itemId,
          name: queuedItem.itemName,
          category:
            typeof payload.category === 'string' && payload.category.trim().length > 0
              ? payload.category
              : 'dry',
          quantity,
          unitType: payload.unitType === 'pack' ? 'pack' : 'base',
          unitLabel:
            typeof payload.unitLabel === 'string' && payload.unitLabel.trim().length > 0
              ? payload.unitLabel
              : queuedItem.unit,
          locationGroup,
          locationId: options?.locationId ?? queuedItem.locationId,
          locationName: options?.locationName ?? queuedItem.locationName,
          note: queuedItem.notes,
          sourceOrderLaterItemId: queuedItem.id,
        });

        await cancelOrderLaterNotification(queuedItem.notificationId);

        set((state) => ({
          orderLaterQueue: state.orderLaterQueue.filter((item) => item.id !== itemId),
        }));

        if (orderLaterItemsTableAvailable !== false) {
          const { error } = await (supabase as any)
            .from('order_later_items')
            .update({
              status: 'added',
              added_at: new Date().toISOString(),
              preferred_supplier_id: supplierId,
              preferred_location_group: locationGroup,
              notification_id: null,
            })
            .eq('id', itemId);

          if (error) {
            if (isMissingTableError(error, 'order_later_items')) {
              orderLaterItemsTableAvailable = false;
            } else {
              console.warn('Unable to mark order_later_items row as added.', error);
            }
          } else {
            orderLaterItemsTableAvailable = true;
          }
        }

        return draftItem;
      },

      getLastOrderedQuantities: async ({ supplierId, managerId, items, forceRefresh }) => {
        const normalizedItems = Array.from(
          new Map(
            items
              .map((item) => normalizeLastOrderedLookupInput(item))
              .filter((item): item is LastOrderedQuantityLookupInput => Boolean(item))
              .map((item) => [item.key, item])
          ).values()
        );

        if (normalizedItems.length === 0) {
          return {
            values: {},
            fromCache: true,
            historyUnavailableOffline: false,
          };
        }

        const existingCache = { ...(get().lastOrderedCacheBySupplier[supplierId] || {}) };
        const buildValuesFromCache = (cache: Record<string, LastOrderedQuantityCacheValue>) =>
          normalizedItems.reduce<Record<string, LastOrderedQuantityLookupResult>>((acc, item) => {
            const resolved = resolveLastOrderedFromCache(cache, item);
            if (resolved) {
              acc[item.key] = resolved;
            }
            return acc;
          }, {});

        const cachedValues = buildValuesFromCache(existingCache);
        const hasCompleteCache = normalizedItems.every((item) => Boolean(cachedValues[item.key]));
        if (hasCompleteCache && !forceRefresh) {
          return {
            values: cachedValues,
            fromCache: true,
            historyUnavailableOffline: false,
          };
        }

        if (!managerId || pastOrderItemsTableAvailable === false) {
          return {
            values: cachedValues,
            fromCache: true,
            historyUnavailableOffline: false,
          };
        }

        const itemIds = Array.from(new Set(normalizedItems.map((item) => item.itemId)));
        const units = Array.from(new Set(normalizedItems.map((item) => item.unit)));
        let nextCache = existingCache;

        const { data, error } = await (supabase as any)
          .from('past_order_items')
          .select('item_id, unit, quantity, location_id, location_group, ordered_at, created_at')
          .eq('created_by', managerId)
          .eq('supplier_id', supplierId)
          .in('item_id', itemIds)
          .in('unit', units)
          .order('ordered_at', { ascending: false })
          .limit(Math.min(2500, Math.max(600, normalizedItems.length * 120)));

        if (error) {
          if (isMissingTableError(error, 'past_order_items')) {
            pastOrderItemsTableAvailable = false;
          } else {
            console.warn('Unable to load past_order_items history.', error);
          }
          return {
            values: cachedValues,
            fromCache: true,
            historyUnavailableOffline: isNetworkLikeError(error) && !hasCompleteCache,
          };
        }

        pastOrderItemsTableAvailable = true;
        nextCache = { ...existingCache };
        (data || []).forEach((rawRow: any) => {
          const itemId =
            typeof rawRow?.item_id === 'string' && rawRow.item_id.trim().length > 0
              ? rawRow.item_id.trim()
              : '';
          const unit = normalizeHistoryLookupUnit(rawRow?.unit);
          const quantity = toValidNumber(rawRow?.quantity);
          if (!itemId || !unit || quantity === null || quantity <= 0) return;

          const cacheValue: LastOrderedQuantityCacheValue = {
            quantity: Math.max(0, quantity),
            orderedAt: toIsoString(rawRow?.ordered_at ?? rawRow?.created_at),
          };

          upsertLastOrderedCacheValue(nextCache, createLastOrderedAnyKey(itemId, unit), cacheValue);

          const locationId =
            typeof rawRow?.location_id === 'string' && rawRow.location_id.trim().length > 0
              ? rawRow.location_id.trim()
              : null;
          if (locationId) {
            upsertLastOrderedCacheValue(
              nextCache,
              createLastOrderedLocationIdKey(itemId, unit, locationId),
              cacheValue
            );
          }

          const locationGroup = normalizeLocationGroup(rawRow?.location_group);
          if (locationGroup) {
            upsertLastOrderedCacheValue(
              nextCache,
              createLastOrderedLocationGroupKey(itemId, unit, locationGroup),
              cacheValue
            );
          }
        });

        set((state) => ({
          lastOrderedCacheBySupplier: {
            ...state.lastOrderedCacheBySupplier,
            [supplierId]: nextCache,
          },
        }));

        return {
          values: buildValuesFromCache(nextCache),
          fromCache: false,
          historyUnavailableOffline: false,
        };
      },

      markOrderItemsStatus: async (orderItemIds, status) => {
        const normalizedIds = Array.from(
          new Set(
            orderItemIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          )
        );

        if (normalizedIds.length === 0) return true;

        try {
          if (orderItemsStatusColumnAvailable !== false) {
            const { error } = await supabase
              .from('order_items')
              .update({ status } as any)
              .in('id', normalizedIds);

            if (error) {
              if (isMissingColumnError(error, 'status')) {
                orderItemsStatusColumnAvailable = false;
              } else {
                throw error;
              }
            } else {
              orderItemsStatusColumnAvailable = true;
            }
          }

          if (orderItemsStatusColumnAvailable === false) {
            if (__DEV__) {
              console.warn(
                '[OrderStore] markOrderItemsStatus skipped: order_items.status column is missing. Apply fulfillment status migration first.'
              );
            }
            return false;
          }

          set((state) => {
            const idSet = new Set(normalizedIds);
            const patchOrder = (orderLike: any) => {
              if (!orderLike || !Array.isArray(orderLike.order_items)) return orderLike;

              if (status === 'pending') {
                let changed = false;
                const nextItems = orderLike.order_items.map((orderItem: any) => {
                  if (!idSet.has(orderItem?.id)) return orderItem;
                  changed = true;
                  return { ...orderItem, status: 'pending' };
                });
                return changed ? { ...orderLike, order_items: nextItems } : orderLike;
              }

              const nextItems = orderLike.order_items.filter((orderItem: any) => !idSet.has(orderItem?.id));
              if (nextItems.length === orderLike.order_items.length) return orderLike;
              return { ...orderLike, order_items: nextItems };
            };

            return {
              orders: Array.isArray(state.orders)
                ? state.orders.map((order: any) => patchOrder(order))
                : state.orders,
              currentOrder: patchOrder(state.currentOrder),
            };
          });

          return true;
        } catch (error) {
          console.error('markOrderItemsStatus failed:', error);
          return false;
        }
      },

      setSupplierOverride: async (orderItemIds, supplierId) => {
        if (orderItemIds.length === 0) return true;
        try {
          const { error } = await supabase
            .from('order_items')
            .update({ supplier_override_id: supplierId } as any)
            .in('id', orderItemIds);
          if (error) throw error;

          set((state) => {
            const idSet = new Set(orderItemIds);
            const patchOrder = (orderLike: any) => {
              if (!orderLike || !Array.isArray(orderLike.order_items)) return orderLike;
              let changed = false;
              const nextItems = orderLike.order_items.map((oi: any) => {
                if (!idSet.has(oi?.id)) return oi;
                changed = true;
                return { ...oi, supplier_override_id: supplierId };
              });
              return changed ? { ...orderLike, order_items: nextItems } : orderLike;
            };
            return {
              orders: Array.isArray(state.orders)
                ? state.orders.map((o: any) => patchOrder(o))
                : state.orders,
              currentOrder: patchOrder(state.currentOrder),
            };
          });
          return true;
        } catch (error) {
          console.error('setSupplierOverride failed:', error);
          return false;
        }
      },

      clearSupplierOverride: async (orderItemIds) => {
        if (orderItemIds.length === 0) return true;
        try {
          const { error } = await supabase
            .from('order_items')
            .update({ supplier_override_id: null } as any)
            .in('id', orderItemIds);
          if (error) throw error;

          set((state) => {
            const idSet = new Set(orderItemIds);
            const patchOrder = (orderLike: any) => {
              if (!orderLike || !Array.isArray(orderLike.order_items)) return orderLike;
              let changed = false;
              const nextItems = orderLike.order_items.map((oi: any) => {
                if (!idSet.has(oi?.id)) return oi;
                changed = true;
                return { ...oi, supplier_override_id: null };
              });
              return changed ? { ...orderLike, order_items: nextItems } : orderLike;
            };
            return {
              orders: Array.isArray(state.orders)
                ? state.orders.map((o: any) => patchOrder(o))
                : state.orders,
              currentOrder: patchOrder(state.currentOrder),
            };
          });
          return true;
        } catch (error) {
          console.error('clearSupplierOverride failed:', error);
          return false;
        }
      },

      finalizeSupplierOrder: async (input) => {
        const consumedDraftItemIds = Array.from(
          new Set(
            (input.consumedDraftItemIds || [])
              .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          )
        );
        const nextPastOrder = await get().createPastOrder(input);

        set((state) => {
          const draftRemovalSet = new Set(consumedDraftItemIds);
          const nextSupplierDrafts: SupplierDraftsBySupplier = {};
          Object.entries(state.supplierDrafts).forEach(([supplierKey, rows]) => {
            const filteredRows = rows.filter((row) => !draftRemovalSet.has(row.id));
            if (filteredRows.length > 0) {
              nextSupplierDrafts[supplierKey] = filteredRows;
            }
          });
          return {
            supplierDrafts: nextSupplierDrafts,
          };
        });

        if (nextPastOrder.syncStatus === 'pending_sync') {
          void get().flushPendingPastOrderSync(input.createdBy);
        }

        return nextPastOrder;
      },
    }),
    {
      name: 'order-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cartByLocation: state.cartByLocation,
        managerCartByLocation: state.managerCartByLocation,
        supplierDrafts: state.supplierDrafts,
        orderLaterQueue: state.orderLaterQueue,
        pastOrders: state.pastOrders,
        pendingPastOrderSyncQueue: state.pendingPastOrderSyncQueue,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<OrderState>;
        return {
          ...currentState,
          ...persisted,
          cartByLocation:
            persisted.cartByLocation && typeof persisted.cartByLocation === 'object'
              ? (persisted.cartByLocation as CartByLocation)
              : currentState.cartByLocation,
          managerCartByLocation:
            persisted.managerCartByLocation && typeof persisted.managerCartByLocation === 'object'
              ? (persisted.managerCartByLocation as CartByLocation)
              : currentState.managerCartByLocation,
          supplierDrafts: normalizeSupplierDrafts((persistedState as any)?.supplierDrafts),
          orderLaterQueue: normalizeOrderLaterQueue((persistedState as any)?.orderLaterQueue),
          pastOrders: normalizePastOrders((persistedState as any)?.pastOrders),
          pendingPastOrderSyncQueue: normalizePendingPastOrderSyncQueue(
            (persistedState as any)?.pendingPastOrderSyncQueue
          ),
        };
      },
    }
  )
);

if (!pastOrderSyncListenerInitialized) {
  pastOrderSyncListenerInitialized = true;
  NetInfo.addEventListener((state) => {
    const online = Boolean(state.isConnected) && state.isInternetReachable !== false;
    if (!online) return;
    const store = useOrderStore.getState();
    if (store.pendingPastOrderSyncQueue.length === 0) return;
    void store.flushPendingPastOrderSync();
  });
}
