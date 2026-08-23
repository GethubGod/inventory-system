"use client";

// Manager surface: Supabase auth gate + manager check, then the Tip
// Dashboard (sidebar app). Sign-out flips back to the login card via
// onAuthStateChange.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import LoginCard from "@/components/manager/LoginCard";
import { DashboardShell } from "@/components/manager/dashboard/DashboardShell";

export default function ManagerApp() {
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

  // Derived: only trust a check made for the current session's user.
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
    return <LoginCard />;
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
          <p className="text-ink">
            This account doesn&apos;t have manager access.
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

  const email = session.user.email ?? "";
  const metadataName =
    typeof session.user.user_metadata?.full_name === "string"
      ? session.user.user_metadata.full_name
      : typeof session.user.user_metadata?.name === "string"
        ? session.user.user_metadata.name
        : null;
  const profileName = metadataName ?? (email.split("@")[0] || "Manager");

  return (
    <DashboardShell
      userId={session.user.id}
      profileName={profileName}
      profileEmail={email}
      onSignOut={signOut}
    />
  );
}
