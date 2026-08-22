# Phase 5 contract — Simplified Inventory Ordering (5a/5b/5c)

Roadmap spec: `docs/ROADMAP.md` Phase 5. Binding seam between backend (Codex) and
frontend (Claude). Sub-checkpoints build sequentially: 5a → 5b → 5c.

## Ground truth (verified against schema)

- History: `past_orders` (supplier_id text, supplier_name, created_by uuid,
  message_text, payload jsonb, share_method) + `past_order_items` (past_order_id,
  supplier_id text, created_by, item_id text, item_name, unit, quantity numeric,
  location_id/name text, location_group 'sushi'|'poki', unit_type 'base'|'pack',
  ordered_at). Also `historical_order_imports`/`historical_order_import_items` exist
  (Phase 6 merges these in).
- Sends: `submit_order_rpc` (review queue), `finalizeSupplierOrder` archive path,
  Phase 1's supplierSendLink/supplierContacts for direct mode.
- Modules (Phase 3): checklist screen ships behind `ordering_simple`.

## 5a schema (backend owns)

```sql
order_checklists (
  id uuid pk, user_id uuid ref auth.users, location_group text check ('sushi','poki'),
  generated_at timestamptz, generation_source text check ('history_v1','manual','import'),
  created_at, updated_at
)
order_checklist_items (
  id uuid pk, checklist_id uuid ref order_checklists on delete cascade,
  item_id uuid,                -- inventory_items.id when matched, nullable
  item_name text not null, unit text not null,
  default_checked boolean not null default true,
  recommended_qty numeric, typical_qty numeric,
  staleness_bucket text check ('frequent','occasional','rare'),
  order_frequency_days numeric,      -- observed cadence
  last_ordered_at timestamptz,
  sort_order int, created_at, updated_at
)
```

RLS: owner reads own; managers read/write all (dashboard editors in 5b).

Generation v1: SQL function `generate_order_checklist(p_user_id uuid, p_location_group text)`
from `past_order_items` frequency + median quantity for that user (fall back to
location-group-wide stats when the user has thin history). Buckets: frequent = ordered
in ≥40% of that user's order days; rare = <10% or single occurrence. Deterministic,
unit-tested via harness (scripts/local-db/verify-migrations.sh + a seed fixture).

## 5a service seam

`src/services/orderChecklist.ts`:
```ts
export interface ChecklistItem {
  id: string; itemId: string | null; itemName: string; unit: string;
  defaultChecked: boolean; recommendedQty: number | null;
  stalenessBucket: 'frequent' | 'occasional' | 'rare';
  lastOrderedAt: string | null; sortOrder: number;
}
export interface Checklist { id: string; locationGroup: 'sushi' | 'poki'; generatedAt: string; items: ChecklistItem[]; }
export async function getOrGenerateMyChecklist(locationGroup: 'sushi' | 'poki'): Promise<Checklist>;
export async function regenerateMyChecklist(locationGroup: 'sushi' | 'poki'): Promise<Checklist>;
export interface ChecklistSendLine { itemId: string | null; itemName: string; unit: string; quantity: number; }
export async function sendChecklistOrder(checklistId: string, lines: ChecklistSendLine[]): Promise<{ orderId: string }>; // 5a: submit_order_rpc review queue
```

## 5a frontend (Claude)

One screen (new tab surface, module `ordering_simple`): pre-checked frequent items with
editable quantities (numeric stepper honoring item units), rarely-ordered collapsed
section at bottom, "add more" search over inventory_items (reuse existing item search
infra), Send Order button → confirmation sheet (grouped preview) → sendChecklistOrder →
success state. ~2-minute happy path. Design tokens + haptics as always.

## 5b additions

- `profiles`/settings: per-employee `order_send_mode text check ('direct','review') default 'review'`
  (backend puts it where role/prefs live today — inspect profiles first).
- `sendChecklistOrder` honors mode: 'direct' → group lines per supplier
  (inventory_items.supplier_id → supplierResolver), run Phase 1 send queue UI, archive
  via the same path Phase 1 uses; 'review' → unchanged 5a behavior.
- Checklist screen shows recent past sent orders (from past_orders, self only).
- Web dashboard: per-employee checklist editor (add/remove items, default_checked,
  recommended_qty) + send-mode toggle. Lives under web/src/app/dashboard/ordering.

## 5c additions

- Order-day reminders on existing infra (`reminders`, `recurring_reminder_rules`,
  `send-reminder`, `evaluate-recurring-reminders`): rule type referencing checklist
  state; message like "Fish order due today — 3 items unchecked". Unchecked count
  computed at fire time server-side.
- Push reliability pass: token refresh on app foreground (device_push_tokens), delivery
  logging table or columns (inspect reminder_events first — extend, don't duplicate).
- Real-device delivery goes on NEEDS-DAVID.

## Non-goals

No screenshot import (Phase 6), no holiday templates (6c), no supplier reply handling,
no changes to Quick Order/advanced flow.
