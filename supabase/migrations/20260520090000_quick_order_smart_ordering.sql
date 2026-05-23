-- Quick Order smart ordering memory and durable draft mutation records.

create extension if not exists "pgcrypto";

create table if not exists public.item_reorder_rules (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  target_stock_quantity numeric,
  target_stock_unit text,
  min_stock_quantity numeric,
  max_stock_quantity numeric,
  usual_order_quantity numeric,
  usual_order_unit text,
  min_order_quantity numeric not null default 1,
  order_increment numeric not null default 1,
  allow_fractional_stock_count boolean not null default true,
  allow_fractional_order boolean not null default false,
  rounding_policy text not null default 'nearest'
    check (rounding_policy in (
      'floor_conservative',
      'ceil_prevent_stockout',
      'nearest',
      'floor_normal_ceil_if_low',
      'custom_threshold'
    )),
  criticality text,
  shelf_life_days integer,
  lead_time_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_reorder_rules_nonnegative check (
    coalesce(target_stock_quantity, 0) >= 0
    and coalesce(min_stock_quantity, 0) >= 0
    and coalesce(max_stock_quantity, 0) >= 0
    and coalesce(usual_order_quantity, 0) >= 0
    and min_order_quantity >= 0
    and order_increment > 0
    and coalesce(shelf_life_days, 0) >= 0
    and coalesce(lead_time_days, 0) >= 0
  )
);

create unique index if not exists item_reorder_rules_scope_unique_idx
  on public.item_reorder_rules(
    item_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists item_reorder_rules_item_location_idx
  on public.item_reorder_rules(item_id, location_id);

drop trigger if exists set_item_reorder_rules_updated_at on public.item_reorder_rules;
create trigger set_item_reorder_rules_updated_at
before update on public.item_reorder_rules
for each row execute function public.set_updated_at();

create table if not exists public.item_order_profiles (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  usual_quantity numeric,
  usual_unit text,
  p50_quantity numeric,
  p75_quantity numeric,
  p95_quantity numeric,
  last_order_quantity numeric,
  last_order_unit text,
  last_ordered_at timestamptz,
  weekday_pattern_json jsonb,
  monthly_pattern_json jsonb,
  sample_size integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint item_order_profiles_nonnegative check (
    coalesce(usual_quantity, 0) >= 0
    and coalesce(p50_quantity, 0) >= 0
    and coalesce(p75_quantity, 0) >= 0
    and coalesce(p95_quantity, 0) >= 0
    and coalesce(last_order_quantity, 0) >= 0
    and sample_size >= 0
  )
);

create unique index if not exists item_order_profiles_scope_unique_idx
  on public.item_order_profiles(
    item_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists item_order_profiles_item_location_idx
  on public.item_order_profiles(item_id, location_id);

drop trigger if exists set_item_order_profiles_updated_at on public.item_order_profiles;
create trigger set_item_order_profiles_updated_at
before update on public.item_order_profiles
for each row execute function public.set_updated_at();

create table if not exists public.quick_order_cart_mutations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.quick_order_sessions(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  mutation_type text not null
    check (mutation_type in (
      'smart_suggestion_applied',
      'stock_recommendation_applied',
      'history_reorder_applied',
      'manual_update',
      'clarification_applied'
    )),
  source_message text,
  assistant_message text,
  before_cart jsonb not null,
  after_cart jsonb not null,
  delta jsonb,
  affected_items jsonb,
  revert_status text not null default 'active'
    check (revert_status in ('active', 'reverted', 'failed')),
  reverted_at timestamptz,
  reverted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists quick_order_cart_mutations_session_created_idx
  on public.quick_order_cart_mutations(session_id, created_at desc);

create index if not exists quick_order_cart_mutations_user_created_idx
  on public.quick_order_cart_mutations(user_id, created_at desc);

alter table public.item_reorder_rules enable row level security;
alter table public.item_order_profiles enable row level security;
alter table public.quick_order_cart_mutations enable row level security;

drop policy if exists item_reorder_rules_select_authenticated on public.item_reorder_rules;
create policy item_reorder_rules_select_authenticated
  on public.item_reorder_rules
  for select
  to authenticated
  using (true);

drop policy if exists item_reorder_rules_modify_manager on public.item_reorder_rules;
create policy item_reorder_rules_modify_manager
  on public.item_reorder_rules
  for all
  to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

drop policy if exists item_order_profiles_select_authenticated on public.item_order_profiles;
create policy item_order_profiles_select_authenticated
  on public.item_order_profiles
  for select
  to authenticated
  using (true);

drop policy if exists item_order_profiles_modify_manager on public.item_order_profiles;
create policy item_order_profiles_modify_manager
  on public.item_order_profiles
  for all
  to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

drop policy if exists quick_order_cart_mutations_select_owner_or_manager on public.quick_order_cart_mutations;
create policy quick_order_cart_mutations_select_owner_or_manager
  on public.quick_order_cart_mutations
  for select
  to authenticated
  using (user_id = auth.uid() or public.current_user_is_manager());

drop policy if exists quick_order_cart_mutations_insert_owner_or_manager on public.quick_order_cart_mutations;
create policy quick_order_cart_mutations_insert_owner_or_manager
  on public.quick_order_cart_mutations
  for insert
  to authenticated
  with check (user_id = auth.uid() or public.current_user_is_manager());

drop policy if exists quick_order_cart_mutations_update_owner_or_manager on public.quick_order_cart_mutations;
create policy quick_order_cart_mutations_update_owner_or_manager
  on public.quick_order_cart_mutations
  for update
  to authenticated
  using (user_id = auth.uid() or public.current_user_is_manager())
  with check (user_id = auth.uid() or public.current_user_is_manager());

grant select on public.item_reorder_rules to authenticated;
grant select on public.item_order_profiles to authenticated;
grant select, insert, update on public.quick_order_cart_mutations to authenticated;
grant insert, update, delete on public.item_reorder_rules to authenticated;
grant insert, update, delete on public.item_order_profiles to authenticated;

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

  with ranked_items as (
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
      o.created_at,
      extract(dow from o.created_at)::int as dow,
      row_number() over (
        partition by oi.inventory_item_id, o.location_id
        order by o.created_at desc
      ) as rn
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.inventory_items ii on ii.id = oi.inventory_item_id
    where oi.inventory_item_id is not null
      and oi.quantity > 0
      and o.status <> 'draft'
      and (p_location_id is null or o.location_id = p_location_id)
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
      (array_agg(quantity order by created_at desc))[1] as last_order_quantity,
      (array_agg(unit order by created_at desc))[1] as last_order_unit,
      max(created_at) as last_ordered_at,
      count(*)::int as sample_size
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
    updated_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.refresh_item_order_profiles(uuid, integer) from public, anon;
grant execute on function public.refresh_item_order_profiles(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
