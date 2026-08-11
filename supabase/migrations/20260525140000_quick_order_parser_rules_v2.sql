-- Quick Order Parser Rules V2.
--
-- Google Sheets remains the editable admin surface, but Quick Order now reads
-- normalized parser rules from dedicated tables. Existing legacy rule tables
-- remain in place for transitional fallback.

create extension if not exists "pgcrypto";

alter table public.locations
  add column if not exists location_key text;

update public.locations
set location_key = public.normalize_quick_order_alias_text(coalesce(location_key, short_code, name))
where location_key is null;

create unique index if not exists locations_location_key_unique_idx
  on public.locations(location_key)
  where location_key is not null;

alter table public.suppliers
  add column if not exists supplier_key text,
  add column if not exists email text;

update public.suppliers
set supplier_key = public.normalize_quick_order_alias_text(coalesce(supplier_key, name))
where supplier_key is null;

create unique index if not exists suppliers_supplier_key_unique_idx
  on public.suppliers(supplier_key)
  where supplier_key is not null;

alter table public.inventory_items
  add column if not exists item_key text,
  add column if not exists secondary_supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists notes text;

update public.inventory_items
set item_key = public.normalize_quick_order_alias_text(coalesce(item_key, name))
where item_key is null;

create unique index if not exists inventory_items_item_key_unique_idx
  on public.inventory_items(item_key)
  where item_key is not null and active = true;

create table if not exists public.quick_order_alias_rules (
  id uuid primary key default gen_random_uuid(),
  alias_text text not null,
  alias_key text generated always as (public.normalize_quick_order_alias_text(alias_text)) stored,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  scope_type text not null default 'global',
  employee_name text,
  employee_name_key text generated always as (public.normalize_quick_order_employee_name(employee_name)) stored,
  employee_scope_key text generated always as (coalesce(public.normalize_quick_order_employee_name(employee_name), 'global')) stored,
  employee_user_id uuid references public.users(id) on delete set null,
  mode_scope text not null default 'both',
  location_id uuid references public.locations(id) on delete cascade,
  location_key text generated always as (coalesce(location_id::text, 'global')) stored,
  active boolean not null default true,
  notes text,
  source text not null default 'google_sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quick_order_alias_rules_alias_not_blank check (alias_key is not null),
  constraint quick_order_alias_rules_scope_check check (scope_type in ('global', 'employee')),
  constraint quick_order_alias_rules_mode_check check (mode_scope in ('order', 'inventory', 'both')),
  constraint quick_order_alias_rules_employee_scope_check check (
    scope_type = 'global' or employee_name_key is not null or employee_user_id is not null
  )
);

create unique index if not exists quick_order_alias_rules_sheet_key_idx
  on public.quick_order_alias_rules(alias_key, scope_type, employee_scope_key, mode_scope, location_key);
create index if not exists quick_order_alias_rules_alias_key_idx on public.quick_order_alias_rules(alias_key);
create index if not exists quick_order_alias_rules_item_id_idx on public.quick_order_alias_rules(item_id);
create index if not exists quick_order_alias_rules_location_id_idx on public.quick_order_alias_rules(location_id);
create index if not exists quick_order_alias_rules_employee_name_key_idx on public.quick_order_alias_rules(employee_name_key);
create index if not exists quick_order_alias_rules_employee_user_id_idx on public.quick_order_alias_rules(employee_user_id);
create index if not exists quick_order_alias_rules_scope_type_idx on public.quick_order_alias_rules(scope_type);
create index if not exists quick_order_alias_rules_mode_scope_idx on public.quick_order_alias_rules(mode_scope);
create index if not exists quick_order_alias_rules_active_idx on public.quick_order_alias_rules(active);

create table if not exists public.quick_order_unit_rules (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.inventory_items(id) on delete cascade,
  item_scope_key text generated always as (coalesce(item_id::text, 'global')) stored,
  from_unit text,
  from_unit_key text generated always as (coalesce(public.normalize_quick_order_alias_text(from_unit), 'missing')) stored,
  to_unit text not null,
  to_unit_key text generated always as (public.normalize_quick_order_alias_text(to_unit)) stored,
  multiplier numeric not null default 1,
  scope_type text not null default 'global',
  employee_name text,
  employee_name_key text generated always as (public.normalize_quick_order_employee_name(employee_name)) stored,
  employee_scope_key text generated always as (coalesce(public.normalize_quick_order_employee_name(employee_name), 'global')) stored,
  employee_user_id uuid references public.users(id) on delete set null,
  mode_scope text not null default 'both',
  location_id uuid references public.locations(id) on delete cascade,
  location_key text generated always as (coalesce(location_id::text, 'global')) stored,
  is_default_when_missing boolean not null default false,
  active boolean not null default true,
  notes text,
  source text not null default 'google_sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quick_order_unit_rules_to_unit_not_blank check (to_unit_key is not null),
  constraint quick_order_unit_rules_multiplier_positive check (multiplier > 0),
  constraint quick_order_unit_rules_scope_check check (scope_type in ('global', 'employee')),
  constraint quick_order_unit_rules_mode_check check (mode_scope in ('order', 'inventory', 'both')),
  constraint quick_order_unit_rules_employee_scope_check check (
    scope_type = 'global' or employee_name_key is not null or employee_user_id is not null
  )
);

