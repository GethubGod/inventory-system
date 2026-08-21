# Handback — Auth/onboarding revamp + manager controls (feat/onboarding-auth)

Built 2026-08-20 on `feat/onboarding-auth` (cut from `roadmap/integration` @ `416c036`).
Ticket: `docs/phases/onboarding-auth-build.md` · Spec: `docs/employee-onboarding-redesign.md`.

## What shipped

### Backend (4 additive migrations, all after 20260812190000; harness PASS + fixture)
- `20260820120000` — `invites.location_group` ('sushi'/'poki'/'both', default 'both').
  accept-invite resolves it to `users.default_location_id` via the short_code
  convention (s→Sushi, p→Poki); 'both' → null. Best-effort: a resolution failure
  never strands a created account.
- `20260820121000` — `get_effective_modules`: `ordering_simple` default flipped to
  TRUE for everyone. Mirrors flipped in `src/store/moduleStore.helpers.ts` and
  `web/src/lib/dashboard/modules.ts` (tri-sync comments updated). Explicit
  `user_modules` rows still win (fixture-proven).
- `20260820122000` — `employee_invite_module_defaults` app_config row + manager-gated
  `set_employee_invite_defaults(jsonb)` RPC (validates keys/booleans).
- `20260820123000` — login credentials: `login_identities` (bcrypt via pgcrypto —
  same hashing as the tips PINs), `normalize_login_name` (lower/trim/collapse,
  unique), `login_auth_attempts` + advisory-lock sliding-window rate limiting
  (6 failures per name, 20 per client / 10 min), `verify_login_credential`
  (service_role only), `set_my_login_credential` (self), `reset_login_credential`
  (manager, refuses suspended), `set_user_default_location` (manager; users RLS
  only allows self-updates).
- Fixture: `scripts/local-db/onboarding_auth_fixture.sql` (12 assertions, documented
  in `scripts/local-db/README.md`).

### Edge functions
- `create-invite`: locationGroup parse/store, duplicate sign-in-name check against
  `login_identities` + open invites (409 with a clear message at creation time),
  employee presets seeded from the app_config defaults when the caller sends none.
- `accept-invite`: preview response includes `locationGroup`; new **onboarding mode**
  (`{token, mode:'onboarding'}`) mints the account with a synthetic address
  (`join-<inviteId>@members.babytunasystems.com`) + discarded random password and
  returns a one-shot magiclink `tokenHash` for the client's first session; location
  resolution runs for both modes. Legacy email+password mode unchanged.
- `login-with-name` (new, `verify_jwt=false` + anon-key check like accept-invite):
  verifies in Postgres, 350ms failure delay, structured codes
  (invalid / rate_limited / suspended), success → magiclink tokenHash; the client
  completes with `auth.verifyOtp` → real Supabase session (SecureStore persistence
  unchanged).
- Deno tests: `_shared/invites.test.ts` (8) + `_shared/loginNames.test.ts` — all pass.

### Native auth flow (black, per the confirmed flow spec)
`app/(auth)/`: `welcome` (two buttons; paste state with clipboard detection strictly
on the button tap), `invite-hello` ("Hello, <Name>", step 1 of 2), `secure` (PIN
card primary / password card secondary), `secure-pin` (custom pad, dots,
confirm-by-re-entry, retry state if the credential step fails after acceptance),
`secure-password` (`textContentType="newPassword"` + hidden username field so
Keychain saves name+password), `ready` ("You're set, <Name>" + location line),
`sign-in` (NAME + PIN-or-password with autofill content types, inline
invalid/rate-limited/suspended errors, "Forgot it? Ask the manager for a reset",
"Have a sign-up code instead?" → legacy signup). Feature code in
`src/features/auth/`; `authTheme` tokens in `src/theme/design.ts`; Terms/Privacy
links pinned to every auth screen (`src/features/auth/legal.ts` + LegalFooter,
also added to legacy login/signup). The join deep link now enters `invite-hello`;
the signed-out guard lands on `welcome`. Legacy email login, access-code signup,
and OAuth store paths are untouched. No emoji anywhere; the "123" PIN mark is a
purpose-built SVG (`src/components/icons/PinDigitsIcon.tsx`).

### Manager Team (tips colorway via `tipsTheme` tokens)
`app/(manager)/manager-settings/team*` + `src/features/team/`: Team roster
(works-at + feature summary per person, defaults row pinned), Invite (name,
works-at segmented, toggles with "Ordering checklist DEFAULT", live preview card
derived purely from form state through `getVisibleEmployeeTabs` so it can't drift
— red warning when no ordering module is on, expiry pills 1/3/7/30 days), Link
ready (Copy + recipient-less `sms:` body prefill with share-sheet fallback),
Employee detail (works-at RPC, live module toggles, Reset PIN typed+confirmed,
Preview as), Preview-as (read-only live render from the target's
`get_effective_modules` through the shared tab logic, dark exit bar), New
employee defaults (bound to the app_config service, "applies to invites only"
tint note). Team row added to manager settings (management group).

