export interface FulfillmentOrderItemEligibilityOptions {
  consumedOrderItemIds?: ReadonlySet<string>;
  orderLaterSourceOrderItemIds?: ReadonlySet<string>;
}

const EMPTY_ORDER_ITEM_IDS: ReadonlySet<string> = new Set();

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getJoinedOrder(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return toRecord(value[0]);
  }

  return toRecord(value);
}

// A Quick Order row reaches fulfillment once review is settled: approved by a
// manager, or skipped entirely ('not_required', e.g. manager-submitted orders).
// Requiring 'approved' alone strands review-exempt orders forever.
export function isOrderFulfillmentEligible(order: unknown): boolean {
  const row = toRecord(order);
  if (!row) return false;

  if (row.entry_method !== 'quick_order' && !row.quick_session_id) {
    return true;
  }

  return (
    row.manager_review_status === 'approved' ||
    row.manager_review_status === 'not_required'
  );
}

// This mirrors the Fulfillment data source's item-level filter. It intentionally
// accepts null status because older rows predate the pending-status migration.
export function isOrderItemFulfillmentEligible(
  orderItem: unknown,
  options?: FulfillmentOrderItemEligibilityOptions,
): boolean {
  const row = toRecord(orderItem);
  if (!row || !toRecord(row.inventory_item)) return false;

  const orderItemId = toTrimmedString(row.id);
  if (!orderItemId) return false;

  const consumedOrderItemIds = options?.consumedOrderItemIds ?? EMPTY_ORDER_ITEM_IDS;
  if (consumedOrderItemIds.has(orderItemId)) return false;

  const orderLaterSourceOrderItemIds =
    options?.orderLaterSourceOrderItemIds ?? EMPTY_ORDER_ITEM_IDS;
  if (orderLaterSourceOrderItemIds.has(orderItemId)) return false;

  const statusValue = toTrimmedString(row.status)?.toLowerCase();
  if (statusValue && statusValue !== 'pending') return false;

  if (row.input_mode === 'remaining') {
    const remainingReported = toNumber(row.remaining_reported, Number.NaN);
    const decidedQuantity = toNumber(row.decided_quantity, Number.NaN);
    return Number.isFinite(remainingReported) || (Number.isFinite(decidedQuantity) && decidedQuantity > 0);
  }

  return toNumber(row.quantity, 0) > 0;
}

// The badge reads flattened order_item rows, whereas the screen reads orders
// with nested items. Keeping this reducer here makes both consumers use the
// same eligibility chain before counting unique orders.
export function getPendingFulfillmentOrderIdsFromItemRows(
  rows: readonly unknown[],
  options?: FulfillmentOrderItemEligibilityOptions,
): Set<string> {
  const orderIds = new Set<string>();

  rows.forEach((value) => {
    const row = toRecord(value);
    if (!row) return;

    const order = getJoinedOrder(row.orders);
    if (!isOrderFulfillmentEligible(order)) return;
    if (!isOrderItemFulfillmentEligible(row, options)) return;

    const orderId = toTrimmedString(row.order_id);
    if (orderId) orderIds.add(orderId);
  });

  return orderIds;
}
