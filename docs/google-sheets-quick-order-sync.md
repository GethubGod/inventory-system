# Google Sheets Quick Order Sync Guide

This guide explains how the Babytuna Google Sheets sync works for the new Quick Order safety and intelligence tables. It is written for someone who has not seen the code before and needs to maintain, set up, or extend the spreadsheet.

The short version: keep the existing `inventory_items` tab as-is, and add optional new tabs only when you want to manage Quick Order guardrails from Google Sheets.

## What Already Exists

The existing sync pushes these required tabs from Google Sheets into Supabase:

- `locations`
- `suppliers`
- `inventory_items`

Those tabs are the foundation. Quick Order can still work if only these three tabs exist.

The new Quick Order tabs are optional enhancements:

- `item_allowed_units`
- `item_order_limits`
- `item_aliases` optional future table
- `quick_order_aliases` optional future table

If any optional tab is missing, sync should log:

```text
Optional sheet missing, skipped
```

That is correct behavior. It should not fail the full sync.

## Do Not Add These Columns To `inventory_items`

Do not add the Quick Order safety columns directly to the existing `inventory_items` sheet.

The sync script maps one sheet tab to one Supabase table:

- `inventory_items` tab syncs to `inventory_items`
- `item_allowed_units` tab syncs to `item_allowed_units`
- `item_order_limits` tab syncs to `item_order_limits`

If you put `hard_max_quantity`, `default_order_unit`, or similar fields inside `inventory_items`, they will not sync into the Quick Order safety tables.

Use formulas to pull IDs and names from `inventory_items` into the new tabs so you do not retype everything.

## Recommended Setup Order

1. Keep `inventory_items` unchanged.
2. Add `item_allowed_units` first.
3. Add `item_order_limits` only for items that need guardrails.
4. Do not add `item_aliases` or `quick_order_aliases` unless matching Supabase tables exist.

Most teams should start with only `item_allowed_units`.

## Required Naming Rules

Sheet tab names must match exactly:

```text
item_allowed_units
item_order_limits
```

Column headers must:

- use lowercase `snake_case`
- match the DB column names exactly
- appear in the exact order shown below
- not be renamed for readability

For example, use `hard_max_quantity`, not `Hard Max`, `hard max`, or `max allowed`.

## `item_allowed_units`

This tab tells Quick Order which units are valid for each item and which unit should be treated as the default order unit.

Create a tab named exactly:

```text
item_allowed_units
```

Use these headers exactly:

```text
id	item_id	unit	is_default	conversion_to_base_unit	min_quantity	soft_max_quantity	hard_max_quantity	created_at	updated_at
```

### Columns

`id`
: Optional. Leave blank for new rows. The script will generate a UUID.

`item_id`
: Required for active rows. This must be the UUID from `inventory_items.id`.

`unit`
: Required for active rows. Examples: `case`, `pack`, `piece`, `lb`, `oz`, `tray`, `box`.

`is_default`
: Optional but recommended. Use `TRUE` for the preferred ordering unit. Use `FALSE` for secondary valid units.

`conversion_to_base_unit`
: Optional. Use only if you know how to convert this unit into the base unit. Leave blank if unsure.

`min_quantity`
: Optional. Minimum useful quantity for this unit.

`soft_max_quantity`
: Optional. Quantity above this should ask for confirmation.

`hard_max_quantity`
: Optional. Quantity above this should be blocked.

`created_at`
: Optional. Leave blank.

`updated_at`
: Optional. Leave blank.

### Minimal Example

```text
id	item_id	unit	is_default	conversion_to_base_unit	min_quantity	soft_max_quantity	hard_max_quantity	created_at	updated_at
	ef1abdd4-048a-4628-8df4-de57e363006	case	TRUE						
	ef1abdd4-048a-4628-8df4-de57e363006	piece	FALSE						
	dea5ea97-79a9-48d9-bc8d-3a076355ceeb	pack	TRUE						
	dea5ea97-79a9-48d9-bc8d-3a076355ceeb	oz	FALSE						
```

In this example:

- Salmon can be ordered by `case` or `piece`.
- `case` is the preferred/default unit.
- Masago can be ordered by `pack` or `oz`.
- `pack` is the preferred/default unit.

### What To Fill First

For a simple setup, only fill:

- `item_id`
- `unit`
- `is_default`

Leave the numeric columns blank unless you have real guardrails.

## `item_order_limits`

This tab stores item-level safety and recommendation limits.

Create a tab named exactly:

```text
item_order_limits
```

Use these headers exactly:

```text
id	item_id	location_id	supplier_id	default_order_unit	typical_min_quantity	typical_max_quantity	soft_max_quantity	hard_max_quantity	manager_approval_quantity	allow_employee_override	allow_manager_override	max_single_order_quantity	max_daily_quantity	max_weekly_quantity	historical_median_quantity	historical_p95_quantity	historical_max_quantity	created_at	updated_at
```

### Columns

`id`
: Optional. Leave blank for new rows. The script will generate a UUID.

`item_id`
: Required for active rows. This must be the UUID from `inventory_items.id`.