create unique index if not exists quick_order_unit_rules_sheet_key_idx
  on public.quick_order_unit_rules(item_scope_key, from_unit_key, scope_type, employee_scope_key, mode_scope, location_key, is_default_when_missing);
create index if not exists quick_order_unit_rules_from_unit_key_idx on public.quick_order_unit_rules(from_unit_key);
create index if not exists quick_order_unit_rules_item_id_idx on public.quick_order_unit_rules(item_id);
create index if not exists quick_order_unit_rules_location_id_idx on public.quick_order_unit_rules(location_id);
create index if not exists quick_order_unit_rules_employee_name_key_idx on public.quick_order_unit_rules(employee_name_key);
create index if not exists quick_order_unit_rules_employee_user_id_idx on public.quick_order_unit_rules(employee_user_id);
create index if not exists quick_order_unit_rules_scope_type_idx on public.quick_order_unit_rules(scope_type);
create index if not exists quick_order_unit_rules_mode_scope_idx on public.quick_order_unit_rules(mode_scope);
create index if not exists quick_order_unit_rules_active_idx on public.quick_order_unit_rules(active);

create table if not exists public.quick_order_reorder_rules (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  scope_type text not null default 'global',
  employee_name text,
  employee_name_key text generated always as (public.normalize_quick_order_employee_name(employee_name)) stored,
  employee_scope_key text generated always as (coalesce(public.normalize_quick_order_employee_name(employee_name), 'global')) stored,
  employee_user_id uuid references public.users(id) on delete set null,
  mode_scope text not null default 'inventory',
  location_id uuid references public.locations(id) on delete cascade,
  location_key text generated always as (coalesce(location_id::text, 'global')) stored,
  counted_unit text,
  counted_unit_key text generated always as (coalesce(public.normalize_quick_order_alias_text(counted_unit), 'any')) stored,
  trigger_type text not null,
  trigger_qty_min numeric,
  trigger_qty_max numeric,
  trigger_qty_min_key text generated always as (coalesce(trigger_qty_min::text, 'none')) stored,
  trigger_qty_max_key text generated always as (coalesce(trigger_qty_max::text, 'none')) stored,
  action_type text not null,
  order_qty numeric,
  order_unit text,
  target_qty numeric,
  target_unit text,
  priority integer,
  active boolean not null default true,
  notes text,
  source text not null default 'google_sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quick_order_reorder_rules_scope_check check (scope_type in ('global', 'employee')),
  constraint quick_order_reorder_rules_mode_check check (mode_scope in ('order', 'inventory', 'both')),
  constraint quick_order_reorder_rules_trigger_check check (trigger_type in ('below', 'at_or_below', 'between', 'equal', 'status')),
  constraint quick_order_reorder_rules_action_check check (action_type in ('fixed_order_qty', 'top_up_to_target', 'no_order', 'ask')),
  constraint quick_order_reorder_rules_nonnegative check (
    coalesce(trigger_qty_min, 0) >= 0
    and coalesce(trigger_qty_max, 0) >= 0
    and coalesce(order_qty, 0) >= 0
    and coalesce(target_qty, 0) >= 0
  ),
  constraint quick_order_reorder_rules_between_check check (
    trigger_type <> 'between'
    or (
      trigger_qty_min is not null
      and trigger_qty_max is not null
      and trigger_qty_min <= trigger_qty_max
    )
  ),
  constraint quick_order_reorder_rules_fixed_order_check check (
    action_type <> 'fixed_order_qty'
    or (order_qty is not null and order_qty > 0 and order_unit is not null and length(trim(order_unit)) > 0)
  ),
  constraint quick_order_reorder_rules_top_up_check check (
    action_type <> 'top_up_to_target'
    or (target_qty is not null and target_unit is not null and length(trim(target_unit)) > 0)
  ),
  constraint quick_order_reorder_rules_employee_scope_check check (
    scope_type = 'global' or employee_name_key is not null or employee_user_id is not null
  )
);

create unique index if not exists quick_order_reorder_rules_sheet_key_idx
  on public.quick_order_reorder_rules(item_id, scope_type, employee_scope_key, mode_scope, location_key, counted_unit_key, trigger_type, trigger_qty_min_key, trigger_qty_max_key);
create index if not exists quick_order_reorder_rules_item_id_idx on public.quick_order_reorder_rules(item_id);
create index if not exists quick_order_reorder_rules_location_id_idx on public.quick_order_reorder_rules(location_id);
create index if not exists quick_order_reorder_rules_employee_name_key_idx on public.quick_order_reorder_rules(employee_name_key);
create index if not exists quick_order_reorder_rules_employee_user_id_idx on public.quick_order_reorder_rules(employee_user_id);
create index if not exists quick_order_reorder_rules_scope_type_idx on public.quick_order_reorder_rules(scope_type);
create index if not exists quick_order_reorder_rules_mode_scope_idx on public.quick_order_reorder_rules(mode_scope);
create index if not exists quick_order_reorder_rules_active_idx on public.quick_order_reorder_rules(active);

