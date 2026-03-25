-- Remove org_id requirement from the entire system.
--
-- The app is single-organization.  The org_id column on orders / order_items
-- and the org-resolution logic in RPCs are vestigial multi-tenant scaffolding
-- that causes cascading failures:
--   • Dashboard-created org-scoped RLS policies block inserts (past_orders bug)
--   • RPCs raise "Could not resolve organization" when org_memberships /
--     organizations tables don't exist
--   • NOT NULL constraints on org_id force RPCs to synthesise a value
--
-- This migration:
--   1. Makes orders.org_id and order_items.org_id nullable
--   2. Rewrites create_order_rpc and submit_order_rpc without org resolution
--   3. Resets RLS on orders and order_items (removes dashboard org-scoped policies)
--   4. Drops the organizations and org_memberships tables if they exist

-- ============================================================
-- 1. Make org_id nullable on orders and order_items
-- ============================================================
do $$
begin
  -- orders.org_id → nullable
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'org_id'
      and is_nullable = 'NO'
  ) then
    alter table public.orders alter column org_id drop not null;
  end if;

  -- order_items.org_id → nullable
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_items' and column_name = 'org_id'
      and is_nullable = 'NO'
  ) then
    alter table public.order_items alter column org_id drop not null;
  end if;
end;
$$;

-- ============================================================
-- 2. Rewrite create_order_rpc — no org resolution, org_id is optional
-- ============================================================
create or replace function public.create_order_rpc(
  p_id uuid,
  p_org_id uuid default null,
  p_location_id uuid default null,
  p_user_id uuid default null,
  p_status text default 'submitted'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  set local statement_timeout = '8s';

  insert into public.orders (id, org_id, location_id, user_id, status)
  values (p_id, p_org_id, p_location_id, p_user_id, p_status::order_status)
  returning id, order_number, user_id, location_id, status, notes,
            created_at, fulfilled_at, fulfilled_by
  into v_row;

  return jsonb_build_object(
    'id',           v_row.id,
    'order_number', v_row.order_number,
    'user_id',      v_row.user_id,
    'location_id',  v_row.location_id,
    'status',       v_row.status,
    'notes',        v_row.notes,
    'created_at',   v_row.created_at,
    'fulfilled_at', v_row.fulfilled_at,
    'fulfilled_by', v_row.fulfilled_by
  );
end;
$$;

revoke all on function public.create_order_rpc(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.create_order_rpc(uuid, uuid, uuid, uuid, text) to authenticated;

-- ============================================================
-- 3. Rewrite submit_order_rpc — no org resolution, org_id is optional
-- ============================================================
create or replace function public.submit_order_rpc(
  p_id          uuid,
  p_org_id      uuid    default null,
  p_location_id uuid    default null,
  p_user_id     uuid    default null,
  p_status      text    default 'submitted',
  p_items       jsonb   default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order          record;
  v_items          jsonb := '[]'::jsonb;
  v_item           jsonb;
  v_is_existing    boolean := false;
  v_has_suggested  boolean := false;
  v_order_type     text := 'manual';
begin
  set local statement_timeout = '10s';

  if p_items is null or jsonb_typeof(p_items) != 'array' then
    raise exception 'p_items must be a JSON array'
      using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item'
      using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if v_item->>'inventory_item_id' is null then
      raise exception 'Each item must have an inventory_item_id'
        using errcode = 'P0001';
    end if;

    if (v_item->>'quantity')::numeric is null or (v_item->>'quantity')::numeric <= 0 then
      raise exception 'Each item must have a positive quantity'
        using errcode = 'P0001';
    end if;
  end loop;

  select exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where coalesce((item->>'was_suggested')::boolean, false)
  )
  into v_has_suggested;

  v_order_type := case when v_has_suggested then 'from_suggestion' else 'manual' end;

  insert into public.orders (id, org_id, location_id, user_id, status, order_type)
  values (p_id, p_org_id, p_location_id, p_user_id, p_status::order_status, v_order_type)
  on conflict (id) do nothing
  returning *
  into v_order;

  if v_order.id is null then
    select * into v_order
      from public.orders
     where id = p_id;
    v_is_existing := true;
  end if;

  if not v_is_existing then
    insert into public.order_items (
      org_id,
      order_id,
      inventory_item_id,
      quantity,
      unit_type,
      input_mode,
      quantity_requested,
      remaining_reported,
      decided_quantity,
      decided_by,
      decided_at,
      note,
      was_suggested,
      original_suggested_qty
    )
    select
      p_org_id,
      p_id,
      (item->>'inventory_item_id')::uuid,
      (item->>'quantity')::numeric,
      coalesce(item->>'unit_type', 'base')::unit_type,
      coalesce(item->>'input_mode', 'quantity'),
      (item->>'quantity_requested')::numeric,
      (item->>'remaining_reported')::numeric,
      (item->>'decided_quantity')::numeric,
      (item->>'decided_by')::uuid,
      (item->>'decided_at')::timestamptz,
      item->>'note',
      coalesce((item->>'was_suggested')::boolean, false),
      (item->>'original_suggested_qty')::numeric
    from jsonb_array_elements(p_items) as item;
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id',                     oi.id,
      'order_id',               oi.order_id,
      'inventory_item_id',      oi.inventory_item_id,
      'quantity',               oi.quantity,
      'unit_type',              oi.unit_type,
      'input_mode',             oi.input_mode,
      'quantity_requested',     oi.quantity_requested,
      'remaining_reported',     oi.remaining_reported,
      'decided_quantity',       oi.decided_quantity,
      'decided_by',             oi.decided_by,
      'decided_at',             oi.decided_at,
      'note',                   oi.note,
      'status',                 oi.status,
      'supplier_override_id',   oi.supplier_override_id,
      'was_suggested',          oi.was_suggested,
      'original_suggested_qty', oi.original_suggested_qty,
      'created_at',             oi.created_at,
      'inventory_item',         jsonb_build_object(
        'id',                ii.id,
        'name',              ii.name,
        'category',          ii.category,
        'supplier_category', ii.supplier_category,
        'supplier_id',       ii.supplier_id,
        'base_unit',         ii.base_unit,
        'pack_unit',         ii.pack_unit,
        'pack_size',         ii.pack_size,
        'active',            ii.active,
        'created_at',        ii.created_at
      )
    )
  )
  into v_items
  from public.order_items oi
  join public.inventory_items ii on ii.id = oi.inventory_item_id
  where oi.order_id = p_id;

  return jsonb_build_object(
    'id',            v_order.id,
    'order_number',  v_order.order_number,
    'org_id',        v_order.org_id,
    'user_id',       v_order.user_id,
    'location_id',   v_order.location_id,
    'status',        v_order.status,
    'order_type',    coalesce(v_order.order_type, v_order_type),
    'notes',         v_order.notes,
    'created_at',    v_order.created_at,
    'fulfilled_at',  v_order.fulfilled_at,
    'fulfilled_by',  v_order.fulfilled_by,
    'order_items',   coalesce(v_items, '[]'::jsonb),
    'is_existing',   v_is_existing
  );
