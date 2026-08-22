# Tip Dashboard v2 — verification notes (2026-08-20)

How the branch was verified against the live backend before the PR. The
database launched empty (v2 went live the same day, stickers not yet
printed), so every check ran through the real product surfaces and was
cleaned up afterwards — the tip activity tables were left at zero rows.

## Local gates

- `npm run test` — 120 unit tests (61 existing + 59 new: range math, close-time
  timing, missing-shift derivation, take-home aggregation, CSV rules).
- `npm run typecheck`, `npm run lint`, `npm run build` — clean.
- `npm run test:e2e` — all 7 Playwright specs pass in one run against the
  live backend (`E2E_ALLOW_LIVE_WRITES=1`; tokens in the untracked
  `web/.env.e2e`). Three spec updates were needed, all environmental or
  era-related, none behavioral: clearing schedule-pre-selected chips before
  the deterministic split-math scenario, `exact: true` on the carousel's
  "Next" (the Next.js dev-tools button's accessible name now collides),
  a chip-scoped locator for "Lena" (the closer header pill also matches),
  and retrying carousel advances that race its scroll animation.

## Backend deploy window

- Migration `20260820120000_tip_dashboard_schedule_verify` applied via
  `supabase db push --include-all` (dry-run first; it picked up exactly this
  one file). Verified live: table + index + manager-only RLS policy,
  `tip_entries.flag_verified_at/by`, and the column-limited manager SELECT on
  `tip_entry_sessions` (grants cover id/location/closer/created/last_seen/
  expires/revoked — `token_hash` stays service-role-only).
- `tip-entry-auth` v4 and `tip-entries` v4 deployed in the same window;
  both return clean 401s for invalid sessions, and `validate_token`/`state`
  now ship `scheduled` per roster person while `get_slot` ships
  `scheduledIds` for the requested meal.

## Live product walkthrough (then cleaned up)

- Manager dashboard (signed in as the `test@test.com` manager): schedule
  pills toggled on Staff & schedule persisted to `tip_employee_schedules`
  with the right weekday encoding (Thu=4, Wed=3 — SQL-checked); both entry
  tokens rotated from the device cards (confirm dialog → plaintext shown
  once → printable `/manager/qr` page renders the QR); Fix dialog edited a
  recorded entry's amounts + split under RLS; Export CSV downloads the
  filtered ledger; range picker/arrows and the location segment recompute
  every number.
- Entry phone (real `/e?t=…` scan flow): scheduled people arrived
  pre-selected and sorted first (Sushi Thu dinner → Maria + Ken selected,
  Jose at the bottom); switching meals re-seeded the selection from that
  meal's schedule; a full save ran through `tip_save_entry` and signed the
  phone out; with dinner recorded, a fresh session preset landed on Lunch
  with that meal's scheduled person pre-selected (screenshot 6).
- Numbers cross-checked against SQL for the visible range: cash pool, card
  total, record + flagged counts, per-person cash take-home (round-half-up
  per entry), entry-log on-time % / median / missing count, and the
  location-segment splits — all matched.

## Not exercised live

- The Verify button (no flagged row can exist yet — the anomaly rule needs
  14 days of history). The write is a one-column UPDATE under the same
  manager RLS policy the Fix dialog exercised; the "verified rows stop
  counting as flagged" logic is unit-tested.

## Notes for David

- Both entry tokens were rotated during verification (they were the seeded,
  never-printed ones — rotating was already on the chore list). The new
  plaintexts sit in the untracked `web/.env.e2e` of the
  `tip-dashboard-v2` worktree for future e2e runs. Since they passed through
  an AI session, rotate once more from the dashboard right before printing
  the real stickers.
- Dev-only quirk observed (pre-existing, not from this branch): under
  `next dev`, React StrictMode double-runs the `/e` token effect and mints
  two sessions per scan; the closer can land on the session localStorage
  discards, so a dev save can show "—" for entered-by. Production mounts
  once and is unaffected.
