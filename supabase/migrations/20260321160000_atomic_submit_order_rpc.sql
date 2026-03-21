-- Atomic order submission: creates order + all items in a single transaction.
-- Replaces the two-step flow (create_order_rpc → client insert items) that
-- caused orphaned orders and timeouts from Supabase JS client auth-lock.
--
-- Idempotency: if an order with the given p_id already exists, returns the
-- existing order instead of inserting a duplicate. This makes retries safe.

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
  v_org_id       uuid := p_org_id;
  v_order        record;
  v_items        jsonb := '[]'::jsonb;
  v_item         jsonb;
  v_is_existing  boolean := false;
begin
  set local statement_timeout = '10s';

  -- ── 1. Resolve org_id when client couldn't determine it ──
  if v_org_id is null then
    begin
      select om.org_id into v_org_id
        from public.org_memberships om
       where om.user_id = p_user_id
       limit 1;
    exception when undefined_table then null;
    end;
  end if;

  if v_org_id is null then
    begin
      select o.id into v_org_id
        from public.organizations o
       limit 1;
    exception when undefined_table then null;
    end;
  end if;

  if v_org_id is null then
    raise exception 'Could not resolve organization for user %', p_user_id
      using errcode = 'P0002';
  end if;

  -- ── 2. Validate items payload ──
  if p_items is null or jsonb_typeof(p_items) != 'array' then
    raise exception 'p_items must be a JSON array'
      using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item'
      using errcode = 'P0001';
  end if;

  -- Validate each item has required fields
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

  -- ── 3. Insert order (idempotent — skip if ID already exists) ──
  insert into public.orders (id, org_id, location_id, user_id, status)
  values (p_id, v_org_id, p_location_id, p_user_id, p_status::order_status)
  on conflict (id) do nothing
  returning *
  into v_order;

  if v_order.id is null then
    -- Order already existed (retry scenario). Fetch it.
    select * into v_order
      from public.orders
     where id = p_id;
    v_is_existing := true;
  end if;

  -- ── 4. Insert order items (only if this is a new order) ──
  if not v_is_existing then
    insert into public.order_items (
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
      note
    )
    select
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
      item->>'note'
    from jsonb_array_elements(p_items) as item;
  end if;

  -- ── 5. Fetch created items with inventory details ──
  select jsonb_agg(
    jsonb_build_object(
      'id',                 oi.id,
      'order_id',           oi.order_id,
      'inventory_item_id',  oi.inventory_item_id,
      'quantity',           oi.quantity,
      'unit_type',          oi.unit_type,
      'input_mode',         oi.input_mode,
      'quantity_requested',  oi.quantity_requested,
      'remaining_reported',  oi.remaining_reported,
      'decided_quantity',    oi.decided_quantity,
      'decided_by',         oi.decided_by,
      'decided_at',         oi.decided_at,
      'note',               oi.note,
      'created_at',         oi.created_at,
      'inventory_item',     jsonb_build_object(
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

  -- ── 6. Return complete order with items ──
  return jsonb_build_object(
    'id',            v_order.id,
    'order_number',  v_order.order_number,
    'org_id',        v_order.org_id,
    'user_id',       v_order.user_id,
    'location_id',   v_order.location_id,
    'status',        v_order.status,
    'notes',         v_order.notes,
    'created_at',    v_order.created_at,
    'fulfilled_at',  v_order.fulfilled_at,
    'fulfilled_by',  v_order.fulfilled_by,
    'order_items',   coalesce(v_items, '[]'::jsonb),
    'is_existing',   v_is_existing
  );
end;
$$;

-- Only authenticated users may call this function.
revoke all on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb) to authenticated;
