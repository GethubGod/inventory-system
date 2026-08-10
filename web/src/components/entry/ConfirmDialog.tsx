"use client";

// Generic centered modal over the dim layer. Used for the anomaly
// "Save anyway?" confirm and the location-switch info dialog. Dismiss only
// via the buttons — tapping the dim layer does nothing (avoids accidental
// loss of context mid-flow).

import type { ReactNode } from "react";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled = false,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-dim flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="bg-card rounded-card p-5 w-full max-w-sm">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        <div className="mt-2 text-ink2 text-sm leading-relaxed">{body}</div>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-full py-3 font-semibold bg-well text-ink"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`flex-1 rounded-full py-3 font-semibold ${
              confirmDisabled ? "bg-disabled text-white" : "bg-accent text-white"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
