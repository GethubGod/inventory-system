# Kitchen requests: handback

Branch `feat/kitchen-requests` (worktree `.claude/worktrees/kitchen-requests`),
cut from `origin/main` 1e52e7a. Contract: `kitchen-requests-contract.md`.
Decision trail: `kitchen-requests-trail.tsv`. Demo shots:
`kitchen-requests-demo/` (01-08 real screens, 90-91 the mockup).

## What shipped

- `/kitchen` web app (Next.js, same `web/` project): sign in with name + PIN
  (existing `login-with-name` edge function) or email + password; chef
  screen (item grid, quantity sheet, live log) and kitchen display (queue,
  tap = ready, 6 s undo, 3 min alert colour, connection line). No device
  slider: the screen comes from the user's modules; accounts with both get
  a Chef / Kitchen display switch. Every request is stamped server-side with
  the sender's username and @tag (login handle) and time.
- Dashboard: `/dashboard/kitchen` item editor (name, unit, scope, order,
  deactivate) and two new per-user modules on Team → Modules:
  **Kitchen requests** (chef) and **Kitchen display**. Managers default on,
  employees off. Invite presets accept the keys too.
- Backend: migration `20260831120000_kitchen_requests.sql` (tables
  `kitchen_items`, `kitchen_requests`; RPCs `kitchen_send_request`
  (idempotent by client key) and `kitchen_update_request` (ready /
  undo_ready / cancel / clear); helper functions; RLS by module and
  works-at location; realtime publication; six seeded items).
- Reliability: realtime feed with 5 s polling while down and 30 s safety
  poll while live; refetch on reconnect/foreground; sends time out at 8 s and
  fail loudly; retries reuse the client key so nothing duplicates;
  unacknowledged sends persist in localStorage and replay on the next load;
  rows race-proof (server `updated_at` wins, fetch snapshots never erase
  newer rows); optimistic ready/undo with rollback only if still ours.

## Verification (all local, honest results)

| Check | Command | Result |
| --- | --- | --- |
| Web typecheck | `cd web && npm run typecheck` | green |
| Web lint | `npm run lint` | green (0 problems) |
| Web unit | `npm run test` | 24 files, 269 tests, green |
| Web build | `npm run build` | green, `/kitchen` and `/dashboard/kitchen` prerendered |
| Migration + SQL fixture | local full stack (`scripts/local-db/full-stack.sh up`) then `scripts/local-db/kitchen_requests_fixture.sql` | `PASS: kitchen requests fixture assertions all held` |
| E2E (10 scenarios) | `web/e2e/kitchen.spec.ts` against the local stack, see `web/e2e/README.md` "Kitchen suite" | 10/10, three consecutive runs |
| Cross-vendor review | Codex Sol reviewed the frontend twice; Claude (Opus) adversarially reviewed the migration | findings and fixes in the trail |

Not verified: nothing was deployed; the mobile app is untouched (it ignores
the new module keys, `src/services/userModules.ts`).

`scripts/local-db/verify-migrations.sh` currently fails on plain `main` at
`20260828100000_tips_v3_grat_scope_weights_notes.sql` (a tips function
signature the 2026-08-11 snapshot predates), before it reaches the kitchen
migration. `full-stack.sh` skips that file and applied everything else.

## Deploy order (needs David)

1. `supabase db push` (or MCP `apply_migration`) for
   `20260831120000_kitchen_requests.sql`. Additive and idempotent.
2. `supabase functions deploy accept-invite` (module keys). See the esm.sh
   note below before deploying any function.
3. Merge and let Vercel deploy `web/`. Optional: `kitchen.smelterpos.com`
   per the subdomain-per-module convention (the app also works at
   `/kitchen` on the existing host).
4. On Team → Modules, turn on **Kitchen requests** for chefs and **Kitchen
   display** for the kitchen account(s). Employees need a name + PIN (or
   password) set in the app to sign in by name; managers can use email.
5. Regenerate `web/src/types/database.ts` after the push if you like; the
   kitchen entries were spliced from a `supabase gen types` run against the
   local stack and match it except `kitchen_actor_identity`, which the
   generator types as `Record<string, unknown>` (the client narrows it).

## Found along the way

- **esm.sh drift breaks fresh edge-function bundles.**
  `https://esm.sh/@supabase/supabase-js@2.57.2` (imported by
  `login-with-name`, `list-users`, `accept-invite`, others) now points its
  types at `@supabase/storage-js@2.99.1/dist/module/StorageClient`, which
  404s. The local edge runtime cannot boot those functions. Production keeps
  serving the bundles built at deploy time, but a redeploy may hit the same
  resolution. Appending `?no-dts` to the import (or pinning with
  `?deps=`/`npm:`) fixes it; the E2E name + PIN and Team page runs used that
  patch locally and it was reverted, not committed. Decide before step 2.
- Dev-only "1 Issue" badge on every page: React's `eval()` notice against
  the strict CSP in `next.config.ts`. Not present in production builds.
- `kitchen_user_location_ok` needs a `public.users` row for the account;
  all 13 production profiles have one (invite acceptance creates it).

## What to test on the floor

1. Manager: Dashboard → Kitchen shows the six items; add one, reorder,
   deactivate. Team → Modules: toggle Kitchen requests / Kitchen display.
2. Chef phone: `/kitchen`, sign in by name + PIN, pick the store once, tap an
   item, +1/+5/+10, Send. The log shows "You" and the time; the kitchen
   display shows the name and @tag.
3. Kitchen display: tap a row, watch the chef's row flip to READY; Undo
   within 6 s; after 3 minutes the age turns red.
4. Airplane mode on the phone, send: "Didn't send" with Retry; back online,
   Retry lands once. Reload the page mid-send: it replays by itself.
5. Deactivate an item while a chef has it on screen: the send is refused with
   the reason and no Retry.
