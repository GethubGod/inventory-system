// Pure request-list state for the kitchen screens. Server rows (from the
// initial fetch, RPC results, and realtime events) are merged by id; sends
// that the server has not acknowledged live alongside them keyed by the
// idempotency client key. Everything here is deterministic and unit tested;
// the hook in components/kitchen wires it to Supabase.
//
// Ordering rules that keep the picture honest when messages race:
// - Per row, a newer server `updatedAt` always wins (a late RPC reply can
//   never overwrite a realtime event that came after it).
// - A row with an optimistic local write in flight is never replaced by a
//   fetch snapshot; only an individual server row (RPC reply, realtime) or
//   the explicit rollback settles it.
// - Per fetch, a snapshot only outranks rows applied before it was issued
//   (`seq` stamps), and a snapshot from an older fetch generation never
//   replaces a newer one.

import type {
  LogRequest,
  PendingError,
  PendingRequest,
  ServerRequest,
} from "@/lib/kitchen/types";

export interface RequestsState {
  byId: Record<string, ServerRequest>;
  pending: Record<string, PendingRequest>;
  /** id -> epoch ms until which this device shows Undo for a row it marked ready. */
  undoUntil: Record<string, number>;
  /**
   * Monotonic count of individual row updates (RPC results, realtime
   * events, optimistic writes). A fetch records the count it started at, so
   * a slow fetch response can never erase or downgrade a row that arrived
   * while it was in flight. Clock-free: no server/device skew involved.
   */
  seq: number;
  /** id -> seq at which this device last applied an individual update. */
  seenSeq: Record<string, number>;
  /** ids whose local row is an optimistic write awaiting its RPC reply. */
  optimistic: Record<string, true>;
  /** Generation of the most recent fetch applied; older generations are ignored. */
  fetchGen: number;
}

export const EMPTY_STATE: RequestsState = {
  byId: {},
  pending: {},
  undoUntil: {},
  seq: 0,
  seenSeq: {},
  optimistic: {},
  fetchGen: 0,
};

/**
 * Merge a fetch of open rows. `sinceSeq` is `state.seq` from when the fetch
 * was issued and `gen` its issue order; rows updated locally after the
 * fetch started keep their local version, rows created after that survive
 * even when the (stale) fetch omits them, optimistic rows are left alone,
 * and a response from an older generation than one already applied is dropped.
 */
export function applyFetch(
  state: RequestsState,
  rows: ServerRequest[],
  sinceSeq: number = state.seq,
  gen: number = state.fetchGen + 1,
): RequestsState {
  if (gen < state.fetchGen) return state;
  const byId: Record<string, ServerRequest> = {};
  const seenSeq: Record<string, number> = {};
  const keepLocal = (
    id: string,
    local: ServerRequest,
    incoming?: ServerRequest,
  ) =>
    id in state.optimistic ||
    (state.seenSeq[id] ?? 0) > sinceSeq ||
    (incoming !== undefined && local.updatedAt > incoming.updatedAt);
  for (const row of rows) {
    const local = state.byId[row.id];
    if (local && keepLocal(row.id, local, row)) {
      byId[row.id] = local;
      if (row.id in state.seenSeq) seenSeq[row.id] = state.seenSeq[row.id];
    } else {
      byId[row.id] = row;
    }
  }
  for (const [id, local] of Object.entries(state.byId)) {
    if (id in byId) continue;
    if (keepLocal(id, local)) {
      byId[id] = local;
      if (id in state.seenSeq) seenSeq[id] = state.seenSeq[id];
    }
  }
  return {
    byId,
    pending: dropAcknowledged(state.pending, rows),
    undoUntil: pruneUndo(state.undoUntil, byId),
    seq: state.seq,
    seenSeq,
    optimistic: state.optimistic,
    fetchGen: Math.max(gen, state.fetchGen),
  };
}

/**
 * Upsert one server row (RPC result, realtime INSERT/UPDATE). A row older
 * than the one held is ignored. Any server row settles an optimistic write
 * for that id.
 */
export function applyServerRow(
  state: RequestsState,
  row: ServerRequest,
): RequestsState {
  const existing = state.byId[row.id];
  if (existing && existing.updatedAt > row.updatedAt) return state;
  return upsert(state, row, false);
}

/** Upsert an optimistic local transition; fetches leave it alone until settled. */
export function applyOptimisticRow(
  state: RequestsState,
  row: ServerRequest,
): RequestsState {
  return upsert(state, row, true);
}

function upsert(
  state: RequestsState,
  row: ServerRequest,
  optimistic: boolean,
): RequestsState {
  const byId = { ...state.byId, [row.id]: row };
  const seq = state.seq + 1;
  let flags = state.optimistic;
  if (optimistic) flags = { ...flags, [row.id]: true };
  else if (row.id in flags) {
    flags = { ...flags };
    delete flags[row.id];
  }
  return {
    byId,
    pending: dropAcknowledged(state.pending, [row]),
    undoUntil: pruneUndo(state.undoUntil, byId),
    seq,
    seenSeq: { ...state.seenSeq, [row.id]: seq },
    optimistic: flags,
    fetchGen: state.fetchGen,
  };
}

export function removeServerRow(
  state: RequestsState,
  id: string,
): RequestsState {
  if (!(id in state.byId)) return state;
  const byId = { ...state.byId };
  delete byId[id];
  const seenSeq = { ...state.seenSeq };
  delete seenSeq[id];
  const optimistic = { ...state.optimistic };
  delete optimistic[id];
  return {
    byId,
    pending: state.pending,
    undoUntil: pruneUndo(state.undoUntil, byId),
    seq: state.seq + 1,
    seenSeq,
    optimistic,
    fetchGen: state.fetchGen,
  };
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

/**
 * Restore sends persisted by a previous page load. Ones that were still in
 * flight come back as "sending" (the hook replays them); ones the chef had
 * already seen fail stay failed and wait for a manual Retry.
 */
export function hydratePending(
  state: RequestsState,
  pendings: PendingRequest[],
  now: number,
): RequestsState {
  if (pendings.length === 0) return state;
  const pending = { ...state.pending };
  for (const item of pendings) {
    if (item.clientKey in pending) continue;
    pending[item.clientKey] =
      item.status === "failed"
        ? { ...item, startedAt: item.startedAt || item.createdAt }
        : { ...item, status: "sending", startedAt: now, error: null };
  }
  return { ...state, pending };
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
        error: null,
      },
    },
  };
}

export function failPending(
  state: RequestsState,
  clientKey: string,
  error: PendingError,
): RequestsState {
  const current = state.pending[clientKey];
  if (!current || current.status === "failed") return state;
  return {
    ...state,
    pending: {
      ...state.pending,
      [clientKey]: { ...current, status: "failed", error },
    },
  };
}

export function dismissPending(
  state: RequestsState,
  clientKey: string,
): RequestsState {
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

export function clearUndoWindow(
  state: RequestsState,
  id: string,
): RequestsState {
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
  return rows.sort(
    (a, b) => b.createdAt - a.createdAt || keyOf(b).localeCompare(keyOf(a)),
  );
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
  return rows.sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

export function openQueuedCount(state: RequestsState): number {
  let count = 0;
  for (const row of Object.values(state.byId))
    if (row.status === "queued") count += 1;
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
