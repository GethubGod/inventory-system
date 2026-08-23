"use client";

// Public invite landing page (/join/[token]) — no auth. Validates the token
// via accept-invite {validateOnly: true} on load, greets the invitee by name,
// and hands off to the app via the babytunasystems:// deep link.

import { useEffect, useState } from "react";
import {
  buildAppDeepLink,
  validateInviteToken,
  type InviteFailureReason,
  type InviteValidation,
} from "@/lib/join";

const APP_STORE_URL =
  "https://apps.apple.com/us/app/babytuna-systems/id6759226573";

const FAILURE_COPY: Record<
  InviteFailureReason,
  { title: string; body: string }
> = {
  used: {
    title: "This invite was already used",
    body: "Invite links only work once. If that wasn't you, or you still need access, ask your manager for a new link.",
  },
  expired: {
    title: "This invite has expired",
    body: "The link's time window has passed. Ask your manager for a new link.",
  },
  revoked: {
    title: "This invite was revoked",
    body: "Your manager cancelled this link. Ask your manager for a new link if you still need one.",
  },
  invalid: {
    title: "This invite link isn't valid",
    body: "The link may be incomplete or mistyped. Double-check it, or ask your manager for a new link.",
  },
};

function SetupStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-tint text-accent text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <span className="text-ink2 text-sm leading-6">{children}</span>
    </li>
  );
}

export default function JoinLanding({ token }: { token: string }) {
  const [validation, setValidation] = useState<InviteValidation | null>(null);

  useEffect(() => {
    let cancelled = false;
    validateInviteToken(token).then((result) => {
      if (!cancelled) setValidation(result);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="flex-1 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <p className="section-label text-center mb-3">Babytuna Systems</p>

        {validation === null ? (
          <div className="bg-card rounded-card p-8 text-center">
            <p className="text-ink3 text-sm">Checking your invite…</p>
          </div>
        ) : validation.ok ? (
          <div className="bg-card rounded-card p-8">
            <h1 className="text-2xl font-bold text-ink mb-2">
              {validation.invitedName
                ? `Hi ${validation.invitedName}, welcome aboard`
                : "Welcome aboard"}
            </h1>
            <p className="text-ink2 text-sm mb-6">
              You&apos;ve been invited to join the Babytuna team app
              {validation.role ? (
                <>
                  {" "}
                  as{" "}
                  <span className="font-semibold capitalize">
                    {validation.role}
                  </span>
                </>
              ) : null}
              . Setup takes about a minute:
            </p>

            <ol className="flex flex-col gap-3 mb-7">
              <SetupStep n={1}>
                Get the Babytuna app from the{" "}
                <a
                  href={APP_STORE_URL}
                  className="text-accent font-semibold underline underline-offset-2"
                >
                  App Store
                </a>
                .
              </SetupStep>
              <SetupStep n={2}>
                Come back here and tap <strong>Open in app</strong> below.
              </SetupStep>
              <SetupStep n={3}>
                Finish the manager-started setup in the app and choose your PIN
                or password — no access code needed.
              </SetupStep>
            </ol>

            <a
              href={buildAppDeepLink(token)}
              className="block w-full text-center rounded-full bg-accent text-white font-bold py-3.5"
            >
              Open in app
            </a>
            <p className="text-ink3 text-xs text-center mt-3">
              Nothing happening? Install the app first, then tap again.
            </p>
            <p className="mt-5 text-center text-xs text-ink3">
              By continuing, you agree to the{" "}
              <a className="underline underline-offset-2" href="/terms">
                Terms
              </a>{" "}
              and acknowledge the{" "}
              <a className="underline underline-offset-2" href="/privacy">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-card p-8">
            <h1 className="text-2xl font-bold text-ink mb-2">
              {FAILURE_COPY[validation.reason].title}
            </h1>
            <p className="text-ink2 text-sm">
              {FAILURE_COPY[validation.reason].body}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
