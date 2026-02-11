## ⚠️ Needs your input
- `eas.json`: No `eas.json` is present. If you are shipping via EAS Build/Submit, confirm whether you want me to add pinned production profiles.
- `app/settings/about-support.tsx`: I normalized both Support and Feedback to `babytunalovessushi@gmail.com`. If you want separate production emails, provide them.
- `app/settings/about-support.tsx`: Privacy policy is wired to the existing Notion URL. If you have a final public URL/domain, provide it and I will swap it in.

## ❌ Fixed by code changes (file paths + what changed)
- `app.json`: Added `expo.ios.buildNumber`, added `expo.ios.config.usesNonExemptEncryption=false`, ensured `supportsTablet=false`, added iOS usage strings for camera/microphone/speech/photo/NFC, and aligned icon/splash paths to real files.
- `assets/images/app-icon.png`: Added from existing 1024x1024 icon asset for Expo icon/adaptive icon usage.
- `assets/images/splash.png`: Added from existing splash asset so configured splash path exists.
- `ios/Babytuna.xcodeproj/project.pbxproj`: Updated native iOS bundle identifier to `com.babytuna.app` (Debug/Release) and set `TARGETED_DEVICE_FAMILY=1` to align with `supportsTablet=false`.
- `ios/Babytuna/Info.plist`: Updated URL scheme entry to `com.babytuna.app`, added `ITSAppUsesNonExemptEncryption=false`, updated microphone/photo strings, and added speech recognition usage description.
- `app/settings/about-support.tsx`: Removed placeholder feedback email and cleaned privacy policy link to a stable URL format.
- `src/lib/supabase.ts`: Added missing-env detection (`supabaseConfigError`) and safe fallback client initialization to avoid hard crash from missing env vars.
- `app/_layout.tsx`: Added configuration error screen and gated auth auto-refresh/init when Supabase env vars are missing.
- `app/orders/[id].tsx`: Added robust route-param parsing (`string | string[]`), load error state, invalid-link fallback UI, and awaited refresh calls after order mutations.
- `app/stock/[areaId].tsx`: Replaced null return on missing `areaId` with user-facing fallback and safe navigation back to stock root.
- `app/stock/completion.tsx`: Replaced null return on missing `areaId` with user-facing fallback and safe navigation back to stock root.
- `app/order-confirmation.tsx`: Added robust param parsing for `orderNumber`/`locationName` to handle array params safely.
- `app/(manager)/export-fish-order.tsx`: Added safe param + JSON parsing helpers to prevent runtime crashes from malformed route params.

## ❌ Needs code changes (if any remain)
- None found in this pass for the requested in-repo submission checks.

## Deploy/verification notes
- Delete-self function exists at `supabase/functions/delete-self/index.ts`. Ensure it is deployed to your target project/environment: `supabase functions deploy delete-self`.
- Build number is now explicitly set in `app.json`; increment before each App Store/TestFlight upload.
- iOS bundle identifier is now aligned to `com.babytuna.app` in both Expo config and native iOS project files.
