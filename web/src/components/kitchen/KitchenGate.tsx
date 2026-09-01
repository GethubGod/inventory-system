"use client";

// Auth gate for /kitchen: Supabase session, then the user's kitchen modules,
// identity, works-at location and the active locations. The server decides
// access on every write regardless; this only picks which screen to show.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import {
  describeKitchenError,
  fetchKitchenAccess,
  type KitchenAccess,
} from "@/lib/kitchen/api";
import { availableViews } from "@/lib/kitchen/access";
import { SmelterLogo } from "@/components/Logo";
import KitchenLoginCard from "@/components/kitchen/KitchenLoginCard";
import KitchenApp from "@/components/kitchen/KitchenApp";

type AccessState =
  | { phase: "loading"; userId: string }
  | { phase: "error"; userId: string; message: string }
  | { phase: "ready"; userId: string; access: KitchenAccess };

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-md mx-auto mt-16 px-5">
      <div className="bg-card rounded-card p-6 flex flex-col gap-4">
        <SmelterLogo height={26} />
        {children}
      </div>
    </div>
  );
}

export default function KitchenGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [access, setAccess] = useState<AccessState | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        setSession(next);
        setSessionLoaded(true);
      },
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const loadAccess = useCallback(async (target: string) => {
    setAccess({ phase: "loading", userId: target });
    try {
      const result = await fetchKitchenAccess(target);
      setAccess((prev) =>
        prev?.userId === target
          ? { phase: "ready", userId: target, access: result }
          : prev,
      );
    } catch (error: unknown) {
      setAccess((prev) =>
        prev?.userId === target
          ? {
              phase: "error",
              userId: target,
              message: describeKitchenError(error),
            }
          : prev,
      );
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setAccess(null);
      return;
    }
    void loadAccess(userId);
  }, [userId, loadAccess]);

  function signOut() {
    void getSupabase().auth.signOut();
  }

  if (!sessionLoaded) {
    return <p className="text-ink3 text-sm text-center mt-16">Loading…</p>;
  }
  if (!session || !userId) {
    return <KitchenLoginCard />;
  }
  // Only trust access loaded for the current session's user.
  if (!access || access.userId !== userId || access.phase === "loading") {
    return (
      <p className="text-ink3 text-sm text-center mt-16">Checking access…</p>
    );
  }
  if (access.phase === "error") {
    return (
      <Card>
        <p className="text-ink font-semibold">Couldn’t check your access</p>
        <p className="text-ink2 text-sm">{access.message}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadAccess(userId)}
            className="bg-accent text-white rounded-full px-5 py-2.5 font-semibold"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={signOut}
            className="bg-card border border-hairline rounded-full px-5 py-2.5 font-semibold text-ink2"
          >
            Sign out
          </button>
        </div>
      </Card>
    );
  }
  if (availableViews(access.access.modules).length === 0) {
    return (
      <Card>
        <p className="text-ink font-semibold">No kitchen access</p>
        <p className="text-ink2 text-sm">
          Signed in as {access.access.identity.displayName}. This account has
          neither Kitchen requests nor Kitchen display turned on. A manager can
          enable them from Dashboard → Team → Modules.
        </p>
        <button
          type="button"
          onClick={signOut}
          className="self-start bg-card border border-hairline rounded-full px-5 py-2.5 font-semibold text-ink2"
        >
          Sign out
        </button>
      </Card>
    );
  }
  return <KitchenApp access={access.access} onSignOut={signOut} />;
}
