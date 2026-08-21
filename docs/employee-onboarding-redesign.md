# Employee onboarding + simplified flow redesign (confirmed 2026-08-20)

Spec agreed with David from interactive mockups (Claude session, Aug 20 2026).
**Not implemented yet** — David will green-light implementation separately.
Mockups live in the conversation; this doc is the source of truth for decisions.

## Confirmed decisions

### Welcome screen (cold start, no invite link)
- Black auth-style screen: logo + app name, then exactly two actions:
  **"I have an invite link"** (red, primary) and **"Sign in"** (outline).
- Tapping "I have an invite link" reveals the paste field (auto-detect a join
  link on the clipboard when possible).
- Replaces the access-code framing as the default first-run experience. The
  access-code path must still exist behind the scenes until invites are proven
  in production (standing roadmap rule — do not remove).
- Terms + Privacy Policy as hyperlinks at the very bottom of every auth screen.

### Invited setup flow (black screens, matches existing auth look)
1. **Hello screen**: just "Hello, <Name>" + a single **Continue** button.
   No avatar circle, no "the manager set you up at …" line. Step 1 of 2.
2. **Secure your app** (step 2 of 2), two options presented as cards:
   - **Use your restaurant PIN** — "The same 4-digit code you use at the
     register." → 4-digit PIN pad entry.
   - **Create a password** — "Saves to iPhone autofill so you never retype
     it." → standard secure text field (iCloud Keychain offers to save;
     requires associated-domains entitlement for babytunasystems.com).
3. **Ready screen**: "You're set, <Name>. Your <location> order list is
   ready." → lands on the Order tab.
- **No Face ID step** — removed entirely; no Face ID permission prompt during
  onboarding. (Can be offered later from settings if ever wanted.)
- Copy style: minimal em dashes, short sentences.

### Sign-in screen (after sign-out / new device)
- Black screen, standard fields: NAME + PIN-or-password, autofill-compatible
  (real text fields, not a custom pad), "Forgot it? Ask the manager for a
  reset." PIN becomes a server-verified credential (hashed, rate-limited,
  manager-resettable) — design together with tips-PIN unification (Phase 4b)
  so each employee has ONE pin across tips + app.

### In-app colorway (employee AND manager surfaces)
- Match the tips web app palette (web/src/app/globals.css), not pure white and
  not warm cream:
  - page `#F5F5F4`, cards `#FFFFFF`, wells `#EDEDEC`, hairline
    `rgba(0,0,0,0.06)`, accent `#E84D38`, tint `#FBEAE7`, alert `#C03520`,
    ink `#1A1A1A` / `#5F5F5F` / `#9C9890`, disabled `#C9C5BC`.
- Rule of thumb: setup/auth = black, daily work = #F5F5F4 with white cards.

### Employee app structure
- Checklist-first: default tabs **Order / History / Settings** for a
  checklist-only employee. The Order screen is the existing Phase 5a
  SimpleOrderScreen (pinned order bar, steppers, voice add, density setting,
  rarely-ordered section) — recolored, not redesigned.
- `ordering_simple` default flips to **ON for employees** (SQL default in
  get_effective_modules + client mirrors in moduleStore.helpers.ts and
  web modules.ts — all three must stay in sync).
- Trimmed employee settings: Profile card, Order reminders, Bigger text,
  About and legal, Sign out, Delete account. Module-gated rows only when the
  module is on.

### Manager side (Version A structure, recolored)
- Team list + per-employee detail (feature toggles, works-at segmented
  control changeable anytime, Reset PIN, **Preview as Nate**).
- **Invite someone** screen: NAME, WORKS AT (Sushi / Poki & Pho / Both),
  WHAT <NAME> CAN USE toggles (Ordering checklist labeled DEFAULT), and a
  **live preview card** directly under the toggles showing the resulting tab
  set (updates as toggles flip; warns when no ordering is enabled). Then
  Create link → link-ready screen (Copy / Send via Messages).
- **New employee defaults** screen: org-wide defaults applied to new invites
  only; existing team members keep their settings.
- Invite carries: name, role, module preset, **and location** (new — invites
  table needs a location column; accept-invite writes users.default_location_id).
- Location is manager-editable after joining (not fixed at invite time).
- "Preview as Nate" renders the real employee layout with the target user's
  module state (live render, not a static picture).

## App Store compliance checklist (carry into implementation)
- In-app account deletion (exists today — keep visible in trimmed settings).
- Privacy policy + terms reachable in-app (About and legal) and linked on all
  auth screens; also in App Store Connect metadata.
- Terms/privacy consent line on invited setup.
- Credential recovery story: manager PIN reset flow.
- Mic/camera purpose strings already present in the 2.3 build.
- Guideline 4.8 note: name+PIN is first-party auth (no obligation), but any
  screen showing Google sign-in must keep Sign in with Apple alongside.

## Open items (need David's call before/at implementation)
- Which security option is primary: restaurant PIN vs create-a-password, or
  keep both as shown in the mockup.
- Restaurant-PIN source of truth: assume tips system PINs (seeded from
  Square) = the "existing PIN"? Requires tip_employees ↔ profiles linkage.
- Where employee Cart/browse surfaces live for people who ALSO have
  Advanced ordering on (tab set becomes Order/Advanced/Cart/History/Settings?).

## Related, already-found launch blockers (separate from this redesign)
- Version/runtimeVersion must bump 2.2 → 2.3 (OTA would land on mic-less 2.2
  binaries and crash on voice).
- Home "Quick Order" quick action is dead when the module is off — becomes
  moot if Home is dropped for checklist-only employees, but must be fixed if
  Home stays for anyone.
- docs/phases/HANDOFF.md claims migrations were never pushed; in reality all
  11 branch migrations + all new edge functions are already live in prod
  (verified by probing 2026-08-20).
