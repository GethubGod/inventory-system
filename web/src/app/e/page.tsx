"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  validateToken,
  TipApiError,
  type FreshSignIn,
} from "@/lib/tips/api";
import { loadSession, saveSession } from "@/lib/tips/session";
import { formatBusinessDate } from "@/lib/tips/businessDate";
import { Splash } from "@/components/entry-flow/chrome";

function todayStatusLine(signIn: FreshSignIn): string {
  const { today } = signIn;
  const date = formatBusinessDate(today.businessDate);
  const status =
    today.defaultMeal === "dinner"
      ? today.dinnerRecorded
        ? "Dinner recorded"
        : "Dinner not yet recorded"
      : today.lunchRecorded
        ? "Lunch recorded"
        : "Lunch not yet recorded";
  return `${date} · ${status}`;
}

function TokenLanding() {
  const router = useRouter();
  // Capture the token once (first-render state): the Next router intercepts
  // the history.replaceState that strips ?t=<token>, and a live
  // useSearchParams read would re-run the effect with token=null and bounce
  // the fresh sign-in straight past the "You're in" confirmation.
  const liveToken = useSearchParams().get("t");
  const [token] = useState(liveToken);
  const [phase, setPhase] = useState<"checking" | "in" | "error">("checking");
  const [signIn, setSignIn] = useState<FreshSignIn | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) {
      router.replace(loadSession() ? "/entry" : "/");
      return;
    }
    let cancelled = false;
    validateToken(token)
      .then((fresh) => {
        if (cancelled) return;
        // Drop ?t=<token> from the address bar/history now that it's used.
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", "/e");
        }
        saveSession({
          token: fresh.sessionToken,
          locationId: fresh.location.id,
          locationName: fresh.location.name,
          closerId: null,
          closerName: null,
        });
        setSignIn(fresh);
        setPhase("in");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          err instanceof TipApiError && err.code === "rate_limited"
            ? err.message
            : "This QR code is no longer active. Ask a manager for the new sticker.",
        );
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [token, router, attempt]);

  const retry = () => {
    setPhase("checking");
    setErrorMessage(null);
    setAttempt((n) => n + 1);
  };

  if (phase === "checking") {
    return <Splash>Checking the sticker&hellip;</Splash>;
  }

  if (phase === "error") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 pb-10">
        <div className="rounded-card bg-card p-5 text-center">
          <p className="font-bold text-ink">Couldn&rsquo;t sign you in</p>
          <p className="mt-2 text-ink2">{errorMessage}</p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/pin")}
          className="mt-6 w-full rounded-full bg-card py-4 font-semibold text-ink active:bg-well"
        >
          Enter PIN instead
        </button>
        <button
          type="button"
          onClick={retry}
          className="mt-4 text-center text-ink2 underline"
        >
          Try again
        </button>
      </main>
    );
  }

  // phase === "in" — fresh sign-in confirmation.
  if (!signIn) return null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-20">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-tint text-accent">
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 15l7 7L24 7" />
          </svg>
        </span>
        <h1 className="mt-5 text-3xl font-bold text-ink">You&rsquo;re in</h1>
        <p className="mt-2 text-ink2">This phone will stay signed in</p>
      </div>

      <div className="mt-8 rounded-card bg-card p-5">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
          <p className="font-bold text-ink">{signIn.location.name}</p>
        </div>
        <p className="mt-1 pl-5 text-ink2">{todayStatusLine(signIn)}</p>
      </div>

      <button
        type="button"
        onClick={() => router.push("/pin")}
        className="mt-5 text-center text-ink2 underline"
      >
        Not {signIn.location.name}? Switch location
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => router.push("/closer")}
        className="mt-10 w-full rounded-full bg-accent py-4 font-semibold text-white active:opacity-90"
      >
        Enter tonight&rsquo;s tips →
      </button>
    </main>
  );
}

export default function TokenLandingPage() {
  return (
    <Suspense fallback={<Splash>Checking the sticker&hellip;</Splash>}>
      <TokenLanding />
    </Suspense>
  );
}
