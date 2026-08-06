"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listLocations, validatePin, TipApiError } from "@/lib/tips/api";
import { saveSession } from "@/lib/tips/session";
import { CloseButton } from "@/components/entry-flow/chrome";

interface LocationOption {
  id: string;
  name: string;
}

/** Short segment label: "Babytuna Sushi" → "Sushi". */
function shortLabel(name: string): string {
  return name.replace(/^Babytuna\s+/i, "");
}

function sortLocations(locations: LocationOption[]): LocationOption[] {
  return [...locations].sort(
    (a, b) =>
      Number(b.name.includes("Sushi")) - Number(a.name.includes("Sushi")),
  );
}

function BackspaceIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9L2 13l7-8z" />
      <path d="M12 10l6 6M18 10l-6 6" />
    </svg>
  );
}

export default function PinPage() {
  const router = useRouter();
  const [locations, setLocations] = useState<LocationOption[] | null>(null);
  const [locationsFailed, setLocationsFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listLocations()
      .then((raw) => {
        if (cancelled) return;
        const sorted = sortLocations(raw);
        setLocations(sorted);
        setSelectedId((current) => current ?? sorted[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setLocationsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  async function submit(fullPin: string, locationId: string) {
    setValidating(true);
    try {
      const fresh = await validatePin(locationId, fullPin);
      saveSession({
        token: fresh.sessionToken,
        locationId: fresh.location.id,
        locationName: fresh.location.name,
        closerId: null,
        closerName: null,
      });
      router.push("/closer");
    } catch (err: unknown) {
      setPin("");
      setError(
        err instanceof TipApiError
          ? err.message
          : "Something went wrong. Try again.",
      );
      setShaking(true);
      setValidating(false);
    }
  }

  function pressDigit(digit: string) {
    // Side effects stay outside the state updater (strict mode runs updaters twice).
    if (validating || !selectedId || pin.length >= 4) return;
    setError(null);
    setShaking(false);
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) void submit(next, selectedId);
  }

  function pressBackspace() {
    if (validating) return;
    setError(null);
    setShaking(false);
    setPin((current) => current.slice(0, -1));
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-5">
      <style>{`
        @keyframes pin-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
        .pin-shake { animation: pin-shake 0.35s ease-in-out; }
      `}</style>

      <div className="flex justify-end">
        <CloseButton onClick={() => router.push("/")} />
      </div>

      <h1 className="mt-4 text-center text-3xl font-bold text-ink">
        Enter the PIN
      </h1>

      {locationsFailed ? (
        <div className="mt-8 flex flex-col items-center gap-4">
          <p className="text-center text-ink2">
            Couldn&rsquo;t load the locations.
          </p>
          <button
            type="button"
            onClick={() => {
              setLocationsFailed(false);
              setLoadAttempt((n) => n + 1);
            }}
            className="rounded-full bg-card px-8 py-3 font-semibold text-ink active:bg-well"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {locations && locations.length > 0 && (
            <div className="mt-6 flex rounded-full bg-card p-1">
              {locations.map((location) => {
                const selected = location.id === selectedId;
                return (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => setSelectedId(location.id)}
                    className={`flex-1 rounded-full py-2.5 text-sm font-semibold ${
                      selected ? "bg-accent text-white" : "text-ink2"
                    }`}
                  >
                    {shortLabel(location.name)}
                  </button>
                );
              })}
            </div>
          )}

          <div
            className={`mt-10 flex justify-center gap-4 ${shaking ? "pin-shake" : ""}`}
          >
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-3.5 w-3.5 rounded-full ${
                  i < pin.length ? "bg-ink" : "border border-hairline bg-card"
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="mt-4 text-center text-sm font-medium text-alert">
              {error}
            </p>
          )}

          <div
            className={`mx-auto mt-10 grid grid-cols-3 justify-items-center gap-4 ${
              validating ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => pressDigit(digit)}
                className="h-[72px] w-[72px] rounded-full bg-card text-2xl font-medium text-ink active:bg-well"
              >
                {digit}
              </button>
            ))}
            <span className="h-[72px] w-[72px]" />
            <button
              type="button"
              onClick={() => pressDigit("0")}
              className="h-[72px] w-[72px] rounded-full bg-card text-2xl font-medium text-ink active:bg-well"
            >
              0
            </button>
            <button
              type="button"
              aria-label="Delete last digit"
              onClick={pressBackspace}
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-card text-ink active:bg-well"
            >
              <BackspaceIcon />
            </button>
          </div>

          <p className="mt-8 text-center text-sm text-ink3">
            Ask a manager for the code
          </p>
        </>
      )}
    </main>
  );
}
