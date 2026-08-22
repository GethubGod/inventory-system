# Build handoff — Auth/onboarding revamp + manager controls (in-app)

You are the build agent for this phase. This document is your ticket: precise about
outcomes, contracts, and acceptance criteria, deliberately open about implementation.
Read this whole file, then `docs/employee-onboarding-redesign.md` (the confirmed spec),
then `docs/ROADMAP.md` ("How to run a phase") and `ARCHITECTURE.md`, then write your own
implementation plan before editing anything.

Visual reference (David-confirmed): the "Babytuna Flow Spec" artifact —
https://claude.ai/code/artifact/8d691495-f819-4545-a6f5-dc03365b5a34
Sections to build: "Auth & onboarding" (all 8 screens) and "Manager" (all 6 screens).

## Mission

1. Replace the first-run/auth experience with the confirmed flow: two-button welcome
   ("I have an invite link" / "Sign in"), invite-link paste, "Hello, <Name>" step,
   Secure-your-app step (restaurant PIN pad OR create-a-password), ready screen, and a
   name + PIN/password sign-in screen. Fully functional end to end, not a shell.
2. Build the manager side in-app: Team, Invite (name + works-at + feature toggles +
   live preview card), link-ready, employee detail (location change, toggles, reset
   PIN, Preview-as), and New employee defaults.
3. All supporting backend: invite location, login credentials, employee defaults,
   `ordering_simple` default flip.

## Hard scope exclusions

- Do NOT touch the employee app surfaces: SimpleOrderScreen and everything under
  `src/features/simpleOrder/`, the employee tab layout's Order/History/Settings
  restructure, and the trimmed settings screen. Those are being redesigned separately.
  The post-onboarding landing stays whatever the current tab layout resolves to.
- Do NOT remove the access-code path (standing roadmap rule). The welcome screen
  demotes it: "Sign in" → existing login; existing access-code signup stays reachable
  via a small "Have a sign-up code instead?" link on the sign-in screen.
- Do NOT touch files owned by another live session: `docs/mockups/tips-dashboard/*`,
  `web/src/app/{e,closer,pin}`, `web/src/components/entry*`,
  `web/src/components/manager/*`, `supabase/functions/tip-*`, `web/e2e/*`.
- No version-number changes (2.2→2.3 bump is a separate launch chore).

## Ground rules (all from hard-won experience — do not skip)

- Branch `feat/onboarding-auth` cut from `roadmap/integration`. First command:
  `git log --oneline -1` — if HEAD is not on roadmap/integration or a descendant,
  `git reset --hard roadmap/integration`. **Never push to `main`** (a main push
  production-deploys `web/` via Vercel).
- Migrations are additive only, timestamped AFTER `20260812190000`, and proven with
  `scripts/local-db/verify-migrations.sh` (disposable postgres:17 harness;
  `supabase start` cannot bootstrap this repo). Nothing is deployed by you; all 18
  existing branch migrations are already live in production — do not re-apply.
- `.expo/types/router.d.ts` is stale and won't regenerate here. New routes need a cast
  at the `router.push` call site — copy the existing pattern in `SimpleOrderScreen.tsx`.
- Tests: `npx jest --runInBand --watchman=false` (plus
  `--testPathIgnorePatterns=/node_modules/` if running from a worktree under
  `/.claude/`, where jest otherwise discovers 0 tests).
- Repo conventions: thin route files under `app/`, feature code under `src/features/`,
  services under `src/services/`, design tokens from `src/theme/design.ts`, Zustand
  selector rules, haptics via `@/lib/haptics`, unit tests consistent with existing
  patterns in `src/__tests__/`.

## Design system for the new screens

- Auth/onboarding screens: black (`#000000`) like the current `(auth)` screens, red
  accent `#E8503A` (`colors.primary`), white text, translucent white wells
  (`rgba(255,255,255,0.09)` fill / `0.18` border).
- Manager screens: tips colorway — page `#F5F5F4`, cards `#FFFFFF` with
  `rgba(0,0,0,0.06)` hairline borders, wells `#EDEDEC`, tint `#FBEAE7`, alert
  `#C03520`. Add these as named tokens in `src/theme/design.ts` rather than scattering
  hex literals; do not restyle existing screens beyond what this phase builds.
