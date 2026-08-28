"use client";

// Last-resort render-error boundary: a phone mid-entry must never land on a
// bare framework error. Reset re-renders the segment; home is the scan gate.

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[smelter-tips] unhandled render error", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 pb-10">
      <div className="rounded-card bg-card p-5 text-center">
        <p className="font-bold text-ink">Something went wrong</p>
        <p className="mt-2 text-ink2">
          Try again — if it keeps happening, scan the QR code again or ask a
          manager.
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="mt-6 w-full rounded-full bg-accent py-4 font-semibold text-white"
      >
        Try again
      </button>
      <Link
        href="/"
        className="mt-4 text-center text-ink2 underline"
      >
        Back to scan
      </Link>
    </main>
  );
}
