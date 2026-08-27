"use client";

// Auth gate for the whole /dashboard subtree: Supabase email/password session
// + manager-role check via the `current_user_is_manager` RPC (canonical
// profiles.role = 'manager' and not suspended — the same source of truth the
// user-management edge functions enforce server-side).

import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import DashboardLoginCard from "@/components/dashboard/DashboardLoginCard";
import DashboardShell from "@/components/dashboard/DashboardShell";

export default function DashboardGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [managerCheck, setManagerCheck] = useState<{
    userId: string;
    ok: boolean;
  } | null>(null);

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

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const userId = session.user.id;
    getSupabase()
      .rpc("current_user_is_manager")
      .then(({ data, error }) => {
        if (cancelled) return;
        setManagerCheck({ userId, ok: !error && data === true });
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Only trust a check made for the current session's user.
  const isManager =
    session && managerCheck && managerCheck.userId === session.user.id
      ? managerCheck.ok
      : null;

  function signOut() {
    void getSupabase().auth.signOut();
  }

  if (!sessionLoaded) {
    return <p className="text-ink3 text-sm text-center mt-16">Loading…</p>;
  }

  if (!session) {
    return <DashboardLoginCard />;
  }

  if (isManager === null) {
    return (
      <p className="text-ink3 text-sm text-center mt-16">Checking access…</p>
    );
  }

  if (!isManager) {
    return (
      <div className="w-full max-w-md mx-auto mt-16 px-5">
        <div className="bg-card rounded-card p-6 flex flex-col gap-4">
          <p className="wordmark">smelter</p>
          <p className="text-ink font-semibold">Managers only</p>
          <p className="text-ink2 text-sm">
            This account doesn&apos;t have manager access. Ask a manager if you
            think that&apos;s wrong.
          </p>
          <button
            type="button"
            onClick={signOut}
            className="self-start bg-card border border-hairline rounded-full px-5 py-2.5 font-semibold text-ink2"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return <DashboardShell onSignOut={signOut}>{children}</DashboardShell>;
}