- **No emojis anywhere in UI. None.** The confirmation artifact uses emoji as
  placeholder glyphs only. Every icon is either (a) an Ionicons glyph via
  `@expo/vector-icons` (the app standard), or (b) a purpose-built SVG component in
  `src/components/icons/` using `react-native-svg` where no Ionicons glyph fits
  (e.g. the "123" PIN mark). Placeholder → real mapping:
  fish logo → the actual app logo asset (`assets/images/app-icon.png`, or a dedicated
  transparent logo variant if the icon file has a baked background);
  lock → `lock-closed-outline`; key/autofill → `key-outline`; link → `link-outline`;
  eye/preview → `eye-outline`; bell → `notifications-outline` / `notifications`;
  gear/defaults → `options-outline`; back `chevron-back`; close `close`;
  check `checkmark` / `checkmark-circle`; backspace `backspace-outline`;
  receipt `receipt-outline`; person `person-outline`.
- Copy rules: sentence case, contractions fine, minimal em dashes, no "please", no
  exclamation marks. Terms + Privacy Policy are tappable links pinned to the bottom of
  every auth screen (use `TERMS_URL` / `PRIVACY_URL` constants in one config module —
  David supplies final URLs, ship with babytunasystems.com placeholders).

## Contracts (pinned so workstreams run in parallel)

Backend owns these exact shapes; frontend codes against them from day one.

```ts
// src/services/invites.ts (extend)
export type InviteLocationGroup = 'sushi' | 'poki' | 'both';
export interface CreateInviteInput {
  invitedName: string;
  role: 'employee' | 'manager';
  expiresInHours: number;
  modulePreset: Record<string, boolean>;
  locationGroup: InviteLocationGroup;        // NEW
}
export interface InvitePreview {              // fetchInvitePreview return (extend)
  invitedName: string;
  role: 'employee' | 'manager';
  locationGroup: InviteLocationGroup;         // NEW
}

// src/services/loginCredentials.ts (new)
export type CredentialKind = 'pin' | 'password';
export function setMyCredential(kind: CredentialKind, secret: string): Promise<void>;
export function signInWithName(name: string, secret: string): Promise<void>; // establishes a Supabase session
export function resetUserCredential(userId: string, newPin: string): Promise<void>; // manager only

// src/services/employeeDefaults.ts (new)
export function getEmployeeInviteDefaults(): Promise<Record<string, boolean>>;
export function setEmployeeInviteDefaults(v: Record<string, boolean>): Promise<void>; // manager only
```

## Workstream A — backend (runs parallel to B and C)

1. Migration: `invites.location_group text not null default 'both'`
   check-constrained to ('sushi','poki','both'). `accept-invite` resolves it to
   `users.default_location_id` (sushi/poki → that location's id from `locations`;
   'both' → null). Extend create-invite/accept-invite/invite-preview payloads per the
   contract. All changes additive; existing invites keep working.
2. Migration: flip the employee default for `ordering_simple` to TRUE inside
   `get_effective_modules` (create or replace), and mirror the flip in BOTH client
   mirrors: `src/store/moduleStore.helpers.ts` and `web/src/lib/dashboard/modules.ts`
   (the tri-sync comment in each file tells you where). Existing explicit
   `user_modules` rows are unaffected.
3. Employee invite defaults: store as one `app_config` JSON row (follow the existing
   `app_config` pattern; no new table needed). `create-invite` applies these as the
   starting `module_preset` when the caller doesn't override. Manager-only write.
4. Login credentials: name + PIN/password sign-in that yields a real Supabase session.
   Requirements (design is yours): secrets bcrypt-hashed server-side, never stored or
   logged in plaintext; verification in an edge function with rate limiting (lockout or
   exponential backoff per name and per IP after repeated failures); login names
   resolved case-insensitively and enforced unique among active users (surface a clear
   error on invite creation for duplicates); manager reset via `resetUserCredential`
   (suspended users refused). One workable design: accounts keep a synthetic email
   under the hood and the edge function maps name → email, then the client completes
   `signInWithPassword`; if you choose differently, keep the service signatures.
   Design for later unification with the tips-app PINs (see
   `docs/tips-launch-handoff.md`) — same hashing, one credential per person eventually.
5. Unit tests for every new/changed service and edge-function helper, plus harness
   fixtures proving the migrations apply and `get_effective_modules` returns the new
   default.

## Workstream B — auth/onboarding screens (native)

Build per the artifact's numbered sequence. All under `app/(auth)/` +
`src/features/auth/` (new feature folder), reusing what exists:
`parseJoinToken` (`src/services/inviteLinks.ts`), `fetchInvitePreview`, the `join.tsx`
deep link, and the auth store.

