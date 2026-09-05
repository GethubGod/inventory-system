# Native release audit

Audit date: September 4, 2026, America/Los_Angeles. Baseline branch `codex/production-readiness` matched `origin/main` at `cf30d6bc641cd22830420cfd6d431c11d5e3c02f` before checks. Worktree: `/Users/david/Babytuna Systems/smelter/.worktrees/production-readiness`.

Native branding and configuration fixes are complete. These checks do not certify App Store approval. A signed distribution archive and the submission record have not been validated by this audit.

## Changes and evidence

| Change | Before | After and reason |
| --- | --- | --- |
| Compiled iOS app icon | The Xcode asset contained the old white Babytuna ring on black. | Copied the existing `assets/images/app-icon.png` into `AppIcon.appiconset`. It contains the delivered silver Smelter mark on white. Exact byte equality checked. No logo generated or redesigned. |
| Compiled iOS launch images | All three scale entries contained the old Babytuna ring. | Copied the existing `assets/images/splash.png` into all three native launch image entries. Exact byte equality checked. Storyboard layout and black background preserved. |
| Permission purpose strings | Generic camera, photo and microphone copy. Native speech recognition had no purpose string. | Named Smelter and described the actual optional features. Added `NSSpeechRecognitionUsageDescription` in Expo config and native plist. `expo-speech-recognition` is linked in `Podfile.lock`; its store calls `requestPermissionsAsync`. This fixes missing configuration but is not a reproduced runtime crash or proof that the legacy speech feature is reachable. |
| Face ID declaration | Secure Store injected an unused purpose string saying the app accessed biometric data. | Removed the plist string and set the existing Secure Store plugin's `faceIDPermission` to false. Source search found no `requireAuthentication` use. This changes no implemented sign-in method. |
| Privacy manifest | `NSPrivacyCollectedDataTypes` was empty. | Declared name, email address, user ID, device ID and other user content, linked to identity for app functionality, with no tracking. Mirrored the manifest into `app.json` so native regeneration retains it. Preserved existing required-reason API declarations. |
| Cloud production toolchain | EAS used its automatic image selection. | Pinned the documented `macos-sequoia-15.6-xcode-26.2` image, matching locally installed Xcode 26.2. This is a reproducibility choice, not evidence that a cloud build passed. |

Privacy evidence: the existing privacy policy describes account and workplace records; profile routes read user names and email; `src/services/notificationService.ts` persists Expo push tokens with `user_id`; ordering and inventory records contain user content. Profile image selection in `app/settings/profile.tsx` and the manager equivalent saves a local URI, so this audit did not claim profile images are uploaded. The manifest is a baseline, not a complete provider retention inventory.

## Assumptions preserved

- Smelter and the delivered silver mark are the intended new brand because they are already the committed Expo name and source assets. No new brand was invented.
- Bundle ID `com.babytuna.systems`, URL scheme `babytunasystems`, project ID, owner and associated webcredentials domain remain existing integration identifiers. Changing them would risk breaking updates, invites or credentials.
- Marketing version remains 2.3, local build number remains 21, and EAS remote versioning still auto-increments production builds. App Store Connect must confirm the next available build number and whether version 2.3 remains submittable.
- OTA runtime stays 2.2. Runtime compatibility is independent of the displayed app version. No native module set was added or removed, and there was no evidence to choose a different runtime. The production update channel still needs validation in the signed binary.
- `supportsTablet: false` and Xcode target family 1 remain iPhone-only. The presence of iPad orientation entries does not make this a universal target.
- `aps-environment` stays `development` in source. Distribution signing must produce production APNs entitlement. Editing the source value alone would not establish push delivery.

## Commands and results

These commands ran from the worktree unless otherwise stated.

