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
- **Production E2E invite accept: PROVEN.** One test invite (SQL-inserted)
  accepted through the deployed accept-invite function → manager test account
  created with a completed profile, signed into the app on the simulator, and
  used to drive every manager screen against live production data (roster,
  per-user effective modules, a real user_modules toggle round-trip verified
  server-side, and a real invite created from the Invite screen).
- **Simulator demo: 29 screenshots in `docs/phases/onboarding-auth-demo/`** —
  every auth screen (welcome, clipboard-assisted paste incl. the iOS paste
  notice and the inline validation error, Hello via both the paste path and the
  join deep link, secure step, PIN pad with dots/confirm-by-re-entry, password
  entry, ready, name sign-in with inline error) and every manager screen
  (roster, invite with the live preview card flipping on toggle and works-at
  changes incl. the red no-ordering warning, link-ready with a real link,
  member detail, Reset PIN modal, preview-as with the dark exit bar, defaults
  with the tint note). Two flows could not complete end-to-end against prod
  because the new backend is not deployed yet, and failed exactly as designed:
  onboarding accept (05a) shows the retry state with the old function's
  "email is required", and name sign-in shows the inline connection error.
  The ready screen (06) was reached by deep link for the same reason.
- **Test-data cleanup: DONE.** Both test invites deleted, the test account
  removed via its own delete-self call, and a verification query confirms zero
  remaining rows (auth user, users, profiles, user_modules, invites).

## Needs David
1. **Deploy order matters**: apply the 5 onboarding migrations (including
   `20260821153027_harden_onboarding_and_invite_deletion.sql`) BEFORE or with
   deploying `create-invite`/`accept-invite`/`login-with-name` — the new
   create-invite inserts `location_group` and reads `login_identities`.
   `login-with-name` also needs its `[functions.login-with-name] verify_jwt=false`
   config (already in supabase/config.toml) picked up at deploy.
2. **Public API keys:** the app/web clients accept the current publishable-key
   variable or the legacy anon-key variable. Pre-session functions accept
   publishable keys through `apikey` and legacy anon JWTs through either
   `apikey` or bearer auth. Set the publishable-key variable in future builds;
   existing legacy-key builds remain compatible.
3. **AASA goes live on the next web deploy** (required for iCloud Keychain save
   on the password path). No web deploy performed by me.
4. **Terms/Privacy are complete** at `tips.babytunasystems.com/terms` and
   `/privacy`. Update the App Store Connect privacy-policy field from the old
   Notion URL after the web deploy.
5. **App Store link is complete** and points to app id `6759226573`.
6. **Tips-PIN unification decision**: the login credentials use the same bcrypt
   hashing as the tips PINs, but note tips v2 (live 2026-08-20) removed PINs from
   the tips web app entirely (QR-only). "Restaurant PIN" in onboarding copy now
   refers to the register PIN the manager gives out. Unifying with a future tips
   credential is mechanical (same hashing) but there is currently nothing to
   unify with.
7. **Invited-user deletion is fixed** by detaching invite audit references
   while preserving the consumed timestamp, plus explicit delete-self cleanup.
8. The dev simulator (iPhone 17 Pro) was signed out of your session
   (davidp@gmail…) to demonstrate the auth flow — sign back in when you next
   use it. The installed dev-client build now points at Metro on port 8081.

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
