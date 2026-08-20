"use client";

// Manager dashboard shell: Supabase auth gate + manager check + tab bar.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import LoginCard from "@/components/manager/LoginCard";
import EntriesTab from "@/components/manager/EntriesTab";
import DiscrepanciesTab from "@/components/manager/DiscrepanciesTab";
import AbTab from "@/components/manager/AbTab";
import AdminTab from "@/components/manager/AdminTab";

type TabId = "entries" | "discrepancies" | "ab" | "admin";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "entries", label: "Entries" },
  { id: "discrepancies", label: "Discrepancies" },
  { id: "ab", label: "A/B test" },
  { id: "admin", label: "Admin" },
];

export default function ManagerApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [managerCheck, setManagerCheck] = useState<{
    userId: string;
    ok: boolean;
  } | null>(null);
  const [tab, setTab] = useState<TabId>("entries");

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

  return (
    <div className="w-full max-w-6xl mx-auto px-5 py-6">
      <header className="flex items-center justify-between gap-3 mb-5">
        <h1 className="text-xl font-bold text-ink">Tip Dashboard</h1>
        <button
          type="button"
          onClick={signOut}
          className="bg-card rounded-full px-4 py-2 text-sm font-semibold text-ink2"
        >
          Sign out
        </button>
      </header>

      <nav className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              tab === t.id ? "bg-accent text-white" : "bg-card text-ink2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "entries" ? <EntriesTab /> : null}
      {tab === "discrepancies" ? <DiscrepanciesTab /> : null}
      {tab === "ab" ? <AbTab /> : null}
      {tab === "admin" ? <AdminTab /> : null}
    </div>
  );
}
