"use client";

import { useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";

export default function LoginCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: signInError } = await getSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
    }
    // On success ManagerApp's onAuthStateChange takes over.
  }

  return (
    <div className="w-full max-w-md mx-auto mt-16 px-5">
      <div className="bg-card rounded-card p-6">
        <p className="section-label mb-1">Babytuna</p>
        <h1 className="text-xl font-bold text-ink mb-5">Tips — Manager</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="section-label">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-well rounded-well px-4 py-3 text-ink outline-none w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="section-label">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-well rounded-well px-4 py-3 text-ink outline-none w-full"
            />
          </label>
          {error ? <p className="text-alert text-sm">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className={`mt-2 rounded-full px-5 py-3 font-semibold text-white ${
              busy ? "bg-disabled" : "bg-accent"
            }`}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