end;
$$;

revoke all on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb) to authenticated;

-- ============================================================
-- 4. Reset RLS on orders — remove any dashboard org-scoped policies
-- ============================================================
alter table public.orders enable row level security;
alter table public.orders no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'orders'
  loop
    execute format('drop policy if exists %I on public.orders', pol.policyname);
  end loop;
end;
$$;

-- All authenticated users can read orders (app filters by location/user client-side).
create policy "orders_select_authenticated"
on public.orders
for select
to authenticated
using (true);

-- Managers can update any order; employees can update their own.
create policy "orders_update_manager_or_owner"
on public.orders
for update
to authenticated
using (
  auth.uid() = user_id
  or public.current_user_is_manager()
)
with check (
  auth.uid() = user_id
  or public.current_user_is_manager()
);

-- Inserts go through SECURITY DEFINER RPCs, but allow direct insert as fallback.
create policy "orders_insert_authenticated"
on public.orders
for insert
to authenticated
with check (auth.uid() = user_id);

grant select, insert, update on public.orders to authenticated;

-- ============================================================
-- 5. Reset RLS on order_items — remove any dashboard org-scoped policies
-- ============================================================
alter table public.order_items enable row level security;
alter table public.order_items no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'order_items'
  loop
    execute format('drop policy if exists %I on public.order_items', pol.policyname);
  end loop;
end;
$$;

-- All authenticated users can read order items.
create policy "order_items_select_authenticated"
on public.order_items
for select
to authenticated
using (true);

-- Managers can update any order item; employees can update items on their orders.
create policy "order_items_update_manager_or_owner"
on public.order_items
for update
to authenticated
using (
  public.current_user_is_manager()
  or exists (
    select 1 from public.orders o
    where o.id = order_id and o.user_id = auth.uid()
  )
)
with check (
  public.current_user_is_manager()
  or exists (
    select 1 from public.orders o
    where o.id = order_id and o.user_id = auth.uid()
  )
);

-- Inserts go through SECURITY DEFINER RPCs, but allow direct insert as fallback.
create policy "order_items_insert_authenticated"
on public.order_items
for insert
to authenticated
with check (true);

grant select, insert, update on public.order_items to authenticated;

-- ============================================================
-- 6. Drop vestigial organizations and org_memberships tables
-- ============================================================
do $$
begin
  if to_regclass('public.org_memberships') is not null then
    drop table public.org_memberships cascade;
  end if;
  if to_regclass('public.organizations') is not null then
    drop table public.organizations cascade;
  end if;
end;
$$;

-- ============================================================
-- 7. Reload PostgREST schema cache
-- ============================================================
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
