# Google Sheets Quick Order Sync Guide

Quick Order now uses six owner-facing tabs. Five tabs sync to Supabase `qo_*` tables; `documentation` is ignored by the script.

## Tabs

1. `items` -> `qo_items`
2. `reorder_rules` -> `qo_reorder_rules`
3. `personalization` -> `qo_personalization`
4. `keywords` -> `qo_keywords`
5. `holiday_overrides` -> `qo_holiday_overrides`
6. `documentation` -> skipped

`inventory_items`, `locations`, and `suppliers` remain operational app tables. Orders and carts still reference `inventory_items.id`.

## items

Headers:

```text
name	category	aliases	supplier	order_unit	target_stock	location_scope	active	notes	sync_status	sync_error
```

`name`, `supplier`, and `order_unit` are required. `aliases` is comma-separated. Blank `location_scope` means both restaurants. Blank `active` means `TRUE`. The sync resolves `supplier` to `supplier_id`, `location_scope` to `location_id`, and `name` to `inventory_item_id`.

## reorder_rules

Headers:

```text
item_name	trigger_at_or_below	trigger_unit	order_qty	order_unit	location_scope	active	notes	sync_status	sync_error
```

Use this for global/location inventory thresholds. Example: Sriracha at or below `0.5 case` orders `1 case`.

## personalization

Headers:

```text
employee_name	rule_type	phrase	item_name	personal_unit	personal_unit_equals	trigger_at_or_below	order_qty	order_unit	location_scope	active	notes	sync_status	sync_error
```

`rule_type` is either `alias` or `item_config`.

Alias rows use `phrase` only:

```text
Devin	alias	shrimp	Ebi (Cooked Shrimp)
```

Item config rows use unit/threshold fields:

```text
Nate	item_config		Tamago	order		5	1	pack
Nate	item_config		Sriracha	box	case
```

If `personal_unit` is set and `personal_unit_equals` is blank, it is a custom counting unit. Nate's Tamago `order` count is stored separately from normal `pack` counts.

## keywords

Headers:

```text
phrase	meaning_type	equals_unit	status	remaining_qty	action	active	notes	sync_status	sync_error
```

`meaning_type` is `status_term`, `unit_alias`, or `ignore`.

- `unit_alias`: `phrase=box`, `equals_unit=case`.
- `ignore`: `phrase=outside`, `action=strip_and_continue`.
- `status_term`: `phrase=no more`, `status=zero`, `remaining_qty=0`, `action=check_reorder_rule`.

Invalid polymorphic combinations are skipped and write `Error` to `sync_error`.

## holiday_overrides

Headers:

```text
holiday_name	start_date	end_date	item_name	location_scope	target_multiplier	active	notes	sync_status	sync_error
```

This tab syncs now, but the recommendation engine does not read it yet.

## Resolution Priority

Preprocessing strips `ignore` keywords, then applies status terms. Item matching uses employee aliases, global item aliases, exact item name, then fuzzy item name. Unit matching uses employee personal units, keyword unit aliases, then `qo_items.order_unit`. Inventory recommendations use employee item_config thresholds, global reorder rules, item target stock, `item_reorder_rules`, then `item_order_profiles`.

Parser catalog loading still treats linked `qo_items` as the preferred Quick Order source, but it now merges active `inventory_items` as a fallback even when the `qo_items` query itself fails. This prevents an unlinked or partially synced sheet row from making an otherwise valid inventory list unreadable; the sync should still resolve every `qo_items.inventory_item_id`, and unlinked rows are logged for cleanup.

Typed quantities support mixed fractions (`5 1/2` -> `5.5`). Compound inventory counts like `Ikura 1 pack + 3` are either summed when the added amount has a compatible unit, or surfaced as a needs-input warning when the added amount has no unit/conversion.

Order mode honors `app_config.order_mode_missing_unit_strategy = item_default_order_unit`, so a plain line like `Salmon 3` uses the item/default order unit without needing a separate unit-rule row. Inventory mode still marks omitted units as inferred before recommendation rules evaluate them.

## Migration Notes

Remove old Quick Order tabs from the workbook after the new tabs are populated:

`aliases`, `unit_rules`, `status_terms`, `employee_quick_order_aliases`, `inventory_reorder_rules`, `inventory_status_terms`, `unit_synonyms`, `Employee order`, `item_allowed_units`, and `item_order_limits`.

If they remain, the sync logs a deprecation warning and skips them.
