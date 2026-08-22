# Phase 2 contract — Dashboard shell + Team (2a), Invites (2b)

Roadmap spec: `docs/ROADMAP.md` Phase 2. Binding seam between backend (Codex) and
frontend (Claude) agents.

## Hard constraint — running-session collision

Two OTHER live sessions are editing tips surfaces right now:
`web/src/app/{e,closer,pin}`, `web/src/components/entry*`, `web/src/components/manager/*`
(tips tabs), `supabase/functions/tip-*`, `web/e2e/*`.
**Do not modify any of those files.** New dashboard lives in NEW routes/components:

- Routes: `web/src/app/dashboard/{layout.tsx,page.tsx,team/page.tsx,suppliers/page.tsx,ordering/page.tsx}`
  (+ `invites` under team in 2b). Tips nav item just links to the existing `/manager`.
- Components: `web/src/components/dashboard/**` only.
- Shared file caution: `web/src/lib/supabase.ts` and `web/src/types/database.ts` may be
  edited by the other sessions — extend, never rewrite; keep diffs minimal and additive.

## Auth (2a)

Dashboard uses **manager Supabase auth** (email/password via `web/src/lib/supabase.ts`
browser client — reuse the LoginCard idiom but build a dashboard-local copy in
`components/dashboard/`, do not import tips manager components). Role check: profile
role must be manager (same check the app uses; inspect `list-users` edge fn for the
authoritative role source). Non-managers get a clear "managers only" screen.

## 2a scope

- Nav shell: Team, Suppliers, Ordering setup (placeholder page), Tips (link to /manager),
  Analytics (disabled "coming soon").
- Team page: roster via `list-users` edge fn (supabase.functions.invoke with the user's
  JWT), role badges, suspend/unsuspend via `set-user-suspended`. Confirm dialog on suspend.
- Suppliers page: table of suppliers with inline edit of contact_phone / contact_channel
  (sms | whatsapp | share_sheet) / contact_name / contact_notes — same columns Phase 1
  added; plain supabase-js reads/writes to `suppliers` (RLS already manager-scoped).

## 2b scope

Backend (Codex):
- Migration: `invites` table — id uuid pk, token text unique (URL-safe, >=128 bits),
  invited_name text, role text check ('employee','manager'), module_preset jsonb default
  '{}', expires_at timestamptz, created_by uuid ref auth.users, created_at, used_at,
  used_by uuid, revoked_at. RLS: managers full; anon none (edge fns use service role).
- Edge fns (follow conventions in supabase/functions/_shared and e.g. list-users):
  - `create-invite` (manager JWT): {invitedName, role, modulePreset?, expiresInHours?}
    → {token, joinUrl}
  - `revoke-invite` (manager JWT): {inviteId} → {ok}
  - `accept-invite` (called during signup with anon key + token): validates token
    (unused, unexpired, unrevoked), creates/claims the account server-side with
    service role, marks used_at/used_by, returns {ok, role}. Access-code path MUST
    remain fully functional and untouched.

Frontend (Claude):
- Team page: "Invite" button → modal (name, role, expiry) → shows copyable personalized
  link `https://tips.babytunasystems.com/join/<token>` + revoke list with status
  (pending / used / expired / revoked).
- Public page `web/src/app/join/[token]/page.tsx`: greets invitee by name, App Store
  link placeholder, `babytunasystems://join?token=...` deep-link button, clear error
  states for used/expired/revoked (server-checked via accept-invite dry-run mode
  `{validateOnly: true}`).
- App side: signup screen accepts `join?token=` deep link → calls accept-invite instead
  of validate-access-code. Access-code UI stays.

## Verification

- `cd web && npm run build` passes (plus any web test script present).
- App: npm run typecheck && npm run test:ci.
- Edge fns unit-testable logic factored into `_shared` where the repo already does so;
  local stack (ports 54421-54423) `supabase functions serve` + curl smoke where feasible.

## Non-goals (binding)

No email sending. No module system yet (module_preset is stored, applied in Phase 3).
No changes to tips pages/functions. Access codes untouched.
