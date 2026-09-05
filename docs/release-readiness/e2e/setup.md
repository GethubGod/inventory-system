# Mobile E2E setup and evidence

This file records the disposable local setup owned by the mobile E2E pass. It
contains no Supabase keys or passwords. The local stack and test accounts are
for this simulator run only; they are never production data.

## Checkout and simulator

At the start of the pass:

```text
branch: codex/production-readiness
HEAD: cf30d6bc641cd22830420cfd6d431c11d5e3c02f
origin/main: cf30d6bc641cd22830420cfd6d431c11d5e3c02f
```

The historical wrapper target `FCADAB49-3A22-4167-B3EB-F794BEB32D9E` was
absent from the simulator inventory. The existing iOS 26.2 devices were left
untouched. A new iPhone 17 Pro Max, iOS 26.2 device was created for this pass:

```text
EF05F833-2AC4-4383-8688-36C51B956BCF
```

The worktree copy of `scripts/sim.sh` points to this replacement and documents
why. The required guard passed:

```sh
scripts/sim.sh assert
# sim.sh: target OK: iPhone 17 Pro Max EF05F833-2AC4-4383-8688-36C51B956BCF
# (booted, Nellit app absent)
```

The dedicated device was created with:

```sh
xcrun simctl create "Smelter Release QA iPhone 17 Pro Max" \
  com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max \
  com.apple.CoreSimulator.SimRuntime.iOS-26-2
scripts/sim.sh boot
```

## Local backend

The repository full-stack harness was started on its alternate port range so
it could not collide with other projects:

```sh
FULL_STACK_PORT_BASE=54520 scripts/local-db/full-stack.sh up
```

The resulting local endpoints are API `http://127.0.0.1:54521`, database
`127.0.0.1:54522`, and local SMTP `127.0.0.1:54524`. Core containers remained
running under the `production-readiness` project name. The harness applied 27
post-cutoff migrations and skipped the one migration that the repository
already documents as incompatible with the schema snapshot:

```text
PASS: schema loaded (27 migration(s) applied this run).
SKIP 20260828100000_tips_v3_grat_scope_weights_notes.sql
```

The ignored worktree `.env.local` points the app to the local API and uses the
local publishable key. Voice flags remain disabled for the baseline pass.
No key value is recorded here.

## Local accounts and fixture data

Three local GoTrue users were created through the local admin endpoint with
email confirmation enabled, then mirrored into `public.users` and
`public.profiles` by `scripts/release-readiness/seed-local-mobile-e2e.sql`:

| Role | Email | Local auth user id | Credential method |
| --- | --- | --- | --- |
| Manager | `e2e.manager@smelter.test` | `3397dc0f-1f1b-4baf-92b0-adc5aa3cffa5` | email + password |
| Employee | `e2e.employee@smelter.test` | `396c8055-f33e-4d26-9f20-308f617f8396` | email + password |
| Employee | `e2e.employee2@smelter.test` | `13f6359f-5fe3-4c4b-b570-ec84eae58190` | email + password |

The seed also added two active local locations, four inventory items, three
stock areas, four stock-area items, two employee checklists, module overrides
for both employee variants, and one submitted plus one fulfilled order. The
seed command completed with:

```text
PASS: local mobile E2E fixture seeded
```

The seed file is [seed-local-mobile-e2e.sql](../../../scripts/release-readiness/seed-local-mobile-e2e.sql).

## Backend fixture checks

Each command below ran against `supabase_db_production-readiness` and the
fixture itself rolled back its data:

```sh
docker exec -i supabase_db_production-readiness psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/local-db/employee_app_fixture.sql
docker exec -i supabase_db_production-readiness psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/local-db/phase5a_checklist_fixture.sql
docker exec -i supabase_db_production-readiness psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/local-db/onboarding_auth_fixture.sql
docker exec -i supabase_db_production-readiness psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/local-db/phase6c_holiday_templates_fixture.sql
docker exec -i supabase_db_production-readiness psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/local-db/kitchen_requests_fixture.sql
docker exec -i supabase_db_production-readiness psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/local-db/phase6b_screenshot_import_fixture.sql
```

Observed results:

