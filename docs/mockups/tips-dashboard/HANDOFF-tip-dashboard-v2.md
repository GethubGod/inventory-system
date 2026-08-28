# Handoff — build the new Tip Dashboard (manager web) for real

You are implementing a finalized, approved design. Do not redesign, simplify the
scope, or add features beyond this document. When something here conflicts with
what you find in the repo, the repo's *backend* is the truth for data shapes and
this document is the truth for *product behavior* — stop and flag genuine
contradictions instead of guessing.

## Mission

Replace the v1 manager page of the Babytuna tips web app with the new
**Tip Dashboard**, exactly as specified by the interactive mockup at
`docs/mockups/tips-dashboard/tip-dashboard-final.html`, wired to the live
backend end to end — including the pieces that connect to the employee entry
client (schedule pre-selection, device sessions, entry log).

Open that mockup in a browser first (`python3 -m http.server` in its folder —
file:// also works) and click through everything before writing code.

**Design decisions already locked (do not revisit):**
- Visual language: the mockup's **"2 · App style"** version — neutral white page
  `#f5f5f4`, white cards, red accent `#e84d38`, pill buttons, red-tint active
  nav. The version tabs and the dark top chrome bar in the mockup are
  mockup-only controls — do NOT build them.
- Table row identity: **strong** color coding — black `Sushi` chip, blue
  (`#2563eb`) `Poki & Pho` chip, tinted cash/card column groups.
- Overview visualization: **Trend & people** (red daily-total line + area, plus
  "cash take-home by person" ranked bars). The daily-bars and week-grid
  variants were rejected; don't build them.
- Sidebar: collapsible (216px ↔ 66px icon rail), pages **Overview / Recorded
  tips / Staff & schedule / Devices & entry log** (device cards ABOVE the entry
  log on that page), profile block + **Log out** button at the bottom.
- Page title is "Tip Dashboard" — no "Babytuna" suffix next to the h1.
- All explanatory copy lives behind small ⓘ info-popovers, never as visible
  paragraphs.
- Full-width layout: no content max-width; tables must fit without horizontal
  scrolling at ≥ ~1100px viewports (keep `overflow-x:auto` + sensible
  min-widths only as a narrow-screen fallback).

## Where you are working

- Repo: `InventorySystem` (this repo). The web app is the top-level `web/`
  Next.js project (App Router, Tailwind v4 tokens in
  `web/src/app/globals.css`).
- **Branch off `origin/main`** (currently at or past `a721b6b`). ⚠️ The LOCAL
  `main` branch is a stale, diverged lineage — never base work on it. Do not
  push to `main` yourself; open a PR.
- Production: Vercel project `inventory-system` (root dir `web`) serves
  https://tips.babytunasystems.com from `main`. Supabase project
  `whrohvitvmcrmedepurd` (linked; CLI is authenticated).
- Parallel work warning: branch `roadmap/integration` holds an unrelated
  dashboard build (Team/Suppliers/Ordering pages under
  `web/src/components/dashboard/` and `/dashboard` routes). Your work is the
  **tips manager** surface only: stay in `/manager` routes and
  `web/src/components/manager/` (+ `web/src/lib/tips/`), so the two merge
  cleanly later.

## Current v1 manager (what you are replacing)

`web/src/app/manager/page.tsx` → `ManagerApp.tsx` with tabs (Entries / Roster /
Admin), `LoginCard.tsx` (heading already says "Tip Dashboard"). Supabase email
auth; manager = `profiles.role='manager'` via `public.current_user_is_manager()`
(RLS on every `tip_*` table). Keep the login card flow; restyle to match the
mockup shell. Keep `/manager/qr` (printable QR page) working — the device page
links to it.

## Backend you already have (do not rebuild)

Tables (see `supabase/migrations/20260806120000_tips_web_foundation.sql` and
`20260811204219_tip_entry_session_duplicate_guard.sql`; regenerate types or use
`web/src/types/database.ts`):

- `tip_employees` — id, name, `location_id` (NULL = works at BOTH locations),
  active, sort_order.
- `tip_entries` — one row per (business_date, location_id, meal_period
  'lunch'|'dinner'); `cash_amount`/`card_amount` numeric(10,2);
  split_count; entry_method 'typed'|'voice'; corrections_count; `entered_by` →
  tip_employees; `flagged_anomaly` + `anomaly_reason`; `entry_session_id`;
  **`created_at`/`updated_at`** (these power the entry log).
- `tip_entry_people` — the split membership.
- `tip_location_access` — per location: `entry_token_hash`,
  `token_rotated_at` (PIN columns exist but PIN is DEAD — v2 is QR-only; never
  surface PIN).
- `tip_entry_sessions` — per-scan sessions: `closer_id`, `created_at`,
  `last_seen_at`, `expires_at` (12h), `revoked`. A session ends after a save
  (v2 behavior). These rows power "phones scanned in" + "recent scans".
- RPCs (service-role/manager): `tip_rotate_entry_token`,
  `tip_revoke_location_sessions`, `tip_save_entry` (13-param, duplicate-guard,
  raises `already_recorded`).
- Edge functions (live): `tip-entry-auth`, `tip-entries`, `tip-voice-parse`
  (+`tip-voice-stream`). The employee entry app at `/`, `/e`, `/entry`,
  `/closer` uses them. **Do not break the entry flow.**
- Managers hit tables directly through supabase-js under RLS (v1 already does
  this) — keep that pattern for dashboard reads/writes.

Locations: `public.locations` — the two rows are Babytuna Sushi and Babytuna
Poki & Pho; resolve ids at runtime, never hardcode.

## New backend you must add (one additive migration, plus edge-fn edits)

1. **Weekly schedule storage** — new table, e.g. `tip_employee_schedules`:
   `(tip_employee_id, location_id, weekday smallint 0-6, meal 'lunch'|'dinner')`
   unique across the tuple; manager-only RLS like the other tip tables; grants
   mirroring `tip_employees`. An employee who works both locations has separate
   rows per location (matches the mockup's per-location schedule lines).
2. **Verify flow** — `tip_entries` add `flag_verified_at timestamptz`,
   `flag_verified_by uuid references auth.users`. "Verify" on a flagged row
   sets them (manager RLS update); verified rows stop counting as flagged in
   KPIs/attention.
3. **Schedule pre-selection on the phone (employee client connection)** —
   extend the `tip-entry-auth`/`tip-entries` responses so the entry client
   receives, for the session's location and current business date, the roster
   with a `scheduled: boolean` per person for that meal period. Client change in
   the entry flow: scheduled people come **pre-selected** in the "who's
   splitting" chips and sort first; unscheduled staff sort to the bottom,
   unselected. (This is the only entry-client change in scope. Business-date
   rule: America/Los_Angeles with 4am rollover — reuse
   `web/src/lib/tips/businessDate.ts`; meal close times: lunch 15:00, dinner
   22:00.)

Migration constraints: **additive only**, never edit an applied migration.
Local `main`-lineage checkouts miss the `202608121*` roadmap migrations that
ARE applied remotely — so validate with `supabase db push --dry-run
--include-all` and expect to use `--include-all` when applying. Deploying
edge-fn changes: deploy all touched functions together with the migration.

## Page-by-page spec (the mockup is the visual truth; this is the data truth)

Shared toolbar on every page: time-frame button (opens a card: This week / Last
week / This month / This year — real date math over `business_date`, ‹ ›
arrows step weeks), location segment (Both / Sushi / Poki & Pho), Export CSV
(real download of the filtered ledger; reuse the CSV rules from
`docs/mockups/tips-dashboard/core/tips-core.js` — per-record year from the
record, quoted/escaped fields). Header strip: flagged count pill, cash pool
total, card total, record count — all filter-aware.

1. **Overview** — Trend & people (compute from `tip_entries` + people in
   range): daily cash+card totals polyline; take-home = each entry's
   `cash_amount / split_count` share summed per person (display rounded, and
   note it's cash only). "Needs attention" list: unverified flagged entries →
   Review (jumps to ledger), missing shifts (see entry-log rule) → See log,
   plus device warnings (token never rotated). Each row navigates to the right
   page.
2. **Recorded tips** — the dense ledger: rows newest-first grouped by day with
   day-total rows; columns Business date / Restaurant chip / Meal / Cash /
   Split between (names · count) / Per person / Card → payroll / Entered by ·
   method / actions. Flagged row: red tint + "⚑ check" chip + **Verify**
   button (writes the new columns). **Fix** re-opens a slot for correction: a
   manager edit dialog updating the entry + people under RLS (manager edits
   don't go through `tip_save_entry`).
3. **Staff & schedule** — add-hire form (name + works-at), then per-employee
   rows: works-at select (maps to `location_id`: sushi id / poki id / NULL for
   both), per-location schedule lines (Sushi chip black, Poki chip blue), 7
   day-cells with L/D toggle pills persisting to `tip_employee_schedules`,
   shifts/week count, **Rename** and **Deactivate/Reactivate** buttons
   (deactivate = `active=false`, history intact; delete only if no recorded
   history — mirror v1 rules). Location segment filters rows AND lines exactly
   like the mockup.
4. **Devices & entry log** — device cards FIRST: per location — QR sticker
   status (`token_rotated_at`, or "never rotated" warning), **Rotate…**
   (existing RPC + confirm dialog; plaintext shows once then link to
   `/manager/qr` print page), sessions summary from `tip_entry_sessions`
   (count in range, last scan time, recent scans with closer names), **Sign
   out all** (`tip_revoke_location_sessions`). Then the entry log: one row per
   entry in range — date, chip, meal, entered by, method, logged-at
   (`created_at` in America/Los_Angeles), timing badge vs close time (green
   ≤45min, amber later same night, red next-day). **Missing** rows (red, on
   top): business dates in range where the schedule says someone was scheduled
   for that location+meal but no `tip_entries` row exists and the shift's
   close time has passed. KPIs: on-time %, median minutes after close, missing
   count.

Auth shell: keep LoginCard; after sign-in render the sidebar app. Log out =
`supabase.auth.signOut()` back to the card. Profile block shows the signed-in
user's name/email.

## Definition of done

- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass
  in `web/` (add unit tests for new pure logic: range math, timing badges,
  missing-shift derivation, take-home aggregation — put pure logic in
  `web/src/lib/tips/`, unit-tested like the existing modules).
- Entry flow regression: existing Playwright suite still passes (read
  `web/e2e/README.md` FIRST — it writes live data, needs
  `E2E_ALLOW_LIVE_WRITES=1`, run `cleanup.sql` before).
- Every dashboard number is filter-consistent (range × location) and matches a
  hand-checked SQL query for at least one week of real data.
- Schedule set in the dashboard visibly pre-selects people on the entry phone
  for that business date/meal.
- No PIN UI anywhere; `/manager/qr` still prints; rotating a token still shows
  plaintext exactly once.
- Migration applied via `supabase db push --include-all` (dry-run first); the
  paired edge functions deployed in the same window; PR opened against `main`
  with screenshots of all four pages (desktop + one narrow-width shot showing
  the scroll fallback).

Ask David before: any schema change beyond the three listed, touching the
entry flow beyond schedule pre-selection, or merging/deploying.
