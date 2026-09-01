// Device-remembered kitchen state (localStorage): the location this phone
// or display works, which screen a dual-access user last used, and sends
// that have not been acknowledged yet. None of it grants anything; the
// server decides access on every call.

import { isKitchenView } from "@/lib/kitchen/access";
import type { KitchenView, PendingRequest } from "@/lib/kitchen/types";

const LOCATION_KEY = "smelter_kitchen_location";
const VIEW_KEY = "smelter_kitchen_view";
const PENDING_PREFIX = "smelter_kitchen_pending";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadRememberedLocation(): string | null {
  const value = storage()?.getItem(LOCATION_KEY);
  return value && value.length > 0 ? value : null;
}

export function saveRememberedLocation(locationId: string | null): void {
  const store = storage();
  if (!store) return;
  if (locationId) store.setItem(LOCATION_KEY, locationId);
  else store.removeItem(LOCATION_KEY);
}

export function loadRememberedView(): KitchenView | null {
  const value = storage()?.getItem(VIEW_KEY);
  return isKitchenView(value) ? value : null;
}

export function saveRememberedView(view: KitchenView): void {
  storage()?.setItem(VIEW_KEY, view);
}

/**
 * Unacknowledged sends survive a refresh or a crash mid-send: on the next
 * load they are replayed with the same client key, which the server treats
 * idempotently, so nothing is lost and nothing duplicates. Keyed per user
 * and location so another account on the same phone never inherits them.
 */
function pendingKey(userId: string, locationId: string): string {
  return `${PENDING_PREFIX}:${userId}:${locationId}`;
}

function isPersistedPending(value: unknown): value is PendingRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.clientKey === "string" &&
    typeof record.locationId === "string" &&
    typeof record.itemId === "string" &&
    typeof record.itemName === "string" &&
    typeof record.unit === "string" &&
    typeof record.quantity === "number" &&
    typeof record.createdAt === "number" &&
    typeof record.attempts === "number"
  );
}

export function loadPendingSends(
  userId: string,
  locationId: string,
): PendingRequest[] {
  const raw = storage()?.getItem(pendingKey(userId, locationId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPersistedPending).map((item) => ({
      kind: "pending" as const,
      clientKey: item.clientKey,
      locationId: item.locationId,
      itemId: item.itemId,
      itemName: item.itemName,
      unit: item.unit,
      quantity: item.quantity,
      status: "failed" as const,
      startedAt: item.createdAt,
      createdAt: item.createdAt,
      attempts: item.attempts,
      error: null,
    }));
  } catch {
    return [];
  }
}

export function savePendingSends(
  userId: string,
  locationId: string,
  pendings: PendingRequest[],
): void {
  const store = storage();
  if (!store) return;
  const key = pendingKey(userId, locationId);
  if (pendings.length === 0) {
    store.removeItem(key);
    return;
  }
  store.setItem(
    key,
    JSON.stringify(
      pendings.map((item) => ({
        clientKey: item.clientKey,
        locationId: item.locationId,
        itemId: item.itemId,
        itemName: item.itemName,
        unit: item.unit,
        quantity: item.quantity,
        createdAt: item.createdAt,
        attempts: item.attempts,
      })),
    ),
  );
}
