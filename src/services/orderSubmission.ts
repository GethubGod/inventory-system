/**
 * Order Submission Service
 *
 * Single, atomic order submission pathway. Sends the order and all items
 * to the database in one RPC call via raw fetch (bypasses the Supabase JS
 * client to avoid the React Native auth-lock deadlock).
 *
 * Key properties:
 * - Atomic: order + items created in a single DB transaction
 * - Idempotent: client-generated order ID with ON CONFLICT — safe to retry
 * - No partial writes: if items fail, the order is rolled back
 * - Single round trip: one fetch call, no multi-step client orchestration
 */

import NetInfo from '@react-native-community/netinfo';
import type {
  OrderItemWithInventory,
  OrderWithDetails,
} from '@/types';
import { useAuthStore } from '@/store/authStore';
import {
  OrderSubmissionError,
  validateSubmitRequest,
  type OrderItemPayload,
  type SubmitOrderRequest,
} from './orderValidation';

// Re-export types and classes for consumers
export { OrderSubmissionError, validateSubmitRequest };
export type { OrderItemPayload, SubmitOrderRequest };

export interface SubmitOrderResult {
  order: OrderWithDetails;
  /** True if this order was already created (idempotent retry). */
  wasExisting: boolean;
}

// ── Configuration ────────────────────────────────────────────

const SUBMIT_TIMEOUT_MS = 12_000;

// ── Helpers ──────────────────────────────────────────────────

function getRequestContext(): {
  url: string;
  token: string;
  anonKey: string;
} {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) {
    throw new OrderSubmissionError(
      'App configuration error. Please restart the app.',
      false,
      'CONFIG_MISSING',
    );
  }

  const token = (useAuthStore.getState().session as any)?.access_token ?? '';
  if (!token) {
    throw new OrderSubmissionError(
      'Your session has expired. Please sign in again.',
      false,
      'NO_SESSION',
    );
  }

  return { url, token, anonKey };
}

async function ensureConnectivity(): Promise<void> {
  try {
    const state = await NetInfo.fetch();
    const hasSignal = state.isConnected !== null || state.isInternetReachable !== null;
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    if (hasSignal && !online) {
      throw new OrderSubmissionError(
        'No internet connection. Please check your network and try again.',
        true,
        'OFFLINE',
      );
    }
  } catch (err) {
    if (err instanceof OrderSubmissionError) throw err;
    // NetInfo itself failed — proceed optimistically
  }
}

function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Core Submit ──────────────────────────────────────────────

/**
 * Submit an order atomically via the submit_order_rpc database function.
 *
 * This is the ONLY code path that writes orders to the database.
 * It uses raw fetch to bypass the Supabase JS client auth-lock issue.
 *
 * Safe to retry: if the order ID already exists in the database,
 * the RPC returns the existing order without duplicating.
 */
