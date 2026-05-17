-- Shared Quick Order brain: quantity safety limits, allowed order units, and
-- stock snapshots captured from typed/voice Quick Order messages.

create extension if not exists "pgcrypto";

create table if not exists public.item_order_limits (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  default_order_unit text,
  typical_min_quantity numeric,
  typical_max_quantity numeric,
  soft_max_quantity numeric,
  hard_max_quantity numeric,
  manager_approval_quantity numeric,
  allow_employee_override boolean not null default false,
  allow_manager_override boolean not null default true,
  max_single_order_quantity numeric,
  max_daily_quantity numeric,
  max_weekly_quantity numeric,
  historical_median_quantity numeric,
  historical_p95_quantity numeric,
  historical_max_quantity numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_order_limits_nonnegative check (
    coalesce(typical_min_quantity, 0) >= 0
    and coalesce(typical_max_quantity, 0) >= 0
    and coalesce(soft_max_quantity, 0) >= 0
    and coalesce(hard_max_quantity, 0) >= 0
    and coalesce(manager_approval_quantity, 0) >= 0
    and coalesce(max_single_order_quantity, 0) >= 0
    and coalesce(max_daily_quantity, 0) >= 0
    and coalesce(max_weekly_quantity, 0) >= 0
  )
);

create unique index if not exists item_order_limits_scope_unique_idx
  on public.item_order_limits(
    item_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists item_order_limits_item_location_idx
  on public.item_order_limits(item_id, location_id);

drop trigger if exists set_item_order_limits_updated_at on public.item_order_limits;
create trigger set_item_order_limits_updated_at
before update on public.item_order_limits
for each row execute function public.set_updated_at();

create table if not exists public.item_allowed_units (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  unit text not null,
  is_default boolean not null default false,
  conversion_to_base_unit numeric,
  min_quantity numeric,
  soft_max_quantity numeric,
  hard_max_quantity numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_allowed_units_unit_not_blank check (length(trim(unit)) > 0),
  constraint item_allowed_units_nonnegative check (
    coalesce(conversion_to_base_unit, 0) >= 0
    and coalesce(min_quantity, 0) >= 0
    and coalesce(soft_max_quantity, 0) >= 0
    and coalesce(hard_max_quantity, 0) >= 0
  )
);

create unique index if not exists item_allowed_units_item_unit_unique_idx
  on public.item_allowed_units(item_id, lower(trim(unit)));

create index if not exists item_allowed_units_item_default_idx
  on public.item_allowed_units(item_id, is_default);

drop trigger if exists set_item_allowed_units_updated_at on public.item_allowed_units;
create trigger set_item_allowed_units_updated_at
before update on public.item_allowed_units
for each row execute function public.set_updated_at();

create table if not exists public.current_stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity numeric not null,
  unit text,
  source_message text,
  source text not null check (source in ('typed', 'voice')),
  entered_by_user_id uuid references public.users(id) on delete set null,
  quick_order_session_id uuid references public.quick_order_sessions(id) on delete set null,
  confidence numeric not null default 0.8 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  constraint current_stock_snapshots_quantity_nonnegative check (quantity >= 0)
);

create index if not exists current_stock_snapshots_location_item_created_idx
  on public.current_stock_snapshots(location_id, item_id, created_at desc);

create index if not exists current_stock_snapshots_user_created_idx
  on public.current_stock_snapshots(entered_by_user_id, created_at desc);

alter table public.item_order_limits enable row level security;
alter table public.item_allowed_units enable row level security;
alter table public.current_stock_snapshots enable row level security;

drop policy if exists item_order_limits_select_authenticated on public.item_order_limits;
create policy item_order_limits_select_authenticated
  on public.item_order_limits
  for select
  to authenticated
  using (true);

drop policy if exists item_order_limits_modify_manager on public.item_order_limits;
create policy item_order_limits_modify_manager
  on public.item_order_limits
  for all
  to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

drop policy if exists item_allowed_units_select_authenticated on public.item_allowed_units;
create policy item_allowed_units_select_authenticated
  on public.item_allowed_units
  for select
  to authenticated
  using (true);

drop policy if exists item_allowed_units_modify_manager on public.item_allowed_units;
create policy item_allowed_units_modify_manager
  on public.item_allowed_units
  for all
  to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

drop policy if exists current_stock_snapshots_select_own_or_manager on public.current_stock_snapshots;
create policy current_stock_snapshots_select_own_or_manager
  on public.current_stock_snapshots
  for select
  to authenticated
  using (entered_by_user_id = auth.uid() or public.current_user_is_manager());

drop policy if exists current_stock_snapshots_insert_own on public.current_stock_snapshots;
create policy current_stock_snapshots_insert_own
  on public.current_stock_snapshots
  for insert
  to authenticated
  with check (entered_by_user_id = auth.uid() or public.current_user_is_manager());

grant select on public.item_order_limits to authenticated;
grant select on public.item_allowed_units to authenticated;
grant select, insert on public.current_stock_snapshots to authenticated;

insert into public.app_config (key, value, description) values
  ('quick_order_voice_enabled', 'false'::jsonb, 'Enable transcript-first Quick Order voice UI'),
  ('quick_order_advanced_model_routing_enabled', 'true'::jsonb, 'Allow advanced model routing for complex Quick Order planning')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
