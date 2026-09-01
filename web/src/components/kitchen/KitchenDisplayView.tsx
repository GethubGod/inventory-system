"use client";

// Kitchen display: the open queue, oldest first. One tap marks a row ready
// (the chef's log flips to READY); the row stays for six seconds with Undo.

import { useCallback, useState } from "react";
import { describeKitchenError } from "@/lib/kitchen/api";
import {
  formatAge,
  formatTag,
  isOldRequest,
  undoSecondsLeft,
} from "@/lib/kitchen/format";
import { kitchenQueueRows } from "@/lib/kitchen/state";
import type { ServerRequest } from "@/lib/kitchen/types";
import Toast, { type ToastState } from "@/components/kitchen/Toast";
import {
  useClock,
  type Connectivity,
  type KitchenRequestsApi,
} from "@/components/kitchen/useKitchenRequests";

function connectionLabel(connectivity: Connectivity): string {
  switch (connectivity) {
    case "live":
      return "Live · connected";
    case "connecting":
      return "Connecting…";
    case "offline":
      return "Offline — showing last known queue";
    case "down":
      return "Reconnecting — checking every few seconds";
  }
}

export default function KitchenDisplayView({
  requests,
}: {
  requests: KitchenRequestsApi;
}) {
  const now = useClock();
  const [toast, setToast] = useState<ToastState | null>(null);
  const rows = kitchenQueueRows(requests.state, now);
  const dismissToast = useCallback(() => setToast(null), []);
  const bad =
    requests.connectivity === "offline" || requests.connectivity === "down";

  async function toggle(row: ServerRequest) {
    const action = row.status === "ready" ? "undo_ready" : "ready";
    const error = await requests.act(row, action);
    if (error) setToast({ text: describeKitchenError(error) });
  }

  return (
    <section>
      <div className="mb-3.5">
        <h1 className="text-[22px] font-bold text-ink">Queue</h1>
        <p className="text-[13px] text-ink2 mt-0.5">
          Oldest first. Tap a row when it’s ready.
        </p>
      </div>

      {requests.loadError && rows.length === 0 ? (
        <div className="bg-card rounded-card p-5 mb-3">
          <p className="text-alert text-sm">{requests.loadError}</p>
          <button
            type="button"
            onClick={() => void requests.reload()}
            className="mt-3 bg-well text-ink2 rounded-full px-4 py-2 text-[13px] font-bold"
          >
            Retry
          </button>
        </div>
      ) : null}

      {rows.length === 0 && !requests.loadError ? (
        <p className="text-center text-sm text-ink3 py-11">
          {requests.items === null
            ? "Loading queue…"
            : "All caught up. New requests appear here instantly."}
        </p>
      ) : null}

      {rows.map((row) => {
        const done = row.status === "ready";
        const age = now - row.createdAt;
        const undoUntil = requests.state.undoUntil[row.id] ?? 0;
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => void toggle(row)}
            aria-label={
              done
                ? `Undo ready for ${row.quantity} ${row.itemName}`
                : `Mark ${row.quantity} ${row.itemName} done`
            }
            className={`w-full rounded-card px-4.5 py-5 mb-2.5 flex items-center justify-between gap-3 text-left transition-colors ${
              done ? "bg-ink" : "bg-card"
            }`}
          >
            <span>
              <span
                className={`text-[23px] font-bold ${done ? "text-white" : "text-ink"}`}
              >
                {row.quantity} × {row.itemName}
              </span>
              <span
                className={`block text-xs mt-[3px] ${done ? "text-white" : "text-ink3"}`}
              >
                {done
                  ? "Done — chef sees READY"
                  : `${row.requestedByName} ${formatTag(row.requestedByTag)}`}
              </span>
            </span>
            {done ? (
              <span className="text-[15px] font-bold text-white underline whitespace-nowrap tabular-nums">
                Undo · {undoSecondsLeft(undoUntil, now)}s
              </span>
            ) : (
              <span
                className={`text-[23px] font-bold tabular-nums ${
                  isOldRequest(age) ? "text-alert" : "text-ink3"
                }`}
              >
                {formatAge(age)}
              </span>
            )}
          </button>
        );
      })}

      <p
        className={`flex items-center justify-center gap-[7px] pt-3.5 text-xs font-semibold ${
          bad ? "text-alert" : "text-ink2"
        }`}
      >
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            bad
              ? "bg-alert"
              : requests.connectivity === "live"
                ? "bg-okgreen"
                : "bg-disabled"
          }`}
        />
        {connectionLabel(requests.connectivity)}
      </p>
      <Toast toast={toast} onDismiss={dismissToast} />
    </section>
  );
}