create table if not exists public.quick_order_status_terms (
  id uuid primary key default gen_random_uuid(),
  phrase text not null,
  phrase_key text generated always as (public.normalize_quick_order_alias_text(phrase)) stored,
  status text not null,
  recommendation_action text not null,
  active boolean not null default true,
  notes text,
  source text not null default 'google_sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quick_order_status_terms_phrase_not_blank check (phrase_key is not null),
  constraint quick_order_status_terms_status_check check (status in ('enough', 'out', 'low', 'unknown')),
  constraint quick_order_status_terms_action_check check (recommendation_action in ('no_order', 'order_needed', 'calculate_order', 'ask'))
);

create unique index if not exists quick_order_status_terms_phrase_key_idx
  on public.quick_order_status_terms(phrase_key);
create index if not exists quick_order_status_terms_active_idx on public.quick_order_status_terms(active);

drop trigger if exists set_quick_order_alias_rules_updated_at on public.quick_order_alias_rules;
create trigger set_quick_order_alias_rules_updated_at
before update on public.quick_order_alias_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_quick_order_unit_rules_updated_at on public.quick_order_unit_rules;
create trigger set_quick_order_unit_rules_updated_at
before update on public.quick_order_unit_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_quick_order_reorder_rules_updated_at on public.quick_order_reorder_rules;
create trigger set_quick_order_reorder_rules_updated_at
before update on public.quick_order_reorder_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_quick_order_status_terms_updated_at on public.quick_order_status_terms;
create trigger set_quick_order_status_terms_updated_at
before update on public.quick_order_status_terms
for each row execute function public.set_updated_at();

alter table public.quick_order_alias_rules enable row level security;
alter table public.quick_order_unit_rules enable row level security;
alter table public.quick_order_reorder_rules enable row level security;
alter table public.quick_order_status_terms enable row level security;

drop policy if exists quick_order_alias_rules_select_authenticated on public.quick_order_alias_rules;
create policy quick_order_alias_rules_select_authenticated
on public.quick_order_alias_rules for select to authenticated
using (active = true or public.current_user_is_manager());

drop policy if exists quick_order_alias_rules_modify_manager on public.quick_order_alias_rules;
create policy quick_order_alias_rules_modify_manager
on public.quick_order_alias_rules for all to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists quick_order_unit_rules_select_authenticated on public.quick_order_unit_rules;
create policy quick_order_unit_rules_select_authenticated
on public.quick_order_unit_rules for select to authenticated
using (active = true or public.current_user_is_manager());

drop policy if exists quick_order_unit_rules_modify_manager on public.quick_order_unit_rules;
create policy quick_order_unit_rules_modify_manager
on public.quick_order_unit_rules for all to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists quick_order_reorder_rules_select_authenticated on public.quick_order_reorder_rules;
create policy quick_order_reorder_rules_select_authenticated
on public.quick_order_reorder_rules for select to authenticated
using (active = true or public.current_user_is_manager());

drop policy if exists quick_order_reorder_rules_modify_manager on public.quick_order_reorder_rules;
create policy quick_order_reorder_rules_modify_manager
on public.quick_order_reorder_rules for all to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists quick_order_status_terms_select_authenticated on public.quick_order_status_terms;
create policy quick_order_status_terms_select_authenticated
on public.quick_order_status_terms for select to authenticated
using (active = true or public.current_user_is_manager());

drop policy if exists quick_order_status_terms_modify_manager on public.quick_order_status_terms;
create policy quick_order_status_terms_modify_manager
on public.quick_order_status_terms for all to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

grant select on public.quick_order_alias_rules to authenticated;
grant insert, update, delete on public.quick_order_alias_rules to authenticated;
grant select on public.quick_order_unit_rules to authenticated;
grant insert, update, delete on public.quick_order_unit_rules to authenticated;
grant select on public.quick_order_reorder_rules to authenticated;
grant insert, update, delete on public.quick_order_reorder_rules to authenticated;
grant select on public.quick_order_status_terms to authenticated;
grant insert, update, delete on public.quick_order_status_terms to authenticated;

insert into public.app_config (key, value, description) values
  ('order_mode_missing_unit_strategy', '"item_default_order_unit"'::jsonb, 'Quick Order V2: missing units in order mode use the item default order unit'),
  ('order_mode_employee_personalization', 'false'::jsonb, 'Quick Order V2: employee-specific rules are off in order mode unless a rule explicitly allows order mode'),
  ('inventory_mode_employee_personalization', 'true'::jsonb, 'Quick Order V2: employee-specific rules are active in inventory mode'),
  ('global_aliases_enabled', 'true'::jsonb, 'Quick Order V2: global alias rules are active'),
  ('fuzzy_match_requires_confirmation', 'true'::jsonb, 'Quick Order V2: low-confidence fuzzy matches require confirmation'),
  ('status_terms_enabled', 'true'::jsonb, 'Quick Order V2: inventory status phrases are active')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
