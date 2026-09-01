"use client";

// Chef phone: item grid, request sheet, live log of everything open at this
// location. Every row is stamped with who sent it (name and @tag) and when.

import { useCallback, useState } from "react";
import { describeKitchenError } from "@/lib/kitchen/api";
import { describeRequest, formatAge, formatTag } from "@/lib/kitchen/format";
import { chefLogRows } from "@/lib/kitchen/state";
import type { KitchenItem, LogRequest, ServerRequest } from "@/lib/kitchen/types";
import RequestSheet from "@/components/kitchen/RequestSheet";
import Toast, { type ToastState } from "@/components/kitchen/Toast";
import { useClock, type KitchenRequestsApi } from "@/components/kitchen/useKitchenRequests";

function Pill({ tone, children }: { tone: "sent" | "sending" | "ready"; children: string }) {
  const classes =
    tone === "ready"
      ? "bg-ink text-white"
      : tone === "sending"
        ? "bg-well text-ink3"
        : "bg-well text-ink2";
  return (
    <span
      className={`rounded-full px-3 py-1.5 text-[11px] font-bold tracking-wide whitespace-nowrap ${classes}`}
    >
      {children}
    </span>
  );
}

function LogRow({
  row,
  now,
  selfUserId,
  canManage,
  onRetry,
  onDismiss,
  onCancel,
  onClear,
}: {
  row: LogRequest;
  now: number;
  selfUserId: string;
  canManage: boolean;
  onRetry: (clientKey: string) => void;
  onDismiss: (clientKey: string) => void;
  onCancel: (request: ServerRequest) => void;
  onClear: (request: ServerRequest) => void;
}) {
  const title = `${row.quantity} ${row.itemName}`;
  if (row.kind === "pending") {
    return (
      <div className="flex items-center gap-2.5 py-3 border-b border-hairline last:border-b-0">
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-ink">{title}</p>
          {row.status === "failed" ? (
            <p className="text-xs font-semibold text-alert mt-0.5 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
              Didn’t send — kitchen never saw this
            </p>
          ) : (
            <p className="text-xs text-ink3 mt-0.5 tabular-nums">
              {formatAge(now - row.createdAt)} ago · You
            </p>
          )}
        </div>
        {row.status === "failed" ? (
          <>
            <button
              type="button"
              onClick={() => onRetry(row.clientKey)}
              className="bg-accent text-white rounded-full px-[15px] py-2.5 text-[13px] font-bold"
            >
              Retry
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => onDismiss(row.clientKey)}
              className="w-[30px] h-[30px] rounded-full bg-well text-ink2 flex items-center justify-center text-sm shrink-0"
            >
              ✕
            </button>
          </>
        ) : (
          <Pill tone="sending">SENDING…</Pill>
        )}
      </div>
    );
  }

  const mine = row.requestedBy === selfUserId;
  const canChange = mine || canManage;
  const who = mine ? "You" : `${row.requestedByName} ${formatTag(row.requestedByTag)}`;
  return (
    <div className="flex items-center gap-2.5 py-3 border-b border-hairline last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold text-ink">{title}</p>
        {row.status === "ready" ? (
          <p className="text-xs text-ink3 mt-0.5">
            Ready — go grab it{row.readyByName ? ` · ${row.readyByName}` : ""}
          </p>
        ) : (
          <p className="text-xs text-ink3 mt-0.5 tabular-nums">
            {formatAge(now - row.createdAt)} ago · {who}
          </p>
        )}
      </div>
      {row.status === "ready" ? (
        <>
          <Pill tone="ready">READY</Pill>
          {canChange ? (
            <button
              type="button"
              onClick={() => onClear(row)}
              className="bg-well text-ink2 rounded-full px-[15px] py-2.5 text-[13px] font-bold"
            >
              Got it
            </button>
          ) : null}
        </>
      ) : (
        <>
          <Pill tone="sent">SENT</Pill>
          {canChange ? (
            <button
              type="button"
              aria-label={`Cancel ${describeRequest(row.quantity, row.itemName)}`}
              onClick={() => onCancel(row)}
              className="w-[30px] h-[30px] rounded-full bg-well text-ink2 flex items-center justify-center text-sm shrink-0"
            >
              ✕
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function ChefView({
  requests,
  selfUserId,
  canManage,
}: {
  requests: KitchenRequestsApi;
  selfUserId: string;
  canManage: boolean;
}) {
  const now = useClock();
  const [sheetItem, setSheetItem] = useState<KitchenItem | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const rows = chefLogRows(requests.state);
  const closeSheet = useCallback(() => setSheetItem(null), []);
  const dismissToast = useCallback(() => setToast(null), []);

  async function cancel(request: ServerRequest) {
    const error = await requests.act(request, "cancel");
    setToast({
      text: error
        ? describeKitchenError(error)
        : `Cancelled ${describeRequest(request.quantity, request.itemName)}`,
    });
  }

  async function clear(request: ServerRequest) {
    const error = await requests.act(request, "clear");
    if (error) setToast({ text: describeKitchenError(error) });
  }

  return (
    <section>
      <div className="mb-3.5">
        <h1 className="text-[22px] font-bold text-ink">Kitchen request</h1>
        <p className="text-[13px] text-ink2 mt-0.5">Tap an item, pick a quantity, confirm.</p>
      </div>

      {requests.items === null && !requests.loadError ? (
        <p className="text-ink3 text-sm py-6 text-center">Loading items…</p>
      ) : requests.loadError && !requests.items ? (
        <div className="bg-card rounded-card p-5 mb-4">
          <p className="text-alert text-sm">{requests.loadError}</p>
          <button
            type="button"
            onClick={() => void requests.reload()}
            className="mt-3 bg-well text-ink2 rounded-full px-4 py-2 text-[13px] font-bold"
          >
            Retry
          </button>
        </div>
      ) : requests.items && requests.items.length === 0 ? (
        <div className="bg-card rounded-card p-5 mb-4">
          <p className="text-ink2 text-sm">
            No items yet. A manager adds them under Dashboard → Kitchen.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          {requests.items?.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSheetItem(item)}
              className="bg-card rounded-card px-3.5 py-5.5 text-left min-h-[84px] flex flex-col justify-center gap-[3px]"
            >
              <span className="text-base font-bold text-ink">{item.name}</span>
              <span className="text-xs text-ink3">Tap to request</span>
            </button>
          ))}
        </div>
      )}

      <div className="bg-card rounded-card px-4 pt-4 pb-2">
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="section-label">Live log</span>
          <span className="text-[13px] text-ink3">{rows.length ? `${rows.length} open` : ""}</span>
        </div>
        {rows.length === 0 ? (
          <p className="text-center text-[13px] text-ink3 pt-5 pb-6.5">
            Nothing requested right now.
          </p>
        ) : (
          rows.map((row) => (
            <LogRow
              key={row.kind === "server" ? row.id : row.clientKey}
              row={row}
              now={now}
              selfUserId={selfUserId}
              canManage={canManage}
              onRetry={requests.retry}
              onDismiss={requests.dismiss}
              onCancel={(request) => void cancel(request)}
              onClear={(request) => void clear(request)}
            />
          ))
        )}
      </div>

      <RequestSheet
        key={sheetItem?.id ?? "closed"}
        item={sheetItem}
        state={requests.state}
        onSend={requests.send}
        onRetry={requests.retry}
        onClose={closeSheet}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </section>
  );
}
