# Kitchen requests contract

Mockup: `docs/mockups/kitchen-requests/kitchen-requests-prototype.html`.
Binding seam between backend (Codex) and frontend (Claude). Web first
(`web/`, route `/kitchen`); the mobile app ports this later and is untouched
here (it ignores unknown module keys, verified in `src/services/userModules.ts`).

## Decisions (confirmed by David, 2026-08-31)

- Access is two per-user module toggles managed on the dashboard Team page:
  `kitchen_requests` (chef view: send requests) and `kitchen_display`
  (kitchen view: see queue, mark ready, undo). Managers default to both on,
  employees to both off. A user with both gets an in-app switch; nobody gets
  the mockup's "prototype device" slider.
- Every request is stamped server-side with the sender's **username** and
  **tag**. Tag = the login handle (`login_identities.login_name`); when no
  login identity exists yet the tag is what that handle would be
  (`normalize_login_name(users.name)`), so it is stable across the day a
  PIN gets set. Username = `login_identities.display_name`, falling back to
  `profiles.full_name`, `users.name`, then the email local part.
- Item list is manager-managed on the dashboard (`/dashboard/kitchen`),
  seeded with the six mockup items.
- Sign-in on `/kitchen` supports both name + PIN (existing `login-with-name`
  edge function + `auth.verifyOtp`) and email + password.
- Queue is scoped by location. `users.default_location_id` null means every
  location; the chef/kitchen picks a location once and the choice persists on
  the device.

## Module keys (canonical)

`ordering_simple` | `ordering_advanced` | `stock_check` | `tips` |
`fulfillment` (manager-side) | **`kitchen_requests`** | **`kitchen_display`**

Every place that enumerates keys changes together:

| Where | Change |
| --- | --- |
| `user_modules_module_key_check` constraint | add the two keys |
| `get_effective_modules` | two new default rows: manager true, employee false; order 6 and 7 |
| `supabase/functions/accept-invite/index.ts` `MODULE_KEYS` | add the two keys |
| `web/src/lib/dashboard/modules.ts` + test | keys, labels ("Kitchen requests", "Kitchen display"), defaults; both keys are toggleable for employees |

## Schema (migration `supabase/migrations/20260831120000_kitchen_requests.sql`)

Additive only. Every statement idempotent (`if not exists`, `drop policy if
exists`, `create or replace`).

```sql
public.kitchen_items (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid null references public.locations(id) on delete restrict, -- null = every location
  name         text not null check (length(btrim(name)) between 1 and 60),
  unit         text not null check (length(btrim(unit)) between 1 and 24),
  sort_order   integer not null default 0,
  active       boolean not null default true,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()   -- trigger set_updated_at
)
-- unique among active items per scope:
create unique index kitchen_items_active_name_scope_key
  on public.kitchen_items (lower(btrim(name)), coalesce(location_id, '00000000-0000-0000-0000-000000000000'))
  where active;

public.kitchen_requests (
  id                 uuid primary key default gen_random_uuid(),
  client_key         uuid not null unique,               -- idempotency key minted by the client
  location_id        uuid not null references public.locations(id),
  item_id            uuid not null references public.kitchen_items(id) on delete restrict,
  item_name          text not null,                      -- snapshot at send time
  unit               text not null,                      -- snapshot at send time
  quantity           integer not null check (quantity between 1 and 999),
  requested_by       uuid references auth.users(id) on delete set null,
  requested_by_name  text not null,
  requested_by_tag   text not null,
  status             text not null default 'queued'
                     check (status in ('queued','ready','cleared','cancelled')),
  created_at         timestamptz not null default now(),
  ready_at           timestamptz,
  ready_by           uuid references auth.users(id) on delete set null,
  ready_by_name      text,
  closed_at          timestamptz,                        -- cleared or cancelled at
  updated_at         timestamptz not null default now()  -- trigger set_updated_at
)
create index kitchen_requests_open_idx on public.kitchen_requests (location_id, created_at) where status in ('queued','ready');
-- plus CHECKs: name/tag lengths 1..200, and status <-> timestamps agree
-- (queued: no ready_at/closed_at; ready: ready_at only; cleared: both; cancelled: closed_at only).
alter table public.kitchen_requests replica identity full;
alter publication supabase_realtime add table public.kitchen_requests;  -- guarded like user_modules
alter publication supabase_realtime add table public.kitchen_items;
```

