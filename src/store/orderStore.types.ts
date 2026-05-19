import {
  ItemCategory,
  Order,
  OrderStatus,
  OrderWithDetails,
  UnitType,
} from '@/types';
import type { PendingFulfillmentDataResult } from '@/services/fulfillmentDataSource';

export type OrderInputMode = 'quantity' | 'remaining';
export type CartScope = 'employee' | 'manager';
export type CartContext = CartScope;
export type OrderEntryMethod = 'manual' | 'quick_order' | 'voice_order' | 'suggested_order';

export interface SubmitOrderOptions {
  orderId?: string;
  entryMethod?: OrderEntryMethod;
  quickSessionId?: string | null;
  pendingSubmitKey?: string;
}

export interface PendingSubmitMetadata {
  orderId: string;
  entryMethod?: OrderEntryMethod;
  quickSessionId?: string | null;
  createdAt: string;
}

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
  wasSuggested: boolean;
  originalSuggestedQty: number | null;
}

export interface AddToCartOptions {
  inputMode?: OrderInputMode;
  quantityRequested?: number | null;
  remainingReported?: number | null;
  decidedQuantity?: number | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  note?: string | null;
  wasSuggested?: boolean;
  originalSuggestedQty?: number | null;
  context?: CartContext;
}

export interface UpdateCartItemOptions {
  cartItemId?: string;
  inputMode?: OrderInputMode;
  quantityRequested?: number | null;
  remainingReported?: number | null;
  wasSuggested?: boolean;
  originalSuggestedQty?: number | null;
  clearDecision?: boolean;
  context?: CartContext;
}

// Cart items organized by location
export type CartByLocation = Record<string, CartItem[]>;

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

export interface PendingPastOrderSyncJob {
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

export type SupplierDraftsBySupplier = Record<string, SupplierDraftItem[]>;
export type LastOrderedCacheBySupplier = Record<string, Record<string, LastOrderedQuantityCacheValue>>;

export interface LastOrderedQuantityCacheValue {
  quantity: number;
  orderedAt: string;
}

export interface OrderState {
  cartByLocation: CartByLocation;
  managerCartByLocation: CartByLocation;
  pendingSubmitByLocation: Record<string, PendingSubmitMetadata>;
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
  clearAllCarts: () => void;
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

  // Order actions
  fetchOrders: (locationId: string) => Promise<void>;
  fetchUserOrders: (userId: string) => Promise<void>;
  fetchManagerOrders: (locationId?: string | null, status?: OrderStatus | null) => Promise<void>;
  fetchOrder: (orderId: string) => Promise<void>;
  createOrder: (locationId: string, userId: string, context?: CartContext, options?: SubmitOrderOptions) => Promise<Order>;
  createAndSubmitOrder: (
    locationId: string,
    userId: string,
    context?: CartContext,
    options?: SubmitOrderOptions
  ) => Promise<OrderWithDetails>;
  createAndSubmitOrderFromSourceLocation: (
    sourceLocationId: string,
    submitLocationId: string,
    userId: string,
    context?: CartContext,
    options?: SubmitOrderOptions
  ) => Promise<OrderWithDetails>;
  submitOrder: (orderId: string) => Promise<void>;
  updateOrderStatus: (orderId: string, status: OrderStatus, fulfilledBy?: string) => Promise<void>;
  fulfillOrder: (orderId: string, fulfilledBy: string) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;

  // Fulfillment actions/state
  loadFulfillmentData: (managerId?: string | null, locationIds?: string[]) => Promise<void>;
  fetchPastOrders: (managerId?: string | null) => Promise<PastOrder[]>;
  fetchPastOrderById: (
    pastOrderId: string,
    managerId?: string | null
  ) => Promise<PastOrderDetail | null>;
  flushPendingPastOrderSync: (managerId?: string | null) => Promise<void>;
  createPastOrder: (input: FinalizeSupplierOrderInput) => Promise<PastOrder>;
  fetchPendingFulfillmentOrders: (locationIds?: string[]) => Promise<PendingFulfillmentDataResult>;
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
