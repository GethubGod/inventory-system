// Kitchen requests domain types (web). Server rows come from
// public.kitchen_requests / public.kitchen_items; the client adds two
// local-only states ("sending", "failed") that never reach the database.
// Contract: docs/phases/kitchen-requests-contract.md.

import type { Database } from "@/types/database";

export type KitchenRequestRow =
  Database["public"]["Tables"]["kitchen_requests"]["Row"];
export type KitchenItemRow =
  Database["public"]["Tables"]["kitchen_items"]["Row"];

export type KitchenErrorCode =
  | "not_signed_in"
  | "kitchen_requests_disabled"
  | "location_not_allowed"
  | "item_unavailable"
  | "invalid_quantity"
  | "client_key_conflict"
  | "request_not_found"
  | "invalid_transition"
  | "not_allowed"
  | "timeout"
  | "network"
  | "unknown";

/** Failures worth retrying with the same client key. Everything else needs a different request. */
export function isRetryableSendError(code: KitchenErrorCode): boolean {
  return code === "timeout" || code === "network" || code === "unknown";
}

export interface PendingError {
  code: KitchenErrorCode;
  message: string;
}

export const SERVER_STATUSES = [
  "queued",
  "ready",
  "cleared",
  "cancelled",
] as const;
export type ServerStatus = (typeof SERVER_STATUSES)[number];

export function isServerStatus(value: unknown): value is ServerStatus {
  return (
    typeof value === "string" &&
    (SERVER_STATUSES as readonly string[]).includes(value)
  );
}

export interface KitchenItem {
  id: string;
  name: string;
  unit: string;
  locationId: string | null;
  sortOrder: number;
  active: boolean;
}

/** A request the server has stored. Times are epoch milliseconds. */
export interface ServerRequest {
  kind: "server";
  id: string;
  clientKey: string;
  locationId: string;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  requestedBy: string | null;
  requestedByName: string;
  requestedByTag: string;
  status: ServerStatus;
  createdAt: number;
  /** Server updated_at; newer always wins when rows race (RPC vs realtime). */
  updatedAt: number;
  readyAt: number | null;
  readyByName: string | null;
  closedAt: number | null;
}

export type PendingStatus = "sending" | "failed";

/** A send that has not been acknowledged by the server (or failed to). */
export interface PendingRequest {
  kind: "pending";
  clientKey: string;
  locationId: string;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  status: PendingStatus;
  /** When the current attempt started (for the "taking longer" note). */
  startedAt: number;
  /** When the user first tapped Send (for log ordering). */
  createdAt: number;
  attempts: number;
  /** Why the last attempt failed; null while sending or before any failure. */
  error: PendingError | null;
}

export type LogRequest = ServerRequest | PendingRequest;

export const UPDATE_ACTIONS = [
  "ready",
  "undo_ready",
  "cancel",
  "clear",
] as const;
export type UpdateAction = (typeof UPDATE_ACTIONS)[number];

export type KitchenView = "chef" | "kitchen";

export interface KitchenModules {
  kitchen_requests: boolean;
  kitchen_display: boolean;
}

export interface KitchenLocation {
  id: string;
  name: string;
  active: boolean;
}

export interface KitchenIdentity {
  userId: string;
  displayName: string;
  tag: string;
}

function toMillis(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Narrow a raw row (REST or realtime payload) into a ServerRequest. */
export function toServerRequest(row: KitchenRequestRow): ServerRequest | null {
  if (!isServerStatus(row.status)) return null;
  const createdAt = toMillis(row.created_at);
  if (createdAt === null) return null;
  return {
    kind: "server",
    id: row.id,
    clientKey: row.client_key,
    locationId: row.location_id,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: row.unit,
    quantity: row.quantity,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    requestedByTag: row.requested_by_tag,
    status: row.status,
    createdAt,
    updatedAt: toMillis(row.updated_at) ?? createdAt,
    readyAt: toMillis(row.ready_at),
    readyByName: row.ready_by_name,
    closedAt: toMillis(row.closed_at),
  };
}

export function toKitchenItem(row: KitchenItemRow): KitchenItem {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    locationId: row.location_id,
    sortOrder: row.sort_order,
    active: row.active,
  };
}
