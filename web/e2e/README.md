# E2E suite (Playwright)

Runs the real entry flows against the live Supabase backend — there is no
mock mode. Serial on purpose (one worker): the backend's auth rate limits
are part of what's under test.

> **⚠ The suite writes to the live database.** It saves TODAY's Sushi tip
> slots, and bad-token attempts burn real failed-attempt budget. Entry
> devices can no longer overwrite recorded slots, so run `cleanup.sql`
> BEFORE a run (a leftover slot puts the specs on the "All set" screen) and
> again after. The config refuses to start without
> `E2E_ALLOW_LIVE_WRITES=1` as the acknowledgement.

## Setup

Create `web/.env.e2e` (gitignored, never commit) with the current entry
fixtures:

```
E2E_ALLOW_LIVE_WRITES=1
E2E_SUSHI_TOKEN=<plaintext entry token for Babytuna Sushi>
E2E_POKI_TOKEN=<plaintext entry token for Babytuna Poki & Pho>
```

(Supabase URL/anon key are picked up from `web/.env.local`.) After a manager
rotates tokens from /manager → Admin, update this file to match. PIN entry
was removed from the product 2026-08-11.

## Run

```
npm run test:e2e                 # against http://localhost:3000 (dev server auto-starts)
E2E_BASE_URL=https://<deployment> npm run test:e2e   # against a deployed build
```

Against a Vercel URL the deployment must be publicly reachable (Deployment
Protection off or bypassed) — Vercel's SSO interstitial otherwise blocks
every request before the app loads.

## After a run

Apply [cleanup.sql](./cleanup.sql) — it removes today's harness-written
entries (scoped to the two locations), all minted sessions, and the auth
ledger, and leaves the seeded tokens/PINs/roster fixtures alone. The
rate-limit spec uses a per-run throwaway user agent so back-to-back runs
don't lock each other out at the device level, but the location-level
failure budget accumulates until cleanup — if the ledger is polluted enough
that even the first attempt is refused, the spec skips and tells you to
clean up first.

## Kitchen suite (`kitchen.spec.ts`)

Runs the kitchen request flows (chef phone + kitchen display in two browser
contexts, realtime, undo, cancel, offline retry idempotency, name + PIN
sign-in, module gating, location scoping) against a **local** Supabase
stack, never the live project: the fixture creates accounts through the
admin API and refuses non-localhost URLs.

```
scripts/local-db/full-stack.sh up          # once; boots 54421-54424 with the prod schema
cd web
E2E_KITCHEN=1 E2E_ALLOW_LIVE_WRITES=1 \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from supabase status> \
E2E_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from supabase status> \
PORT=3100 E2E_BASE_URL=http://localhost:3100 \
npx playwright test e2e/kitchen.spec.ts
```

`E2E_ALLOW_LIVE_WRITES=1` is only the config's opt-in gate; with the URLs
above nothing touches production. `PORT=3100` keeps the suite's dev server
apart from any `npm run dev` on 3000 that points at the live project.
Without `E2E_KITCHEN=1` the suite skips itself, so the default `npm run
test:e2e` run is unchanged.

Gotcha: after a large multi-file rewrite, restart the dev server before
running the suite. Turbopack once kept serving the previous bundle and the
failures pointed at code that no longer existed.
