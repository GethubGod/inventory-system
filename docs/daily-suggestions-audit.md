# Daily Suggestions Audit

Date: 2026-03-22

## Audit Findings

- Orders table: `public.orders`
- Orders primary key column: `id`
- Orders timestamp column: `created_at`
- Orders location column: `location_id`
- Orders status column: `status`
- Orders status values: `draft`, `submitted`, `processing`, `fulfilled`, `cancelled`, `cancel_requested`
- Order items table: `public.order_items`
- Order items primary key column: `id`
- Order items FK to orders: `order_id`
- Order items item identifier column: `inventory_item_id`
- Order items item name column: none on `order_items`; item name comes from `public.inventory_items.name`
- Order items quantity column: `quantity`
- Order items unit column: no direct unit label column on `order_items`; quantity mode is `unit_type`, and display units come from `public.inventory_items.base_unit` / `public.inventory_items.pack_unit`
- Order items supplier column: none on `order_items`; current resolution path is `order_items.supplier_override_id -> suppliers.id/name` override first, otherwise `inventory_items.supplier_id -> suppliers.id/name`, with legacy fallbacks from `inventory_items.default_supplier` / `inventory_items.secondary_supplier`
- Location identifier type: `uuid`
- Orders location source in app: selected location is stored in `useAuthStore.location`; default comes from `users.default_location_id`
- Edge Function file structure: `supabase/functions/<function-name>/index.ts` with shared helpers in `supabase/functions/_shared/*.ts`
- Edge Function import pattern: `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';`
- Edge Function env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- CORS pattern:

```ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
```

- Edge Function parameter pattern: JSON request body via `await req.json()`; auth comes from `Authorization: Bearer ...`
- Location parameter pattern for existing functions: explicitly passed in request body when needed (`locationId` or `locationShortCode`), not derived from auth token
- Smart Order screen path: `src/features/smart/SmartOrderScreen.tsx`
- Smart Order routes: `app/(tabs)/voice.tsx`, `app/(manager)/voice.tsx`
- Current Smart Order data fetch: direct client-side Supabase query in `src/features/ordering/orderInsights.ts` via `fetchLocationOrderInsights(locationId)`, not an Edge Function
- Current Smart Order suggestion UI: existing "predicted order" section on the Smart Order screen with item rows, +/- stepper, and "Add all {count} to cart"
- Smart Order state management: local `useState` in the screen, plus Zustand stores for auth/location (`useAuthStore`) and cart/order state (`useOrderStore`)
- Existing smart-order hook: none; shared fetch helper is `fetchLocationOrderInsights`
- Smart Order UI structure: `SafeAreaView`, top-level `FlatList`, `IdentityHeader`, `GlassSurface`, `GlassView`, `EmptyStateCard`, `LoadingIndicator`, `TouchableOpacity`, `Ionicons`
- Cart add function: `addToCart(locationId, inventoryItemId, quantity, unitType, options?)`
- Cart add helper currently used by Smart Order: `addPredictedItem(item, quantityOverride?)`
- Cart add options currently supported: `inputMode`, `quantityRequested`, `remainingReported`, `decidedQuantity`, `decidedBy`, `decidedAt`, `note`, `context`
- Existing bulk add support: no generic store-level batch add; current Smart Order code loops over items and calls `addPredictedItem` / `addToCart`
- Existing suggestion infrastructure: no `suggested_orders` table found, no `get_dow_suggestions` RPC found, no existing suggestion Edge Function, no `was_suggested` column found on `order_items`, no `original_suggested_qty` column found on `order_items`, no `order_type` column found on `orders`

## Source Notes

- The repo does not include the original `CREATE TABLE public.orders` / `public.order_items` migration, so current schema was reconstructed from:
  - generated database types in `src/types/database.ts`
  - later `ALTER TABLE` migrations in `supabase/migrations`
  - the live write contract in `supabase/migrations/20260321162000_submit_order_rpc_include_org_id.sql`
  - current app queries against `orders`, `order_items`, `inventory_items`, and `suppliers`
- `src/types/database.ts` appears slightly behind later `order_items` migrations. For example, SQL migrations add `status`, `supplier_override_id`, and `org_id` usage that are not fully represented in the TypeScript `OrderItem` interface.

## Current Smart Order Behavior

- `fetchLocationOrderInsights(locationId)` loads `orders` directly from Supabase with nested `order_items` + `inventory_items`
- It filters by `location_id`, excludes only `draft` orders, and limits to recent rows
- "Predicted" items are computed client-side in JavaScript by grouping same-day-of-week items and keeping items seen at least 3 times
- The current logic does not use median quantity, does not use frequency ratios, and does not use supplier names
