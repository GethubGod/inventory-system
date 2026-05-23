-- Missing Item Check history import and profile refresh support.

create extension if not exists "pgcrypto";

alter table public.item_order_profiles
  add column if not exists weekday integer,
  add column if not exists ordered_count_recent integer not null default 0,
  add column if not exists total_similar_orders integer not null default 0,
  add column if not exists confidence_score numeric,
  add column if not exists source text not null default 'submitted_orders';

create unique index if not exists item_order_profiles_plain_scope_unique_idx
  on public.item_order_profiles(item_id, location_id, supplier_id) nulls not distinct;

create table if not exists public.historical_order_imports (
  id uuid primary key default gen_random_uuid(),
  imported_by uuid references public.users(id) on delete set null,
  employee_id uuid references public.users(id) on delete set null,
  location_id uuid not null references public.locations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  placed_at timestamptz not null,
  original_text text not null,
  status text not null default 'imported' check (status in ('imported', 'voided')),
  created_at timestamptz not null default now()
);

create table if not exists public.historical_order_import_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.historical_order_imports(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  item_name_snapshot text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  original_line text,
  created_at timestamptz not null default now()
);

create table if not exists public.quick_order_ignored_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  location_id uuid references public.locations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  suggestion_type text,
  context jsonb not null default '{}'::jsonb,
  ignored_at timestamptz not null default now()
);

create index if not exists historical_order_imports_location_placed_idx
  on public.historical_order_imports(location_id, placed_at desc);

create index if not exists historical_order_import_items_import_idx
  on public.historical_order_import_items(import_id);

create index if not exists historical_order_import_items_item_idx
  on public.historical_order_import_items(item_id);

create index if not exists quick_order_ignored_suggestions_session_idx
  on public.quick_order_ignored_suggestions(user_id, location_id, ignored_at desc);

alter table public.historical_order_imports enable row level security;
alter table public.historical_order_import_items enable row level security;
alter table public.quick_order_ignored_suggestions enable row level security;

drop policy if exists historical_order_imports_manager_all on public.historical_order_imports;
create policy historical_order_imports_manager_all
  on public.historical_order_imports
  for all
  to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

drop policy if exists historical_order_import_items_manager_all on public.historical_order_import_items;
create policy historical_order_import_items_manager_all
  on public.historical_order_import_items
  for all
  to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

drop policy if exists quick_order_ignored_suggestions_owner_or_manager on public.quick_order_ignored_suggestions;
create policy quick_order_ignored_suggestions_owner_or_manager
  on public.quick_order_ignored_suggestions
  for all
  to authenticated
  using (user_id = auth.uid() or public.current_user_is_manager())
  with check (user_id = auth.uid() or public.current_user_is_manager());

grant select, insert, update on public.historical_order_imports to authenticated;
grant select, insert, update on public.historical_order_import_items to authenticated;
grant select, insert, update on public.quick_order_ignored_suggestions to authenticated;

create or replace function public.refresh_item_order_profiles(
  p_location_id uuid default null,
  p_lookback_orders integer default 12
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can refresh Quick Order profiles';
  end if;

  with history_items as (
    select
      oi.inventory_item_id as item_id,
      o.location_id,
      null::uuid as supplier_id,
      oi.quantity::numeric as quantity,
      case
        when oi.unit_type = 'pack' then ii.pack_unit
        when oi.unit_type = 'base' then ii.base_unit
        else oi.unit_type
      end as unit,
      o.created_at as placed_at,
      extract(dow from o.created_at)::int as weekday,
      'submitted_orders'::text as source,
      o.id::text as order_key
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.inventory_items ii on ii.id = oi.inventory_item_id
    where oi.inventory_item_id is not null
      and oi.quantity > 0
      and o.status <> 'draft'
      and (p_location_id is null or o.location_id = p_location_id)

    union all

    select
      hii.item_id,
      hi.location_id,
      coalesce(hii.supplier_id, hi.supplier_id) as supplier_id,
      hii.quantity::numeric as quantity,
      hii.unit,
      hi.placed_at,
      extract(dow from hi.placed_at)::int as weekday,
      'manager_import'::text as source,
      hi.id::text as order_key
    from public.historical_order_import_items hii
    join public.historical_order_imports hi on hi.id = hii.import_id
    where hi.status = 'imported'
      and hii.quantity > 0
      and (p_location_id is null or hi.location_id = p_location_id)
  ),
  ranked_items as (
    select
      *,
      row_number() over (
        partition by item_id, location_id, coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
        order by placed_at desc
      ) as rn
    from history_items
  ),
  recent as (
    select * from ranked_items where rn <= greatest(1, p_lookback_orders)
  ),
  grouped as (
    select
      item_id,
      location_id,
      supplier_id,
      percentile_cont(0.5) within group (order by quantity) as p50_quantity,
      percentile_cont(0.75) within group (order by quantity) as p75_quantity,
      percentile_cont(0.95) within group (order by quantity) as p95_quantity,
      (array_agg(quantity order by placed_at desc))[1] as last_order_quantity,
      (array_agg(unit order by placed_at desc))[1] as last_order_unit,
      max(placed_at) as last_ordered_at,
      count(*)::int as sample_size,
      count(*)::int as ordered_count_recent,
      count(distinct order_key)::int as total_similar_orders,
      (array_agg(weekday order by placed_at desc))[1] as weekday,
      case when count(*) > 0 then least(1, count(*)::numeric / greatest(1, p_lookback_orders)::numeric) else 0 end as confidence_score,
      case when bool_or(source = 'manager_import') then 'manager_import' else 'submitted_orders' end as source
    from recent
    group by item_id, location_id, supplier_id
  )
  insert into public.item_order_profiles (
    item_id,
    location_id,
    supplier_id,
    usual_quantity,
    usual_unit,
    p50_quantity,
    p75_quantity,
    p95_quantity,
    last_order_quantity,
    last_order_unit,
    last_ordered_at,
    sample_size,
    weekday,
    ordered_count_recent,
    total_similar_orders,
    confidence_score,
    source,
    updated_at
  )
  select
    item_id,
    location_id,
    supplier_id,
    p50_quantity,
    last_order_unit,
    p50_quantity,
    p75_quantity,
    p95_quantity,
    last_order_quantity,
    last_order_unit,
    last_ordered_at,
    sample_size,
    weekday,
    ordered_count_recent,
    total_similar_orders,
    confidence_score,
    source,
    now()
  from grouped
  on conflict (
    item_id,
    (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  do update set
    usual_quantity = excluded.usual_quantity,
    usual_unit = excluded.usual_unit,
    p50_quantity = excluded.p50_quantity,
    p75_quantity = excluded.p75_quantity,
    p95_quantity = excluded.p95_quantity,
    last_order_quantity = excluded.last_order_quantity,
    last_order_unit = excluded.last_order_unit,
    last_ordered_at = excluded.last_ordered_at,
    sample_size = excluded.sample_size,
    weekday = excluded.weekday,
    ordered_count_recent = excluded.ordered_count_recent,
    total_similar_orders = excluded.total_similar_orders,
    confidence_score = excluded.confidence_score,
    source = excluded.source,
    updated_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.refresh_item_order_profiles(uuid, integer) from public, anon;
grant execute on function public.refresh_item_order_profiles(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
