"use client";

// Scan gate: every entry session starts here with a QR scan. The sticker can
// be scanned with the phone's camera app (opens /e?t=...) or with the
// in-page scanner below — no PIN path. First visit on a device shows the
// onboarding carousel (preview anytime with /?onboarding=a or =b).

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchState, isSessionInvalid } from "@/lib/tips/api";
import {
  clearSession,
  hasOnboarded,
  loadSession,
  markOnboarded,
} from "@/lib/tips/session";
import { Onboarding, type OnboardingVariant } from "@/components/entry-flow/Onboarding";
import { QrScanner } from "@/components/entry-flow/QrScanner";
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

function CameraIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 8h2l2-3h8l2 3h2a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function ScanLanding() {
  const router = useRouter();
  const search = useSearchParams();
  const [phase, setPhase] = useState<"checking" | "ready">("checking");
  const [networkNote, setNetworkNote] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // /?onboarding=a|b previews a specific carousel variant.
  const onboardingParam = search.get("onboarding");
  const variant: OnboardingVariant = onboardingParam === "b" ? "story" : "cards";

  useEffect(() => {
    let cancelled = false;
    const session = loadSession();
    // A live session means an entry is mid-flight on this phone (refresh,
    // tab restore) — resume it rather than demanding a re-scan.
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
      setShowOnboarding(onboardingParam !== null || !hasOnboarded());
      setPhase("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [router, onboardingParam]);

  if (phase === "checking") {
    return <Splash>One sec&hellip;</Splash>;
  }

  if (showOnboarding) {
    return (
      <Onboarding
        variant={variant}
        onDone={() => {
          markOnboarded();
          setShowOnboarding(false);
        }}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-14">
      <h1 className="text-3xl font-bold text-ink">Scan to enter</h1>
      <p className="mt-2 text-ink2">
        Every entry starts with the sticker by the register
      </p>
      {networkNote && (
        <p className="mt-3 text-sm text-ink3">
          Couldn&rsquo;t check this phone&rsquo;s last session — scan the
          sticker to start fresh.
        </p>
      )}

      <div className="mt-8 flex flex-col gap-4">
        <div className="flex items-start gap-4 rounded-card bg-card p-5">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-well bg-well text-ink">
            <QrIcon />
          </span>
          <div className="pt-1">
            <p className="font-bold text-ink">Two ways to scan</p>
            <p className="mt-1 text-sm text-ink2">
              Use your camera app or scan it here.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setShowScanner(true)}
        className="mt-10 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-4 font-semibold text-white active:opacity-90"
      >
        <CameraIcon />
        Scan the sticker
      </button>

      {showScanner && (
        <QrScanner
          onToken={(token) => {
            setShowScanner(false);
            router.push(`/e?t=${encodeURIComponent(token)}`);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </main>
  );
}

export default function ScanLandingPage() {
  return (
    <Suspense fallback={<Splash>One sec&hellip;</Splash>}>
      <ScanLanding />
    </Suspense>
  );
}
