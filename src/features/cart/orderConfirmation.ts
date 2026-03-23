export interface OrderConfirmationPayload {
  orderId: string;
  orderNumber?: string | null;
  locationName: string;
  itemCount: number;
  summary: string;
  submittedBy: string;
  submittedAt: string;
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

export function formatOrderConfirmationSubmittedTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unavailable';
  }

  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
