# Handoff: get the Babytuna Tips web app fully ready for David's final test

You are picking up a finished-and-deployed-backend project. Your job: deploy
the frontend to Vercel, seed test access, build and run an automated
end-to-end verification (including a Codex-driven independent pass), fix
everything you find, and hand David a clean "ready to test" package. David
tests LAST, as final review — nothing obviously broken may reach him.

## Where everything is

- Repo: `/Users/david/Babytuna Systems/InventorySystem` (git). The tips work
  lives on branch `feat/tips-web-app`, checked out in the worktree
  `/Users/david/Babytuna Systems/InventorySystem/.claude/worktrees/tips-web-app`.
  Work THERE. David will merge branches himself — do not merge, do not touch
  `main` or `fix/quick-order-multiline-parsing` (it has uncommitted changes).
- Web app: `web/` in that worktree (Next.js 16, TS strict, Tailwind v4).
  `web/SETUP.md` is the authoritative runbook — read it fully first.
- Backend: **already live and smoke-tested** on Supabase project
  `whrohvitvmcrmedepurd` (ACTIVE_HEALTHY). Migrations applied, edge functions
  `tip-entry-auth`, `tip-entries`, `tip-voice-parse`, `tip-voice-stream`
  deployed (stream has verify_jwt=false, the rest require the anon key as
  bearer). The Supabase CLI is authenticated and the worktree is linked.
  The Supabase MCP server is also available (execute_sql etc.).
- Env: `web/.env.local` has `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon key also in repo-root `.env` as
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`). Never commit env files or print the key.
- Quality gates that must stay green (run in `web/`): `npm run typecheck`,
  `npx eslint src --max-warnings=0`, `npm run test` (57 tests), `npm run build`.

## Hard constraints

- Do NOT modify the Expo mobile app, its config, or `main`/David's branch.
- Do NOT edit already-applied migrations (everything through
  `20260807101000_*` is applied remotely). New schema changes = new
  timestamped migration + `supabase db push` from the worktree.
- You cannot log into the manager dashboard (agents must never enter
  passwords). Anything requiring manager auth is either done via
  service-role SQL (see "Seeding" below) or left for David.
- Any test data you create in the live DB must be deleted afterwards —
  except the deliberate test fixtures listed under "Seeding". Verify counts.
- Commit in logical chunks on `feat/tips-web-app` with clear messages.

## Task 1 — Vercel deployment

David has already connected the repo to Vercel. Vercel MCP tools are
available in the session (`list_projects`, `get_deployment`,
`get_deployment_build_logs`, etc.).

1. Find the Vercel project connected to this repo. Ensure its **Root
   Directory is `web`** and framework is Next.js. If settings are wrong and
   no MCP tool can change them, give David a one-line instruction to flip it
   in the Vercel dashboard and continue with everything else.
2. Set env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (values from `web/.env.local`) for Production + Preview.
3. Get a successful deployment of branch `feat/tips-web-app` (push the
   branch to the remote if it isn't; a preview deployment is fine — David
   merges later). Debug build failures via the build-log tools until green.
4. Note the stable deployment URL. Do NOT set the `ALLOWED_ORIGINS` Supabase
   secret yet (preview URLs vary; leave CORS open as it is today — flag it
   as a post-merge TODO for the production domain).

## Task 2 — Seed test access (service-role SQL, pattern already proven)

Mimic what the previous agent's smoke test did (see `web/SETUP.md` §5–6 for
the model):

1. Generate a high-entropy token per location
   (`openssl rand -base64 24 | tr '+/' '-_' | tr -d '='`), store its sha256
   hex in `tip_location_access.entry_token_hash` (upsert row per location,
   set `token_rotated_at`). Location ids: Babytuna Sushi
   `03c25829-a34d-4df6-aa5e-5cf7612ecd21`, Babytuna Poki & Pho
   `48aa6345-d32e-4599-aae5-866d14c9e9b3`.
2. Set a known 4-digit test PIN per location:
   `pin_hash = extensions.crypt('<pin>', extensions.gen_salt('bf'))`.
3. Seed roster placeholders David can rename in Admin later: 3 per location,
   names like `Maria`, `Jose`, `Ken` (scope: 2 location-specific + 1 both).
