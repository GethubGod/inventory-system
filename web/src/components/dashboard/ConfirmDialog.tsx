"use client";

// Minimal confirm dialog in the Babytuna design language (flat card over dim).

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-dim flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-card rounded-card p-6 w-full max-w-sm flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-ink font-bold">{title}</p>
        <p className="text-ink2 text-sm">{body}</p>
        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-ink2 bg-well"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-full px-5 py-2.5 text-sm font-semibold text-white ${
              busy ? "bg-disabled" : destructive ? "bg-alert" : "bg-accent"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
