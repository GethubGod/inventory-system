# Supabase & Database Summary (Babytuna Inventory System)

Companion to **`CODEBASE_FULL_CONTEXT_SUMMARY.md` §7**.

---

## Client setup

- **File**: `src/lib/supabase.ts`
- **Env**: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (required at runtime; dev shows config screen if missing in `_layout.tsx`).
- **Storage**: Custom **expo-secure-store** adapter with **chunking** for large session JSON.
- **Important**: `auth.storageKey` derived from Supabase hostname; **`clearSupabaseStoredSession`** wipes key + related entries on sign-out/delete.

---

## Edge Functions (in repo)

| Function | Path | Role |
|----------|------|------|
| **parse-order** | `supabase/functions/parse-order/` | Quick Order NL parsing (service role for catalog, sessions, logs) |
| Shared CORS | `supabase/functions/_shared/cors.ts` | CORS headers |

**Secrets (Deno env)** expected by `parse-order/index.ts`:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required at cold start)
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY` (optional depending on mode)
- `PARSE_ORDER_LLM_PROVIDER` optional: `gemini` | `claude`

**Invoke URL**: `supabase.functions.invoke('parse-order', { body })` from app.

---

## RPCs referenced from application / Edge

| RPC | Used by |
|-----|---------|
| **`submit_order_rpc`** | `src/services/orderSubmission.ts` |
| **`ensure_current_user_identity`** | `src/store/authStore.ts` |
| **`sync_profile_after_order`** | `orderSubmission.syncProfileAfterOrder` (fire-and-forget) |
| **`get_recent_orders`** | `parse-order/index.ts` |
| **`get_dow_suggestions`** | `parse-order/index.ts` |

*(Additional RPCs may exist from older migrations — search `supabase/migrations` for `create or replace function public.`)*

---

## Core tables (app + Quick Order)

### `locations`

- **Purpose**: Active sites; `useAuthStore.fetchLocations` filters `active = true`.
- **Key columns**: `id`, `name`, `short_code`, `active`.

### `users`

- **Purpose**: App user row (mirror of auth user for FKs).
- **Key columns**: `id`, `email`, `name`, `role`, `default_location_id`, `created_at`.

### `profiles`

- **Purpose**: Onboarding, suspension, notifications, provider.
- **RLS**: Various migrations reset policies; app uses `select *` per session user.
- **Realtime**: `authStore` subscribes to profile row changes.

### `inventory_items`

- **Purpose**: Master catalog.
- **Important columns**: `name`, `category`, `supplier_category`, `supplier_id`, `base_unit`, `pack_unit`, `pack_size`, `active`, **`aliases`** (Quick Order), **`allowed_units`**, optional `created_by`.
- **App**: `inventoryStore` CRUD; parser global fetch.

### `area_items`

- **Purpose**: Associates inventory lines to **storage areas** / locations for **ordering context**.
- **Quick Order**: **Entire location catalog** for `parse-order` comes from here (join filters on `storage_areas.location_id`).

### `storage_areas`

- Referenced in `area_items` joins; must be **active** for catalog rows to appear.

### `orders`

- **Purpose**: Order header.
- **Columns ( notable )**: `status`, `location_id`, `user_id`, `order_type` (RPC sets), **`entry_method`** (default **`manual`** in quick_order foundation migration), **`quick_session_id`**, **`manager_review_status`**, timestamps, fulfillment fields.
- **Constraint**: `entry_method` in `manual | quick_order | voice_order | suggested_order`.

### `order_items`

- Line items; supports **`input_mode`** quantity vs remaining, notes, **`was_suggested`**, **`supplier_override_id`**, optional **`status`** (`pending`, `sent`, … per fulfillment migrations).

### Quick Order tables

| Table | Purpose |
|-------|---------|
| **`quick_order_sessions`** | `messages` jsonb, `parsed_items` jsonb, `status` (`active` / `submitted` / `abandoned`), links to `submitted_order_id` |
| **`parser_examples`** | Training/seed examples (`raw_text`, `structured_output`, `is_active`) |
| **`parser_corrections`** | Per-user learning (`raw_token`, suggested vs corrected ids, qty/unit, optional `location_id`, `correction_type`) |
| **`parser_usage_log`** | Metrics, token estimates, limits enforcement |
| **`app_config`** | Key/value including Quick Order flags & **`quick_order_unit_synonyms`** (json consumed by `configureUnitAliases`) |

### Fulfillment / history

| Table | Purpose |
|-------|---------|
| **`past_orders`** | Manager finalized supplier message batches |
| **`past_order_items`** | Denormalized lines for history / “last ordered qty” |
| **`order_later_items`** | Deferred ordering with notifications |

### Stock

- Migrations under `*stock*`, `area_items_settings`, etc.; `stockStore` uses `src/lib/api/stock.ts`.

### Reminders

- `employee_reminders` migrations; types in `database.ts` (`ReminderThread`, …).

---

## `submit_order_rpc` vs Quick Order columns (critical)

Inspected migration excerpt: **`20260401113000_harden_inventory_items_defaults_and_submit_order_units.sql`** defines `submit_order_rpc` inserting into `orders` with columns: **`id, org_id, location_id, user_id, status, order_type`** — **not** `entry_method` or `quick_session_id`.

**Implication**: New orders from the app likely keep **`entry_method` default `manual`** and **`quick_session_id` null** unless:

- A **later migration** changes the RPC (not found in repo grep for `entry_method` inside `submit_order_rpc`), or
- A **database trigger** fills them, or
- Another **code path** updates the row post-insert (not found in `src/**/*.ts` grep for `entry_method` writes).

**UI that depends on these columns**: `QuickOrderReviewQueueScreen` filter; manager tab badge logic in `(manager)/_layout.tsx`.

---

## RLS / security notes

- Quick Order tables have policies for **authenticated** users and **manager** helpers like `current_user_is_manager()` (see quick_order foundation migration).
- **`ensure_current_user_identity`** is **SECURITY DEFINER** — client uses it instead of RLS-blocked upserts for repair.
- Edge `parse-order` uses **service role** — **never** expose service key in the app.

---

## Migrations index (representative)

Located in `supabase/migrations/`. Notable filenames:

- `20260509134000_quick_order_foundation.sql` — sessions, parser tables, `orders` quick columns
- `20260510120000_quick_order_parser_resilience.sql` — `allowed_units`, correction `location_id`, parser_usage `metrics`, seed examples
- `20260510000000_app_config.sql` — app_config
- `20260510010000_parser_usage_log.sql`
- `20260512120000_quick_order_unit_synonyms.sql`
- `20260321160000_atomic_submit_order_rpc.sql` + later fixes — order atomicity
- `20260210110000_fulfillment_past_orders_and_order_later.sql` — fulfillment data model
- Auth: `*auth_identity_repair_rpc*`, `*profiles_rls*`

---

## Storage buckets

**unclear from repo** — no explicit bucket usage grep performed in `src/`; inspect Supabase dashboard or search `storage.from` if adding file features.