### Web parity (small)
`InviteCreateModal` gains a works-at control and seeds employee presets from the
org defaults; `createInvite` passes `locationGroup`; `modules.ts` default flip.
No dashboard redesign. AASA file added at
`web/public/.well-known/apple-app-site-association`
(`TH8X9F2YUR.com.babytuna.systems`) served as JSON via `next.config.ts` headers.
iOS `webcredentials:tips.babytunasystems.com` associated domain added to app.json
+ `ios/Babytuna/Babytuna.entitlements`.

## Verification
- Migration harness: PASS (all branch migrations + 4 new on the prod baseline);
  fixture prints 12 `ok:` lines + PASS.
- `npx tsc --noEmit` clean (app + web), `npx jest --runInBand --watchman=false`:
  939 passed / 14 skipped, web `vitest`: 105 passed, Deno tests 9 passed.
- Lint: no new errors (remaining errors are pre-existing in
  `docs/mockups/tips-dashboard/*` — another live session's files — and
  `supabase/functions/tip-voice-parse`, both out of scope).
- **Production E2E invite accept: PROVEN.** One test invite (SQL-inserted, id
  `b7a4666c-79cc-4b49-8ea5-68776aaa4c93`) accepted through the deployed
  accept-invite function → manager test user
  `onboarding-test-20260820@babytunasystems.com` created with completed profile.
  Cleanup status: see below.
- Simulator demo: see `docs/phases/onboarding-auth-demo/` (screenshots).

## Needs David
1. **Deploy order matters**: apply the 4 migrations BEFORE (or together with)
   deploying `create-invite`/`accept-invite`/`login-with-name` — the new
   create-invite inserts `location_group` and reads `login_identities`.
   `login-with-name` also needs its `[functions.login-with-name] verify_jwt=false`
   config (already in supabase/config.toml) picked up at deploy.
2. **API-key mismatch found in production (pre-existing, affects the live app
   today):** the deployed edge functions' injected `SUPABASE_ANON_KEY` is now the
   *publishable* key (`sb_publishable_15Zj…`), so accept-invite returns 401
   Unauthorized to any client sending the legacy JWT anon key — which is what the
   repo `.env` contained. Invite acceptance from a binary built with the legacy
   key is currently broken. I switched the local `.env` (gitignored) to the
   publishable key to demo; production builds/EAS env need the same alignment.
   Please confirm which key the shipped 2.2 binary embeds.
3. **AASA goes live on the next web deploy** (required for iCloud Keychain save
   on the password path). No web deploy performed by me.
4. Final **Terms/Privacy URLs** — placeholders `babytunasystems.com/terms` /
   `/privacy` in `src/features/auth/legal.ts` (privacy matches about-support).
5. **App Store link**: `web/src/components/join/JoinLanding.tsx` `APP_STORE_URL`
   is still the TODO placeholder.
6. **Tips-PIN unification decision**: the login credentials use the same bcrypt
   hashing as the tips PINs, but note tips v2 (live 2026-08-20) removed PINs from
   the tips web app entirely (QR-only). "Restaurant PIN" in onboarding copy now
   refers to the register PIN the manager gives out. Unifying with a future tips
   credential is mechanical (same hashing) but there is currently nothing to
   unify with.
7. **Test-data cleanup** (if not already done by the session — see handback
   addendum below): revoke/remove invite `b7a4666c-…`, delete test user
   `onboarding-test-20260820@…`, and any invite created from the Team screen
   during the demo.
8. The dev simulator (iPhone 17 Pro) was signed out of your session
   (davidp@gmail…) to demonstrate the auth flow — sign back in when you next use it.

## Consciously left out / notes
- Manager-role invites from the native Invite screen (web modal still does both
  roles; native is employee-only per the flow spec).
- Preview-as renders the employee chrome (real tab set + surfaces) from the
  target's live module state — it does not mount SimpleOrderScreen itself
  (excluded surface, and mounting it would fetch/mutate as the manager).
- Synthetic onboarding accounts show `join-<id>@members.babytunasystems.com` as
  their email in profile/settings surfaces. Cosmetic; flagging for a later pass.
- "Unique among active users" is enforced as globally unique login names
  (including suspended users) — reusing a suspended person's name errors at
  invite creation rather than silently colliding on unsuspend.
- Legacy `signup.tsx` invite mode still works (second entry path); the deep link
  no longer targets it.
- `.expo/types/router.d.ts` regenerates on next `expo start`; new routes use the
  established cast pattern meanwhile.
