# Quick Order Restructure Validation Checklist

Use this checklist for second-agent validation after applying the migration to a local Supabase database.

## Schema

- [ ] `qo_items` exists with the expected sheet columns plus `id`, `inventory_item_id`, `supplier_id`, `location_id`, `created_at`, and `updated_at`.
- [ ] `qo_reorder_rules` exists with the expected sheet columns plus `id`, `qo_item_id`, `location_id`, `created_at`, and `updated_at`.
- [ ] `qo_personalization` exists with alias/item_config validation and FKs to `auth.users`, `qo_items`, and `locations`.
- [ ] `qo_keywords` exists with `status_term`, `unit_alias`, and `ignore` constraints plus `phrase_key`.
- [ ] `qo_holiday_overrides` exists and is synced/fetched but not consumed by runtime recommendation logic.
- [ ] `current_stock_snapshots` has `tracking_unit`.
- [ ] `current_stock_snapshots` has a tracked-unit uniqueness path for employee/item/location/tracking unit.
- [ ] Deprecated Decision 3 tables have SQL comments marking them as superseded by `qo_*` tables on 2026-05-26.

## Data Migration

- [ ] Active `inventory_items` rows seeded `qo_items`.
- [ ] `inventory_reorder_rules` and global `quick_order_reorder_rules` seeded `qo_reorder_rules`.
- [ ] `inventory_status_terms`, `quick_order_status_terms`, and `unit_synonyms` seeded `qo_keywords`.
- [ ] Employee-scoped aliases and item config rows seeded `qo_personalization`.
- [ ] Global aliases from `quick_order_alias_rules` were appended to `qo_items.aliases`.
- [ ] `item_allowed_units` and `item_order_limits` were not migrated.
- [ ] Row counts match the dry-run estimates in `docs/qo-restructure-schema-audit.md`.

## Sync Script

- [ ] `items`, `reorder_rules`, `personalization`, `keywords`, and `holiday_overrides` sync to `qo_*` tables.
- [ ] `documentation` is explicitly skipped.
- [ ] Deprecated tabs such as `unit_synonyms` log a deprecation warning and do not write to deprecated tables.
- [ ] `items` resolves `inventory_item_id`, `supplier_id`, and `location_id`.
- [ ] `reorder_rules` resolves `qo_item_id` and `location_id`.
- [ ] `personalization` resolves employee, item, and location references.
- [ ] `keywords` writes `phrase_key`.
- [ ] Polymorphic personalization errors are written to `sync_error` and skipped.
- [ ] Polymorphic keyword errors are written to `sync_error` and skipped.

## Edge Function

- [ ] Active parse-order data loading reads `qo_items`, `qo_reorder_rules`, `qo_personalization`, `qo_keywords`, and `qo_holiday_overrides`.
- [ ] Active parse-order data loading does not read deprecated Decision 3 tables.
- [ ] `item_reorder_rules` and `item_order_profiles` are still available only as legacy recommendation fallback inputs.
- [ ] Item resolution priority is personalization alias, `qo_items.aliases`, exact `qo_items.name`, fuzzy `qo_items.name`.
- [ ] Unit resolution priority is personalization item config, `qo_keywords` unit alias, `qo_items.order_unit`.
- [ ] Reorder priority is personalization threshold, `qo_reorder_rules`, `qo_items.target_stock`, legacy `item_reorder_rules`, legacy `item_order_profiles`, no recommendation.
- [ ] Ignore keywords strip before tokenization.
- [ ] Status keywords work in inventory mode and can appear before or after the item phrase.
- [ ] Custom counting units write `tracking_unit`.
- [ ] Custom counting unit thresholds evaluate against matching tracking units.
- [ ] Triggered custom-unit recommendations emit `order_qty` and `order_unit` from personalization in global units.

## Required Behavioral Checks

- [ ] Devin `shrimp 2` resolves to `Ebi (Cooked Shrimp)`, 2 pack.
- [ ] Nate `Sriracha 1 box` resolves box to case through personalization.
- [ ] Generic employee `Sriracha 1 box` resolves box to case through `qo_keywords`.
- [ ] Nate `Tamago 10` writes `tracking_unit = order` and returns no recommendation.
- [ ] Nate `Tamago 5` recommends 1 pack.
- [ ] Nate `Tamago 4` recommends 1 pack.
- [ ] Generic inventory `Sriracha 0.5 case` recommends 1 case through `qo_reorder_rules`.
- [ ] Salmon current stock 1 case with `target_stock = 3` recommends 2 cases.
- [ ] Item with only legacy `item_reorder_rules` still recommends through fallback.
- [ ] `Albacore outside 2 case` strips `outside`.
- [ ] `Sriracha a lot` returns no order.
- [ ] `Sriracha no more` checks reorder rules.
- [ ] `Wakame half` checks reorder rules with remaining quantity 0.5.
- [ ] Poki-only Edamame is not visible at Sushi.
- [ ] Nate personalization threshold wins over global Sriracha rule.
- [ ] Nate Tamago `tracking_unit = order` snapshot coexists with another employee Tamago `tracking_unit = pack` snapshot.

## Test Commands

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npx jest src/__tests__/quickOrderRestructure.test.ts --runInBand --watchman=false`
- [ ] `npm test -- --runInBand --watchman=false`

## Documentation

- [ ] `src/features/ordering/quickOrderContextNotes.ts` accurately describes the new parser contract.
- [ ] `docs/google-sheets-quick-order-sync.md` accurately describes the six-tab workbook.
- [ ] `docs/qo-restructure-discovery.md` exists.
- [ ] `docs/qo-restructure-schema-audit.md` exists.
- [ ] `docs/qo-restructure-changelog.md` exists.
- [ ] `docs/qo-restructure-validation-checklist.md` exists.

## Environment-Limited Validation

- [ ] Start local Supabase.
- [ ] Apply `20260526100000_google_sheets_quick_order_restructure.sql`.
- [ ] Seed Nate, Devin, a generic employee, Sriracha, Tamago, Salmon, Wakame, Albacore, and Edamame fixtures.
- [ ] Run parse-order requests through the local edge function for the required behavioral checks.
- [ ] Confirm database snapshot rows contain expected `tracking_unit` values.