Status is server truth only. `sending` and `failed` exist only in the client.

Seed (only when `kitchen_items` is empty), `location_id` null, `sort_order` 1..6:
Fried Shrimp/pieces, Sushi Rice/tubs, Crab Mix/trays, Unagi/portions,
Tempura Batter/batches, Salmon/filets.

## Helper functions (security definer, `set search_path = public`, stable)

- `kitchen_module_enabled(p_key text) returns boolean`
  false when `auth.uid()` is null or the profile is suspended; otherwise the
  `enabled` value from `get_effective_modules(auth.uid())` for `p_key`.
- `kitchen_user_location_ok(p_location_id uuid) returns boolean`
  the location is active and `users.default_location_id` for `auth.uid()` is
  null or equals `p_location_id`. Applies to managers too (works-at rule).
- `kitchen_actor_identity(p_user_id uuid, out display_name text, out tag text)`
  the username/tag rule from Decisions. Never returns null for either.
  Callable only for yourself or by a manager (`42501` otherwise): it reads
  login handles as the owner and must not be a directory of them.

Grants: execute to `authenticated` and `service_role`; revoke from `public`, `anon`.

## RPCs (security definer, `set search_path = public`, volatile)

### `kitchen_send_request(p_client_key uuid, p_item_id uuid, p_quantity integer, p_location_id uuid) returns public.kitchen_requests`

1. `auth.uid()` required, else `42501` `not_signed_in`. Null `p_client_key`
   is `22023` `invalid_client_key`.
2. **Replay first.** If a row with `client_key = p_client_key` exists: return
   it when `requested_by = auth.uid()` and item/quantity/location match the
   arguments; `42501` `client_key_conflict` otherwise. A retry of a request
   that already landed succeeds even if the item was deactivated or the
   user's location changed since, so a retry can never be pushed into
   minting a new key (and a duplicate).
3. `kitchen_module_enabled('kitchen_requests')` else `42501` `kitchen_requests_disabled`.
4. `kitchen_user_location_ok(p_location_id)` else `42501` `location_not_allowed`.
5. Item must exist, be active, and have `location_id` null or `= p_location_id`,
   else `22023` `item_unavailable`.
6. `p_quantity` between 1 and 999 else `22023` `invalid_quantity`.
7. Insert with `item_name`/`unit` snapshotted from the item and
   `requested_by_name`/`requested_by_tag` from `kitchen_actor_identity(auth.uid())`.
   On `unique_violation` (concurrent replay) re-select by `client_key` and return.

### `kitchen_update_request(p_request_id uuid, p_action text) returns public.kitchen_requests`

Gate first: signed in (`42501` `not_signed_in`) and holding either kitchen
module or the manager role, not suspended (`42501` `not_allowed`), and a
known action (`22023` `unknown_action`). Then locks the row `for update`.
Unknown id → `P0002` `request_not_found`. Location must pass
`kitchen_user_location_ok`, else `42501` `location_not_allowed`.

| action | from → to | who | side effects |
| --- | --- | --- | --- |
| `ready` | queued → ready | `kitchen_display` | `ready_at = now()`, `ready_by`, `ready_by_name` |
| `undo_ready` | ready → queued | `kitchen_display` | clears the three ready fields |
| `cancel` | queued → cancelled | requester or manager | `closed_at = now()` |
| `clear` | ready → cleared | requester or manager | `closed_at = now()` |

Already in the target state → return the row unchanged (idempotent).
Any other transition → `22023` `invalid_transition`, hint names the current status.
Wrong actor → `42501` `not_allowed`.

