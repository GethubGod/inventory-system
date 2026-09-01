// Supabase calls for the kitchen screens. Reads go through RLS with the
// signed-in user's JWT; writes go through the two security-definer RPCs so
// the server stamps who/when and enforces the state machine. Errors are
// normalised to KitchenApiError with the stable code the RPC raised.

import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import {
  toKitchenItem,
  toServerRequest,
  type KitchenIdentity,
  type KitchenItem,
  type KitchenLocation,
  type KitchenModules,
  type KitchenRequestRow,
  type ServerRequest,
  type UpdateAction,
} from "@/lib/kitchen/types";

/** How far back the open-request fetch looks. Anything older is stale noise. */
export const OPEN_WINDOW_MS = 12 * 60 * 60 * 1000;

/** A send that has not been acknowledged by then is reported as failed. */
export const SEND_TIMEOUT_MS = 8_000;

export const UPDATE_TIMEOUT_MS = 8_000;

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

export class KitchenApiError extends Error {
  readonly code: KitchenErrorCode;
  readonly hint: string | null;

  constructor(code: KitchenErrorCode, message: string, hint: string | null = null) {
    super(message);
    this.name = "KitchenApiError";
    this.code = code;
    this.hint = hint;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<KitchenErrorCode>([
  "not_signed_in",
  "kitchen_requests_disabled",
  "location_not_allowed",
  "item_unavailable",
  "invalid_quantity",
  "client_key_conflict",
  "request_not_found",
  "invalid_transition",
  "not_allowed",
]);

function isKitchenErrorCode(value: string): value is KitchenErrorCode {
  return KNOWN_CODES.has(value);
}

function looksLikeNetworkFailure(message: string): boolean {
  return /fetch|network|load failed|connection|ECONN|timed? ?out/i.test(message);
}

/** Normalise a PostgrestError / thrown error into KitchenApiError. */
export function toKitchenApiError(error: unknown): KitchenApiError {
  if (error instanceof KitchenApiError) return error;
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const message =
    typeof record?.message === "string"
      ? record.message
      : error instanceof Error
        ? error.message
        : "Request failed";
  const hint = typeof record?.hint === "string" ? record.hint : null;
  if (isKitchenErrorCode(message)) return new KitchenApiError(message, message, hint);
  if (looksLikeNetworkFailure(message)) {
    return new KitchenApiError("network", message, hint);
  }
  return new KitchenApiError("unknown", message, hint);
}

/** What to tell the person on the floor. The RPC hint wins when present. */
export function describeKitchenError(error: unknown): string {
  const apiError = toKitchenApiError(error);
  if (apiError.hint) return apiError.hint;
  switch (apiError.code) {
    case "not_signed_in":
      return "You were signed out. Sign in again.";
    case "kitchen_requests_disabled":
      return "Your account can't send kitchen requests. Ask a manager.";
    case "location_not_allowed":
      return "Your account doesn't work at this location.";
    case "item_unavailable":
      return "That item was removed from the list. Pick another.";
    case "invalid_quantity":
      return "Quantity must be between 1 and 999.";
    case "request_not_found":
      return "That request no longer exists.";
    case "invalid_transition":
      return "That request already moved on. Refreshing.";
    case "not_allowed":
      return "Only the chef who sent this can change it.";
    case "timeout":
      return "The kitchen never confirmed. Check Wi-Fi and retry.";
    case "network":
      return "Couldn't reach smelter. Check Wi-Fi and retry.";
    default:
      return apiError.message || "Something went wrong. Retry.";
  }
}

async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new KitchenApiError("timeout", "timeout")),
      ms,
    );
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface KitchenAccess {
  identity: KitchenIdentity;
  modules: KitchenModules;
  /** profiles.role = manager (may cancel or clear anyone's request). */
  isManager: boolean;
  defaultLocationId: string | null;
  locations: KitchenLocation[];
}

