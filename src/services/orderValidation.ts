/**
 * Pure validation functions for order submission.
 * No React Native, Supabase, or external dependencies.
 */

export interface OrderItemPayload {
  inventory_item_id: string;
  quantity: number;
  unit_type: string;
  input_mode: string;
  quantity_requested: number | null;
  remaining_reported: number | null;
  decided_quantity: number | null;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  was_suggested?: boolean;
  original_suggested_qty?: number | null;
}

export interface SubmitOrderRequest {
  orderId: string;
  locationId: string;
  userId: string;
  status: 'submitted' | 'draft';
  items: OrderItemPayload[];
  entryMethod?: 'manual' | 'quick_order' | 'voice_order' | 'suggested_order';
  quickSessionId?: string | null;
}

export class OrderSubmissionError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'OrderSubmissionError';
  }
}

/**
 * Validate a submission request before sending to the backend.
 * Returns null if valid, or a user-facing error message string.
 */
export function validateSubmitRequest(req: SubmitOrderRequest): string | null {
  if (!req.orderId) return 'Missing order ID';
  if (!req.locationId) return 'Missing location';
  if (!req.userId) return 'Missing user';
  if (!req.items || req.items.length === 0) return 'Cart is empty';

  for (let i = 0; i < req.items.length; i++) {
    const item = req.items[i];
    if (!item.inventory_item_id) return `Item ${i + 1} is missing a product reference`;
    const isRemainingMode = item.input_mode === 'remaining';
    const invalidQuantity =
      typeof item.quantity !== 'number' ||
      !isFinite(item.quantity) ||
      (isRemainingMode ? item.quantity < 0 : item.quantity <= 0);
    if (invalidQuantity) {
      return `Item ${i + 1} has an invalid quantity`;
    }
    if (isRemainingMode && (typeof item.remaining_reported !== 'number' || item.remaining_reported < 0)) {
      return `Item ${i + 1} is missing a valid remaining quantity`;
    }
  }

  return null;
}
