"use client";

// Sign-in for /kitchen. Name + PIN is the default (that is what employees
// set up in the app); managers can flip to email + password.

import { useState, type FormEvent } from "react";
import { SmelterLogo } from "@/components/Logo";
import {
  SignInError,
  signInWithEmail,
  signInWithName,
} from "@/lib/kitchen/auth";

type Mode = "name" | "email";

export default function KitchenLoginCard() {
  const [mode, setMode] = useState<Mode>("name");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "name") await signInWithName(name, secret);
      else await signInWithEmail(email, password);
      // On success KitchenGate's onAuthStateChange takes over.
    } catch (err: unknown) {
      setError(
        err instanceof SignInError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unable to sign in right now",
      );
      setBusy(false);
    }
  }

  const inputClasses =
    "bg-well rounded-well px-4 py-3 text-ink outline-none w-full";

  return (
    <div className="w-full max-w-md mx-auto mt-16 px-5">
      <div className="bg-card rounded-card p-6">
        <SmelterLogo height={26} className="mb-2" />
        <h1 className="text-xl font-bold text-ink mb-1">Kitchen</h1>
        <p className="text-ink2 text-sm mb-5">
          Sign in to send or see kitchen requests.
        </p>

        <div
          className="flex bg-well rounded-full p-1 mb-4"
          role="tablist"
          aria-label="Sign-in method"
        >
          {(["name", "email"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              onClick={() => {
                setMode(option);
                setError(null);
              }}
              className={`flex-1 rounded-full py-2 text-sm font-semibold ${
                mode === option ? "bg-ink text-white" : "text-ink2"
              }`}
            >
              {option === "name" ? "Name + PIN" : "Email"}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {mode === "name" ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="section-label">Name</span>
                <input
                  type="text"
                  autoComplete="username"
                  autoCapitalize="words"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClasses}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="section-label">PIN or password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  className={inputClasses}
                />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="section-label">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClasses}
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
                  className={inputClasses}
                />
              </label>
            </>
          )}
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