export async function submitOrder(req: SubmitOrderRequest): Promise<SubmitOrderResult> {
  // ── Client-side validation ──
  const validationError = validateSubmitRequest(req);
  if (validationError) {
    throw new OrderSubmissionError(validationError, false, 'VALIDATION');
  }

  // ── Connectivity check ──
  await ensureConnectivity();

  // ── Auth context ──
  const { url, token, anonKey } = getRequestContext();

  // ── Build RPC payload ──
  const rpcPayload = {
    p_id: req.orderId,
    p_org_id: req.orgId,
    p_location_id: req.locationId,
    p_user_id: req.userId,
    p_status: req.status,
    p_items: req.items,
  };

  // ── Execute ──
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  const t0 = Date.now();

  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/submit_order_rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(rpcPayload),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    if (err?.name === 'AbortError') {
      throw new OrderSubmissionError(
        'Order submission timed out. Please try again.',
        true,
        'TIMEOUT',
      );
    }
    throw new OrderSubmissionError(
      'Network error during order submission. Please check your connection and try again.',
      true,
      'NETWORK',
    );
  } finally {
    clearTimeout(timer);
  }

  const elapsed = Date.now() - t0;

  // ── Parse response ──
  if (!response.ok) {
    let detail = '';
    let fullBody: any = null;
    try {
      fullBody = await response.json();
      detail = fullBody?.message ?? fullBody?.error ?? fullBody?.hint ?? JSON.stringify(fullBody);
    } catch {
      detail = await response.text().catch(() => '');
    }

    // Log full error for debugging
    console.error('[OrderSubmission] RPC failed', {
      status: response.status,
      elapsed,
      detail,
      fullBody,
      orderId: req.orderId,
    });

    if (response.status === 401) {
      throw new OrderSubmissionError(
        'Your session has expired. Please sign in again.',
        false,
        'AUTH_EXPIRED',
      );
    }
    if (response.status === 403) {
      throw new OrderSubmissionError(
        'You don\'t have permission to submit orders. Please contact your manager.',
        false,
        'FORBIDDEN',
      );
    }

    // In dev, surface the DB detail for debugging; in prod, show a clean message
    const userMessage = __DEV__
      ? `Failed to submit order: ${detail}`
      : 'Failed to submit order. Please try again.';

    throw new OrderSubmissionError(
      userMessage,
      response.status >= 500,
      `HTTP_${response.status}`,
    );
  }

  const data = await response.json();
  if (!data?.id) {
    console.error('[OrderSubmission] RPC returned no data', { data, elapsed });
    throw new OrderSubmissionError(
      'Order may not have been saved. Please check your orders before retrying.',
      true,
      'NO_DATA',
    );
  }

  console.log('[OrderSubmission] success', {
    orderId: data.id,
    orderNumber: data.order_number,
    itemCount: data.order_items?.length ?? 0,
    isExisting: data.is_existing,
    elapsed,
  });

  // ── Map response to app types ──
  const order = mapRpcResponseToOrder(data, req.userId, req.locationId);
  return {
    order,
    wasExisting: data.is_existing === true,
  };
}

// ── Profile sync (fire-and-forget) ───────────────────────────

export function syncProfileAfterOrder(userId: string, orderCreatedAt: string): void {
  // Best-effort — never blocks the happy path
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  const token = (useAuthStore.getState().session as any)?.access_token ?? '';
  if (!url || !anonKey || !token) return;

  fetch(`${url}/rest/v1/rpc/sync_profile_after_order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_order_created_at: orderCreatedAt,
    }),
  }).catch(() => {});
}

// ── UUID generation (exported for store use) ─────────────────

export { generateUUID };

// ── Response mapping ─────────────────────────────────────────

function mapRpcResponseToOrder(
  data: any,
  userId: string,
  locationId: string,
): OrderWithDetails {
  const orderItems: OrderItemWithInventory[] = (data.order_items ?? []).map((item: any) => ({
    id: item.id,
    order_id: item.order_id,
    inventory_item_id: item.inventory_item_id,
    quantity: item.quantity,
    unit_type: item.unit_type ?? 'base',
    input_mode: item.input_mode ?? 'quantity',
    quantity_requested: item.quantity_requested ?? null,
    remaining_reported: item.remaining_reported ?? null,
    decided_quantity: item.decided_quantity ?? null,
    decided_by: item.decided_by ?? null,
    decided_at: item.decided_at ?? null,
    note: item.note ?? null,
    created_at: item.created_at ?? '',
    inventory_item: item.inventory_item ?? {
      id: item.inventory_item_id,
      name: 'Unknown',
      category: 'dry',
      supplier_category: 'main_distributor',
      base_unit: 'unit',
      pack_unit: '',
      pack_size: 1,
      active: true,
      created_at: '',
    },
  }));

  return {
    id: data.id,
    order_number: data.order_number,
    org_id: data.org_id,
    user_id: data.user_id ?? userId,
    location_id: data.location_id ?? locationId,
    status: data.status ?? 'submitted',
    notes: data.notes ?? null,
    created_at: data.created_at ?? new Date().toISOString(),
    fulfilled_at: data.fulfilled_at ?? null,
    fulfilled_by: data.fulfilled_by ?? null,
    user: { id: data.user_id ?? userId } as any,
    location: { id: data.location_id ?? locationId } as any,
    order_items: orderItems,
  };
}
