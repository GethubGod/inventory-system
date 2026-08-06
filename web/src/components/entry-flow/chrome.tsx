"use client";

import type { ReactNode } from "react";

/** Top-right circular white escape hatch used across the sign-in flow. */
export function CloseButton({
  onClick,
  label = "Close",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink2 active:bg-well"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M3 3l10 10M13 3L3 13" />
      </svg>
    </button>
  );
}

/** Full-height centered transitional state on cream. */
export function Splash({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center px-5">
      <p className="text-center text-ink2">{children}</p>
    </main>
  );
}
