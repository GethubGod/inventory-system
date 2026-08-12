# Roadmap build — handoff (as of 2026-08-12)

Branch: `roadmap/integration` (41 commits ahead of `origin/main`). PR open against `main`.
**Never push to `main` directly** — a `main` push production-deploys `web/` via Vercel.
David reviews the whole branch once at the end; nothing is deployed by agents.

Read first: `docs/ROADMAP.md` (the spec), `docs/phases/phase*-contract.md` (backend/frontend
seams per phase), `docs/deploy/NEEDS-DAVID.md` (the running list of things only David can do).

## Operating rules established this session

1. **Codex builds backend, Claude builds frontend.** Backend = migrations, RPCs, edge
   functions, `src/services/*` data layer. Frontend = RN screens, `web/` dashboard pages.
2. **Every phase gets a written contract** in `docs/phases/` before agents start, pinning
   the exact service signatures both sides code against, so they can run in parallel.
3. **Independent verifier agents** check acceptance criteria against the roadmap, not
   against builder claims. Their reports live in `docs/phases/*-verification.md`. Findings
   get fixed by a separate agent before the phase is called done.
4. **Migrations are proven locally, never pushed.** `scripts/local-db/verify-migrations.sh`
   spins a disposable postgres:17 container, loads `auth_stub.sql` + `baseline_public_schema.sql`
   (a read-only snapshot of production's public schema pulled via the Supabase MCP), then
   applies only the migrations new on this branch. Phase fixtures (`phase5a_*`, `phase6b_*`,
   `phase6c_*`) run against it with `--keep`. **All 11 new migrations currently PASS.**

## Gotchas that will bite you

- **`supabase start` cannot bootstrap this repo.** Migration history begins mid-stream
  (`locations`, `users`, `inventory_items`, `orders`, `suppliers` predate it). Use the
  harness above instead. Local ports were moved to 54421/54422/54423 (defaults collide
  with the `one-month-turnaround` project).
- **Worktree agents get cut from `main`, not the current branch.** Every worktree agent
  prompt must begin with: "run `git log --oneline -1`; if HEAD is not `<expected sha>` or a
  descendant, `git reset --hard roadmap/integration`."
- **Jest ignores `/.claude/`**, so worktree agents must run
  `npx jest --runInBand --watchman=false --testPathIgnorePatterns=/node_modules/`
  instead of `npm run test:ci` (which silently discovers 0 tests there).
- **Codex's sandbox cannot commit** (`.git/index.lock` denied) or run Docker. The
  orchestrator commits Codex's work and runs the harness afterward. The `codex-rescue`
  subagent is a one-shot forwarder — poll from the main loop with
  `node ~/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs status|result <task-id>`.
  Codex jobs sometimes wedge in `verifying` after finishing the actual work; monitor with a
  log-idle timeout (~15 min) and take over by committing the on-disk files.
- **`.expo/types/router.d.ts` is stale** (generated June 2026) and does not regenerate from
  `expo start`/`export` in this environment. New routes need a cast at the `router.push`
  call site — see `SimpleOrderScreen.tsx` for the existing pattern.
- **Do not touch these files** — another live session owns them:
  `docs/mockups/tips-dashboard/*`, `web/src/app/{e,closer,pin}`, `web/src/components/entry*`,
  `web/src/components/manager/*`, `supabase/functions/tip-*`, `web/e2e/*`.

## Status by phase

| Phase | Backend | Frontend | Verified |
|---|---|---|---|
| 0 Merge foundation | ✅ | — | ✅ |
| 1 Rapid Send All | ✅ | ✅ | ✅ + findings fixed |
| 2a Dashboard shell/Team/Suppliers | ✅ | ✅ | ✅ |
| 2b Invite links | ✅ | ✅ | ✅ + findings fixed |
| 3 Module toggles | ✅ | ✅ | ✅ + findings fixed |
| 4 In-app tips | ⛔ FROZEN | ⛔ FROZEN | — |
| 5a Checklist core | ✅ | ✅ | ✅ (generation proven in harness) |
| 5b Direct send + editors | ✅ | ✅ | ✅ + findings fixed |
| 5c Order reminders | ✅ | ✅ | ⬜ not independently verified |
| 6a Parse spike | ✅ report | — | GO recommendation, synthetic data only |
| 6b Screenshot import | ✅ | ❌ **NOT BUILT** | ⬜ |
| 6c Holiday templates | ✅ | ❌ **NOT BUILT** | ⬜ |
| 7a Receiving | ✅ | ✅ | ⬜ not independently verified |
| 7b Invoice reconciliation | ✅ | ❌ **NOT BUILT** | ⬜ |
| 8 Localization | ❌ **NOT STARTED** | ❌ | — |
| 9a Stock check core | ✅ | ❌ **NOT BUILT** | ⬜ |
| 9b Stock check polish | ❌ **NOT STARTED** | ❌ | — |
| 10 Analytics + digest | ❌ **NOT STARTED** | ❌ | — |

## Next actions, in order

1. **6b dashboard import UI** — the only phase whose frontend agent died mid-run (session
   limit). Backend is committed and complete: `src/services/screenshotImports.ts`,
   `supabase/functions/parse-order-screenshot`, migration `20260812180000`. Spec is in
   `docs/phases/phase6-7-contract.md` §6b Frontend. Extend
   `web/src/components/dashboard/OrderingPage.tsx` with an import tab: upload to the
   `order-screenshots` bucket → invoke parse → poll → review screen where **every** row must
   end matched/manual/skipped (the `confirm_screenshot_import_review` RPC enforces this
   server-side) → merge.
2. **6c holiday templates frontend** — dashboard template CRUD + app checklist banner.
   Backend exposes a non-destructive overlay (`get_checklist_holiday_overlay`), so the app
   renders adjustments without mutating stored checklist rows.
3. **7b invoice frontend** — camera/photo capture from the receiving screen → upload to
   `supplier-invoices` → parse → compare view highlighting price changes and qty mismatches
   → confirm writes `supplier_price_history`.
4. **9a stock check frontend** — guided walk-through, numpad / Full-Low-Out entry, pars
   editing, "start order from this check" feeding the Phase 5 checklist via
   `createChecklistFromCheck`. Full spec: `docs/stock-check-proposal.md`.
5. **Verifier round 3** over 5c, 6b, 6c, 7a, 7b, 9a once their frontends exist.
6. **Phase 8 (localization)** — run this *after* app screen churn settles; it touches every
   employee-facing string. Can run parallel to 9b/10.
7. **9b stock check polish**, then **Phase 10 analytics + weekly digest**.
8. **Final pass** (task #15): full suite + typecheck + lint, rebase on latest `origin/main`
   to absorb David's tips work, iOS simulator smoke-test of every new screen, fix trivia,
   write the per-phase deploy checklists in `docs/deploy/`.

## Phase 4 is blocked on David

Two of David's own sessions are rewriting the tip edge functions
(`feat/tips-qr-sessions` — PIN page removed, `/closer` added, `tip-entry-auth` reworked) and
the tips dashboard. Phase 4 builds *on top of* those, so it stays frozen until David
confirms they are merged to `main`. When he does: rebase this branch on `origin/main` first,
then build 4a (native typed entry, extend tip edge fns to accept Supabase-authed users
alongside device-session tokens) and 4b (voice entry + `tip_employees` ↔ `profiles` identity
unification).
