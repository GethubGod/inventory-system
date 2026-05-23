-- Spreadsheet-managed inventory-mode recommendation rules and qualitative
-- inventory status terms for Quick Order.

create extension if not exists "pgcrypto";

create table if not exists public.inventory_reorder_rules (
  id uuid primary key default gen_random_uuid(),
  active boolean not null default true,
  location_id uuid references public.locations(id) on delete cascade,
  location_key text generated always as (coalesce(location_id::text, 'global')) stored,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  applies_to_mode text not null default 'inventory_only',
  trigger_type text not null,
  trigger_qty numeric,
  trigger_qty_max numeric,
  trigger_qty_key text generated always as (coalesce(trigger_qty::text, 'none')) stored,
  trigger_qty_max_key text generated always as (coalesce(trigger_qty_max::text, 'none')) stored,
  trigger_unit text,
  trigger_unit_key text generated always as (coalesce(lower(trim(trigger_unit)), 'none')) stored,
  order_strategy text not null,
  order_qty numeric,
  order_unit text,
  priority integer not null default 100,
  notes text,
  source text not null default 'google_sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_reorder_rules_mode_check
    check (applies_to_mode in ('inventory_only', 'order_only', 'both')),
  constraint inventory_reorder_rules_trigger_type_check
    check (trigger_type in ('below', 'at_or_below', 'equal', 'between', 'at_or_above', 'always')),
  constraint inventory_reorder_rules_order_strategy_check
    check (order_strategy in ('fixed_order_qty', 'no_order', 'use_existing_recommendation_engine')),
  constraint inventory_reorder_rules_nonnegative check (
    coalesce(trigger_qty, 0) >= 0
    and coalesce(trigger_qty_max, 0) >= 0
    and coalesce(order_qty, 0) >= 0
  ),
  constraint inventory_reorder_rules_trigger_bounds_check check (
    trigger_type = 'always'
    or (
      trigger_qty is not null
      and trigger_unit is not null
      and length(trim(trigger_unit)) > 0
    )
  ),
  constraint inventory_reorder_rules_between_check check (
    trigger_type <> 'between'
    or (
      trigger_qty is not null
      and trigger_qty_max is not null
      and trigger_qty <= trigger_qty_max
    )
  ),
  constraint inventory_reorder_rules_fixed_order_check check (
    order_strategy <> 'fixed_order_qty'
    or (
      order_qty is not null
      and order_qty > 0
      and order_unit is not null
      and length(trim(order_unit)) > 0
    )
  )
);

create index if not exists inventory_reorder_rules_inventory_item_id_idx
  on public.inventory_reorder_rules(inventory_item_id);

create index if not exists inventory_reorder_rules_location_id_idx
  on public.inventory_reorder_rules(location_id);

create index if not exists inventory_reorder_rules_active_idx
  on public.inventory_reorder_rules(active);

create index if not exists inventory_reorder_rules_priority_idx
  on public.inventory_reorder_rules(priority);

create unique index if not exists inventory_reorder_rules_sheet_key_idx
  on public.inventory_reorder_rules(
    inventory_item_id,
    location_key,
    trigger_type,
    trigger_qty_key,
    trigger_qty_max_key,
    trigger_unit_key
  );

create table if not exists public.inventory_status_terms (
  id uuid primary key default gen_random_uuid(),
  active boolean not null default true,
  phrase text not null,
  phrase_key text not null,
  status text not null,
  remaining_qty numeric,
  remaining_unit_behavior text not null default 'none',
  recommendation_action text not null,
  priority integer not null default 100,
  notes text,
  source text not null default 'google_sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_status_terms_phrase_not_blank check (length(trim(phrase)) > 0),
  constraint inventory_status_terms_phrase_key_not_blank check (length(trim(phrase_key)) > 0),
  constraint inventory_status_terms_status_check
    check (status in ('enough', 'zero', 'partial', 'low', 'unknown')),
  constraint inventory_status_terms_remaining_unit_behavior_check
    check (remaining_unit_behavior in ('none', 'detected_unit', 'item_default_unit')),
  constraint inventory_status_terms_recommendation_action_check
    check (recommendation_action in ('no_order', 'check_reorder_rule', 'ask_quantity', 'use_existing_recommendation_engine')),
  constraint inventory_status_terms_remaining_qty_nonnegative check (coalesce(remaining_qty, 0) >= 0)
);

create index if not exists inventory_status_terms_phrase_key_idx
  on public.inventory_status_terms(phrase_key);

create index if not exists inventory_status_terms_active_idx
  on public.inventory_status_terms(active);

create index if not exists inventory_status_terms_priority_idx
  on public.inventory_status_terms(priority);

create unique index if not exists inventory_status_terms_sheet_phrase_key_idx
  on public.inventory_status_terms(phrase_key);

drop trigger if exists set_inventory_reorder_rules_updated_at on public.inventory_reorder_rules;
create trigger set_inventory_reorder_rules_updated_at
before update on public.inventory_reorder_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_inventory_status_terms_updated_at on public.inventory_status_terms;
create trigger set_inventory_status_terms_updated_at
before update on public.inventory_status_terms
for each row execute function public.set_updated_at();

alter table public.inventory_reorder_rules enable row level security;
alter table public.inventory_status_terms enable row level security;

drop policy if exists inventory_reorder_rules_select_authenticated on public.inventory_reorder_rules;
create policy inventory_reorder_rules_select_authenticated
on public.inventory_reorder_rules
for select
to authenticated
using (active = true or public.current_user_is_manager());

drop policy if exists inventory_reorder_rules_modify_manager on public.inventory_reorder_rules;
create policy inventory_reorder_rules_modify_manager
on public.inventory_reorder_rules
for all
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists inventory_status_terms_select_authenticated on public.inventory_status_terms;
create policy inventory_status_terms_select_authenticated
on public.inventory_status_terms
for select
to authenticated
using (active = true or public.current_user_is_manager());

drop policy if exists inventory_status_terms_modify_manager on public.inventory_status_terms;
create policy inventory_status_terms_modify_manager
on public.inventory_status_terms
for all
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

grant select on public.inventory_reorder_rules to authenticated;
grant insert, update, delete on public.inventory_reorder_rules to authenticated;
grant select on public.inventory_status_terms to authenticated;
grant insert, update, delete on public.inventory_status_terms to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
