// Barrel re-export for all orderStore helper domains.
// New code should import from the specific helper files directly.

// Shared utilities (table flags, error detection, IDs, notifications)
export {
  tableFlags,
  orderLaterMoveInFlightIds,
  resolveCurrentOrgId,
  createFulfillmentId,
  toIsoString,
  toJsonObject,
  normalizeSupplierId,
  normalizeLocationGroup,
  toStringArray,
  normalizeHistoryLookupUnit,
  isNetworkLikeError,
  isMissingTableError,
  isMissingColumnError,
  cancelOrderLaterNotification,
  scheduleOrderLaterNotification,
  createOrderLaterInAppNotification,
} from './sharedHelpers';

// Cart helpers
export {
  createCartItemId,
  toValidNumber,
  normalizeNote,
  getEffectiveQuantity,
  isSubmittableCartItem,
  normalizeCartItem,
  normalizeLocationCart,
  getLocationCart,
  normalizeCartByLocation,
  normalizeCartContext,
  getCartByContext,
  mergeCartItem,
  findCartItemIndex,
  cartItemToPayload,
} from './cartHelpers';

// Past-order helpers
export {
  createLastOrderedAnyKey,
  createLastOrderedLocationIdKey,
  createLastOrderedLocationGroupKey,
  normalizeLastOrderedLookupInput,
  resolveLastOrderedFromCache,
  upsertLastOrderedCacheValue,
  getPastOrderCountsFromPayload,
  normalizePastOrder,
  normalizePastOrders,
  normalizePastOrderItems,
  createPastOrderSyncJobId,
  normalizePendingPastOrderSyncQueue,
  mergeRemoteAndPendingPastOrders,
  extractPastOrderItemsFromPayload,
  extractConsumedOrderItemIds,
  removeConsumedOrderItems,
} from './pastOrderHelpers';

// Supplier-draft & order-later helpers
export {
  normalizeSupplierDrafts,
  normalizeOrderLaterItem,
  normalizeOrderLaterQueue,
} from './supplierDraftHelpers';