Error convention for every RPC above: `raise exception '<code>' using errcode = '<sqlstate>', hint = '<human sentence>'`.
The client keys on `message` (the code) and shows `hint`.

## RLS

- `kitchen_items`: select to `authenticated` when manager, or when either
  kitchen module is on **and** the item is global or at a location the user
  works at; insert/update/delete when `current_user_is_manager()` (insert
  also pins `created_by` to the caller or null).
- `kitchen_requests`: select to `authenticated` when the same module test
  passes **and** `kitchen_user_location_ok(location_id)`. No insert/update/delete
  policies; writes go through the RPCs only. `revoke insert, update, delete on
  public.kitchen_requests from authenticated`.
- `revoke all on table ... from anon, authenticated` on both tables first
  (production's default privileges grant ALL, including truncate/trigger),
  then grant back exactly: items select/insert/update/delete, requests
  select; `grant all ... to service_role` explicitly.
- Realtime does not RLS-filter DELETE events; nothing deletes these rows
  (no delete grant, FKs restrict), so none are expected. Do not add a delete path
  without revisiting this.
- Deactivating a location hides its open requests from everyone (the
  `active` test is part of `kitchen_user_location_ok`); close them out first.

## Client reads (web)

- Items: `from('kitchen_items').select(...).eq('active', true).or('location_id.is.null,location_id.eq.<loc>').order('sort_order').order('name')`.
- Open requests: `from('kitchen_requests').select('*').eq('location_id', loc).in('status', ['queued','ready']).gte('created_at', now - 12h).order('created_at')`.
- Realtime: channel `kitchen-requests-<loc>` on `postgres_changes` (`*`, `public.kitchen_requests`, filter `location_id=eq.<loc>`). Every event merges by `id`. While the channel is not `SUBSCRIBED`, or after `online`/`visibilitychange`, the client refetches; a 5 s poll runs whenever the channel is down.

## Client send protocol (web)

1. Mint `client_key = crypto.randomUUID()` when the user taps Send; push a
   local row `{status:'sending', clientKey, ...}` into the log.
2. Call `kitchen_send_request`. 8 s timeout → mark `failed`. After 1.5 s show
   "Taking longer than usual". Success → replace the local row with the
   returned row (matched by `client_key`).
3. Retry (sheet button or log row) reuses the **same** `client_key`. The server
   returns the existing row if the first attempt actually landed, so a retry
   can never duplicate.
4. Dismissing a failed row drops it locally only (nothing was stored).

Kitchen "Ready" is optimistic with rollback; undo window 6 s client-side, the
server allows `undo_ready` at any time while the row is still `ready`.

## Types

`web/src/types/database.ts` gains `kitchen_items`, `kitchen_requests` (Row/
Insert/Update/Relationships) and the four functions, generated with
`supabase gen types typescript --db-url <harness db>` and spliced in (do not
regenerate the whole file; prod does not have the migration yet).

## Verification (definition of done)

- `scripts/local-db/verify-migrations.sh` PASS with the new migration.
- `scripts/local-db/kitchen_requests_fixture.sql` (runs on the kept harness
  container, ends with `PASS:`, rolls back): seeds, module defaults, every
  RPC error code, idempotent replay, race replay, all four transitions +
  refusals, RLS visibility per location and per module, suspended user refused.
- `web`: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` green.
- Full local stack (`supabase start` on 54421-54423 with migrations disabled,
  baseline + new migrations loaded by psql): realtime script proves an insert
  reaches a subscribed authenticated client and is hidden from a client at
  the other location; Playwright `kitchen.spec.ts` drives chef + kitchen in
  two browser contexts end to end (send → appears → ready → chef sees READY →
  got it; offline send fails loudly and retry with the same key lands once).

## Non-goals

No mobile app changes. No push notifications or sounds. No org layer (tables
are org-agnostic like everything since March 2026). No deploy: migration and
`accept-invite` redeploy are listed for David in the PR body.
