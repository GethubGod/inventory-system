# E2E suite (Playwright)

Runs the real entry flows against the live Supabase backend — there is no
mock mode. Serial on purpose (one worker): the backend's auth rate limits
are part of what's under test.

> **⚠ The suite writes to the live database.** It saves (and overwrites)
> TODAY's tip slots for both locations, and its rate-limit spec burns real
> failed-attempt budget (6 location-scoped failures per run; 5 uncleaned
> runs inside 10 minutes would hit the 30-failure location cap and block
> real PIN sign-ins). Run it only while the database holds no tip data you
> care about, and apply `cleanup.sql` after every run. The config refuses
> to start without `E2E_ALLOW_LIVE_WRITES=1` as the acknowledgement.

## Setup

Create `web/.env.e2e` (gitignored, never commit) with the current entry
fixtures:

```
E2E_ALLOW_LIVE_WRITES=1
E2E_SUSHI_TOKEN=<plaintext entry token for Babytuna Sushi>
E2E_POKI_TOKEN=<plaintext entry token for Babytuna Poki & Pho>
E2E_SUSHI_PIN=<4-digit PIN for Sushi>
E2E_POKI_PIN=<4-digit PIN for Poki & Pho>
```

(Supabase URL/anon key are picked up from `web/.env.local`.) After a manager
rotates tokens/PINs from /manager → Admin, update this file to match.

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
