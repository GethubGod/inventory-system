-- Daily suggestions: tracking columns, heuristic RPC, and submit_order_rpc metadata support.

alter table public.order_items
  add column if not exists was_suggested boolean not null default false,
  add column if not exists original_suggested_qty numeric;

alter table public.orders
  add column if not exists order_type text not null default 'manual';

create table if not exists public.suggested_orders (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  item_name text not null,
  supplier_name text,
  suggested_qty numeric not null,
  unit text,
  confidence_score numeric,
  confidence_tier text not null default 'medium',
  source text not null default 'heuristic',
  created_at timestamptz not null default now()
);

create index if not exists idx_suggested_orders_lookup
  on public.suggested_orders(date, location_id);

alter table public.suggested_orders enable row level security;

create or replace function public.get_dow_suggestions(
  p_location_id uuid,
  p_min_frequency numeric default 0.4,
  p_lookback_months integer default 6
)
returns jsonb
language sql
stable
as $$
  with same_dow_orders as (
    select
      o.id,
      o.created_at
    from public.orders o
    where o.location_id = p_location_id
      and o.status = 'fulfilled'
      and extract(dow from o.created_at) = extract(dow from now())
      and o.created_at >= now() - make_interval(months => greatest(coalesce(p_lookback_months, 6), 1))
  ),
  total_count as (
    select count(distinct id) as cnt
    from same_dow_orders
  ),
  item_occurrences as (
    select
      sdo.id as order_id,
      oi.inventory_item_id as item_id,
      ii.name as item_name,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ) as unit,
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      ) as supplier_name,
      sum(oi.quantity) as ordered_qty
    from same_dow_orders sdo
    join public.order_items oi
      on oi.order_id = sdo.id
    join public.inventory_items ii
      on ii.id = oi.inventory_item_id
    left join public.suppliers override_supplier
      on override_supplier.id = oi.supplier_override_id
    left join public.suppliers primary_supplier
      on primary_supplier.id = ii.supplier_id
    where coalesce(oi.status, 'sent') not in ('cancelled', 'order_later')
    group by
      sdo.id,
      oi.inventory_item_id,
      ii.name,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ),
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      )
  ),
  item_stats as (
    select
      io.item_id,
      io.item_name,
      io.unit_type,
      io.unit,
      io.supplier_name,
      count(*) as times_ordered,
      percentile_cont(0.5) within group (order by io.ordered_qty) as suggested_qty,
      round(avg(io.ordered_qty)::numeric, 1) as avg_qty
    from item_occurrences io
    group by
      io.item_id,
      io.item_name,
      io.unit_type,
      io.unit,
      io.supplier_name
  )
  select coalesce(
    jsonb_agg(row_to_json(row_data) order by row_data.frequency desc, row_data.times_ordered desc, row_data.item_name asc),
    '[]'::jsonb
  )
  from (
    select
      s.item_id,
      s.item_name,
      s.unit_type,
      s.unit,
      s.supplier_name,
      s.times_ordered,
      t.cnt as total_orders,
      round(s.times_ordered::numeric / nullif(t.cnt, 0), 2) as frequency,
      s.suggested_qty,
      s.avg_qty
    from item_stats s
    cross join total_count t
    where t.cnt > 0
      and s.times_ordered::numeric / nullif(t.cnt, 0) >= coalesce(p_min_frequency, 0.4)
  ) as row_data;
$$;

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
  v_org_id         uuid := p_org_id;
  v_order          record;
  v_items          jsonb := '[]'::jsonb;
  v_item           jsonb;
  v_is_existing    boolean := false;
  v_has_suggested  boolean := false;
  v_order_type     text := 'manual';
begin
  set local statement_timeout = '10s';

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
  values (p_id, v_org_id, p_location_id, p_user_id, p_status::order_status, v_order_type)
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
      v_org_id,
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