| Command | Result |
| --- | --- |
| `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse origin/main`, `git status --short` | Clean baseline, branch and commit shown above. |
| `xcodebuild -version` | Passed: Xcode 26.2, build 17C52. |
| `xcrun --sdk iphoneos --show-sdk-version` | Passed: 26.2. Sandbox cache/FSEvents warnings appeared; the command exited zero. |
| `git -C '/Users/david/Babytuna Systems/smelter' diff -- ios/Babytuna.xcodeproj/project.pbxproj ios/Podfile.lock` | Read-only context inspection. Main-checkout changes were not copied. |
| `plutil -lint ios/Babytuna/Info.plist ios/Babytuna/PrivacyInfo.xcprivacy ios/Babytuna/Supporting/Expo.plist ios/Babytuna/Babytuna.entitlements ios/Babytuna.xcodeproj/project.pbxproj` | Passed for all five files. |
| `npx --no-install expo config --type public --json > /tmp/smelter-native-expo-config.json` | Passed. Resolved display name is Smelter, runtime is 2.2, and resolved privacy manifest equals the native plist. |
| `sips -g pixelWidth -g pixelHeight -g hasAlpha ios/Babytuna/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` | Passed: 1024 by 1024, no alpha channel. |
| Python `plistlib`/JSON inspection and file-byte comparisons | Native and Expo display name agree, privacy dictionaries agree, native icon equals source icon, all three native launch images equal source splash. |
| `git diff --check -- app.json eas.json ios assets` | Passed. |

The native auditor did not run a simulator or build concurrently with the mobile test agent. Simulator screenshots and integrated test results belong in the main report. No remote build, upload, signing change, submission or deployment was performed.

## Submission blockers and checks still required

1. Resolve Apple signing ownership before producing the release archive. Existing uncommitted main-checkout signing settings use team `94WMH54N38`; `eas.json` submission settings use `TH8X9F2YUR`. There is no evidence here that either team is the intended app owner. This audit did not alter either setting.
2. Produce and validate the exact signed distribution archive. Confirm bundle identity, Smelter icon/name, supported SDK, production APNs entitlement, embedded JavaScript, production environment and update channel. Validate the archive in Xcode or App Store Connect and inspect its generated privacy report.
3. Confirm provider retention for optional voice processing, technical logs and any other off-device content. Apple treats data as collected when the developer or a partner can access it beyond servicing the request in real time. This audit cannot infer provider retention or App Store privacy labels from a network call alone. Audio and tip/financial data classification require particular attention before final privacy answers are submitted.
4. Confirm a working privacy policy URL, support URL, updated age-rating answers, screenshots and review metadata in App Store Connect. A policy checked into the repository is not proof that the public URL works.
5. Provide a working reviewer account and instructions that cover enabled employee and manager features. Review credentials must remain valid during review. Exercise invite onboarding and in-app account deletion against the intended backend using authorized disposable test accounts.
6. Perform real-device release validation for microphone recording, photo selection, notification delivery and offline/relaunch behavior. Simulator screenshots do not prove those hardware and production services work.

## Official sources checked

