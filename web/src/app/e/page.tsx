"use client";

// QR/NFC landing: /e?t=<token>. Validates the sticker token, mints the
// per-scan session, then goes straight to work — if this phone remembers
// who's closing (and they're still on the roster), the closer screen is
// skipped entirely.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setCloser, validateToken, TipApiError } from "@/lib/tips/api";
import {
  loadRememberedCloser,
  loadSession,
  saveSession,
  updateSession,
} from "@/lib/tips/session";
import { Splash } from "@/components/entry-flow/chrome";

function TokenLanding() {
  const router = useRouter();
  // Capture the token once (first-render state): the Next router intercepts
  // the history.replaceState that strips ?t=<token>, and a live
  // useSearchParams read would re-run the effect with token=null and bounce
  // the fresh sign-in.
  const liveToken = useSearchParams().get("t");
  const [token] = useState(liveToken);
  const [phase, setPhase] = useState<"checking" | "error">("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) {
      router.replace(loadSession() ? "/entry" : "/");
      return;
    }
    let cancelled = false;
    const signIn = async (): Promise<"entry" | "closer"> => {
      const fresh = await validateToken(token);
      saveSession({
        token: fresh.sessionToken,
        locationId: fresh.location.id,
        locationName: fresh.location.name,
        closerId: null,
        closerName: null,
      });
      // Remembered closer: apply it server-side and skip the roster screen.
      const remembered = loadRememberedCloser(fresh.location.id);
      const stillOnRoster =
        remembered && fresh.roster.some((r) => r.id === remembered.closerId);
      if (remembered && stillOnRoster) {
        try {
          await setCloser(fresh.sessionToken, remembered.closerId);
          updateSession({
            closerId: remembered.closerId,
            closerName: remembered.closerName,
          });
          return "entry";
        } catch {
          // Roster changed under us — fall through to the picker.
        }
      }
      return "closer";
    };
    signIn()
      .then((destination) => {
        if (cancelled) return;
        // Drop ?t=<token> from the address bar/history now that it's used.
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", "/e");
        }
        router.replace(`/${destination}`);
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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 pb-10">
      <div className="rounded-card bg-card p-5 text-center">
        <p className="font-bold text-ink">Couldn&rsquo;t sign you in</p>
        <p className="mt-2 text-ink2">{errorMessage}</p>
      </div>
      <button
        type="button"
        onClick={() => router.push("/")}
        className="mt-6 w-full rounded-full bg-card py-4 font-semibold text-ink active:bg-well"
      >
        Back to scan
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

export default function TokenLandingPage() {
  return (
    <Suspense fallback={<Splash>Checking the sticker&hellip;</Splash>}>
      <TokenLanding />
    </Suspense>
  );
}
