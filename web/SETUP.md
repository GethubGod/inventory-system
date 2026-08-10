# Babytuna Tips — setup & runbook

End-of-day tip entry web app (`web/`), replacing the paper tip sheets for
Babytuna Sushi and Babytuna Poki & Pho. Employees enter tips on their phones
(voice-first, typing as an equal fallback); managers get a dashboard with
exports. Lives in the same repo + Supabase project as the mobile app.

> **Status 2026-08-08:** backend **and frontend are deployed and verified.**
> Migrations applied, all four edge functions ACTIVE, and `web/` deploys from
> Vercel project `inventory-system` (root directory `web`, framework
> Next.js; env vars set for Production + Preview). The branch
> `feat/tips-web-app` serves at **https://babytuna-tips.vercel.app** (a
> project domain pinned to that branch; after merge, production serves from
> `main` on the project's default domains). One manual step remains:
> **Vercel → Settings → Deployment Protection → Vercel Authentication →
> Disabled** — until then every `*.vercel.app` URL of this project sits
> behind a Vercel SSO interstitial and phones can't open the QR links.
> Test access (tokens/PINs/placeholder roster) is seeded; a Playwright E2E
> suite + voice-parse harness live in `web/e2e/` (see `e2e/README.md`) and
> pass against local dev; two Codex review rounds ended with no blocking
> findings. Post-merge chores are listed in the launch handoff note.

## 1. Environment

`web/.env.local` (never committed):

```
NEXT_PUBLIC_SUPABASE_URL=https://whrohvitvmcrmedepurd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same value as EXPO_PUBLIC_SUPABASE_ANON_KEY in the repo-root .env>
```

On Vercel set the same two env vars for the project (root directory: `web`).
No service-role key anywhere in the web app — privileged work happens in edge
functions.

## 2. Database

New migration: `supabase/migrations/20260806120000_tips_web_foundation.sql`
(tables `tip_employees`, `tip_entries`, `tip_entry_people`,
`tip_location_access`, `tip_entry_sessions`, `tip_auth_attempts`; manager-only
RLS; validation + rotation RPCs). Apply with:

```
supabase db push
```

(or the Supabase MCP `apply_migration`). It only creates new objects — nothing
existing is touched. It was validated locally against Postgres 17
(`supabase/postgres` image): schema applies cleanly and the RPC smoke tests
(rotation, token/PIN validation, rate limiting, upsert conflict target) pass.

## 3. Edge functions

Four new functions (all modeled on the existing quick-order patterns):

| Function | Purpose | verify_jwt |
| --- | --- | --- |
| `tip-entry-auth` | validate QR token / PIN, mint entry sessions, session state, set closer | default (anon key as bearer) |
| `tip-entries` | read today's slot, save entry (+ anomaly check at save) | default |
| `tip-voice-parse` | audio chunk + known fields → parsed tip fields (Gemini) | default |
| `tip-voice-stream` | WebSocket relay for the live-transcript A/B variant (Gemini Live) | **false** (set in `supabase/config.toml`) |

Deploy:

```
supabase functions deploy tip-entry-auth tip-entries tip-voice-parse tip-voice-stream
```

Secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):

- `GEMINI_API_KEY` — already set for quick-order voice; reused here.
- Optional overrides: `TIP_VOICE_MODEL` (default `gemini-2.5-flash`),
  `GEMINI_LIVE_MODEL` (default `gemini-live-2.5-flash-preview`).
- Recommended once the Vercel domain exists: add it to `ALLOWED_ORIGINS`
  (comma-separated) to restrict browser CORS on all functions.

## 4. Run locally

```
cd web
npm install
npm run dev        # http://localhost:3000
npm run test       # Vitest unit tests
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # must pass before deploy
npm run test:e2e   # Playwright E2E against the live backend — read e2e/README.md FIRST
```

The entry flow needs real edge functions + tables (see above) — there is no
mock mode.

## 5. Access setup (tokens, PINs, QR, NFC)

Everything is rotated from **/manager → Admin** (manager Supabase login =
same account as the mobile app, `profiles.role = 'manager'`).

- **Entry token** ("Rotate entry token"): generates a new URL token for a
  location. Tokens are stored hashed (sha256), so the plaintext is shown
  **once** — the button then opens the printable QR page. Rotating kills the
  old sticker immediately.
- **PIN** ("Rotate PIN"): 4-digit keypad fallback per location; choose one or
  let it generate randomly. Stored bcrypt-hashed; shown once. Validation is
  server-side and rate-limited (6 tries / 10 min per device+IP, 30 / 10 min
  per location; entry tokens: 20 / 10 min per device+IP).
- **Seeding**: on a fresh database there are no tokens/PINs — "rotating" the
  first time creates them. Do that once per location, print, done.
- **Roster**: add tip-eligible staff (name + location scope Both/Sushi/Poki)
  in Admin → Roster. The "Who's closing?" screen and splitting chips read
  from this roster. Deactivate, don't delete, when someone leaves.
- **Sign out all devices** (Admin, per location): revokes every already-minted
  entry session for that location — use after a lost phone. Rotating the
  token/PIN alone only stops *new* sign-ins.

### Printing the QR stickers

After rotating a token you land on `/manager/qr?...` — hit Print (the page is
print-styled). One sticker per location, by the register. The QR encodes
`https://<your-domain>/e?t=<token>`.

### NFC tags

Buy **NTAG213** (or 215) NFC stickers — any cheap 25mm round ones. Write the
same URL as the QR (`https://<your-domain>/e?t=<token>`) as an **NDEF URL
record** using any writer app (e.g. "NFC Tools" on iOS/Android: Write → Add a
record → URL → write). Then optionally lock the tag. iPhone XS+ reads them in
the background; Android natively. There is **no Web NFC in the app** — the
tag is just a URL launcher. After rotating a token, re-write the tag with the
new URL.

