# Residual dependency advisory assessment

Assessment date: September 5, 2026 UTC. Read-only package and caller audit at worktree commit `40c11a0bb2dc39f5fa3b915fc433b8b65593c6d2`, ahead of local `origin/main` baseline `cf30d6b`. No packages, source files or installed dependencies changed during this assessment.

The saved npm audit still reports 29 affected package entries: 8 high, 21 moderate, zero critical. Those entries propagate four advisories from three underlying packages through their dependents. They are not 29 separate reachable iOS vulnerabilities. The audit remains red; the exposure assessment below does not clear the advisories.

Input: `docs/release-readiness/logs/npm-audit-final.json` and the installed lockfile/package sources after the compatible security updates.

## Summary

| Package | Concrete caller and input | iOS exposure found | Recommendation |
| --- | --- | --- | --- |
| `decode-uri-component@0.2.2` | `query-string@7.1.3` decodes query keys and values; React Navigation's default `getStateFromPath` calls it. | The package is part of the navigation dependency graph. Smelter's Expo Router 6.0.24 overrides incoming parsing with `URL.searchParams`, and its query-string callers only stringify. No normal Smelter routing path to the vulnerable decoder was found. | Preserve the existing parser. Do not blindly override to ESM-only 0.5.0. Retest routing after future dependency changes. |
| `image-size@1.2.1` | Metro inspects local asset files and buffers during bundling and development. | Build-process availability risk. No on-device call from app or profile-photo code was found. Inputs include package assets as well as app-owned assets. | Keep build assets trusted, review imported files and dependencies, and plan a compatible Metro/Expo toolchain upgrade or targeted parser mitigation. |
| `uuid@7.0.3` | `xcode` calls `uuid.v4()` without an output buffer to generate Xcode project IDs. | Build tooling only; the advisory concerns v3/v5/v6 output-buffer writes, none used by this caller. | Low immediate exposure for this caller. A scoped xcode dependency override to 11.1.1 is a candidate with focused validation, not an applied or tested upgrade. |

## URI decoder

The [maintainer advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) identifies excessive computation when malformed percent-encoded input reaches the decoder. It lists 0.5.0 as patched and input-size limits as a workaround.

Installed call chain:

1. `package-lock.json` has exactly two query-string dependents: Expo Router and `@react-navigation/core`.
2. `node_modules/query-string/index.js:231` calls `decodeComponent(value)` when decoding is enabled. Its `parse` function defaults decoding to true and passes query keys and values through that function.
3. React Navigation's default parser invokes `queryString.parse` in `node_modules/@react-navigation/core/src/getStateFromPath.tsx:879`.
4. Smelter's router store creates Expo's linking config at `node_modules/expo-router/build/global-state/router-store.js:160`. `build/getLinkingConfig.js:90` supplies its own `getStateFromPath` from Expo's fork.
5. `node_modules/expo-router/build/fork/getStateFromPath-forks.js:371` parses incoming queries using `new URL(path, ...).searchParams`. Its path decoder uses the built-in `decodeURIComponent` with a catch. Expo's two query-string imports only call `stringify`, which does not call the affected decoder.
6. Searches found no direct application import of query-string, decode-uri-component or React Navigation's `getStateFromPath`.

A malformed external link is a plausible input for the *default React Navigation parser*, but this audit did not demonstrate it reaches that parser in Smelter. Do not describe an unproven app freeze as reproduced.

A process-local check replaced the installed decoder export with a throwing sentinel, then invoked the installed Expo query parser and query-string serializer for four cases: an invite token, encoded spaces and ampersand, duplicate query keys, and malformed UTF-8 percent escapes. All four passed with zero calls to the sentinel. This verifies those installed helper calls; it is not a simulator deep-link test or a proof covering every future navigation configuration.

