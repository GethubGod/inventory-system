"use client";

// Printable QR page for a freshly rotated entry token. Tokens are stored
// hashed, so this page only works with the plaintext token passed in the
// URL fragment ("#t=...") right after rotation — fragments never reach
// servers or request logs, and the hash is scrubbed once read.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { getSupabase } from "@/lib/supabase";
import { entryUrlFor } from "@/lib/tips/entryUrl";

/** Parse "#t=<token>" from the current location, browser only. */
function readTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.startsWith("#t=")) return null;
  try {
    return decodeURIComponent(hash.slice(3)) || null;
  } catch {
    return null;
  }
}

function QrPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locationName = searchParams.get("name") ?? "Babytuna";
  // Token lives in component state; the fragment is cleared right after the
  // first read so it doesn't linger in the address bar or history.
  const [token] = useState<string | null>(readTokenFromHash);

  useEffect(() => {
    if (token && typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, [token]);

  const [authState, setAuthState] = useState<"loading" | "none" | "ok">(
    "loading",
  );
  const [entryUrl, setEntryUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setAuthState(data.session ? "ok" : "none");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token || authState !== "ok") return;
    let cancelled = false;
    const url = entryUrlFor(token);
    QRCode.toDataURL(url, { width: 480, margin: 2 })
      .then((dataUrl) => {
        if (cancelled) return;
        setEntryUrl(url);
        setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setEntryUrl(url);
        setQrError("Could not generate the QR code.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, authState]);

  if (authState === "loading") {
    return <p className="text-ink3 text-sm text-center mt-16">Loading…</p>;
  }

  if (authState === "none") {
    return (
      <div className="w-full max-w-md mx-auto mt-16 px-5">
        <div className="bg-card rounded-card p-6">
          <p className="text-ink">Sign in via /manager first.</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="w-full max-w-md mx-auto mt-16 px-5">
        <div className="bg-card rounded-card p-6 flex flex-col gap-4">
          <p className="text-ink">
            No token to show. Entry tokens are stored hashed and can&apos;t be
            re-displayed — this page only works right after rotating a token
            from the dashboard&apos;s Devices &amp; entry log page.
          </p>
          <button
            type="button"
            onClick={() => router.push("/manager")}
            className="self-start bg-accent text-white rounded-full px-5 py-2.5 font-semibold"
          >
            Go to the dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto px-5 py-10 flex flex-col items-center text-center">
      <h1 className="text-2xl font-bold text-ink">{locationName}</h1>
      <div className="mt-6">
        {qrDataUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={qrDataUrl}
            alt={`Tip entry QR code for ${locationName}`}
            className="w-72 h-72"
          />
        ) : qrError ? (
          <p className="text-alert text-sm">{qrError}</p>
        ) : (
          <p className="text-ink3 text-sm">Generating QR…</p>
        )}
      </div>
      <p className="mt-6 text-ink font-semibold">
        Scan with your phone camera to enter tips
      </p>
      {entryUrl ? (
        <p className="mt-2 text-xs font-mono text-ink3 break-all">
          {entryUrl}
        </p>
      ) : null}
      <p className="mt-4 text-sm text-ink2">
        Also write this URL to the NFC tag.
      </p>
      <div className="no-print mt-8 flex gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="bg-card border border-hairline rounded-full px-5 py-2.5 font-semibold text-ink2"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="bg-accent text-white rounded-full px-5 py-2.5 font-semibold"
        >
          Print
        </button>
      </div>
    </div>
  );
}

export default function QrPage() {
  return (
    <Suspense
      fallback={<p className="text-ink3 text-sm text-center mt-16">Loading…</p>}
    >
      <QrPageInner />
    </Suspense>
  );
}
