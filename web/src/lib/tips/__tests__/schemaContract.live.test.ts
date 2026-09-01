// Live schema contract: every select and RPC the Tip Dashboard sends must be
// accepted by the database the web app is configured against.
//
// Skipped unless LIVE_SCHEMA_CHECK=1 (`npm run check:schema`). Read-only.
//
// By default it runs as the anon role, which either sees zero rows (200) or is
// denied the table outright (42501). Postgres resolves the column list before
// it checks privileges, so a column the schema lacks still surfaces as 42703
// and a missing function as 404 / PGRST202. That proves the schema, not the
// manager's grants or RLS. Set LIVE_SCHEMA_BEARER to a signed-in manager's
// access token to run as that user instead; then every select must return
// 200. Credentials come from the environment or web/.env.local.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SELECTS,
  FIX_ENTRY_RPC,
  FIX_ENTRY_RPC_ARGS,
  FIX_ENTRY_SELECT,
} from "../dashboardQueries";

const ENABLED = process.env.LIVE_SCHEMA_CHECK === "1";

function readEnvFile(): Record<string, string> {
  try {
    const text = readFileSync(fileURLToPath(new URL("../../../../.env.local", import.meta.url)), "utf8");
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const BEARER = process.env.LIVE_SCHEMA_BEARER?.trim() || null;

function credentials(): { url: string; key: string } {
  const file = readEnvFile();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? file.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? file.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set (env or web/.env.local)");
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function rest(path: string, init: RequestInit = {}) {
  const { url, key } = credentials();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${BEARER ?? key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/**
 * As anon, 200 (rows or none under RLS) or 42501 (denied the table) both prove
 * the column list parsed. As a signed-in manager only 200 will do.
 */
function expectSelectParsed(status: number, body: unknown, label: string) {
  const ok = status === 200 || (BEARER === null && errorCode(body) === "42501");
  expect(ok, `${label}: HTTP ${status} ${JSON.stringify(body)}`).toBe(true);
}

function errorCode(body: unknown): string | null {
  return typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
    ? body.code
    : null;
}

describe.skipIf(!ENABLED)("Tip Dashboard schema contract (live)", () => {
  for (const [table, select] of Object.entries(DASHBOARD_SELECTS)) {
    it(`accepts the ${table} select`, async () => {
      const { status, body } = await rest(`${table}?select=${encodeURIComponent(select)}&limit=1`);
      expectSelectParsed(status, body, table);
    });
  }

  it("accepts the Fix dialog select", async () => {
    const { status, body } = await rest(
      `tip_entries?select=${encodeURIComponent(FIX_ENTRY_SELECT)}&limit=1`,
    );
    expectSelectParsed(status, body, "fix dialog");
  });

  it(`exposes ${FIX_ENTRY_RPC} with the v3 argument set`, async () => {
    // Anon is not a manager, so a present function answers with a permission
    // or manager-check error. Only "no such function" (PGRST202) or an
    // ambiguous overload (PGRST203) fails this test.
    const args = Object.fromEntries(FIX_ENTRY_RPC_ARGS.map((name) => [name, null]));
    const { status, body } = await rest(`rpc/${FIX_ENTRY_RPC}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
    const code = errorCode(body);
    expect(status, JSON.stringify(body)).not.toBe(404);
    expect(code, JSON.stringify(body)).not.toMatch(/^PGRST20[23]$/);
  });
});
