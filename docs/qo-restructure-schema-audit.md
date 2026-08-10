# Quick Order Restructure Schema Audit

## New Tables

The migration creates:

- `qo_items`: sheet-managed Quick Order catalog config, linked to `inventory_items` by `inventory_item_id`.
- `qo_reorder_rules`: global/location reorder thresholds.
- `qo_personalization`: employee aliases and employee item configuration rows.
- `qo_keywords`: ignore phrases, unit aliases, and status terms.
- `qo_holiday_overrides`: synced schema only; runtime logic is deferred.

All five tables use UUID primary keys, `created_at`/`updated_at`, RLS enabled, authenticated select for active rows (or managers), manager-only writes, and `service_role` grants for sync.

## current_stock_snapshots Extension

The migration adds `tracking_unit text null` and a unique index on:

`entered_by_user_id, item_id, location_id, coalesce(tracking_unit, '__default__')`

The parse-order writer changes to upsert snapshots through this identity so Nate's custom `order` count and another employee's `pack` count can coexist.

## Data Migration Plan

The migration is idempotent and runs in one transaction. Dry-run row count queries are included as comments in the migration for:

- active `inventory_items` to `qo_items`
- `inventory_reorder_rules` and `quick_order_reorder_rules` to `qo_reorder_rules`
- `inventory_status_terms`, `quick_order_status_terms`, and `unit_synonyms` to `qo_keywords`
- employee/global alias and unit/reorder rows to `qo_personalization` or `qo_items.aliases`

`item_allowed_units` and `item_order_limits` are intentionally discarded from the new config layer.

## Resolution Priority Pseudocode

Preprocessing:

1. Strip active `qo_keywords` rows where `meaning_type = 'ignore'`.
2. For `meaning_type = 'status_term'`, emit status and `remaining_qty`.

Item:

1. `qo_personalization` where employee matches, `rule_type = 'alias'`, phrase matches, and location matches.
2. `qo_items.aliases` split by comma.
3. `qo_items.name` exact match.
4. `qo_items.name` fuzzy match.

Unit:

1. `qo_personalization` where employee, item, and `personal_unit` match.
2. `qo_keywords` where `meaning_type = 'unit_alias'`.
3. `qo_items.order_unit`.

Reorder:

1. `qo_personalization` item_config threshold fields for employee/item/location.
2. `qo_reorder_rules` for item/location.
3. `qo_items.target_stock`.
4. `item_reorder_rules`.
5. `item_order_profiles`.
6. No recommendation.

## Contract Mapping

- Personal context notes map to `qo_personalization(rule_type='alias')`.
- Unit notes map to `qo_personalization.personal_unit`, `qo_keywords(unit_alias)`, or `qo_items.order_unit`.
- Inventory no-order/recommendation notes map to `qo_personalization` thresholds, `qo_reorder_rules`, `qo_keywords(status_term)`, and `qo_items.target_stock`.
- Fuzzy/correction notes still use parser corrections and catalog matching.

## Deprecation Deferred

The follow-up drop migration should run about 30 days after this migration is live and stable. Deferred tables:

- `quick_order_alias_rules`
- `quick_order_unit_rules`
- `quick_order_reorder_rules`
- `quick_order_status_terms`
- `employee_quick_order_aliases`
- `inventory_reorder_rules`
- `inventory_status_terms`
- `unit_synonyms`
- `item_allowed_units`
- `item_order_limits`
