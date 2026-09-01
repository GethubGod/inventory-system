"use client";

// Live request list for one location: initial fetch, realtime feed, polling
// while the feed is down, refetch on reconnect/foreground, replay of sends
// persisted by a previous page load, and the optimistic actions both screens
// use. State transitions are the pure functions in lib/kitchen/state; this
// hook only wires them to Supabase, storage and the clock.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  describeKitchenError,
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
  hydratePending,
  removeServerRow,
  retryPending,
  setUndoWindow,
  startPending,
  type RequestsState,
} from "@/lib/kitchen/state";
import { loadPendingSends, savePendingSends } from "@/lib/kitchen/storage";
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
  act: (
    request: ServerRequest,
    action: UpdateAction,
  ) => Promise<KitchenApiError | null>;
}

function newClientKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Very old WebViews only. Still unique enough for an idempotency key.
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
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
 * Mount one instance per user + location (key the component by both): the
 * list, items, channel and persisted sends all belong to that pair.
 */
export function useKitchenRequests(
  userId: string,
  locationId: string,
): KitchenRequestsApi {
  const [state, setState] = useState<RequestsState>(() =>
    hydratePending(
      EMPTY_STATE,
      loadPendingSends(userId, locationId),
      Date.now(),
    ),
  );
  const [items, setItems] = useState<KitchenItem[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelStatus>("connecting");
  const online = useSyncExternalStore(
    subscribeOnline,
    () => window.navigator.onLine,
    () => true,
  );
  const inFlight = useRef<Set<string>>(new Set());
  const actionChains = useRef<Map<string, Promise<unknown>>>(new Map());
  const replayed = useRef(false);
  // Latest state for event handlers (retry, reload) without re-creating callbacks.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Unacknowledged sends outlive the page (replayed on the next load).
  useEffect(() => {
    savePendingSends(userId, locationId, Object.values(state.pending));
  }, [state.pending, userId, locationId]);

  const reload = useCallback((): Promise<void> => {
    // Anything applied after this point outranks the response (see applyFetch).
    const since = stateRef.current.seq;
    const requests = fetchOpenRequests(locationId).then(
      (rows) => {
        setState((prev) => applyFetch(prev, rows, since));
        setRequestsError(null);
      },
      (error: unknown) => {
        setRequestsError(toKitchenApiError(error).message);
      },
    );
    const catalogue = fetchKitchenItems(locationId).then(
      (nextItems) => {
        setItems(nextItems);
        setItemsError(null);
      },
      (error: unknown) => {
        setItemsError(toKitchenApiError(error).message);
      },
    );
    return Promise.all([requests, catalogue]).then(() => undefined);
  }, [locationId]);

  const runSend = useCallback((pending: PendingRequest) => {
    if (inFlight.current.has(pending.clientKey)) return;
    inFlight.current.add(pending.clientKey);
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
      .catch((error: unknown) => {
        inFlight.current.delete(pending.clientKey);
        const apiError = toKitchenApiError(error);
        setState((prev) =>
          failPending(prev, pending.clientKey, {
            code: apiError.code,
            message: describeKitchenError(apiError),
          }),
        );
      });
  }, []);

  // Initial fetch, realtime feed, and replay of persisted sends.
  useEffect(() => {
    void reload();
    if (!replayed.current) {
      replayed.current = true;
      for (const pending of Object.values(stateRef.current.pending)) {
        if (pending.status === "sending") runSend(pending);
      }
    }
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
  }, [locationId, reload, runSend]);

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
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      void reload();
    }, interval);
    return () => clearInterval(timer);
  }, [channel, reload]);

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
        error: null,
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
      if (
        !current ||
        current.status !== "failed" ||
        inFlight.current.has(clientKey)
      ) {
        return;
      }
      const now = Date.now();
      const attempt: PendingRequest = {
        ...current,
        status: "sending",
        startedAt: now,
        attempts: current.attempts + 1,
        error: null,
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
    (
      request: ServerRequest,
      action: UpdateAction,
    ): Promise<KitchenApiError | null> => {
      // One action at a time per request: a tap and its undo cannot overtake
      // each other on the wire.
      const previous =
        actionChains.current.get(request.id) ?? Promise.resolve();
      const run = previous.then(async () => {
        const now = Date.now();
        const current = stateRef.current.byId[request.id] ?? request;
        // Optimistic local transition. It keeps the server updatedAt it was
        // built from, so the RPC reply (newer) replaces it and any older
        // stray message is ignored.
        let optimistic: ServerRequest;
        switch (action) {
          case "ready":
            optimistic = { ...current, status: "ready", readyAt: now };
            break;
          case "undo_ready":
            optimistic = {
              ...current,
              status: "queued",
              readyAt: null,
              readyByName: null,
            };
            break;
          case "cancel":
            optimistic = { ...current, status: "cancelled", closedAt: now };
            break;
          case "clear":
            optimistic = { ...current, status: "cleared", closedAt: now };
            break;
        }
        setState((prev) => {
          const next = applyServerRow(prev, optimistic);
          return action === "ready"
            ? setUndoWindow(next, request.id, now + UNDO_WINDOW_MS)
            : action === "undo_ready"
              ? clearUndoWindow(next, request.id)
              : next;
        });
        try {
          const row = await updateKitchenRequest(request.id, action);
          setState((prev) => applyServerRow(prev, row));
          return null;
        } catch (error: unknown) {
          const apiError = toKitchenApiError(error);
          // Roll back only if the optimistic row is still what we show;
          // a newer server row that arrived meanwhile is the truth.
          setState((prev) =>
            prev.byId[request.id] === optimistic
              ? clearUndoWindow(applyServerRow(prev, current), request.id)
              : prev,
          );
          void reload();
          return apiError;
        }
      });
      actionChains.current.set(
        request.id,
        run.catch(() => undefined),
      );
      return run;
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

  const loadError = requestsError ?? itemsError;

  return useMemo(
    () => ({
      state,
      items,
      loadError,
      connectivity,
      reload,
      send,
      retry,
      dismiss,
      act,
    }),
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
