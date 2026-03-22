export const ORDER_CONFIRMATION_ROUTE = '/order-confirmation' as const;

export interface OrderConfirmationPayload {
  orderId: string;
  orderNumber?: string | null;
  locationName: string;
  itemCount: number;
  summary: string;
  submittedBy: string;
  submittedAt: string;
  browseRoute: string;
}

export interface OrderConfirmationRouteParams {
  [key: string]: string | undefined;
  orderId?: string;
  orderNumber?: string;
  locationName?: string;
  itemCount?: string;
  summary?: string;
  submittedBy?: string;
  submittedAt?: string;
  browseRoute?: string;
}

export function createOrderConfirmationParams(
  payload: OrderConfirmationPayload,
): OrderConfirmationRouteParams {
  return {
    orderId: payload.orderId,
    ...(payload.orderNumber ? { orderNumber: payload.orderNumber } : {}),
    locationName: payload.locationName,
    itemCount: String(payload.itemCount),
    summary: payload.summary,
    submittedBy: payload.submittedBy,
    submittedAt: payload.submittedAt,
    browseRoute: payload.browseRoute,
  };
}

export function getOrderConfirmationParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function formatOrderConfirmationSummary(
  itemCount: number,
  locationName: string,
): string {
  return `${itemCount} item${itemCount === 1 ? '' : 's'} for ${locationName}`;
}

export function formatOrderConfirmationDisplayId({
  orderId,
  orderNumber,
}: {
  orderId?: string | null;
  orderNumber?: string | null;
}): string {
  if (orderNumber && orderNumber.trim().length > 0) {
    return `#${orderNumber.trim()}`;
  }

  if (orderId && orderId.trim().length > 0) {
    return orderId.trim().slice(0, 8).toUpperCase();
  }

  return 'Unavailable';
}
