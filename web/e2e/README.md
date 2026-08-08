# E2E suite (Playwright)

Runs the real entry flows against the live Supabase backend — there is no
mock mode. Serial on purpose (one worker): the backend's auth rate limits
are part of what's under test.

## Setup

Create `web/.env.e2e` (gitignored, never commit) with the current entry
fixtures:

```
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

The suite writes real rows (today's tip entries for the seeded locations,
minted sessions, and deliberate failed PIN attempts for the rate-limit
spec). Clean them with [cleanup.sql](./cleanup.sql). The rate-limit spec
uses a per-run throwaway user agent, so back-to-back runs don't lock each
other out — but each run leaves 7 failed attempts on the Poki location
until cleanup (the per-location cap is 30 failures / 10 min).