- 01/02 Welcome: logo + two buttons; paste state with clipboard detection
  (`expo-clipboard`, already a dependency) — if the clipboard holds a join link, offer
  it; never read the clipboard silently on launch without a user tap (iOS shows a paste
  notice — trigger reads only from the button press).
- 03 Hello: name from `fetchInvitePreview`, one Continue button, step 1 of 2.
- 04 Secure your app: two option cards (PIN primary, password secondary), step 2 of 2.
- 05a PIN: custom pad (4 digits, dots, backspace), confirm-by-re-entry pass; store via
  `setMyCredential('pin', …)` after the account is created by accept-invite.
- 05b Password: standard secure `TextInput` with `textContentType="newPassword"` +
  `autoComplete` so iCloud Keychain offers to save. Add the Associated Domains
  entitlement (`webcredentials:tips.babytunasystems.com`) to the iOS project and an
  `apple-app-site-association` file under `web/public/.well-known/` (webcredentials
  section; content-type application/json). It only goes live when David deploys web —
  note it in your handback.
- 06 Ready: "You're set, <Name>" → routes into the app (current tab layout).
- 07 Sign in: NAME + PIN-or-password fields (`textContentType="username"` /
  `"password"` for autofill), `signInWithName`, inline errors (wrong credential,
  locked out, suspended), "Forgot it? Ask the manager for a reset" hint, and the small
  "Have a sign-up code instead?" link to the legacy flow.
- Session persistence unchanged (SecureStore); signing in once keeps you signed in.

## Workstream C — manager screens (native + small web parity)

Native, under `app/(manager)/manager-settings/team*` + `src/features/team/` (new),
using the services from the contracts and the existing `userModules` /
`moduleStore` machinery:

- Team list: roster from the existing `list-users` data + per-user effective modules
  summary; "New employee defaults" row pinned at the bottom.
- Invite screen: name, works-at segmented control, module toggles (Ordering checklist
  tagged DEFAULT), and the live preview card underneath — a pure function of the
  toggle state (tab list text + mini frame; red warning line when no ordering module is
  on). Re-renders on every toggle. Then link-ready screen: copy + `sms:` share
  (recipient-less body prefill; same deep-link approach as Send All).
- Employee detail: works-at segmented control (writes `users.default_location_id`,
  changeable anytime), module toggles (existing `setUserModule`), Reset PIN flow
  (manager types a new 4-digit PIN, confirm dialog, `resetUserCredential`),
  and Preview as <Name>.
- Preview as <Name>: renders the real employee tab/module state for that user (drive
  the existing module-driven layout logic with the target user's
  `get_effective_modules` result — a live render, read-only, with the dark top exit
  bar). It must never mutate the target user's data.
- New employee defaults screen: toggles bound to `employeeDefaults` service, with the
  "applies to invites only" tint note.
- Web dashboard parity (small): add works-at to `InviteCreateModal` and seed its
  preset from the employee defaults. Do not redesign the dashboard.

## Definition of done

- Typecheck, lint, and the full jest suite pass; new logic has unit tests (invite
  location resolution, name normalization/uniqueness, rate-limit behavior, defaults
  merge, preview-card derivation as a pure function).
- Migrations pass the local harness; fixtures included.
- Fully functional means demonstrated: record/screenshot on the iOS simulator —
  every auth screen (both credential paths), and every manager screen including a live
  toggle flip changing the invite preview card. Create at most one real test invite in
  production to prove the E2E accept path, and revoke it plus remove the test user
  afterward.
- Zero emoji glyphs in any UI string or component; logo spots use the real asset.
- Existing flows still work: legacy access-code signup, email/password + OAuth login,
  the current tab layout, web dashboard invites.
- Handback note listing: what needs David (AASA goes live on next web deploy; final
  Terms/Privacy URLs; App Store link for `web/src/components/join/JoinLanding.tsx`
  `APP_STORE_URL`; confirming the tips-PIN unification decision), plus anything you
  consciously left out.

## Decisions already made — do not re-litigate

Both credential options ship (PIN card first, password second). No Face ID step. No
avatar or explainer copy on the Hello screen. Location on the invite AND editable
later. `ordering_simple` on by default for employees. Access-code path demoted, not
removed. Colorway and copy per the artifact and spec doc.
