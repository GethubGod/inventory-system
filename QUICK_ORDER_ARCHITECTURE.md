# Babytuna Quick Order Architecture

## Goal

Build "Babytuna Quick Order" as an AI-assisted ordering flow where employees and managers can type natural-language sushi inventory requests, have an Edge Function parse the text into structured order items, review any uncertain matches, and submit the resulting order through the existing Supabase-backed order pipeline.

The intended Week 1 foundation is:

- keep the existing Quick Order chat UI as the user-facing shell;
- add database support for parser context, session transcripts, parsed item payloads, manager review metadata, and correction feedback;
- add manager tooling so the AI context can be maintained from the app instead of direct database edits;
- prepare for a later Supabase Edge Function that uses `inventory_items.aliases`, manager-authored parser examples, and correction history when parsing free-form order text.

## Existing Relevant Files

### Quick Order UI

- `src/features/ordering/QuickOrderScreen.tsx`
  - This is the UI shown in the reference screenshot.
  - It currently renders static `QUICK_ORDER_MOCK_DATA` with examples like `salmon 2, tuna 3, ginger`, `Got these`, `Salmon`, `Tuna belly`, `Ginger`, and `Place order`.
  - State management is local React state only:
    - `inputValue`
    - `composerHeight`
    - `scrollBottomOffset`
    - `keyboardVisible`
    - `suggestionVisible`
    - `suggestionHeight`
  - Animation state is local Reanimated shared values:
    - `userBubbleProgress`
    - `systemCardProgress`
    - `composerBottomOffset`
    - `suggestionProgress`
  - There is no Zustand store, Supabase query, Edge Function call, order submission, or draft integration in this screen yet.

- `app/(tabs)/quick-order.tsx`
  - Employee route wrapper.
  - Renders `QuickOrderScreen` with `EMPLOYEE_ORDERING_MODE`.

- `app/(manager)/quick-order.tsx`
  - Manager route wrapper.
  - Renders `QuickOrderScreen` with `MANAGER_ORDERING_MODE`.

- `app/(tabs)/_layout.tsx`
  - Employee tab registration for Quick Order.

- `app/(manager)/_layout.tsx`
  - Manager tab registration for Quick Order and hidden manager screens.

### Existing Order And Inventory Data Paths

- `src/lib/supabase.ts`
  - Shared Supabase client.
  - Uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

- `src/types/database.ts`
  - Hand-maintained database-facing TypeScript types.
  - Current item type is `InventoryItem`; current table mapping is `inventory_items`.
  - Current order type is `Order`; current table mapping is `orders`.

- `src/store/inventoryStore.ts`
  - Existing inventory fetch/add/update/delete logic.
  - Uses `inventory_items`, not `items`.
  - Direct inventory fetch currently selects:
    - `id`
    - `name`
    - `category`
    - `supplier_category`
    - `supplier_id`
    - `base_unit`
    - `pack_unit`
    - `pack_size`
    - `active`
    - `created_at`
    - `created_by`

- `src/store/orderStore.ts`
  - Existing cart/order state and order submission orchestration.

- `src/services/orderSubmission.ts`
  - Existing order validation/submission service surface.

- `src/lib/api/client.ts`
  - API helper layer, including inventory and order helper functions.

- `supabase/functions/voice-order/index.ts`
  - Existing voice-order Edge Function.
  - Useful reference for Supabase Edge Function structure and prompt/context handling, but it is not wired to Quick Order.

### Existing Schema/Migration Context

- `supabase/migrations/20260324110000_remove_org_id_requirement.sql`
  - Important compatibility note: this migration makes `orders.org_id` and `order_items.org_id` nullable and drops `organizations` / `org_memberships` if present.
  - Quick Order migrations should not assume `organizations` exists.

- `supabase/migrations/20260324130000_drop_all_org_id_not_null.sql`
  - Additional cleanup around dashboard-added `org_id` columns.

- `supabase/migrations/20260401113000_harden_inventory_items_defaults_and_submit_order_units.sql`
  - Current hardened inventory defaults and current `submit_order_rpc` shape.

## Naming Decision

The prompt refers to an `items` table. This codebase consistently uses `inventory_items` in routes, stores, types, RPC joins, and migrations. Week 1 should therefore add aliases to `public.inventory_items`.

The prompt also refers to `organizations`. Current repo migrations treat organizations as vestigial multi-tenant scaffolding and may drop the table. Week 1 schema should keep `quick_order_sessions.org_id` nullable and avoid a hard foreign key to `organizations` unless a live database query confirms that table exists in the target environment.

## Schema Design

### `inventory_items.aliases`

Purpose: manager-maintained phrase list used by the parser to resolve natural language tokens to canonical inventory rows.

Planned changes:

- `aliases text[] not null default '{}'`
- GIN index on `aliases`

Notes:

- Alias values should be normalized in app code before writing:
  - trimmed
  - lowercased for duplicate detection
  - empty strings rejected
- The original typed display string can be preserved, but matching should be case-insensitive.

### `quick_order_sessions`

