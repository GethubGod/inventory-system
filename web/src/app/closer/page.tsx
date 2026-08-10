"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchState,
  isSessionInvalid,
  setCloser,
  TipApiError,
  type RosterPerson,
  type SessionState,
} from "@/lib/tips/api";
import {
  clearSession,
  loadSession,
  updateSession,
  type StoredSession,
} from "@/lib/tips/session";
import { Avatar } from "@/components/Avatar";
import { CloseButton, Splash } from "@/components/entry-flow/chrome";

export default function CloserPage() {
  const router = useRouter();
  const [session, setSession] = useState<StoredSession | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pickError, setPickError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stored = loadSession();
    if (!stored) {
      router.replace("/");
      return;
    }
    fetchState(stored.token)
      .then((fresh) => {
        if (cancelled) return;
        setSession(stored);
        setState(fresh);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isSessionInvalid(err)) {
          clearSession();
          router.replace("/");
        } else {
          setSession(stored);
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router, loadAttempt]);

  async function pick(person: RosterPerson) {
    if (!session || busyId) return;
    setPickError(null);
    setBusyId(person.id);
    // Optimistic: cache the closer locally, then confirm with the server.
    const previous = {
      closerId: session.closerId,
      closerName: session.closerName,
    };
    updateSession({ closerId: person.id, closerName: person.name });
    try {
      await setCloser(session.token, person.id);
      router.push("/entry");
    } catch (err: unknown) {
      updateSession(previous);
      setBusyId(null);
      if (isSessionInvalid(err)) {
        clearSession();
        router.replace("/");
        return;
      }
      setPickError(
        err instanceof TipApiError
          ? err.message
          : "Something went wrong. Try again.",
      );
    }
  }

  if (!session || (!state && !loadFailed)) {
    return <Splash>One sec&hellip;</Splash>;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-5">
      <div className="flex h-10 justify-end">
        {session.closerId && (
          <CloseButton onClick={() => router.push("/entry")} />
        )}
      </div>

      <h1 className="mt-4 text-3xl font-bold text-ink">Who&rsquo;s closing?</h1>
      <p className="mt-1 text-ink2">
        {state?.location.name ?? session.locationName}
      </p>

      {pickError && (
        <p className="mt-3 text-sm font-medium text-alert">{pickError}</p>
      )}

      {loadFailed ? (
        <div className="mt-8 flex flex-col items-center gap-4">
          <p className="text-center text-ink2">
            Couldn&rsquo;t load the roster.
          </p>
          <button
            type="button"
            onClick={() => {
              setLoadFailed(false);
              setLoadAttempt((n) => n + 1);
            }}
            className="rounded-full bg-card px-8 py-3 font-semibold text-ink active:bg-well"
          >
            Try again
          </button>
        </div>
      ) : state && state.roster.length === 0 ? (
        <div className="mt-8 rounded-card bg-card p-5 text-center text-ink2">
          No staff on the roster yet. Ask a manager to add people in the
          dashboard.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {state?.roster.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => void pick(person)}
              disabled={busyId !== null}
              className={`flex flex-col items-center gap-2 rounded-card bg-card p-4 active:bg-well ${
                busyId !== null && busyId !== person.id ? "opacity-60" : ""
              }`}
            >
              <Avatar name={person.name} size={48} />
              <span className="font-semibold text-ink">
                {person.name.trim().split(/\s+/)[0]}
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
