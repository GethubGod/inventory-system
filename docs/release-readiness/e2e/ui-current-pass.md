# Mobile UI pass: integrated iOS Release binary

Date: 2026-09-05

Device: isolated `Smelter Release QA iPhone 17 Pro Max`, iOS 26.2,
`EF05F833-2AC4-4383-8688-36C51B956BCF`. The historical FCAD device was absent,
so this dedicated replacement was used. No Nellit simulator was targeted.

## Driver contract

All simulator checks use the repository wrapper, which pins the QA UDID:

```sh
scripts/sim.sh assert
SMELTER_AXE_PATH=/Users/david/.npm/_npx/99336612077b7094/node_modules/xcodebuildmcp/bundled/axe \
  scripts/sim.sh input describe-ui
SMELTER_AXE_PATH=/Users/david/.npm/_npx/99336612077b7094/node_modules/xcodebuildmcp/bundled/axe \
  scripts/sim.sh input tap --label 'Sign in' --element-type Button
SMELTER_AXE_PATH=/Users/david/.npm/_npx/99336612077b7094/node_modules/xcodebuildmcp/bundled/axe \
  scripts/sim.sh input type --file /private/tmp/smelter-manager-name.txt
scripts/sim.sh io screenshot docs/release-readiness/e2e/<evidence>.png
```

The wrapper's headless input command is `input`. Earlier notes used `ui` for
AXe input; those commands were corrected when the wrapper was split from its
simulator appearance `ui` command.

## Chronological launch diagnosis

1. The first native Debug build reached Xcode but had no embedded JavaScript
   bundle. Its launch showed Expo's `No script URL provided` error. This was a
   build artifact limitation, not a feature pass.
2. The first Release build generated an invalid or missing embedded update
   manifest because the checkout path contains spaces. The durable Podfile
   quoting hook was corrected by the native workstream. The rebuilt Release
   binary rendered the real Smelter welcome screen; see
   `02-release-manifest-fixed.png` and `final-launch-errors.log`.
3. The first Release install was linker-signed only. Sign-in reached the local
   function boundary but failed before network because SecureStore reported
   `ERR_KEY_CHAIN: A required entitlement isn't present.` The native build was
   rebuilt with simulator application-identifier and keychain entitlements.
   The error disappeared in the signed binary.
4. The signed Release binary authenticated the manager fixture through the
   local `login-with-name` Edge Function. The Edge Runtime log contains the
   request, and the app rendered the authenticated checklist/dashboard. The
   local API remains `127.0.0.1:54521`; no production host is bundled.

## Passed UI evidence

- `06-signed-welcome.png`: signed Release welcome screen.
- `07-manager-login-result.png`: authenticated manager checklist.
- `09-manager-order-submitted.png`: simple-order review sheet.
- `10-manager-order-sent.png`: order submission confirmation.
- `11-manager-location-selector.png`: location switching sheet.
- `12-manager-cart-empty.png`: empty cart state.
- `13-manager-history-empty.png`: empty employee order-history state.
- `14-manager-quick-actions.png`, `15-manager-add-note.png`,
  `16-manager-note-added.png`, `17-manager-checklist-display.png`:
  manager quick-action sheets and note/display interactions.
- `18-manager-receive-empty.png`: receive-delivery empty state.
- `19-manager-settings.png`, `20-manager-home.png`,
  `25-manager-profile.png`: manager settings, home, and profile screens.
- `21-manager-quick-order-filled.png`: quick-order text entry retained in
  the input before the final send action.
- `22-manager-fulfillment.png`, `23-manager-fulfillment-expanded.png`:
  pending supplier fulfillment and expanded item detail.
- `24-manager-fulfillment-history-empty.png`: fulfillment history empty state.

The simple-order mutation was verified in the disposable local database after
the confirmation screen. It created a submitted order for the manager fixture
with `entry_method=simple_checklist`; the exact local UUID is recorded in the
private command log and parent report without exposing credentials.

## Known blocked or fixture-dependent paths

- Quick Order `Send` was left unpressed after the automatic approval review
  rejected the persistent action. The exact rejected command is retained in
  the parent task log. This is an honest **BLOCKED** result, not a pass.
- Fulfillment shows `UNRESOLVED SUPPLIER` and zero remaining items because the
  disposable fixture has no supplier configuration. The UI rendered the
  pending items and expanded their quantities. Supplier send was not attempted.
- Quick Order's Advanced list starts empty because the local fixture has no
  `qo_items` parser catalog rows. The four global inventory rows are visible
  through Browse inventory. A fixture-only `qo_items` addition is still required before parser testing.
  It has not been applied while write approval is pending.

No PINs, passwords, tokens, or server keys are stored in this document.

## Root follow-up and evidence limits

The root agent continued headless native testing after this initial pass. The `root-*` screenshots and corresponding accessibility JSON cover employee stock areas, a stock station, history and a real local order detail; manager inventory, team, employee detail/preview, reminder configuration and empty delivery history; shared settings; and credential-modal recovery. The route inventory distinguishes partial screen checks, narrow passes, aliases, blocked actions and unexercised routes.

Earlier manager configuration screenshots without `-active` show the employee checklist because the manager view was inactive. They are historical redirect evidence, not passes for the named manager screen. Only the corresponding `-active` images establish those manager screens rendered. The canonical `/orders` link also resolves to employee My Orders; an explicit manager-group route is checked separately.

The local Quick Order/supplier supplement is prepared in `scripts/release-readiness/seed-local-quick-order-catalog.sql` and has not been applied. It adds no phone or email recipient. Inventory browsing already renders all four fixture inventory rows. Parser and fulfillment mutations still need the approved local fixture and explicit local-test-write authorization.
