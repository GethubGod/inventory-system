-- Harden order RPCs and orders / order_items RLS.
--   • RPCs require p_user_id = auth.uid() and insert auth.uid() as user_id
--   • orders SELECT limited to owner or manager
--   • order_items INSERT limited to orders owned by caller or manager

-- ============================================================
-- 1. create_order_rpc — auth.uid() enforcement
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
  v_user_id uuid;
begin
  set local statement_timeout = '8s';

  if auth.uid() is null or p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'Unauthorized'
      using errcode = 'P0001';
  end if;

  v_user_id := auth.uid();

  insert into public.orders (id, org_id, location_id, user_id, status)
  values (p_id, p_org_id, p_location_id, v_user_id, p_status::order_status)
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
-- 2. submit_order_rpc — auth.uid() enforcement
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
  v_user_id        uuid;
begin
  set local statement_timeout = '10s';

  if auth.uid() is null or p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'Unauthorized'
      using errcode = 'P0001';
  end if;

  v_user_id := auth.uid();

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
  values (p_id, p_org_id, p_location_id, v_user_id, p_status::order_status, v_order_type)
  on conflict (id) do nothing
  returning *
  into v_order;

  if v_order.id is null then
    select * into v_order
      from public.orders
     where id = p_id;
    v_is_existing := true;
  end if;

  if v_order.user_id is distinct from v_user_id then
    raise exception 'Forbidden'
      using errcode = 'P0001';
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
      payload.inventory_item_id,
      payload.quantity,
      case
        when payload.requested_unit_type = 'pack' and payload.has_pack_unit then 'pack'::unit_type
        when payload.requested_unit_type = 'base' and payload.has_base_unit then 'base'::unit_type
        when payload.has_pack_unit and not payload.has_base_unit then 'pack'::unit_type
        when payload.has_base_unit and not payload.has_pack_unit then 'base'::unit_type
        else 'base'::unit_type
      end,
      payload.input_mode,
      payload.quantity_requested,
      payload.remaining_reported,
      payload.decided_quantity,
      payload.decided_by,
      payload.decided_at,
      payload.note,
      payload.was_suggested,
      payload.original_suggested_qty
    from (
      select
        (item->>'inventory_item_id')::uuid as inventory_item_id,
        (item->>'quantity')::numeric as quantity,
        case
          when item->>'unit_type' in ('base', 'pack') then item->>'unit_type'
          else null
        end as requested_unit_type,
        coalesce(item->>'input_mode', 'quantity') as input_mode,
        (item->>'quantity_requested')::numeric as quantity_requested,
        (item->>'remaining_reported')::numeric as remaining_reported,
        (item->>'decided_quantity')::numeric as decided_quantity,
        (item->>'decided_by')::uuid as decided_by,
        (item->>'decided_at')::timestamptz as decided_at,
        item->>'note' as note,
        coalesce((item->>'was_suggested')::boolean, false) as was_suggested,
        (item->>'original_suggested_qty')::numeric as original_suggested_qty,
        nullif(trim(ii.base_unit), '') is not null as has_base_unit,
        nullif(trim(ii.pack_unit), '') is not null as has_pack_unit
      from jsonb_array_elements(p_items) as item
      left join public.inventory_items ii
        on ii.id = (item->>'inventory_item_id')::uuid
    ) as payload;
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
-- 3. orders SELECT — owner or manager only
-- ============================================================
drop policy if exists "orders_select_authenticated" on public.orders;

create policy "orders_select_owner_or_manager"
on public.orders
for select
to authenticated
using (
  auth.uid() = user_id
  or public.current_user_is_manager()
);

-- ============================================================
-- 4. order_items INSERT — order must belong to caller or manager
-- ============================================================
drop policy if exists "order_items_insert_authenticated" on public.order_items;

create policy "order_items_insert_owner_or_manager"
on public.order_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders o
    where o.id = order_id
      and o.user_id = auth.uid()
  )
  or public.current_user_is_manager()
);

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
