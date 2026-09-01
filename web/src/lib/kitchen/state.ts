// Pure request-list state for the kitchen screens. Server rows (from the
// initial fetch, RPC results, and realtime events) are merged by id; sends
// that the server has not acknowledged live alongside them keyed by the
// idempotency client key. Everything here is deterministic and unit tested;
// the hook in components/kitchen wires it to Supabase.

import type {
  LogRequest,
  PendingRequest,
  ServerRequest,
} from "@/lib/kitchen/types";

export interface RequestsState {
  byId: Record<string, ServerRequest>;
  pending: Record<string, PendingRequest>;
  /** id -> epoch ms until which this device shows Undo for a row it marked ready. */
  undoUntil: Record<string, number>;
}

export const EMPTY_STATE: RequestsState = { byId: {}, pending: {}, undoUntil: {} };

/** Replace the server picture with a fresh fetch of open rows. */
export function applyFetch(
  state: RequestsState,
  rows: ServerRequest[],
): RequestsState {
  const byId: Record<string, ServerRequest> = {};
  for (const row of rows) byId[row.id] = row;
  return {
    byId,
    pending: dropAcknowledged(state.pending, rows),
    undoUntil: pruneUndo(state.undoUntil, byId),
  };
}

/** Upsert one server row (RPC result or realtime INSERT/UPDATE). */
export function applyServerRow(
  state: RequestsState,
  row: ServerRequest,
): RequestsState {
  const byId = { ...state.byId, [row.id]: row };
  return {
    byId,
    pending: dropAcknowledged(state.pending, [row]),
    undoUntil: pruneUndo(state.undoUntil, byId),
  };
}

export function removeServerRow(state: RequestsState, id: string): RequestsState {
  if (!(id in state.byId)) return state;
  const byId = { ...state.byId };
  delete byId[id];
  return { byId, pending: state.pending, undoUntil: pruneUndo(state.undoUntil, byId) };
}

export function startPending(
  state: RequestsState,
  pending: PendingRequest,
): RequestsState {
  return {
    ...state,
    pending: { ...state.pending, [pending.clientKey]: pending },
  };
}

/** A new attempt on an existing pending row (same client key). */
export function retryPending(
  state: RequestsState,
  clientKey: string,
  now: number,
): RequestsState {
  const current = state.pending[clientKey];
  if (!current) return state;
  return {
    ...state,
    pending: {
      ...state.pending,
      [clientKey]: {
        ...current,
        status: "sending",
        startedAt: now,
        attempts: current.attempts + 1,
      },
    },
  };
}

export function failPending(state: RequestsState, clientKey: string): RequestsState {
  const current = state.pending[clientKey];
  if (!current || current.status === "failed") return state;
  return {
    ...state,
    pending: { ...state.pending, [clientKey]: { ...current, status: "failed" } },
  };
}

export function dismissPending(state: RequestsState, clientKey: string): RequestsState {
  if (!(clientKey in state.pending)) return state;
  const pending = { ...state.pending };
  delete pending[clientKey];
  return { ...state, pending };
}

export function setUndoWindow(
  state: RequestsState,
  id: string,
  until: number,
): RequestsState {
  return { ...state, undoUntil: { ...state.undoUntil, [id]: until } };
}

export function clearUndoWindow(state: RequestsState, id: string): RequestsState {
  if (!(id in state.undoUntil)) return state;
  const undoUntil = { ...state.undoUntil };
  delete undoUntil[id];
  return { ...state, undoUntil };
}

/**
 * Chef log: everything still open at this location (queued, ready) plus this
 * device's unacknowledged sends, newest first. Pending rows sort by the
 * moment Send was tapped so a retry does not jump the queue.
 */
export function chefLogRows(state: RequestsState): LogRequest[] {
  const rows: LogRequest[] = [];
  for (const row of Object.values(state.byId)) {
    if (row.status === "queued" || row.status === "ready") rows.push(row);
  }
  for (const pending of Object.values(state.pending)) rows.push(pending);
  return rows.sort((a, b) => b.createdAt - a.createdAt || keyOf(b).localeCompare(keyOf(a)));
}

/**
 * Kitchen queue: queued rows oldest first, plus rows this device marked
 * ready while their Undo window is still open.
 */
export function kitchenQueueRows(
  state: RequestsState,
  now: number,
): ServerRequest[] {
  const rows: ServerRequest[] = [];
  for (const row of Object.values(state.byId)) {
    if (row.status === "queued") rows.push(row);
    else if (row.status === "ready" && (state.undoUntil[row.id] ?? 0) > now) {
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function openQueuedCount(state: RequestsState): number {
  let count = 0;
  for (const row of Object.values(state.byId)) if (row.status === "queued") count += 1;
  return count;
}

/**
 * A stable signature of what the lists render. The screens re-render only
 * when this changes; the per-second clock tick updates ages in place so a
 * tap never lands on a row that was just torn down.
 */
export function listSignature(state: RequestsState, now: number): string {
  const parts: string[] = [];
  for (const row of Object.values(state.byId)) {
    const undo = (state.undoUntil[row.id] ?? 0) > now ? "u" : "";
    parts.push(`${row.id}:${row.status}${undo}`);
  }
  for (const pending of Object.values(state.pending)) {
    parts.push(`${pending.clientKey}:${pending.status}:${pending.attempts}`);
  }
  return parts.sort().join("|");
}

function keyOf(row: LogRequest): string {
  return row.kind === "server" ? row.id : row.clientKey;
}

function dropAcknowledged(
  pending: Record<string, PendingRequest>,
  rows: ServerRequest[],
): Record<string, PendingRequest> {
  let next: Record<string, PendingRequest> | null = null;
  for (const row of rows) {
    if (row.clientKey in pending) {
      next ??= { ...pending };
      delete next[row.clientKey];
    }
  }
  return next ?? pending;
}

function pruneUndo(
  undoUntil: Record<string, number>,
  byId: Record<string, ServerRequest>,
): Record<string, number> {
  let next: Record<string, number> | null = null;
  for (const id of Object.keys(undoUntil)) {
    const row = byId[id];
    if (!row || row.status !== "ready") {
      next ??= { ...undoUntil };
      delete next[id];
    }
  }
  return next ?? undoUntil;
}
