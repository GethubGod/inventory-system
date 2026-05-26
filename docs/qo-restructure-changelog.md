# Quick Order Restructure Changelog

Migration date used in SQL comments: 2026-05-26.

## Chronological Work Log

1. Discovery
   - Read the Quick Order parser contract, Google Sheets sync script, parse-order edge function pipeline, recommendation and safety engines, client submit path, operator docs, relevant migrations, and Quick Order tests.
   - Produced `docs/qo-restructure-discovery.md`.

2. Schema audit
   - Produced `docs/qo-restructure-schema-audit.md`.
   - Documented the five new `qo_*` tables, `current_stock_snapshots.tracking_unit`, data migration plan, resolution pseudocode, and deferred deprecated table drops.

3. Database migration
   - Added `supabase/migrations/20260526100000_google_sheets_quick_order_restructure.sql`.
   - Created `qo_items`, `qo_reorder_rules`, `qo_personalization`, `qo_keywords`, and `qo_holiday_overrides`.
   - Added `current_stock_snapshots.tracking_unit` and `tracking_unit_key`.
   - Added a tracked-unit uniqueness index for employee/item/location/tracking unit.
   - Seeded the new tables from existing active source tables.
   - Added SQL deprecation comments to the Decision 3 tables.

4. Google Sheets sync
   - Updated `scripts/google-sheets-sync.js`.
   - Replaced active Quick Order sheet syncs with `items`, `reorder_rules`, `personalization`, `keywords`, `holiday_overrides`, and explicit `documentation` skip.
   - Added strict headers, FK resolution, polymorphic row validation, sync status/error writeback, and deprecated-tab logging.

5. Edge function runtime
   - Updated `supabase/functions/parse-order/index.ts` to load `qo_items`, `qo_reorder_rules`, `qo_personalization`, `qo_keywords`, and `qo_holiday_overrides`.
   - Kept `item_reorder_rules` and `item_order_profiles` only as legacy fallback inputs.
   - Updated `supabase/functions/parse-order/types.ts` for `qo_item_id`, `tracking_unit`, and custom counting unit metadata.
   - Updated `supabase/functions/parse-order/stock-updates.ts` to carry custom `tracking_unit`, preserve custom units through synonym normalization, and support status terms in prefix and suffix positions.
   - Updated `supabase/functions/parse-order/process-message.ts` to treat inventory-mode status-only phrases as stock input and avoid review rows for recognized status segments.
   - Updated `supabase/functions/parse-order/recommendation-engine.ts` so personalization, `qo_reorder_rules`, `qo_items.target_stock`, then legacy fallback ordering is represented.
   - Stubbed `supabase/functions/parse-order/safety-engine.ts` to pass through without caps or blocking, per the no-safety-layer decision.

6. Parser contract and operator docs
   - Rewrote `src/features/ordering/quickOrderContextNotes.ts` for the new `qo_*` contract, resolution priority, custom counting units, deprecated tables, and legacy fallback role.
   - Rewrote `docs/google-sheets-quick-order-sync.md` for the six-tab workbook structure, polymorphic rows, Devin/Nate examples, resolution priority, and migration notes.

7. Tests
   - Added `src/__tests__/quickOrderRestructure.test.ts` with 20 required contract tests.
   - Updated `src/__tests__/googleSheetsSync.test.ts` for the new six-tab sync config.
   - Updated `src/__tests__/quickOrderParser.test.ts` to remove obsolete safety-layer expectations and keep inventory status behavior passing.
   - Marked legacy tests that assert retired safety caps, item allowed-unit enforcement, or old employee unit-rule behavior as skipped because those behaviors are intentionally removed by this restructure.

8. Final deliverables
   - Added this changelog.
   - Added `docs/qo-restructure-validation-checklist.md`.

9. Parser regression hotfix
   - Added a pure catalog builder module and changed `parse-order` catalog loading to merge active `inventory_items` as a fallback even when `qo_items` fails to load.
   - Added a minimal `inventory_items` fallback query so optional catalog columns cannot empty the parser catalog.
   - Fixed order-mode missing-unit defaults so `order_mode_missing_unit_strategy=item_default_order_unit` works without requiring a separate default unit-rule row.
   - Updated the mobile response guard so inventory-mode stock updates, recommendations, warnings, blocked operations, and assistant actions count as structured output even when the backend also returns a transient raw error.
   - Added regression coverage for the exact sushi list containing mixed fractions and `Ikura 1 pack + 3` in both order and inventory modes.

## Tables Created Or Altered

- Created: `qo_items`
- Created: `qo_reorder_rules`
- Created: `qo_personalization`
- Created: `qo_keywords`
- Created: `qo_holiday_overrides`
- Altered: `current_stock_snapshots`
  - Added `tracking_unit`
  - Added generated `tracking_unit_key`
  - Added tracked-unit uniqueness index
- Commented deprecated: `quick_order_alias_rules`, `quick_order_unit_rules`, `quick_order_reorder_rules`, `quick_order_status_terms`, `employee_quick_order_aliases`, `inventory_reorder_rules`, `inventory_status_terms`, `unit_synonyms`, `item_allowed_units`, `item_order_limits`

## Tests Added

- `src/__tests__/quickOrderRestructure.test.ts`
  - Devin pure-word alias.
  - Nate per-employee renamed unit.
  - Global keyword renamed unit.
  - Nate custom counting unit above, at, and below threshold.
  - Global reorder rule.
  - Maintain-target default.
  - Legacy fallback.
  - Ignore word.
  - Status term enough, zero, and partial.
  - Location scope.
  - Personalization priority over global reorder rule.
  - Sheet round-trip sync contract.
  - Personalization polymorphic row error.
  - Keywords polymorphic row error.
  - Deprecated tab handling.
  - Custom unit isolation.

## Assumptions Made

- `inventory_items` remains the operational item id source everywhere orders/cart/submission need `item_id`.
- `qo_items.inventory_item_id` is resolved case-insensitively by name during sync and migration.
- Supplier and location names are resolved case-insensitively in the sync script.
- `holiday_overrides` is synced and fetched but not consumed by recommendation logic in this task.
- Existing dirty worktree changes outside this task were preserved and not reverted.
- Legacy safety and item allowed-unit tests were skipped rather than rewritten because the prompt explicitly retires those layers.
- The local Supabase integration sanity check was blocked because `supabase status` could not connect to the Docker daemon at `/var/run/docker.sock`; the unit/integration Jest coverage was run instead. A second-agent validation pass should run the SQL migration and edge function requests against local Supabase.

## Verification Run

- `npm run typecheck` passed.
- `npm run lint` exited 0 with warnings only.
- `npx jest src/__tests__/quickOrderRestructureFixups.test.ts --runInBand` passed, including the exact sushi list in both order and inventory modes.
- `npx jest src/__tests__/quickOrderRestructure.test.ts --runInBand --watchman=false` passed: 20 tests.
- `npx jest src/__tests__/quickOrderParser.test.ts --runInBand --watchman=false` passed.
- `npm test -- --runInBand --watchman=false` passed: 27 suites passed, 1 suite skipped, 645 tests passed, 14 skipped.
- `supabase status` failed because Docker was not available, so local edge-function curl checks were not run.

## Known Follow-Up

- Run the new migration on a local Supabase database and verify generated row counts against production-like data.
- Remove dead helper code left behind by the no-safety stub once the team is comfortable deleting the file entirely.
- Drop deprecated Decision 3 tables in a follow-up migration 30 days after production stability is confirmed.
