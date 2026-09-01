"use client";

// Bottom toast in the kitchen design language, with an optional action.

import { useEffect } from "react";

export interface ToastState {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function Toast({
  toast,
  onDismiss,
  durationMs = 2600,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [toast, onDismiss, durationMs]);

  if (!toast) return null;
  return (
    <div
      role="status"
      className="kitchen-rise fixed left-1/2 -translate-x-1/2 bottom-6 z-60 bg-ink text-white rounded-full px-4.5 py-3 text-[13px] font-semibold flex items-center gap-3 whitespace-nowrap"
    >
      <span>{toast.text}</span>
      {toast.actionLabel && toast.onAction ? (
        <button
          type="button"
          onClick={() => {
            onDismiss();
            toast.onAction?.();
          }}
          className="text-white font-bold underline"
        >
          {toast.actionLabel}
        </button>
      ) : null}
    </div>
  );
}
