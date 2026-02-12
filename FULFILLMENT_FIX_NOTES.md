# Fulfillment Page - Fix Notes

## Problem
Items on the fulfillment page were grouping under "Unknown Supplier" because supplier resolution didn't check the `default_supplier` text column on `inventory_items`.

## Root Cause
`resolveSupplierId()` in `fulfillment.tsx` checked `supplier_name`, `supplierName`, `supplier`, `vendor_name`, `vendorName` — but the actual DB column is `default_supplier`. The UUID-based `supplier_id` column was also all NULL because the backfill migration only matched against `supplier_name`/`supplier` columns that don't exist.

## Changes

### Database Migrations
- **`20260212121000_inventory_items_add_supplier_id.sql`** — Adds `supplier_id` UUID FK to `inventory_items`
- **`20260212123000_backfill_inventory_supplier_id.sql`** — Backfills `supplier_id` from `supplier_name`/`supplier` text columns
- **`20260212124000_order_items_supplier_override.sql`** — Adds `supplier_override_id` UUID FK to `order_items` for per-line supplier reassignment; also backfills `inventory_items.supplier_id` from `default_supplier` text column (fixing the earlier backfill)

### Supplier Resolution (`fulfillment.tsx`)
- Added `default_supplier` and `defaultSupplier` to `resolveSupplierId()` candidateNames
- Supplier override priority: `order_item.supplier_override_id` > `resolveSupplierId()` (which checks UUID `supplier_id` then text columns)

### Per-Item Overflow Menu (`fulfillment.tsx`)
- "..." button on each item in expanded supplier group view
- **Move to Order Later** — Opens schedule modal, creates order-later item, zeros source order items
- **Move to [Secondary Supplier]** — Sets `supplier_override_id` on source order items (only shown if item has `secondary_supplier`)
- **Move back to [Primary Supplier]** — Clears `supplier_override_id` (only shown if item was previously overridden)

### Store Actions (`orderStore.ts`)
- `setSupplierOverride(orderItemIds, supplierId)` — Updates `order_items.supplier_override_id` in Supabase + local state
- `clearSupplierOverride(orderItemIds)` — Nulls `order_items.supplier_override_id` in Supabase + local state

### Confirm Order (`fulfillment-confirmation.tsx`)
- Supplier name is now the primary header; "Confirm Order" is subtitle
- Secondary supplier "Move to [name]" button per item (removes from current, creates draft under secondary)
- Default message template simplified to `{{items}}\n\nThank you!`

### Navigation (`_layout.tsx`)
- Past-orders tabs hidden with `tabBarStyle: { display: 'none' }` (accessible via router.push from fulfillment header)

### Empty State (`fulfillment.tsx`)
- When no pending orders: shows "All orders fulfilled" with "Remind Employees" button linking to employee reminders

## Past Orders Flow
The existing flow works end-to-end once supplier resolution is fixed:
1. Manager taps "Confirm Order" on a supplier group
2. Reviews items, shares/copies the order message
3. Taps "Finalize" → `finalizeSupplierOrder()` creates `PastOrder` + `PastOrderItem` records
4. `fetchPendingFulfillmentOrders()` calls `removeConsumedOrderItems()` to filter fulfilled items
5. Items disappear from fulfillment page, appear in Past Orders (accessible via header button)
