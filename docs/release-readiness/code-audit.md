# Mobile code audit

Scope: mobile routes in `app/**`, shared source in `src/**`, and local regression tests. Worktree branch `codex/production-readiness` matched the fetched `origin/main` commit `cf30d6b` before testing. This report is a code audit, not proof that every production workflow or App Store review requirement passes.

## Changes and assumptions

| Area | Concrete failure | Change | Decision made |
| --- | --- | --- | --- |
| Shared device logout | Saved avatar, personal reminders, and a pending reorder survived sign-out. A second employee could inherit them. | Reset app settings and pending reorder alongside existing user stores; invalidate shared query caches. | Reset account-related settings on sign-out. Device display/accessibility preferences remain in the separate display store. |
| Supplier lookup | Invalidating a lookup while its request was pending reused the old request and allowed stale data to repopulate the cache. | Invalidation detaches pending requests. Only the currently tracked request may write cache data or clear its pending slot. | An invalidated caller still receives its own eventual result; this is cache isolation, not cancellation of every application request. |
| Module refresh | An older response could finish after a realtime permission revocation and restore the revoked module in client state. | Sequence module loads and reset generations; hook refuses data belonging to another authenticated user. | Keep the existing offline role-default policy. Database authorization remains essential. |
| Logout notifications | No sign-out path deactivated the phone's push token or removed local scheduled/delivered notifications. | Save the registered device token locally, deactivate only the departing user and current token before clearing their session, clear local notifications and badge. Bound cleanup to five seconds. | Logout completes even offline. Failed remote deactivation is a release limitation rather than a reason to trap a user signed in. |
| Notification races | A pending token registration could finish after logout began. | Invalidate older registration generations, await pending registration writes before deactivation, skip foreground registration while auth is loading, expire delayed native cleanup callbacks. | Preserve notifications on the account's other devices when signing out this phone. |
| Legacy password form | The form required a current password but never checked it before calling `auth.updateUser`. | Verify the current authenticated user and password before updating the email credential. Wrong-password or offline verification does not call update or sign-out. | Retain legacy email sign-in support. |
| Name-login profile | Manager and legacy profile screens changed the Supabase email password even when the user signed in with a separate name/PIN credential. | Read permitted `login_identities.credential_kind` metadata. Reuse the employee PIN/password sheet for name accounts; use the email form only when the metadata row is absent. Show lookup failures without choosing the wrong editor. | Reuse existing UI and server credential RPC. A real recovery email does not imply email-password sign-in. |
| Manager name edit | The checkmark only closed the editor. It did not persist the entered name. | Save through the existing `update_my_display_name` RPC and update local auth state after success; keep failures visible. | Reuse the same atomic name/identity update as employee profile. |
| Home insights cache | The location-only memory cache survived logout; pending reads or requests could restore the old account data. | Key cached cards by user and location, clear memory on auth cleanup, invalidate pending disk hydration and screen updates with a generation. | Keep seven-day optional card caching; discard the previous unscoped disk format. |
| Production debug route | The notifications debug menu item was hidden, but its route was still directly reachable by a deep link. | Redirect the route in production before mounting the diagnostic screen. | Debug tools remain available in development. |

The employee credential sheet was extracted without a visual redesign. No business records were seeded. No push, deploy, migration, or remote write was performed by this audit worker.

## Local verification

The original shared-settings and module-race defects were reproduced with failing assertions before their fixes. The original query-invalidation test showed the fresh fetcher was never called; the second test also timed out because invalidation retained the unresolved request. All now pass.

Commands run from the worktree:

- `npm run test:ci -- --runTestsByPath src/__tests__/authStore.signOut.test.ts src/__tests__/moduleAccess.test.ts`: initial run failed on both new module-race tests. The first settings fixture needed a Reminder field-name correction before its behavioral assertion ran.
- `npm run test:ci -- --runTestsByPath src/__tests__/authStore.signOut.test.ts src/__tests__/queryCache.test.ts`: initial behavioral run failed on retained avatar and cache invalidation.
- `npm run test:ci -- --runTestsByPath src/__tests__/loginCredentials.test.ts src/__tests__/changePassword.test.ts src/__tests__/authStore.signOut.test.ts src/__tests__/notificationService.test.ts src/__tests__/moduleAccess.test.ts src/__tests__/queryCache.test.ts`: final targeted service/store run passed, 6 suites and 60 tests.
- `npm run test:ci -- --runTestsByPath src/__tests__/notificationService.test.ts src/__tests__/authStore.signOut.test.ts src/__tests__/authStore.authFlow.test.ts src/__tests__/moduleAccess.test.ts src/__tests__/queryCache.test.ts src/__tests__/changePassword.test.ts`: earlier auth compatibility pass, 6 suites and 50 tests before later added cases. Existing auth-flow tests print mocked native-module reset warnings; they are not simulator coverage.
- Targeted ESLint across changed mobile files passed with no errors and eight warnings at that point. Seven were test import-order warnings, one was the pre-existing unused `upsertProfileResilient` function.

