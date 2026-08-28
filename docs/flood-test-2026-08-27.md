# Flood Test & Security Review — 2026-08-27

Scope: the web surfaces only — the tips entry app and the manager dashboard —
plus the four tip edge functions and their SQL RPCs. The Expo mobile app was
out of scope.

**Targets tested live:** `tips.babytunasystems.com` (production web app) and
`https://whrohvitvmcrmedepurd.supabase.co/functions/v1/{tip-entry-auth,
tip-entries, tip-voice-parse, tip-voice-stream}`.

## Method

1. **Static review** of `web/src/**`, `supabase/functions/{tip-entry-auth,
   tip-entries, tip-voice-parse, tip-voice-stream}`, `_shared/tips.ts`,
   `_shared/cors.ts`, and the tip migrations.
2. **Live flood harness** (`flood-test/harness.mjs`, 81 checks): route
   availability, method fuzzing, malformed JSON, 19 garbage-token shapes
   (SQLi, XSS, path traversal, unicode, oversized, wrong types),
   session-gate bypass attempts, rate-limit burn-down (20-try window),
   XFF-spoof bypass attempt, 30-way concurrent bad-token burst, 60-way
   concurrent site GET burst, 25-way concurrent voice-parse burst, WebSocket
   ticket auth (no/short/garbage/oversized tickets), oversized upload (5–6MB).
3. **Fix + verify**: all fixes on branch `fix/web-flood-hardening`, quality
   gates green, browser verification on the Vercel preview.

## Result: 73/81 checks passed on the unpatched deployment. 8 findings.

---

## Findings fixed in PR #17

### Security

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| S1 | High | **No CSP / X-Frame-Options / Referrer-Policy / X-Content-Type-Options** on any page (confirmed live). Clickjacking + script-injection surface with session tokens in localStorage. | Fixed — full header set in `next.config.ts` |
| S2 | High | **Rate-limit bypass via `x-forwarded-for` spoofing** (confirmed live): after burning the 20-try token limit, a request with a spoofed XFF was allowed again immediately. `clientIdentifier` trusted the first (client-controlled) XFF entry. | Fixed — uses the last (proxy-appended) entry |
| S3 | High | **QR token leak via Referer**: `/e?t=<token>` validated before stripping the URL, and fetches used the default referrer policy. | Fixed — token stripped before any network call; `referrerPolicy: "no-referrer"` on all edge fetches; site-wide `Referrer-Policy: no-referrer` |
| S4 | Medium | **CSV formula injection**: a roster name like `=HYPERLINK(...)` exported unescaped; Excel/Sheets would execute it when a manager opens the CSV. | Fixed — `= + - @` prefixes neutralized; regression test added |
| S5 | Medium | **`/manager/qr` gated by any session**, not manager role — any signed-in account with a `#t=` link could print entry QR codes. | Fixed — requires `current_user_is_manager()` |
| S6 | Low | QR entry URL built without `encodeURIComponent`. | Fixed |

### Reliability

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| R1 | Medium | **`tip-voice-parse` returned HTTP 500 on a non-multipart body** (confirmed live). | Fixed — clean 400 |
| R2 | High | **Meal-switch race**: tapping Save mid Lunch↔Dinner switch sent the new meal with the old meal's crew (and possibly stale amounts). | Fixed — Save blocked while slot loads |
| R3 | Medium | **Double-submit race**: two fast taps both passed the `saving` state guard. | Fixed — synchronous in-flight ref |
| R4 | Medium | **Voice recorder played the live mic through the device speaker** (`processor.connect(destination)`) — feedback + privacy leak in the dining room. | Fixed — zero-gain node |
| R5 | Medium | **Unsafe response casts**: malformed edge-function responses crashed the render (`.map` of undefined). | Fixed — shape validation → retryable error |
| R6 | Medium | **Manager "Fix" was non-atomic** (3 PostgREST calls; mid-failure = mixed roster). | Fixed — single transactional `tip_manager_fix_entry` RPC (new migration, needs `supabase db push`) |
| R7 | Low | Saved-screen per-person used float division — could disagree with the split strip by a cent. | Fixed — shared `perPersonShare` |
| R8 | Low | `$NaN` in dashboard on malformed numeric; `localStorage` without try/catch; no `error.tsx`/`not-found.tsx`. | Fixed |

### Verified NOT vulnerable (tested, no action needed)

