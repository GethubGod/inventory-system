// Shared helpers for the E2E suite. Sessions can be minted directly through
// the live tip-entry-auth edge function so specs that aren't about the sign-in
// UI can start authenticated (the sign-in UI itself is covered in
// landing.spec.ts).

import type { Page } from "@playwright/test";

export interface Fixtures {
  supabaseUrl: string;
  anonKey: string;
  sushiToken: string;
  pokiToken: string;
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Create web/.env.e2e (gitignored) with the seeded ` +
        `fixture values — see e2e/README.md.`,
    );
  }
  return value;
}

export function fixtures(): Fixtures {
  return {
    supabaseUrl: need("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: need("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    sushiToken: need("E2E_SUSHI_TOKEN"),
    pokiToken: need("E2E_POKI_TOKEN"),
  };
}

interface RosterPerson {
  id: string;
  name: string;
}

export interface MintedSession {
  sessionToken: string;
  locationId: string;
  locationName: string;
  roster: RosterPerson[];
}

async function callAuth(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { supabaseUrl, anonKey } = fixtures();
  const response = await fetch(`${supabaseUrl}/functions/v1/tip-entry-auth`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok || json.ok !== true) {
    throw new Error(
      `tip-entry-auth ${String(body.action)} failed: ${response.status} ${JSON.stringify(json)}`,
    );
  }
  return json;
}

/** Mint a fresh entry session straight from the edge function. */
export async function mintSession(entryToken: string): Promise<MintedSession> {
  const json = await callAuth({ action: "validate_token", token: entryToken });
  const location = json.location as { id: string; name: string };
  return {
    sessionToken: json.sessionToken as string,
    locationId: location.id,
    locationName: location.name,
    roster: (json.roster as RosterPerson[]) ?? [],
  };
}

/** Set the session's closer server-side (what the "Who's closing?" tap does). */
export async function setCloser(
  sessionToken: string,
  closerId: string,
): Promise<void> {
  await callAuth({ action: "set_closer", sessionToken, closerId });
}

/**
 * Install a minted session (and a deterministic voice variant) into
 * localStorage before the app boots, so specs can start on /entry. Also
 * marks the device as onboarded so the first-run carousel stays out of the
 * way (it has its own spec in landing.spec.ts).
 */
export async function installSession(
  page: Page,
  session: MintedSession,
  closer: RosterPerson | null,
): Promise<void> {
  await page.addInitScript(
    ([stored, variant]) => {
      window.localStorage.setItem("bt_tips_session", stored);
      window.localStorage.setItem("bt_tips_voice_variant", variant);
      window.localStorage.setItem("bt_tips_onboarded", "1");
    },
    [
      JSON.stringify({
        token: session.sessionToken,
        locationId: session.locationId,
        locationName: session.locationName,
        closerId: closer?.id ?? null,
        closerName: closer?.name ?? null,
      }),
      "waveform",
    ] as const,
  );
}

/** Mint + set closer + install, in one go. */
export async function signInAs(
  page: Page,
  entryToken: string,
  closerName: string,
): Promise<MintedSession> {
  const session = await mintSession(entryToken);
  const closer = session.roster.find((person) => person.name === closerName);
  if (!closer) {
    throw new Error(
      `${closerName} not on roster (${session.roster.map((p) => p.name).join(", ")})`,
    );
  }
  await setCloser(session.sessionToken, closer.id);
  await installSession(page, session, closer);
  return session;
}