Added coverage includes wrong current password, verified user mismatch, offline identity lookup, correct PIN/password editor selection, absent identity selecting legacy email, cached token logout, denied notification permission, notification service errors, cleanup timeout, late local cleanup, stale token registration, module request reordering, same-user reset races, and stale cache writes.

- `npm run test:ci -- --runTestsByPath src/__tests__/credentialModal.test.ts`: passed, 1 suite and 3 rendered-form tests. React Test Renderer printed its existing deprecation notice.
- `npm run test:ci -- --runTestsByPath src/__tests__/homeInsightsCache.test.ts src/__tests__/authStore.signOut.test.ts`: passed, 2 suites and 11 tests. Tests cover same-location user separation, memory reset, old-generation writes, delayed disk hydration, and logout integration.

The orchestrator runs integrated typecheck, lint, full tests, and simulator verification separately. This worker did not operate a simulator, issue live orders, delete an account, or send a notification.

## Audit limits and remaining risks

- Remote token deactivation cannot be guaranteed offline. The server can retain the old employee's active token after local sign-out. A server-side device ownership/unregister contract and a real-device push test are required to prove this case safe. A five-second timeout also permits a pending remote operation to finish later, but its filters remain the departing user and device token.
- Existing stock/order stores contain asynchronous operations beyond the cache changes here. Local tests do not prove every pending operation is discarded across logout.
- Module access falls back to role defaults after first-fetch failure. That existing choice is unchanged. Server RLS/RPC checks, not client tabs, must enforce access.
- The app has legacy email onboarding/profile paths and the newer name/PIN flow. Credential editing now chooses by stored identity metadata. Successful credential change, name change, subsequent login, and account deletion still need live end-to-end verification.
- Supabase deletion success and data removal, SMS supplier sending, delivery recording, camera/voice processing, notification delivery, and offline recovery need authorized test accounts and real service verification. Unit mocks cannot establish production readiness.
- A source search found 283 lines matching `as any`, `: any`, or `<any>` in mobile production source at audit time. This is a rough line count, not a TypeScript finding count. The existing codebase is not free of unchecked types. This pass fixes bounded defects rather than claiming a complete type-safety rewrite.
- No claim is made here that Apple will approve the app or that every screen passed visual inspection. Use the integrated report's screenshots and explicit blocked checks for that decision.

## Final focused static check

`npx eslint src/components/settings/ChangeCredentialSheet.tsx src/components/settings/ChangePasswordModal.tsx src/features/employeeSettings/EmployeeProfileScreen.tsx src/features/home/HomeScreenView.tsx src/features/home/homeInsightsCache.ts src/services/changePassword.ts src/services/loginCredentials.ts src/services/notificationService.ts src/store/authStore.ts src/store/moduleStore.ts src/hooks/useMyModules.ts src/lib/queryCache.ts 'app/(manager)/manager-settings/profile.tsx' app/settings/profile.tsx app/settings/notifications-debug.tsx app/_layout.tsx src/__tests__/credentialModal.test.ts src/__tests__/homeInsightsCache.test.ts`

Result: exit 0, no errors, one pre-existing unused-function warning in authStore. `git diff --check -- app src docs/release-readiness/code-audit.md` also passed.

## Persisted cache validation follow-up

Root review identified an unchecked cast during home cache hydration. Replaced it with `unknown` and nested validation for predicted items, previous-order items, reminders, dates, quantities, units, and counts. Malformed entries are discarded independently, so valid cached cards still load.

`npm run test:ci -- --runTestsByPath src/__tests__/homeInsightsCache.test.ts` reproduced 10 failures before validation and passed all 18 tests afterward. `npx eslint src/features/home/homeInsightsCache.ts src/__tests__/homeInsightsCache.test.ts` passed without warnings or errors.
