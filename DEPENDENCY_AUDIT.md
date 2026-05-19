# Dependency Audit Notes

Last checked with `npm audit fix` and `npm audit --omit=dev --audit-level=critical`.

- Safe `npm audit fix` reduced the audit report to moderate advisories.
- Remaining production advisories are transitive through Expo's Metro toolchain:
  `postcss <8.5.10` under `@expo/metro-config` and `brace-expansion <1.1.13`.
- `npm audit fix --force` currently proposes installing `expo@49.0.23`, which would be a breaking SDK downgrade from Expo 54. Do not force this automatically.
- Revisit after an Expo SDK / Expo CLI patch includes the fixed transitive versions, or apply a targeted override only after `expo-doctor`, typecheck, lint, Jest, and device smoke tests pass.