/** Everything the gate needs to decide which screen (if any) to show. */
export async function fetchKitchenAccess(userId: string): Promise<KitchenAccess> {
  const supabase = getSupabase();
  const [modulesResult, userResult, locationsResult, identityResult, managerResult] =
    await Promise.all([
      supabase.rpc("get_effective_modules", { p_user_id: userId }),
      supabase
        .from("users")
        .select("default_location_id")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("locations")
        .select("id, name, active")
        .eq("active", true)
        .order("name"),
      supabase.rpc("kitchen_actor_identity", { p_user_id: userId }),
      supabase.rpc("current_user_is_manager"),
    ]);
  if (modulesResult.error) throw toKitchenApiError(modulesResult.error);
  if (userResult.error) throw toKitchenApiError(userResult.error);
  if (locationsResult.error) throw toKitchenApiError(locationsResult.error);
  if (identityResult.error) throw toKitchenApiError(identityResult.error);
  if (managerResult.error) throw toKitchenApiError(managerResult.error);

  const modules: KitchenModules = { kitchen_requests: false, kitchen_display: false };
  for (const row of modulesResult.data ?? []) {
    if (row.module_key === "kitchen_requests" || row.module_key === "kitchen_display") {
      modules[row.module_key] = row.enabled === true;
    }
  }
  const identityRow = identityResult.data?.[0];
  return {
    identity: {
      userId,
      displayName: identityRow?.display_name?.trim() || "Unknown",
      tag: identityRow?.tag?.trim() || "unknown",
    },
    modules,
    isManager: managerResult.data === true,
    defaultLocationId: userResult.data?.default_location_id ?? null,
    locations: (locationsResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
    })),
  };
}

export async function fetchKitchenItems(locationId: string): Promise<KitchenItem[]> {
  const { data, error } = await getSupabase()
    .from("kitchen_items")
    .select("*")
    .eq("active", true)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .order("sort_order")
    .order("name");
  if (error) throw toKitchenApiError(error);
  return (data ?? []).map(toKitchenItem);
}

export async function fetchOpenRequests(
  locationId: string,
  now: number = Date.now(),
): Promise<ServerRequest[]> {
  const since = new Date(now - OPEN_WINDOW_MS).toISOString();
  const { data, error } = await getSupabase()
    .from("kitchen_requests")
    .select("*")
    .eq("location_id", locationId)
    .in("status", ["queued", "ready"])
    .gte("created_at", since)
    .order("created_at");
  if (error) throw toKitchenApiError(error);
  const rows: ServerRequest[] = [];
  for (const row of data ?? []) {
    const request = toServerRequest(row);
    if (request) rows.push(request);
  }
  return rows;
}

export interface SendRequestInput {
  clientKey: string;
  itemId: string;
  quantity: number;
  locationId: string;
}

/**
 * Idempotent send: the same clientKey always maps to the same stored row, so
 * retrying after a timeout can never create a duplicate.
 */
export async function sendKitchenRequest(
  input: SendRequestInput,
  timeoutMs: number = SEND_TIMEOUT_MS,
): Promise<ServerRequest> {
  const call = getSupabase()
    .rpc("kitchen_send_request", {
      p_client_key: input.clientKey,
      p_item_id: input.itemId,
      p_quantity: input.quantity,
      p_location_id: input.locationId,
    })
    .then(({ data, error }) => {
      if (error) throw toKitchenApiError(error);
      const request = data ? toServerRequest(data) : null;
      if (!request) throw new KitchenApiError("unknown", "Unexpected send response");
      return request;
    });
  return withTimeout(call, timeoutMs);
}

export async function updateKitchenRequest(
  requestId: string,
  action: UpdateAction,
  timeoutMs: number = UPDATE_TIMEOUT_MS,
): Promise<ServerRequest> {
  const call = getSupabase()
    .rpc("kitchen_update_request", { p_request_id: requestId, p_action: action })
    .then(({ data, error }) => {
      if (error) throw toKitchenApiError(error);
      const request = data ? toServerRequest(data) : null;
      if (!request) throw new KitchenApiError("unknown", "Unexpected update response");
      return request;
    });
  return withTimeout(call, timeoutMs);
}

export type ChannelStatus = "connecting" | "live" | "down";

export interface RequestSubscriptionHandlers {
  onUpsert: (request: ServerRequest) => void;
  onDelete: (id: string) => void;
  onStatus: (status: ChannelStatus) => void;
}

/**
 * Realtime feed for one location. RLS filters what each subscriber can see;
 * the location filter just keeps the other store's traffic off the wire.
 * Returns an unsubscribe function.
 */
export function subscribeToKitchenRequests(
  locationId: string,
  handlers: RequestSubscriptionHandlers,
): () => void {
  const supabase = getSupabase();
  const channel: RealtimeChannel = supabase
    .channel(`kitchen-requests-${locationId}`)
    .on<KitchenRequestRow>(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "kitchen_requests",
        filter: `location_id=eq.${locationId}`,
      },
      (payload: RealtimePostgresChangesPayload<KitchenRequestRow>) => {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as Partial<KitchenRequestRow>).id;
          if (typeof id === "string") handlers.onDelete(id);
          return;
        }
        const request = toServerRequest(payload.new);
        if (request) handlers.onUpsert(request);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") handlers.onStatus("live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        handlers.onStatus("down");
      }
    });
  handlers.onStatus("connecting");
  return () => {
    void supabase.removeChannel(channel);
  };
}