## 6. How sessions & security work

- Scanning/tapping opens `/e?t=<token>` → `tip-entry-auth` validates the
  token server-side (hash compare + rate limit) and mints an opaque
  **entry session** (localStorage, ~180 days), scoped to that location.
- Entry sessions can only call the three entry functions; the anon key has
  **zero** direct access to tip tables (RLS: manager-only policies). Location
  scoping is enforced server-side from the session record — never by client
  parameters.
- "Who's closing?" is **attribution, not authentication** (anyone can tap any
  name); it fills `entered_by`.
- Saves are **atomic** (a SQL RPC upserts the entry and replaces its people in
  one transaction), voice parsing has a per-session quota (40 chunks / 5 min),
  and the live-transcript WebSocket authenticates with a **single-use 60s
  ticket** so the long-lived session token never appears in a URL. The QR
  token is stripped from browser history right after landing, and the manager
  QR page receives the freshly rotated token via the URL fragment only.
- Manager dashboard = real Supabase auth + `current_user_is_manager()` RLS.
  Entry tokens/PINs never grant dashboard access.

## 7. Business rules (documented + unit tested)

- **Business date**: America/Los_Angeles, rolls over at **4am** — a 12:30am
  save after Friday dinner belongs to Friday. (`src/lib/tips/businessDate.ts`)
- **Meal default**: before 4pm LA → Lunch, else Dinner (0–4am counts as
  dinner).
- **One entry per (date, location, meal)**: saving an existing slot edits it
  in place (the form shows "Already recorded — editing"); enforced by a DB
  unique constraint + upsert.
- **Split math**: per-person = (cash + card) / people, computed in integer
  cents, rounded to the **nearest cent (half-up)**; leftover cents stay in
  the drawer (shares × count may be a few cents under/over the pool).
  Per-person amounts are derived, never stored. (`src/lib/tips/split.ts`)
- **Anomaly rule** (save-time, never blocks): with ≥14 historical entries for
  the same location+meal, a cash/card amount is flagged when it is **both**
  above the max ever recorded **and** more than 3× the historical median —
  i.e. record-setting alone doesn't nag; typo-scale values do. The closer
  confirms "Save anyway?" and the entry is stored with
  `flagged_anomaly = true` + reason (Discrepancies tab shows them).
  (`src/lib/tips/anomaly.ts`; the spec suggested "above max-ever **or** 3×
  median" — the AND variant was chosen so every record-setting busy night
  doesn't produce a false alarm; tweak in one place if you'd rather have OR.)
- **A/B test**: each device is randomly, persistently assigned `waveform` or
  `live_transcript`; every voice entry records the variant plus
  `corrections_count` (fields edited/re-recorded in review). Dashboard → A/B
  test shows entries + avg corrections per variant. If a voice entry is later
  re-saved as typed, the original variant + corrections are preserved on the
  row (the readout keys on `voice_variant`), so edits don't erase
  observations.

Mirrored logic note: `businessDate`/`anomaly` live canonically in
`web/src/lib/tips/` (unit tested) and are mirrored in
`supabase/functions/_shared/tips.ts` (used at save time). If you change one,
change both.

## 8. Click-through verification checklist

Entry flows:
1. **Token landing**: rotate a token, open `/e?t=<token>` in a fresh private
   window → "You're in" screen with correct location + today's status → CTA →
   "Who's closing?" → pick a name → entry form. Reload the site root →
   goes straight to the form (no "You're in", no closer prompt).
2. **Bad token**: `/e?t=garbage` → friendly error + PIN fallback offer.
3. **PIN fallback**: `/pin` → pick location → wrong PIN (clears, shows error)
   → right PIN → closer → form. 7 wrong tries → rate-limit message.
4. **Typed entry**: enter cash/card ($0 must be accepted), pick 2+ people,
   watch the split strip update live, Save → reload → slot shows "Already
   recorded — editing" with values prefilled. Save with all people deselected
   is impossible (button disabled + prompt).
5. **Voice entry (both variants)**: on two different devices/browsers (or
   clear localStorage to re-roll the variant), "Speak it in" → say e.g.
   "Dinner. Cash one twenty, card three forty. Split between Maria and Jose."
   → rows check off as you pause → Done talking → review shows values +
   transcript; low-confidence fields show red-dot "?" and must be tapped;
   re-record just the card amount with its mic ("card three fifty") → Save
   tips → lands in the entry with entry_method=voice, variant + corrections
   recorded (check dashboard).
6. **Voice failure path**: kill the network mid-listen → sheet keeps captured
   fields, lets you finish by typing.
7. **Edit existing slot**: save over an existing entry → dashboard shows one
   row (edited), not two.
8. **Offline save**: airplane-mode a save → clear retry banner, values kept.

Manager:
9. **Login**: non-manager account is refused; manager sees entries.
10. **Filters + totals**: date range + location filters change rows, daily
    subtotals and range totals match by hand-check.
11. **Export**: XLSX has Entries + Per person sheets; CSV opens in Excel.
12. **Anomaly confirm**: enter an absurd amount (after ~14 real entries) →
    confirm dialog quotes the usual range → save anyway → entry appears in
    Discrepancies as flagged; missing-slot list shows a day you skip.
13. **Rotation**: rotate token → old QR dead (test it), new printable QR
    works; rotate PIN → old PIN refused, new accepted.
14. **A/B readout**: after a few voice entries, both variants show counts +
    avg corrections.
