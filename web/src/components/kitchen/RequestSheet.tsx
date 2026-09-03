"use client";

// Bottom sheet: pick a quantity, send, watch it land. The sheet's state is
// derived from the request store (pending row for this client key, or the
// server row that replaced it), so a realtime insert that arrives before the
// RPC reply still flips the sheet to "Sent".

import { useEffect, useState } from "react";
import { describeRequest } from "@/lib/kitchen/format";
import type { RequestsState } from "@/lib/kitchen/state";
import { isRetryableSendError, type KitchenItem } from "@/lib/kitchen/types";

const SLOW_NOTE_MS = 1_500;
const SUCCESS_CLOSE_MS = 1_100;
const MAX_QUANTITY = 999;

type SheetPhase = "idle" | "sending" | "success" | "failed";

function phaseFor(state: RequestsState, clientKey: string | null): SheetPhase {
  if (!clientKey) return "idle";
  const pending = state.pending[clientKey];
  if (pending) return pending.status === "sending" ? "sending" : "failed";
  for (const row of Object.values(state.byId)) {
    if (row.clientKey === clientKey) return "success";
  }
  // Dismissed from the log while the sheet was open: treat as idle.
  return "idle";
}

/**
 * Mount a fresh instance per open (the parent keys this by item id): the
 * quantity, client key and timers belong to one sheet session.
 */
export default function RequestSheet({
  item,
  state,
  onSend,
  onRetry,
  onDismiss,
  onClose,
}: {
  item: KitchenItem | null;
  state: RequestsState;
  onSend: (item: KitchenItem, quantity: number) => string;
  onRetry: (clientKey: string) => void;
  onDismiss: (clientKey: string) => void;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [clientKey, setClientKey] = useState<string | null>(null);
  const [popKey, setPopKey] = useState(0);
  /** Attempt ("clientKey:attempts") that has been in flight for 1.5 s. */
  const [slowAttempt, setSlowAttempt] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());

  const phase = phaseFor(state, clientKey);
  const busy = phase === "sending";
  const pending = clientKey ? state.pending[clientKey] : undefined;
  const sentQuantity = pending?.quantity ?? quantity;
  const attemptId = pending ? `${pending.clientKey}:${pending.attempts}` : null;
  const showSlowNote = busy && attemptId !== null && slowAttempt === attemptId;
  const failure = phase === "failed" ? (pending?.error ?? null) : null;
  const retryable = failure ? isRetryableSendError(failure.code) : true;

  // "Taking longer than usual" after 1.5 s of sending.
  useEffect(() => {
    if (phase !== "sending" || !pending || !attemptId) return;
    const remaining = Math.max(
      0,
      SLOW_NOTE_MS - (Date.now() - pending.startedAt),
    );
    const timer = setTimeout(() => setSlowAttempt(attemptId), remaining);
    return () => clearTimeout(timer);
  }, [phase, pending, attemptId]);

  // Auto-close after the success panel.
  useEffect(() => {
    if (phase !== "success") return;
    const timer = setTimeout(onClose, SUCCESS_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [phase, onClose]);

  if (!item) return null;

  function bump(delta: number) {
    setQuantity((q) => Math.min(MAX_QUANTITY, Math.max(1, q + delta)));
    setPopKey((k) => k + 1);
  }

  function handleSend() {
    if (!item || busy) return;
    if (phase === "failed" && clientKey) {
      if (retryable) onRetry(clientKey);
      else {
        // Nothing was stored and retrying cannot help: drop it and start over.
        onDismiss(clientKey);
        onClose();
      }
      return;
    }
    setClientKey(onSend(item, quantity));
  }

  function requestClose() {
    if (busy) return;
    onClose();
  }

  const description = describeRequest(sentQuantity, item.name);

  return (
    <div
      className="kitchen-fade fixed inset-0 z-50 bg-dim flex items-end justify-center"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        if (Date.now() - openedAt < 250) return;
        requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kitchen-sheet-title"
        className="kitchen-rise w-full max-w-[430px] bg-cream rounded-t-sheet px-4.5 pt-3.5 pb-[calc(22px+env(safe-area-inset-bottom))]"
      >
        <div className="w-9 h-1 bg-disabled rounded-full mx-auto mb-4" />
        <div className="flex justify-between items-start mb-3.5">
          <div>
            <h2
              id="kitchen-sheet-title"
              className="text-[22px] font-bold text-ink"
            >
              {item.name}
            </h2>
            <p className="text-xs text-ink2 mt-0.5">
              Sends to the kitchen instantly
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={requestClose}
            className={`w-[34px] h-[34px] rounded-full bg-card text-ink2 flex items-center justify-center text-[15px] ${
              busy ? "opacity-35" : ""
            }`}
          >
            ✕
          </button>
        </div>

        {phase === "idle" || phase === "sending" ? (
          <div
            className={`bg-card rounded-card px-4 py-4.5 mb-3 ${
              busy ? "opacity-45 pointer-events-none" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => bump(-1)}
                className="w-14 h-14 rounded-full bg-well flex items-center justify-center text-[26px] font-semibold text-ink"
                style={{ opacity: quantity <= 1 ? 0.35 : 1 }}
              >
                −
              </button>
              <div className="text-center">
                <div
                  key={popKey}
                  className="value-pop text-[52px] font-bold leading-none tabular-nums text-ink"
                  aria-live="polite"
                >
                  {quantity}
                </div>
                <div className="text-xs text-ink2 mt-1">{item.unit}</div>
              </div>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => bump(1)}
                className="w-14 h-14 rounded-full bg-well flex items-center justify-center text-[26px] font-semibold text-ink"
              >
                +
              </button>
            </div>
            <div className="flex gap-1.5 mt-4">
              {[1, 5, 10].map((step) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => bump(step)}
                  className="flex-1 bg-well rounded-full py-2.5 text-[13px] font-semibold text-ink2"
                >
                  +{step}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-card rounded-card px-4 py-6.5 mb-3 text-center">
            {phase === "success" ? (
              <>
                <div
                  aria-hidden
                  className="w-16 h-16 rounded-full bg-ink text-white text-3xl flex items-center justify-center mx-auto mb-3"
                >
                  ✓
                </div>
                <p className="text-xl font-bold text-ink">
                  Sent — {description}
                </p>
                <p className="text-[13px] text-ink2 mt-1">
                  On the kitchen display now
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-alert flex items-center justify-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" />
                  Didn’t send — {description}
                </p>
                <p className="text-[13px] text-ink2 mt-1.5">
                  {failure?.message ??
                    "The kitchen never saw this. Check Wi‑Fi and retry."}
                </p>
              </>
            )}
          </div>
        )}

        {phase !== "success" ? (
          <button
            type="button"
            disabled={busy}
            onClick={handleSend}
            className={`w-full rounded-full px-5 py-[17px] text-base font-bold text-white flex items-center justify-center gap-2 ${
              busy ? "bg-ink" : "bg-accent"
            }`}
          >
            {busy ? (
              <>
                <span aria-hidden className="kitchen-spin" /> Sending to
                kitchen…
              </>
            ) : phase === "failed" ? (
              retryable ? (
                "Retry now"
              ) : (
                "OK"
              )
            ) : (
              <>
                Send {describeRequest(quantity, item.name)}{" "}
                <span aria-hidden>→</span>
              </>
            )}
          </button>
        ) : null}
        {showSlowNote ? (
          <p
            role="status"
            className="text-center text-[13px] font-semibold text-alert mt-2.5"
          >
            Taking longer than usual — still trying…
          </p>
        ) : null}
      </div>
    </div>
  );
}
