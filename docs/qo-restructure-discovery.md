# Quick Order Restructure Discovery

Generated for the Google Sheets Quick Order restructure.

## Current Sheet To Table Map

- `settings` -> `app_config`
- `locations` -> `locations`
- `suppliers` -> `suppliers`
- `items` -> `inventory_items`
- `inventory_items` -> `inventory_items`
- `aliases` -> `quick_order_alias_rules`
- `unit_rules` -> `quick_order_unit_rules`
- `reorder_rules` -> `quick_order_reorder_rules`
- `status_terms` -> `quick_order_status_terms`
- `item_order_limits` -> `item_order_limits`
- `Employee order` -> `item_allowed_units`
- `item_aliases` -> `item_aliases` optional legacy table
- `quick_order_aliases` -> `quick_order_aliases` optional legacy table
- `employee_quick_order_aliases` -> `employee_quick_order_aliases`
- `inventory_reorder_rules` -> `inventory_reorder_rules`
- `inventory_status_terms` -> `inventory_status_terms`
- `unit_synonyms` -> `unit_synonyms`

## Current Parser Data Dependencies

- `inventory_items`: active catalog, aliases, base/pack/default units, supplier, location, safety caps, target stock.
- `quick_order_sessions`: previous messages and parsed items for conversational context.
- `parser_corrections`: saved user corrections for matching.
- `employee_quick_order_aliases`: employee-scoped phrase to inventory item resolution.
- `quick_order_alias_rules`: global/employee parser alias rules.
- `quick_order_unit_rules`: global/employee unit aliases and missing-unit defaults.
- `quick_order_reorder_rules`: V2 inventory reorder rules.
- `quick_order_status_terms`: V2 qualitative status terms.
- `inventory_reorder_rules`: inventory-mode sheet reorder rules.
- `inventory_status_terms`: qualitative inventory terms.
- `item_allowed_units`: unit restrictions, conversions, employee-specific thresholds.
- `item_order_limits`: safety caps, defaults, and historical limits.
- `unit_synonyms`: stock-mode unit aliases such as box to case.
- `item_reorder_rules`: smart-ordering fallback.
- `item_order_profiles`: history/profile fallback.
- `current_stock_snapshots`: stock count writes from inventory mode.
- `orders`, `order_items`, history RPCs, and `quick_order_cart_mutations`: order history, missing-item checks, and draft mutation tracking.

## quickOrderContextNotes.ts Summary

The context note builder surfaces non-obvious parser decisions only. It preserves notes for inventory rules/no-order decisions, employee aliases, saved corrections, fuzzy matches, unit handling, inferred units, and rule metadata. Inventory-rule notes have highest heading priority, followed by personal context, corrections, unit handling, and item matching.

## Operational Vs Config Tables

Operational tables confirmed in active code: `inventory_items`, `locations`, `suppliers`, `quick_order_sessions`, `parser_corrections`, `current_stock_snapshots`, order/cart/history tables and RPCs, `item_reorder_rules`, and `item_order_profiles`.

Config tables being replaced by `qo_*`: `quick_order_alias_rules`, `quick_order_unit_rules`, `quick_order_reorder_rules`, `quick_order_status_terms`, `employee_quick_order_aliases`, `inventory_reorder_rules`, `inventory_status_terms`, `unit_synonyms`, `item_allowed_units`, and `item_order_limits`.

No additional operational Quick Order config table was found that needs to stay in the sheet-driven path.

## current_stock_snapshots Current Schema

Columns:

- `id uuid primary key default gen_random_uuid()`
- `location_id uuid not null references locations(id)`
- `item_id uuid not null references inventory_items(id)`
- `quantity numeric not null`
- `unit text`
- `source_message text`
- `source text not null check (typed, voice)`
- `entered_by_user_id uuid references users(id)`
- `quick_order_session_id uuid references quick_order_sessions(id)`
- `confidence numeric not null default 0.8`
- `created_at timestamptz not null default now()`

Indexes and policies:

- `current_stock_snapshots_location_item_created_idx(location_id, item_id, created_at desc)`
- `current_stock_snapshots_user_created_idx(entered_by_user_id, created_at desc)`
- `current_stock_snapshots_session_created_idx(quick_order_session_id, created_at desc)`
- RLS allows users to select their own snapshots or managers to select all, and users/managers to insert.

## Risks

- `supabase/functions/parse-order/index.ts` loads many deprecated tables directly; these must be replaced before the edge function can run against the new workbook.
- `process-message.ts` applies `item_allowed_units` and `item_order_limits` safety behavior. David's new design removes that safety layer.
- `stock-updates.ts` currently normalizes stock units via `unit_synonyms` and `quick_order_unit_rules`; custom counting units need to keep their own `tracking_unit`.
- `recommendation-engine.ts` evaluates V2 and inventory reorder rules before legacy fallbacks; it must be reordered to personalization, `qo_reorder_rules`, `qo_items.target_stock`, then legacy fallbacks.
- Google Sheets tests assert old tab names and old table URLs; they need updating to the six-tab workbook.

## Test Inventory

Existing Quick Order tests include:

- `src/__tests__/googleSheetsSync.test.ts`
- `src/__tests__/quickOrderParser.test.ts`
- `src/__tests__/quickOrderContextNotes.test.ts`
- `src/__tests__/quickOrderHistorySuggestions.test.ts`
- `src/__tests__/quickOrderInventoryAudit.test.ts`
- `src/__tests__/quickOrderComposer*.test.ts`
- `src/__tests__/quickOrderVoice.test.ts`
- `src/__tests__/quickOrderStatePersistence.test.ts`
- `src/__tests__/quickOrderCart.test.ts`
- `src/__tests__/quickOrderListCard.test.ts`
- `src/__tests__/quickOrderQuantityFlow.test.ts`
- `src/__tests__/orderSubmission.test.ts`
