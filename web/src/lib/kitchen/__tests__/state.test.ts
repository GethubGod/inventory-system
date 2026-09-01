import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE,
  applyFetch,
  applyServerRow,
  chefLogRows,
  clearUndoWindow,
  dismissPending,
  failPending,
  kitchenQueueRows,
  listSignature,
  openQueuedCount,
  removeServerRow,
  retryPending,
  setUndoWindow,
  startPending,
} from "../state";
import type { PendingRequest, ServerRequest } from "../types";

const T0 = 1_700_000_000_000;

function server(overrides: Partial<ServerRequest> = {}): ServerRequest {
  return {
    kind: "server",
    id: "r1",
    clientKey: "k1",
    locationId: "loc",
    itemId: "i1",
    itemName: "Fried Shrimp",
    unit: "pieces",
    quantity: 2,
    requestedBy: "u1",
    requestedByName: "Minh",
    requestedByTag: "minh",
    status: "queued",
    createdAt: T0,
    readyAt: null,
    readyByName: null,
    closedAt: null,
    ...overrides,
  };
}

function pending(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    kind: "pending",
    clientKey: "k9",
    locationId: "loc",
    itemId: "i1",
    itemName: "Fried Shrimp",
    unit: "pieces",
    quantity: 1,
    status: "sending",
    startedAt: T0 + 5_000,
    createdAt: T0 + 5_000,
    attempts: 1,
    ...overrides,
  };
}

describe("send lifecycle", () => {
  it("a pending send disappears once the server row with its key arrives", () => {
    let state = startPending(EMPTY_STATE, pending({ clientKey: "k1" }));
    expect(chefLogRows(state)).toHaveLength(1);
    state = applyServerRow(state, server({ clientKey: "k1" }));
    const rows = chefLogRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("server");
    expect(state.pending).toEqual({});
  });

  it("a realtime insert that beats the RPC reply also clears the pending row", () => {
    let state = startPending(EMPTY_STATE, pending({ clientKey: "k1" }));
    state = applyFetch(state, [server({ clientKey: "k1" })]);
    expect(state.pending).toEqual({});
    expect(Object.keys(state.byId)).toEqual(["r1"]);
  });

  it("retry keeps the same client key and counts attempts", () => {
    let state = startPending(EMPTY_STATE, pending());
    state = failPending(state, "k9");
    expect(state.pending.k9.status).toBe("failed");
    state = retryPending(state, "k9", T0 + 20_000);
    expect(state.pending.k9).toMatchObject({
      status: "sending",
      attempts: 2,
      startedAt: T0 + 20_000,
      createdAt: T0 + 5_000,
      clientKey: "k9",
    });
  });

  it("failing an already failed or unknown key is a no-op", () => {
    const state = failPending(startPending(EMPTY_STATE, pending()), "k9");
    expect(failPending(state, "k9")).toBe(state);
    expect(failPending(state, "nope")).toBe(state);
  });

  it("dismiss drops only the local row", () => {
    let state = startPending(EMPTY_STATE, pending());
    state = applyServerRow(state, server());
    state = dismissPending(state, "k9");
    expect(state.pending).toEqual({});
    expect(Object.keys(state.byId)).toEqual(["r1"]);
    expect(dismissPending(state, "k9")).toBe(state);
  });
});

describe("stale fetches", () => {
  it("a fetch issued before a row arrived cannot erase that row", () => {
    // Fetch starts (seq 0), then the RPC result lands, then the empty
    // fetch response arrives.
    let state = EMPTY_STATE;
    const since = state.seq;
    state = applyServerRow(state, server({ id: "new" }));
    state = applyFetch(state, [], since);
    expect(Object.keys(state.byId)).toEqual(["new"]);
    // A fetch issued after the row was applied is authoritative again.
    state = applyFetch(state, [], state.seq);
    expect(state.byId).toEqual({});
  });

  it("a fetch issued before an optimistic update cannot downgrade it", () => {
    let state = applyFetch(EMPTY_STATE, [server({ id: "a" })]);
    const since = state.seq;
    state = setUndoWindow(
      applyServerRow(state, server({ id: "a", status: "ready" })),
      "a",
      T0 + 6_000,
    );
    state = applyFetch(state, [server({ id: "a", status: "queued" })], since);
    expect(state.byId.a.status).toBe("ready");
    expect(state.undoUntil.a).toBe(T0 + 6_000);
    // The next fresh fetch wins.
    state = applyFetch(
      state,
      [server({ id: "a", status: "queued" })],
      state.seq,
    );
    expect(state.byId.a.status).toBe("queued");
    expect(state.undoUntil).toEqual({});
  });

  it("removeServerRow forgets the row's sequence stamp", () => {
    let state = applyServerRow(EMPTY_STATE, server({ id: "x" }));
    state = removeServerRow(state, "x");
    expect(state.seenSeq).toEqual({});
  });
});

