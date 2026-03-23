// Cart-domain helper functions for orderStore.
// Pure functions for cart item normalization, merging, and context resolution.

import { UnitType } from '@/types';
import type { OrderItemPayload } from '@/services/orderSubmission';
import type {
  CartByLocation,
  CartContext,
  CartItem,
  OrderInputMode,
  OrderState,
} from '../orderStore.types';

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export const createCartItemId = () =>
  `cart_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export function createLegacyCartItemId(
  locationId: string,
  inventoryItemId: string,
  inputMode: OrderInputMode,
  unitType: UnitType,
  index: number
): string {
  return `legacy_cart_${locationId}_${inventoryItemId}_${inputMode}_${unitType}_${index}`;
}

// ---------------------------------------------------------------------------
// Shared micro-helpers (needed by this module and others)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cart-item normalization
// ---------------------------------------------------------------------------

export function getEffectiveQuantity(item: CartItem): number {
  if (item.inputMode === 'quantity') {
    return item.quantityRequested ?? 0;
  }
  return item.decidedQuantity ?? 0;
}

export function isSubmittableCartItem(item: CartItem): boolean {
  if (item.inputMode === 'remaining') {
    return (item.remainingReported ?? 0) >= 0;
  }
  return getEffectiveQuantity(item) > 0;
}

export function normalizeCartItem(
  raw: any,
  options?: { locationId?: string; index?: number }
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

  const wasSuggested = raw?.wasSuggested === true || raw?.was_suggested === true;
  const originalSuggestedQty = toValidNumber(
    raw?.originalSuggestedQty ?? raw?.original_suggested_qty
  );

  if (inputMode === 'quantity') {
    const legacyQuantity = toValidNumber(raw?.quantity);
    const quantityRequested = toValidNumber(raw?.quantityRequested ?? legacyQuantity);
    if (quantityRequested === null || quantityRequested <= 0) return null;

    const decidedQuantityRaw = toValidNumber(raw?.decidedQuantity);
    const decidedQuantity = decidedQuantityRaw !== null && decidedQuantityRaw >= 0 ? decidedQuantityRaw : null;

    return {
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
      wasSuggested,
      originalSuggestedQty,
    };
  }

  const remainingLegacy = toValidNumber(raw?.remainingReported ?? raw?.quantity);
  if (remainingLegacy === null || remainingLegacy < 0) return null;

  const decidedQuantityRaw = toValidNumber(raw?.decidedQuantity);
  const decidedQuantity = decidedQuantityRaw !== null && decidedQuantityRaw >= 0 ? decidedQuantityRaw : null;

  return {
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
    wasSuggested,
    originalSuggestedQty,
  };
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
        wasSuggested: existing.wasSuggested || incoming.wasSuggested,
        originalSuggestedQty:
          existing.originalSuggestedQty ?? incoming.originalSuggestedQty ?? null,
      };
      return destination.map((item, idx) => (idx === existingIndex ? merged : item));
    }

    return [...destination, incoming];
  }

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
    was_suggested: item.wasSuggested,
    original_suggested_qty: item.originalSuggestedQty,
  };
}