`location_id`
: Optional. Leave blank for a global rule that applies to all locations. Fill with a `locations.id` UUID only when the limit is location-specific.

`supplier_id`
: Optional. Leave blank unless the rule is supplier-specific.

`default_order_unit`
: Recommended. The unit recommendations should use, such as `case`, `pack`, `lb`, or `tray`.

`typical_min_quantity`
: Optional. A normal lower bound. Useful for recommendations.

`typical_max_quantity`
: Optional. A normal upper bound. Useful for safety messaging.

`soft_max_quantity`
: Optional. Quantity above this should ask for confirmation but may still be allowed.

`hard_max_quantity`
: Optional. Quantity above this should be blocked.

`manager_approval_quantity`
: Optional. Quantity above this requires manager approval for employees.

`allow_employee_override`
: Optional. Usually `FALSE`.

`allow_manager_override`
: Optional. Usually `TRUE`.

`max_single_order_quantity`
: Optional. Legacy/supplemental maximum for one order. Leave blank unless needed.

`max_daily_quantity`
: Optional. Future daily guardrail. Leave blank unless needed.

`max_weekly_quantity`
: Optional. Future weekly guardrail. Leave blank unless needed.

`historical_median_quantity`
: Optional. Historical typical middle order quantity.

`historical_p95_quantity`
: Optional. Historical unusually-high threshold. Useful for voice quantity confirmation.

`historical_max_quantity`
: Optional. Highest known historical order quantity.

`created_at`
: Optional. Leave blank.

`updated_at`
: Optional. Leave blank.

### Minimal Example

```text
id	item_id	location_id	supplier_id	default_order_unit	typical_min_quantity	typical_max_quantity	soft_max_quantity	hard_max_quantity	manager_approval_quantity	allow_employee_override	allow_manager_override	max_single_order_quantity	max_daily_quantity	max_weekly_quantity	historical_median_quantity	historical_p95_quantity	historical_max_quantity	created_at	updated_at
	ef1abdd4-048a-4628-8df4-de57e363006			case	1	4	6	12		FALSE	TRUE								
	dea5ea97-79a9-48d9-bc8d-3a076355ceeb			pack	1	2	4	8		FALSE	TRUE								
```

In this example:

- Salmon default order unit is `case`.
- Salmon above `6 case` asks for confirmation.
- Salmon above `12 case` is blocked.
- Masago default order unit is `pack`.
- Masago above `4 pack` asks for confirmation.
- Masago above `8 pack` is blocked.

### What To Fill First

For a simple setup, only fill:

- `item_id`
- `default_order_unit`
- `soft_max_quantity` if you want confirmation above a value
- `hard_max_quantity` if you want blocking above a value
- `allow_employee_override`
- `allow_manager_override`

Leave historical fields blank unless you have real historical order stats.

## Why There Are Many Quantity Fields

The fields serve different purposes. You do not need to fill them all.

`typical_min_quantity`
: Helps recommendations know a minimum useful quantity.

`typical_max_quantity`
: Defines the normal high end, but does not necessarily block.

`soft_max_quantity`
: Triggers confirmation. Example: “Salmon 7 cases is above normal. Confirm?”

`hard_max_quantity`
: Blocks the item from being added. Example: “Salmon 17 cases is above the safe limit.”

`manager_approval_quantity`
: Allows managers to approve larger quantities while employees are blocked.

`max_single_order_quantity`
: Extra maximum for one order. Usually leave blank if `hard_max_quantity` is used.

`max_daily_quantity`
: Future daily limit. Usually leave blank.

`max_weekly_quantity`
: Future weekly limit. Usually leave blank.

`historical_median_quantity`
: Historical middle order amount.

`historical_p95_quantity`
: Historical high-but-not-impossible amount. Useful for catching voice transcription mistakes.

`historical_max_quantity`
: Highest known historical order.

If you are unsure, leave optional numeric fields blank. Blank numeric cells are safe.

## How To Avoid Retyping Item IDs

Do not manually retype every item ID. Use formulas.

### Simple Copy Method

1. Duplicate the `inventory_items` tab.
2. Rename the duplicate to `item_allowed_units`.
3. Delete columns you do not need.
4. Reorder and rename columns to match the required `item_allowed_units` headers.
5. Keep the old `id` values under `item_id`.
6. Clear the `id` column so the sync script can generate row IDs.

This is good for a one-time setup.

### Formula Method

Use formulas to pull from `inventory_items`.

For example, if `inventory_items` has:

- column A = `id`
- column E = `base_unit`
- column F = `pack_unit`

In `item_allowed_units`, you can set:

```text
B2 = inventory_items!A2
C2 = inventory_items!F2
D2 = TRUE
```

Then create a second row for the same item with:

```text
B3 = inventory_items!A2
C3 = inventory_items!E2
D3 = FALSE
```

That gives each item one default order unit and one secondary unit.

## Suggested Setup From Current Inventory Columns

Your current `inventory_items` sheet already has useful fields:

- `id`
- `name`
- `base_unit`
- `pack_unit`
- `pack_size`
- `active`

For many items:

- use `pack_unit` as the default Quick Order unit
- use `base_unit` as an allowed secondary unit

Examples:

```text
Inventory item: Salmon
base_unit: piece
pack_unit: case

item_allowed_units rows:
Salmon case TRUE
Salmon piece FALSE
```

```text
Inventory item: Masago
base_unit: oz
pack_unit: pack

item_allowed_units rows:
Masago pack TRUE
Masago oz FALSE
```

```text
Inventory item: Uni
base_unit: tray
pack_unit: pack

item_allowed_units rows:
Uni pack TRUE
Uni tray FALSE
```

## Recommended First Pass

Start small. Add guardrails only for the highest-risk items.

Good first candidates:

- Salmon
- Tuna Loin
- Albacore Loin
- Masago
- Uni
- Ikura
- Tobiko
- Unagi
- Hamachi / Yellowtail

For the rest, `item_allowed_units` is enough.

## Optional Aliases

The sync config includes:

- `item_aliases`
- `quick_order_aliases`

These are future/optional tables. The current app already supports aliases through `inventory_items.aliases`.

Do not create these tabs unless the matching Supabase tables exist.

If these tabs are missing, sync will skip them safely.

## Pull-Only Stock Snapshot Sheet

The script can pull current stock snapshots into:

```text
_current_stock_snapshots
```

This is read-only visibility data from Supabase. Do not edit it and expect changes to push back.

Use the menu:

```text
Babytuna Sync -> Pull from Supabase (read-only tables)
```

It will also pull:

- `_orders (read-only)`
- `_order_items (read-only)`

## Sync Behavior

### Missing Optional Tabs

If an optional tab does not exist, sync logs:

```text
Optional sheet missing, skipped
```

This is correct.

### Blank Optional Rows

Blank rows are skipped.

### Blank Numeric Cells

Blank numeric cells become `null` or are omitted.

They do not break sync.

### Invalid Numeric Cells

Invalid numeric values are logged as warnings and skipped.

Example invalid values:

- `many`
- `lots`
- `two cases`

Use only numbers in numeric columns.

### Blank Boolean Cells

Blank boolean cells are okay.

Accepted boolean values:

- `TRUE`
- `FALSE`
- `yes`
- `no`
- `1`
- `0`

### Orphan Deletion

Orphan deletion is disabled by default for optional Quick Order tabs.

That means missing optional rows do not delete existing database guardrails.

This prevents accidentally removing safety rules just because a sheet is incomplete.

To enable optional orphan deletion later, set Apps Script property:

```text
ENABLE_OPTIONAL_QUICK_ORDER_ORPHAN_DELETE=true
```

Do not enable this unless the optional sheet is complete and intentionally owns that table.

## Apps Script Setup Checklist

1. Open Google Sheets.
2. Go to Extensions -> Apps Script.
3. Replace the script with the latest `scripts/google-sheets-sync.js`.
4. Confirm script properties are set:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
5. Save.
6. Reload the spreadsheet.
7. Use `Babytuna Sync -> Sync All to Supabase`.

Expected output when optional sheets are missing:

```text
locations: rows upserted
suppliers: rows upserted
inventory_items: rows upserted
item_order_limits: Optional sheet missing, skipped
item_allowed_units: Optional sheet missing, skipped
item_aliases: Optional sheet missing, skipped
quick_order_aliases: Optional sheet missing, skipped
optional orphan deletion disabled
```

This is healthy.

## Extending The Sync Script

The sync script is in:

```text
scripts/google-sheets-sync.js
```

Each pushed sheet is configured in `SYNC_CONFIG`.

Required fields:

`sheet`
: Google Sheets tab name.

`table`
: Supabase table name.

`conflictColumn`
: Column used for upsert conflicts, usually `id`.

Optional Quick Order tables should also define:

`optional: true`
: Missing sheet should not fail sync.

`expectedHeaders`
: Exact header list, in order, for strict validation.

`requiredActiveFields`
: Fields required only when a row has meaningful data.

`meaningfulFields`
: Fields used to decide whether a row should be synced or treated as blank.

`numericFields`
: Fields normalized as numbers; blank becomes null.

`booleanFields`
: Fields normalized as booleans; blank is omitted.

`optionalTable: true`
: Table may not exist yet. HTTP/schema-cache failures should skip safely.

## Current Limitations

- One sheet tab syncs to one Supabase table.
- `inventory_items` cannot currently populate `item_allowed_units` or `item_order_limits` directly.
- Header order is strict for optional sheets that define `expectedHeaders`.
- Alias tabs are configured as optional future tables, but current aliases still live in `inventory_items.aliases`.
- Pull-only sheets are for visibility, not editing.

## Quick Start Recommendation

For immediate use:

1. Add `item_allowed_units`.
2. Populate only fish/high-volume items first.
3. Fill `item_id`, `unit`, and `is_default`.
4. Add `item_order_limits` only for risky items.
5. In `item_order_limits`, fill only `item_id`, `default_order_unit`, `soft_max_quantity`, and `hard_max_quantity` at first.
6. Leave everything else blank until real data exists.