- [Apple upcoming requirements](https://developer.apple.com/news/upcoming-requirements/): uploads require Xcode 26 or newer and an iOS 26 or newer SDK from April 28, 2026; updated age-rating answers are required. Local 26.2 satisfies the SDK floor, subject to validating the final archive.
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/): review requires complete functionality and metadata, a live backend and reviewer access where sign-in is required. Privacy links must be accessible, and account-creation apps must support initiating deletion.
- [Apple app privacy details](https://developer.apple.com/app-store/app-privacy-details/): the collection definition includes third-party access beyond real-time request servicing. Final answers need provider evidence.
- [Apple privacy manifest documentation](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests): collected-data declarations describe the data and purpose. Use the archive's aggregate report to validate bundled SDK declarations.
- [Expo build infrastructure](https://docs.expo.dev/build-reference/infrastructure/): explicitly lists `macos-sequoia-15.6-xcode-26.2` with Xcode 26.2 build 17C52. Automatic image aliases may change.

## Native dependency build unblock

The release worktree initially had no `ios/Pods`. Installed CocoaPods dependencies and removed reliance on manual edits in `node_modules` for Expo's two path-with-spaces bugs.

- Added a `post_install` hook in `ios/Podfile` for the EXConstants and EXUpdates script phases. It runs each script as a quoted Bash file argument instead of nesting an unquoted pathname inside `bash -c`. It preserves `FORCE_BUNDLING` and explicitly supplied `PROJECT_ROOT` values.
- The app target's React Native bundle script was already quoted correctly and needed no change.
- The first `pod install --no-repo-update` failed because sandbox DNS could not resolve the Hermes dependency host. The same install succeeded with approved network/filesystem escalation, installing 109 declared dependencies and 110 pods.
- Root replaced the shared dependency symlink with an isolated worktree install. Ran `pod install --no-repo-update > /tmp/smelter-production-pod-install-final.log 2>&1` again with escalation. It passed in 14 seconds with the same dependency count.
- Initial generated paths pointed at shared dependencies. The final install uses `../node_modules` and restores the Xcode project to its baseline content. The final `ios/Podfile.lock` diff contains only the Podfile checksum. No pod versions or dependency checksums changed.
- Reproduced the original nested-shell failure with a harmless script in a temporary directory containing spaces: exit 127. The quoted direct-file invocation ran that same script successfully: exit 0. This is a targeted shell regression check, not an app build result.
- `ruby -c ios/Podfile` passed. `plutil -lint ios/Pods/Pods.xcodeproj/project.pbxproj ios/Babytuna.xcodeproj/project.pbxproj` passed. `diff ios/Podfile.lock ios/Pods/Manifest.lock` showed no difference. `git diff --check -- ios` passed.
- Inspected generated Pods script phases and confirmed both invoke `bash -l` with a quoted script path. Integrated build ownership then returned to the mobile E2E agent. No native build or simulator was run by this auditor.

## Release manifest launch failure

The integrated Release build succeeded, but launch terminated with `NSInternalInconsistencyException` because the embedded update manifest was missing. The root agent reproduced the app failure and owns the final rebuild/relaunch check.

The first permanent quoting change covered the outer Expo shell invocation but missed a second upstream SDK 54 bug inside both scripts. Fresh dependency installation restored `PROJECT_DIR_BASENAME=$(basename $PROJECT_DIR)` without quotes. In this checkout, the real EXUpdates phase trace selected mode `all`, evaluated the basename as `Babytuna` instead of `Pods`, then exited zero before running Node. The EXConstants phase has the same guard. This explains a successful build with missing generated resources.

Extended the Podfile's install hook to quote this exact expression in the worktree's installed `expo-updates/scripts/create-updates-resources-ios.sh` and `expo-constants/scripts/get-app-config-ios.sh`. The patch is idempotent and survives `npm ci` followed by `pod install`. No package version changed, and updates remain enabled.

Verification:

- The original resource phase ran with the worktree's real `PROJECT_DIR` and exited zero without creating a manifest. A targeted trace showed `PROJECT_DIR_BASENAME=Babytuna` and the early exit.
- `pod install --no-repo-update` passed in 10 seconds after the hook change. `Podfile.lock` again changed only its Podfile checksum.
- Ran each corrected real resource script with Release configuration, the actual worktree/Pods paths, and separate temporary output directories. EXUpdates wrote a parseable embedded `app.manifest` with a valid UUID, commit timestamp and 43 assets. EXConstants wrote parseable `app.config` with name Smelter. Both phases exited zero.
- The first manifest probe incorrectly expected a `runtimeVersion` field and failed that assertion. Expo's embedded build manifest uses the legacy `{ id, commitTime, assets }` shape, confirmed in `createManifestForBuildAsync.js`; the corrected format assertion passed. Runtime version remains configured in Expo.plist.
- Generated Pods project plist validation, Podfile/Manifest.lock parity and `git diff --check -- ios` passed.

These phase probes prove resource generation. The main report must separately record the root agent's rebuilt-app launch result before calling the runtime failure fixed.