The patched [0.5.0 package manifest](https://github.com/SamVerschueren/decode-uri-component/blob/v0.5.0/package.json) declares ESM and a default export. The installed CommonJS query-string calls the result of `require('decode-uri-component')` directly. A raw override changes that module contract. It can fail at require time or return a namespace instead of a callable function, depending on the loader.

A bounded future fix is to adopt a compatible upstream navigation/query-string release that removes the vulnerable dependency, or backport the maintainer's decoder fix through a reviewed CommonJS-compatible package patch. Validate malformed inputs, valid Unicode, spaces, repeated keys and cold/warm deep links. If adding an input boundary instead, it must run before all relevant parsers, including cold launch, and impose an explicit length/encoding policy. A screen-level check occurs too late. No such code change was made here.

## Image parser

The [ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [JXL/HEIF advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) describe infinite parser loops from malformed image structures. The checked advisory records list no patched image-size version.

`package-lock.json` shows Metro as the only direct image-size dependent. `node_modules/metro/src/Assets.js:68` passes asset buffers to image-size; line 173 passes a local asset path or buffer when computing asset metadata. The transformer calls this asset metadata code during bundling. No application source imports image-size.

These inputs are local files in the build graph. They include checked-in app images and images shipped by npm dependencies. They are not restricted to the five Smelter PNGs. All five current source images in `assets/images` have valid PNG signatures, but that limited check does not certify all dependency images or future changes.

Metro limits image handling by filename extension, but `image-size` detects actual type by content. A malicious ICNS/JXL/HEIF file renamed with an accepted extension such as `.png` can bypass an extension-only assumption. An untrusted image added to a branch or dependency can therefore hang a developer or CI bundling process. The shipped iOS app does not execute the Node Metro asset parser when a user selects a local profile photo or loads a remote image.

A possible targeted mitigation uses image-size's documented `disableTypes` API to reject `icns`, `jxl`, `jxl-stream` and `heif` before their parser runs. This must execute in every Metro process that parses assets, including transform workers. Calling it only in the parent `metro.config.js` does not establish worker protection. A worker-compatible transformer wrapper or reviewed package patch would need an actual export/build test. An asset plugin runs after image-size metadata parsing and is too late for this mitigation. No mitigation was installed in this read-only assessment.

The [official project README](https://github.com/image-size/image-size#disabling-certain-image-types) documents disabling types. The installed `dist/index.js:25` confirms the disabled-type check precedes `calculate`. The project is currently archived on GitHub, so there is no basis here to promise a forthcoming patch.

## UUID

The [maintainer advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) concerns missing output-buffer bounds checks in v3, v5 and v6. The installed `xcode/lib/pbxProject.js:90` calls `uuid.v4()` with no buffer or offset. The lockfile shows xcode as the only direct uuid dependent. No app source imports uuid.

A scoped override under `xcode` to 11.1.1 is technically plausible: the [official package manifest](https://raw.githubusercontent.com/uuidjs/uuid/v11.1.1/package.json) keeps a CommonJS `require` export, and its [changelog](https://raw.githubusercontent.com/uuidjs/uuid/v11.1.1/CHANGELOG.md) records the advisory fix. Unlike the decoder upgrade, the observed xcode `v4()` contract remains available. Before applying, test xcode project parse/generate/write/reparse behavior and regenerate native configuration without unrelated diffs. No override was applied or validated here.

## Checks actually run

- Parsed the saved audit JSON and lockfile to identify underlying advisories, exact package versions and direct dependency edges.
- Ran `npm explain decode-uri-component`, `npm explain image-size` and `npm explain uuid`; their peer-tree output was large, so the conclusions use direct lockfile edges and caller searches.
- Used `rg` and line reads in installed package sources, app source and Metro configuration to trace callers.
- Ran a Node process with a throwing decoder sentinel against four actual Expo parser/serializer cases. Passed with zero decoder invocations.
- Checked PNG signatures for the five existing `assets/images/*.png` files. Passed.
- Checked current advisory records, patched package manifests and upstream documentation. No package installation, app build or simulator operation performed for this subtask.

The remaining uncertainty is integration coverage and future reachability. Preserve these findings alongside the red audit result, and rerun the reachability checks whenever Expo Router, React Navigation, Metro, asset handling or xcode dependencies change.