| Fixture | Result |
| --- | --- |
| `employee_app_fixture.sql` | PASS, checklist save/meta/name sync assertions, rollback |
| `phase5a_checklist_fixture.sql` | PASS, frequent/occasional/rare generated rows, rollback |
| `onboarding_auth_fixture.sql` | PASS, credential normalization, rate limit, suspension, manager gates, deletion, rollback |
| `phase6c_holiday_templates_fixture.sql` | PASS, zero rows outside window and three overlays inside, rollback |
| `kitchen_requests_fixture.sql` | PASS, module/location/RLS/RPC transitions, rollback |
| `phase6b_screenshot_import_fixture.sql` | PASS, merge rebuilt checklist, rollback |

The root task already copied complete command logs into
`docs/release-readiness/logs/`.

## Name-login credential verification

The three fixture users were first authenticated through the local GoTrue
email/password endpoint, then each authenticated session called
`public.set_my_login_credential` to provision a disposable four-digit PIN.
The three RPC calls returned HTTP `204`. The local Edge Function was then
called with each display name and its PIN. All three calls returned HTTP `200`
with `{ok, tokenHash}`; token values are kept only in private temporary files
and are not copied into this report.

The first publishable-key request returned HTTP `401`: the local Edge Runtime
exposes its generated key to workers as JSON in `SUPABASE_PUBLISHABLE_KEYS`,
while this function reads the documented comma-separated form. The local
harness now applies a small generated-runtime overlay in
`scripts/local-db/full-stack.sh` that also exposes the same value as
`SUPABASE_PUBLISHABLE_KEY`, then restarts only the disposable Edge Runtime.
No app or Edge Function source is changed. After the overlay, the publishable
key request returned HTTP `200`, and rerunning the full-stack `up` command
reapplied the overlay and returned HTTP `200` again. The one-shot token was
kept in a private temporary file and is not recorded here.

## Build handoff status

The first XcodeBuildMCP Debug build reached Xcode but failed before compiling
because worktree CocoaPods output was not installed. Native setup then installed
109 dependencies / 110 pods and reported the lockfile matching `Manifest.lock`.
The subsequent `build_run_sim` completed with `errors: []` and installed the
app, but its direct launch had no Metro URL. The runtime redbox read:

```text
No script URL provided. Make sure the packager is running or you have embedded
a JS bundle in your application bundle.
```

An Expo CLI retry was stopped at the interactive development-team selector so
it would not make an unreviewed signing choice. Root then built an ad-hoc-signed
simulator Release with an embedded JavaScript bundle and update manifest, set
the QA update policy to `NEVER`, installed it on the dedicated simulator, and
confirmed that it stays loaded across an app-only relaunch. The first unsigned
Release and the missing-manifest failure are retained as historical diagnosis
in `ui-current-pass.md`.

The loaded binary authenticated the disposable manager and employee fixtures.
Manager checklist, simple ordering, location switching, cart, history, quick
actions, receiving empty state, manager home, fulfillment, fulfillment history,
settings, profile, logout, and employee checklist states have recorded
screenshots. Root separately recorded read-only common settings, stock, order
history, and production debug-route guard screens. Remaining feature mutations
and hardware/external-service paths stay explicitly classified in the route
matrix and release report; no unverified mutation is called a pass.

## Integrated schema parity correction

Root review found the local full-stack cutoff omitted the August 11 tip-session
prerequisite. That was why Tips v3 had been incorrectly listed as incompatible.
Aligned the cutoff with the independently passing migration harness and removed
the skip. Checked that both columns and migration-ledger entries were absent,
then ran:

```sh
FULL_STACK_PORT_BASE=54520 scripts/local-db/full-stack.sh load
```

Result: both missing existing migrations applied successfully; no fixture reset.
The complete baseline now includes all 29 migrations verified independently.
Local migration execution now uses `psql --single-transaction` to avoid partial
DDL after an error. The prior skipped state above is historical setup evidence.

## Release launch correction

The first Release binary built successfully but crashed with an invalid embedded
manifest exception. Expo's unquoted PROJECT_DIR check silently skipped resource
generation in the checkout path containing spaces. A durable Podfile hook now
repairs both script invocation and the inner directory check. Root rebuilt,
installed and launched the app successfully; `02-release-manifest-fixed.png`
shows the real welcome screen. `python3 scripts/verify-ios-release.py <app>`
verified the embedded JavaScript, update manifest and all 43 bundled assets.

For headless UI input, set SMELTER_AXE_PATH to the installed XcodeBuildMCP AXe
binary and use `scripts/sim.sh input <command>`. The wrapper pins the same simulator
UDID and rejects caller-provided device overrides. Screenshots still use
`scripts/sim.sh io screenshot <path>`.