4. These fixtures STAY for David's test. Record the plaintext tokens/PINs
   for the final handoff note (they're his; rotating from /manager later
   replaces them).

## Task 3 — Automated end-to-end "simulator"

Build a real E2E harness and make it pass against BOTH local dev and the
Vercel deployment:

1. Add Playwright as a devDependency in `web/` with a small
   `web/e2e/` suite (own npm script `test:e2e`; must not break
   `npm run build` or CI-less local runs). Cover at minimum:
   - `/e?t=<token>` → "You're in" → closer pick → entry form
   - token is stripped from the URL/history after landing
   - PIN flow: wrong PIN error, right PIN proceeds; rate-limit message after
     6 bad tries (use a throwaway identifier — note it pollutes
     `tip_auth_attempts` briefly; clean up)
   - typed entry: amounts + chips + live split strip math, save, reload →
     "Already recorded — editing" prefill; edit and re-save (single row)
   - zero-people guard; $0 amounts accepted
   - returning session skips straight to the form
   - unauthenticated `/` shows the scan screen
   Grant mic permissions in the browser context but voice UI can only be
   smoke-checked (sheet opens, checklist renders, cancel works) — real STT
   goes through Task 4.
2. Voice pipeline without a microphone: synthesize speech on macOS —
   `say -o /tmp/tip.aiff "Dinner. Cash one twenty, card three forty. Split between Maria and Jose."`,
   convert with `afconvert /tmp/tip.aiff -f m4af -d aac /tmp/tip.m4a`, then
   POST it to `tip-voice-parse` (multipart: `session_token`, `audio`,
   `known_state={}`) with a session minted from a seeded token. Assert the
   parsed fields: meal=dinner, cash=120, card=340, people matched to the
   seeded roster. Test a couple of variations (corrections like "no wait,
   card was three fifty"; a cash-only utterance merged against known state;
   a `target_field=card` re-record). If accuracy is bad, tune the prompt in
   `supabase/functions/tip-voice-parse/index.ts` and redeploy that function.
3. Delete all tip_entries/sessions/attempts created by the harness runs
   (keep the Task-2 fixtures). Leave a documented cleanup script.

## Task 4 — Codex independent verification

The Codex plugin is installed. After your own fixes are in:

- Run the E2E suite and the four quality gates; everything green.
- Then invoke Codex (the `codex:rescue` agent forwards a single task; call
  the companion script directly from the main session if you need
  status/results — pattern:
  `node ~/.claude/plugins/cache/openai-codex/codex/<ver>/scripts/codex-companion.mjs task "<prompt>"`).
  Ask it for a read-only adversarial pass over everything that changed since
  commit `c15e15b` PLUS a re-check of the two prior review rounds' fixes
  (transactional saves, rate-limit locking, ticket auth, RLS on all tip_*
  tables). Triage its findings: fix real ones, document rejected ones with
  reasons.
- Repeat until Codex has no unaddressed blocking findings.

## Task 5 — the "ready to test" package for David

Finish with ONE message/file containing:
- Deployment URL + confirmation the deployed build is the tested commit.
- Entry links per location (`<url>/e?t=<token>`) — ideally also as QR codes
  David can scan from his screen (the `/manager/qr` page needs manager
  login, so generate QR PNGs yourself, e.g. with the `qrcode` package, into
  a scratch folder and attach them).
- The two test PINs.
- What was verified automatically (E2E results, voice-parse accuracy notes,
  Codex verdict) and what only David can verify: manager dashboard login,
  rotation buttons, XLSX export contents on a real machine, real-mic voice
  entry on his iPhone (both A/B variants — clearing localStorage re-rolls
  the variant), NFC tags.
- Reminder list of post-merge chores: Vercel production domain,
  ALLOWED_ORIGINS secret, rotate the seeded test tokens/PINs from /manager,
  rename/replace placeholder roster, print real QR stickers, write NFC tags.

Keep `web/SETUP.md` updated as reality changes. When in doubt about scope:
polish and verify what exists; do not redesign anything — the UI and flows
were approved from mockups and reviewed twice.