- Gateway rejects missing/garbage API keys (401) on all verify_jwt functions.
- All session-gated actions return 401 `session_invalid` for bad/missing sessions — no path past the gate found.
- Rate limit engages exactly at attempt #21 (20/10min) and holds under a 30-way concurrent burst (advisory locks work).
- WebSocket stream rejects missing/short/garbage/oversized tickets (connection never opens); tickets are single-use, 60s.
- 60 concurrent GETs on the site: 60×200, 0×5xx, ~0.4s.
- 25 concurrent bad-session voice-parse posts: 25×401, no 5xx.
- Malformed JSON → 400; wrong methods → 405; unknown actions → 400/401. No 5xx from any fuzzed input except R1.
- `end_session` is idempotent and safe with garbage/missing tokens.
- RLS: anon/authenticated roles have zero direct access to `tip_*` tables (manager-only policies); service-role key is nowhere in the client bundle.
- Split math is integer-cent based; division-by-zero guarded.

---

## Findings NOT fixed (need David / infra decisions)

| # | Severity | Finding | Recommended action |
|---|----------|---------|--------------------|
| O1 | **Critical ops** | **`tips.smelter.com` serves a parked-domain lander page** over plain HTTP; HTTPS has no certificate (TLS SNI error). `dashboard.smelter.com` likewise dead. The real app is `tips.babytunasystems.com`; dashboard host per config is `dashboard.smelterpos.com`. Anyone controlling that parked domain could later serve a phishing clone of the QR landing page. | Point the DNS at Vercel (or let the registration lapse); until then do not print/ship anything referencing smelter.com |
| O2 | Medium | **`ALLOWED_ORIGINS` is unset** — edge functions answer browser CORS from any origin (`*`). Already on the launch checklist. | `supabase secrets set ALLOWED_ORIGINS=https://tips.babytunasystems.com,https://dashboard.smelterpos.com` |
| O3 | Medium | **`entry_token_plain` stores the live QR token in plaintext**, re-fetched by the dashboard on every load. Accepted tradeoff (per David, 2026-08-20) so stickers can be reprinted — but any manager-session XSS/extensions can lift live entry credentials. | Keep as-is consciously, or null the column after first print and require rotation for reprints |
| O4 | Medium | **Oversized voice uploads (5–6MB) hang until gateway timeout (504)** instead of the intended fast 413 — the Supabase gateway buffers the body before the function's content-length guard runs. Ties up workers for the full timeout. | Client-side: stop recording/chunk before ~4MB. Server-side guard stays as defense-in-depth. No function-side fix possible |
| O5 | Medium | **Auth gates are client-only** (no Next middleware); `/manager`, `/dashboard`, `/manager/qr` render their shells to anyone and rely on RLS/RPC for data. Data is safe (verified), but defense-in-depth says add a server-side gate. | Add `middleware.ts` with Supabase SSR session check for `/manager*` and `/dashboard*` |
| O6 | Low | **Invite tokens ride in the URL path** (`/join/<token>`) — persisted in history/proxy logs, unlike the scrubbed `#t=` fragment pattern. | Move to fragment or one-time exchange code |
| O7 | Low | **Unlimited session minting with a valid QR token**: successful validations aren't rate-limited (only failures are), so a photo of the sticker can mint unbounded 12h sessions (table bloat). Voice quota (40/5min/session) caps the expensive path. | Optional: cap concurrent active sessions per location |
| O8 | Low | **No client `maxLength` on roster/invite names** (server allows 60 chars for tip_employees; other inputs unbounded). | Add maxLength attributes |
| O9 | Info | `$0 + $0` saves are allowed — **intentional** per SETUP.md ("$0 must be accepted"). | No action |
| O10 | Info | Path-traversal-shaped tokens (`../../etc/passwd`) are rejected at the Supabase edge with 403 before reaching the function — safe, just a different code than the app's 401. | No action |

## Test-data note

The rate-limit burn-down wrote ~55 intentionally-failed rows to
`tip_auth_attempts` keyed to random throwaway identifier hashes (no real
device IPs). The ledger auto-deletes rows older than 2 days
(`tip_auth_attempt_allowed` cleanup), so no manual cleanup is needed. No
`tip_entries`, sessions, or roster rows were created — no valid entry token
was available to the harness, and none was needed.

## Validation that the fixes broke nothing

- `npm run typecheck` — green
- `npx eslint src --max-warnings=0` — green
- `npm run test` — 195/195 (17 files), including a new CSV-injection
  regression test
- `npm run build` — green (15 routes)
- `deno check` on the four tip functions — only the 3 pre-existing
  strict-mode errors that exist identically on `main`
- Browser verification of the preview deployment by an independent agent:
  entry landing, malformed-token handling, scan screen, dashboard login
  gate, 404/error pages, and the new security headers.

## Deploy checklist (after merge)

1. `supabase db push` (applies `20260827120000_tip_manager_fix_entry.sql`)
2. `supabase functions deploy tip-entry-auth tip-entries tip-voice-parse tip-voice-stream`
3. Vercel: merge deploys `web/` automatically
4. Set `ALLOWED_ORIGINS` (O2)
5. Resolve the smelter.com domain situation (O1)