Purpose: durable transcript and parse state for a Quick Order conversation.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `org_id uuid null`
- `location_id uuid null references public.locations(id) on delete set null`
- `user_id uuid null references public.users(id) on delete set null`
- `status text not null default 'active' check (status in ('active', 'submitted', 'abandoned'))`
- `messages jsonb not null default '[]'::jsonb`
- `parsed_items jsonb not null default '[]'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `submitted_order_id uuid null references public.orders(id) on delete set null`

Indexes:

- `(user_id, created_at desc)`
- `(location_id, created_at desc)`
- `(status, updated_at desc)`
- `submitted_order_id`

### `orders` Quick Order Metadata

Purpose: flag submitted orders that came from Quick Order and track manager review.

Planned columns:

- `entry_method text not null default 'manual' check (entry_method in ('manual', 'quick_order', 'voice_order', 'suggested_order'))`
- `quick_session_id uuid null references public.quick_order_sessions(id) on delete set null`
- `manager_review_status text not null default 'not_required' check (manager_review_status in ('not_required', 'pending', 'approved', 'changes_requested', 'rejected'))`
- `manager_review_notes text null`
- `manager_reviewed_at timestamptz null`
- `manager_reviewed_by uuid null references public.users(id) on delete set null`

Indexes:

- `quick_session_id`
- `(entry_method, created_at desc)`
- `(manager_review_status, created_at desc)`

### `parser_corrections`

Purpose: feedback table for parser mistakes, especially "AI picked item A, user corrected to item B / qty / unit".

Columns:

- `id uuid primary key default gen_random_uuid()`
- `session_id uuid null references public.quick_order_sessions(id) on delete cascade`
- `user_id uuid null references public.users(id) on delete set null`
- `raw_token text not null`
- `parser_suggested_item_id uuid null references public.inventory_items(id) on delete set null`
- `user_corrected_item_id uuid null references public.inventory_items(id) on delete set null`
- `user_corrected_qty numeric null`
- `user_corrected_unit text null`
- `created_at timestamptz not null default now()`

Indexes:

- `(raw_token)`
- `(user_corrected_item_id, created_at desc)`
- `(session_id, created_at desc)`

### `parser_examples`

Purpose: manager-authored few-shot examples for the future parser Edge Function.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `raw_text text not null`
- `structured_output jsonb not null default '[]'::jsonb`
- `source text not null default 'manager' check (source in ('manager', 'correction', 'seed'))`
- `is_active boolean not null default true`
- `created_at timestamptz not null default now()`

Indexes:

- `(is_active, created_at desc)`
- `(source, created_at desc)`

Expected `structured_output` shape:

```json
[
  {
    "item_id": "uuid",
    "item_name": "Salmon",
    "quantity": 2,
    "unit": "lb",
    "unit_type": "base",
    "confidence": 1
  }
]
```

## Manager Configuration Page

Planned route:

- `app/(manager)/manager-settings/quick-order-config.tsx`

Planned feature file:

- `src/features/ordering/QuickOrderConfigScreen.tsx`

Sections:

- Aliases Manager
  - Search active `inventory_items`.
  - Select an item.
  - Add an alias string to `inventory_items.aliases`.
  - Remove aliases from the selected item.

- Examples Manager
  - List `parser_examples`.
  - Create, edit, delete examples.
  - Raw text input for natural language order text.
  - Visual structured-output builder using actual inventory item search.
  - Toggle active/inactive examples.

- Weekly Learning
  - Query recent `parser_corrections`.
  - Group correction patterns by `raw_token` and `user_corrected_item_id`.
  - Promote repeated raw tokens into `inventory_items.aliases` with one manager action.

## Edge Function Direction

Parser function:

- path: `supabase/functions/parse-order/index.ts`
- input:
  - `raw_text`
  - `session_id`
  - `location_id`
  - `user_id`
  - current authenticated user from JWT, which must match `user_id`
- context:
  - active location-scoped `inventory_items` through `area_items` and `storage_areas`
  - active `parser_examples`
  - recent `parser_corrections`
  - previous `quick_order_sessions.messages` when `session_id` is provided
- output:
  - parsed items
  - unresolved and clarification flags
  - `session_state.total_items`
  - `session_state.ready_to_submit`

LLM environment:

- `PARSE_ORDER_LLM_PROVIDER=gemini` with `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `PARSE_ORDER_LLM_PROVIDER=claude` with `ANTHROPIC_API_KEY`
- If `PARSE_ORDER_LLM_PROVIDER` is omitted, the function auto-selects Gemini first, then Claude, based on which key exists.
- The function uses `SUPABASE_SERVICE_ROLE_KEY` server-side and should never expose LLM keys to the app.

## Roadmap

### Week 1: Foundation

- Audit existing Quick Order shell.
- Add architecture anchor doc.
- Add schema for aliases, sessions, parser examples, parser corrections, and order review metadata.
- Add Manager Quick Order Configuration page.
- Keep current Quick Order user screen behavior unchanged except for shared types if needed.

### Week 2: Parser Edge Function

- Create `parse-order` Supabase Edge Function.
- Fetch inventory aliases and parser examples.
- Return structured parsed items with confidence and unresolved-token metadata.
- Use a 5-minute in-memory catalog cache and a strict LLM timeout.

### Week 3: Wire Quick Order Screen

- Replace mock data with real session state.
- Send typed messages to Edge Function.
- Render parsed items, unresolved items, and Day-of-Week suggestions.
- Persist conversation state in `quick_order_sessions`.

### Week 4: Manager Review Queue

- Add `/manager/orders/pending`.
- Show pending Quick Orders with parsed order lines and saved chat transcript.
- Approve, edit and approve, or reject with a note.
- Keep Quick Orders out of supplier fulfillment until manager approval.

### Week 5: Correction Learning Loop

- Employee corrections from the Quick Order chat insert rows into `parser_corrections`.
- Manager edit-and-approve diffs also insert rows into `parser_corrections`.
- Manager Quick Order AI config has a Weekly Learning tab that groups corrections.
- Managers can add repeated raw tokens as permanent inventory aliases.

## Open Implementation Notes

- Live database introspection was blocked during this audit because local Supabase/Docker was unavailable and the remote Supabase CLI was not authenticated in this shell.
- Before deploying the migration to production, confirm whether `public.organizations` exists in that environment. The migration should stay compatible either way by keeping `org_id` nullable and not adding a hard organization foreign key unless the table is present.
