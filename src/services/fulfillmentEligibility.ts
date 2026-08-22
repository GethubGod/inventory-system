const QUICK_ORDER_ENTRY_METHODS = new Set([
  'quick_order',
  'voice_order',
  'suggested_order',
]);

const FULFILLMENT_READY_REVIEW_STATUSES = new Set([
  'approved',
  'not_required',
]);

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function getField(order: unknown, key: string): unknown {
  if (!order || typeof order !== 'object') return null;
  return (order as Record<string, unknown>)[key];
}

export function isOrderFulfillmentEligible(order: unknown): boolean {
  const entryMethod = normalizeText(getField(order, 'entry_method'));
  const quickSessionId = normalizeText(getField(order, 'quick_session_id'));
  const reviewStatus = normalizeText(getField(order, 'manager_review_status'));
  const isQuickOrder = Boolean(
    quickSessionId || (entryMethod && QUICK_ORDER_ENTRY_METHODS.has(entryMethod))
  );

  if (!isQuickOrder) return true;

  return Boolean(reviewStatus && FULFILLMENT_READY_REVIEW_STATUSES.has(reviewStatus));
}
