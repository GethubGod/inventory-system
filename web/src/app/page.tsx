"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchState, isSessionInvalid } from "@/lib/tips/api";
import { clearSession, loadSession } from "@/lib/tips/session";
import { Splash } from "@/components/entry-flow/chrome";

function QrIcon() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden
    >
      <rect x="6" y="6" width="16" height="16" rx="3" />
      <rect x="34" y="6" width="16" height="16" rx="3" />
      <rect x="6" y="34" width="16" height="16" rx="3" />
      <rect x="11.5" y="11.5" width="5" height="5" fill="currentColor" stroke="none" />
      <rect x="39.5" y="11.5" width="5" height="5" fill="currentColor" stroke="none" />
      <rect x="11.5" y="39.5" width="5" height="5" fill="currentColor" stroke="none" />
      <rect x="34" y="34" width="6" height="6" fill="currentColor" stroke="none" />
      <rect x="44" y="34" width="6" height="6" fill="currentColor" stroke="none" />
      <rect x="34" y="44" width="6" height="6" fill="currentColor" stroke="none" />
      <rect x="44" y="44" width="6" height="6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden
    >
      <circle cx="16" cy="16" r="12" />
      <circle cx="16" cy="16" r="5" />
    </svg>
  );
}

export default function ScanLandingPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "ready">("checking");
  const [networkNote, setNetworkNote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const session = loadSession();
    const verify = async (): Promise<"show" | "entry" | "closer" | "network"> => {
      if (!session) return "show";
      try {
        await fetchState(session.token);
        return session.closerId ? "entry" : "closer";
      } catch (err: unknown) {
        if (isSessionInvalid(err)) {
          clearSession();
          return "show";
        }
        return "network";
      }
    };
    void verify().then((outcome) => {
      if (cancelled) return;
      if (outcome === "entry" || outcome === "closer") {
        router.replace(`/${outcome}`);
        return;
      }
      if (outcome === "network") setNetworkNote(true);
      setPhase("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (phase === "checking") {
    return <Splash>One sec&hellip;</Splash>;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-14">
      <h1 className="text-3xl font-bold text-ink">Scan to enter</h1>
      <p className="mt-2 text-ink2">Get in with the sticker by the register</p>
      {networkNote && (
        <p className="mt-3 text-sm text-ink3">
          Couldn&rsquo;t check this phone&rsquo;s sign-in — scan the sticker or
          enter the PIN to try again.
        </p>
      )}

      <div className="mt-8 flex flex-col gap-4">
        <div className="flex items-start gap-4 rounded-card bg-card p-5">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-well bg-well text-ink">
            <QrIcon />
          </span>
          <div className="pt-1">
            <p className="font-bold text-ink">Scan the QR code</p>
            <p className="mt-1 text-sm text-ink2">
              Open your camera, point it at the sticker — you&rsquo;re in
              automatically
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4 rounded-card bg-card p-5">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-well bg-well text-ink">
            <TagIcon />
          </span>
          <div className="pt-1">
            <p className="font-bold text-ink">Or tap the tag</p>
            <p className="mt-1 text-sm text-ink2">
              Hold your phone against the round tag
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => router.push("/pin")}
        className="mt-10 w-full rounded-full bg-card py-4 font-semibold text-ink active:bg-well"
      >
        Enter PIN instead
      </button>
      <p className="mt-4 text-center text-sm text-ink3">
        You only do this once — this phone stays signed in
      </p>
    </main>
  );
}