describe("chefLogRows", () => {
  it("lists open server rows and pending sends newest first, hides closed rows", () => {
    let state = applyFetch(EMPTY_STATE, [
      server({ id: "old", createdAt: T0 - 100 }),
      server({ id: "ready", status: "ready", createdAt: T0 + 100 }),
      server({ id: "gone", status: "cleared", createdAt: T0 + 200 }),
      server({ id: "cancelled", status: "cancelled", createdAt: T0 + 300 }),
    ]);
    state = startPending(
      state,
      pending({ clientKey: "p", createdAt: T0 + 50 }),
    );
    expect(
      chefLogRows(state).map((row) =>
        row.kind === "server" ? row.id : row.clientKey,
      ),
    ).toEqual(["ready", "p", "old"]);
  });
});

describe("kitchenQueueRows", () => {
  it("shows queued rows oldest first and ready rows only during this device's undo window", () => {
    let state = applyFetch(EMPTY_STATE, [
      server({ id: "b", createdAt: T0 + 10 }),
      server({ id: "a", createdAt: T0 }),
      server({ id: "mine", status: "ready", readyAt: T0 + 20 }),
      server({ id: "theirs", status: "ready", readyAt: T0 + 20 }),
    ]);
    state = setUndoWindow(state, "mine", T0 + 6_000);
    expect(kitchenQueueRows(state, T0 + 1_000).map((r) => r.id)).toEqual([
      "a",
      "mine",
      "b",
    ]);
    expect(kitchenQueueRows(state, T0 + 6_001).map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(openQueuedCount(state)).toBe(2);
  });

  it("drops the undo window when the row leaves the ready state", () => {
    let state = applyFetch(EMPTY_STATE, [server({ id: "x", status: "ready" })]);
    state = setUndoWindow(state, "x", T0 + 6_000);
    state = applyServerRow(state, server({ id: "x", status: "cleared" }));
    expect(state.undoUntil).toEqual({});
    state = setUndoWindow(state, "x", T0 + 6_000);
    state = clearUndoWindow(state, "x");
    expect(state.undoUntil).toEqual({});
    expect(clearUndoWindow(state, "x")).toBe(state);
  });

  it("removeServerRow forgets a row and its undo window", () => {
    let state = applyFetch(EMPTY_STATE, [server({ id: "x", status: "ready" })]);
    state = setUndoWindow(state, "x", T0 + 6_000);
    state = removeServerRow(state, "x");
    expect(state.byId).toEqual({});
    expect(state.undoUntil).toEqual({});
    expect(removeServerRow(state, "x")).toBe(state);
  });
});

describe("listSignature", () => {
  it("changes only when list membership, status, undo, or attempts change", () => {
    let state = applyFetch(EMPTY_STATE, [server({ id: "a" })]);
    const base = listSignature(state, T0);
    expect(listSignature(state, T0 + 59_000)).toBe(base);
    state = applyServerRow(state, server({ id: "a", status: "ready" }));
    const ready = listSignature(state, T0);
    expect(ready).not.toBe(base);
    state = setUndoWindow(state, "a", T0 + 6_000);
    expect(listSignature(state, T0)).not.toBe(ready);
    expect(listSignature(state, T0 + 7_000)).toBe(ready);
    state = startPending(state, pending());
    const withPending = listSignature(state, T0);
    state = retryPending(state, "k9", T0);
    expect(listSignature(state, T0)).not.toBe(withPending);
  });
});
