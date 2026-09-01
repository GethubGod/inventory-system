"use client";

// Small "i" button that opens a plain-language popover. Shared by the manager
// dashboard and the phone entry flow so hints live behind one tap instead of
// taking up space on the screen.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function InfoButton({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (buttonRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) {
            const width = Math.min(320, window.innerWidth - 32);
            const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
            // Open upward when the trigger sits in the bottom quarter of the
            // screen so the text cannot land below the fold.
            const openUp = rect.bottom > window.innerHeight * 0.75;
            setPos(
              openUp
                ? { left, bottom: window.innerHeight - rect.top + 8 }
                : { left, top: rect.bottom + 8 },
            );
          }
          setOpen((value) => !value);
        }}
        className={`h-5 w-5 flex-none rounded-full border border-line font-serif text-[11px] font-extrabold italic leading-none text-ink3 hover:border-ink3 hover:text-ink ${className}`}
      >
        i
      </button>
      {open && pos && (
        <div
          role="dialog"
          className="fixed z-[80] w-[min(320px,calc(100vw-32px))] rounded-[14px] border border-line bg-card px-3.5 py-3 text-[13px] leading-relaxed text-ink2 shadow-[0_6px_24px_rgba(16,20,28,0.16)] [&_b]:text-ink"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
        >
          {children}
        </div>
      )}
    </>
  );
}
