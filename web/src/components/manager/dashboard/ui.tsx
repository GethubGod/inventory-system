"use client";

// Small shared pieces of the Tip Dashboard: the mockup's pill buttons and
// table styles as class constants, the ⓘ info popover, the toast, location
// chips, and a centered confirm/edit dialog.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LocationInfo } from "./types";

/* ---------- class recipes (mockup v2 "App style") ---------- */

export const btn =
  "rounded-full bg-well px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:brightness-95";
export const btnPrim =
  "rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white hover:brightness-95";
export const btnDanger =
  "rounded-full bg-flagtint px-3.5 py-1.5 text-[13px] font-semibold text-alert hover:brightness-95";
export const miniBtn =
  "rounded-full border border-line bg-card px-[11px] py-1 text-xs font-semibold text-ink hover:border-ink3";
export const miniBtnDanger =
  "rounded-full border border-alert/40 bg-card px-[11px] py-1 text-xs font-semibold text-alert hover:border-alert";
export const panelWrap = "overflow-hidden rounded-card border border-line bg-card";
export const th =
  "whitespace-nowrap border-b border-line bg-card px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink2";
export const td = "whitespace-nowrap border-b border-hairline px-3 py-2 align-middle";
export const sectionH3 = "text-[15px] font-extrabold tracking-[-0.01em] text-ink";

/* ---------- location chip ---------- */

/** Strong row identity: black Sushi chip, blue Poki & Pho chip. */
export function LocationChip({
  location,
  short = false,
}: {
  location: LocationInfo;
  short?: boolean;
}) {
  const color =
    location.kind === "poki" ? "bg-poki" : location.kind === "sushi" ? "bg-ink" : "bg-ink2";
  return (
    <span
      className={`inline-block rounded-md px-2 py-px text-xs font-bold text-white ${color}`}
    >
      {short ? location.shortLabel : location.label}
    </span>
  );
}

/* ---------- toast ---------- */

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    setMessage(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-[26px] left-1/2 z-[90] -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-[18px] py-[9px] text-[13px] font-semibold text-white transition-opacity duration-200 ${
          message ? "opacity-100" : "opacity-0"
        }`}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- info popover ---------- */

/**
 * The ⓘ button. All explanatory copy lives behind these — never as visible
 * paragraphs on the page.
 */
export { InfoButton } from "@/components/InfoButton";

/* ---------- centered modal ---------- */

export function ModalShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-dim p-5"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} rounded-card bg-card p-5`}
      >
        <h4 className="text-[15px] font-extrabold text-ink">{title}</h4>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busyLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalShell title={title} onClose={busy ? () => {} : onCancel}>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink2">{body}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btn} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={btnDanger} onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
