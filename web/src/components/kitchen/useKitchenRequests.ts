"use client";

// Live request list for one location: initial fetch, realtime feed, polling
// while the feed is down, refetch on reconnect/foreground, and the optimistic
// actions both screens use. State transitions are the pure functions in
// lib/kitchen/state; this hook only wires them to Supabase and the clock.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  fetchKitchenItems,
  fetchOpenRequests,
  sendKitchenRequest,
  subscribeToKitchenRequests,
  toKitchenApiError,
  updateKitchenRequest,
  type ChannelStatus,
  type KitchenApiError,
} from "@/lib/kitchen/api";
import { UNDO_WINDOW_MS } from "@/lib/kitchen/format";
import {
  EMPTY_STATE,
  applyFetch,
  applyServerRow,
  clearUndoWindow,
  dismissPending,
  failPending,
  removeServerRow,
  retryPending,
  setUndoWindow,
  startPending,
  type RequestsState,
} from "@/lib/kitchen/state";
import type {
  KitchenItem,
  PendingRequest,
  ServerRequest,
  UpdateAction,
} from "@/lib/kitchen/types";

/** Poll cadence while the realtime channel is not live. */
const DOWN_POLL_MS = 5_000;
/** Safety-net refetch cadence while live (catches anything a dropped frame missed). */
const LIVE_POLL_MS = 30_000;

export type Connectivity = "live" | "connecting" | "down" | "offline";

export interface KitchenRequestsApi {
  state: RequestsState;
  items: KitchenItem[] | null;
  loadError: string | null;
  connectivity: Connectivity;
  reload: () => Promise<void>;
  send: (item: KitchenItem, quantity: number) => string;
  retry: (clientKey: string) => void;
  dismiss: (clientKey: string) => void;
  act: (request: ServerRequest, action: UpdateAction) => Promise<KitchenApiError | null>;
}

function newClientKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Very old WebViews only. Still unique enough for an idempotency key.
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Mount one instance per location (key the component by location id): the
 * list, items and channel all belong to that location.
 */
export function useKitchenRequests(locationId: string): KitchenRequestsApi {
  const [state, setState] = useState<RequestsState>(EMPTY_STATE);
  const [items, setItems] = useState<KitchenItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelStatus>("connecting");
  const online = useSyncExternalStore(
    subscribeOnline,
    () => window.navigator.onLine,
    () => true,
  );
  const inFlight = useRef<Map<string, PendingRequest>>(new Map());
  // Latest state for event handlers (retry) without re-creating callbacks.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const reload = useCallback(
    (): Promise<void> =>
      Promise.all([fetchKitchenItems(locationId), fetchOpenRequests(locationId)]).then(
        ([nextItems, rows]) => {
          setItems(nextItems);
          setState((prev) => applyFetch(prev, rows));
          setLoadError(null);
        },
        (error: unknown) => {
          setLoadError(toKitchenApiError(error).message);
        },
      ),
    [locationId],
  );

  // Initial fetch + realtime feed.
  useEffect(() => {
    void reload();
    const unsubscribe = subscribeToKitchenRequests(locationId, {
      onUpsert: (row) => setState((prev) => applyServerRow(prev, row)),
      onDelete: (id) => setState((prev) => removeServerRow(prev, id)),
      onStatus: (status) => {
        setChannel(status);
        // Anything that happened while the channel was down is on the server.
        if (status === "live") void reload();
      },
    });
    return unsubscribe;
  }, [locationId, reload]);

  // Back online or back to the foreground: refetch, never trust a stale list.
  useEffect(() => {
    const handleOnline = () => void reload();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [reload]);

  // Poll: fast while the feed is down, slow as a safety net while live.
  useEffect(() => {
    const interval = channel === "live" ? LIVE_POLL_MS : DOWN_POLL_MS;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void reload();
    }, interval);
    return () => clearInterval(timer);
  }, [channel, reload]);

  const runSend = useCallback((pending: PendingRequest) => {
    inFlight.current.set(pending.clientKey, pending);
    sendKitchenRequest({
      clientKey: pending.clientKey,
      itemId: pending.itemId,
      quantity: pending.quantity,
      locationId: pending.locationId,
    })
      .then((row) => {
        inFlight.current.delete(pending.clientKey);
        setState((prev) => applyServerRow(prev, row));
      })
      .catch(() => {
        inFlight.current.delete(pending.clientKey);
        setState((prev) => failPending(prev, pending.clientKey));
      });
  }, []);

  const send = useCallback(
    (item: KitchenItem, quantity: number): string => {
      const now = Date.now();
      const pending: PendingRequest = {
        kind: "pending",
        clientKey: newClientKey(),
        locationId,
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        quantity,
        status: "sending",
        startedAt: now,
        createdAt: now,
        attempts: 1,
      };
      setState((prev) => startPending(prev, pending));
      runSend(pending);
      return pending.clientKey;
    },
    [locationId, runSend],
  );

  const retry = useCallback(
    (clientKey: string) => {
      const current = stateRef.current.pending[clientKey];
      if (!current || current.status !== "failed" || inFlight.current.has(clientKey)) {
        return;
      }
      const now = Date.now();
      const attempt: PendingRequest = {
        ...current,
        status: "sending",
        startedAt: now,
        attempts: current.attempts + 1,
      };
      setState((prev) => retryPending(prev, clientKey, now));
      runSend(attempt);
    },
    [runSend],
  );

  const dismiss = useCallback((clientKey: string) => {
    setState((prev) => dismissPending(prev, clientKey));
  }, []);

  const act = useCallback(
    async (request: ServerRequest, action: UpdateAction): Promise<KitchenApiError | null> => {
      const now = Date.now();
      // Optimistic local transition; the server row replaces it on success.
      setState((prev) => {
        const current = prev.byId[request.id] ?? request;
        switch (action) {
          case "ready": {
            const next = applyServerRow(prev, { ...current, status: "ready", readyAt: now });
            return setUndoWindow(next, request.id, now + UNDO_WINDOW_MS);
          }
          case "undo_ready":
            return clearUndoWindow(
              applyServerRow(prev, { ...current, status: "queued", readyAt: null, readyByName: null }),
              request.id,
            );
          case "cancel":
            return applyServerRow(prev, { ...current, status: "cancelled", closedAt: now });
          case "clear":
            return applyServerRow(prev, { ...current, status: "cleared", closedAt: now });
        }
      });
      try {
        const row = await updateKitchenRequest(request.id, action);
        setState((prev) => applyServerRow(prev, row));
        return null;
      } catch (error: unknown) {
        const apiError = toKitchenApiError(error);
        // Roll back to what we knew, then let the next fetch settle it.
        setState((prev) => clearUndoWindow(applyServerRow(prev, request), request.id));
        void reload();
        return apiError;
      }
    },
    [reload],
  );

  const connectivity: Connectivity = !online
    ? "offline"
    : channel === "live"
      ? "live"
      : channel === "connecting"
        ? "connecting"
        : "down";

  return useMemo(
    () => ({ state, items, loadError, connectivity, reload, send, retry, dismiss, act }),
    [state, items, loadError, connectivity, reload, send, retry, dismiss, act],
  );
}

/** Re-render once a second for ages and countdowns. */
export function useClock(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
