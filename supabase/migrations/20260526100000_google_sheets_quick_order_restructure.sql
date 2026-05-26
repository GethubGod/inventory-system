begin;

create extension if not exists "pgcrypto";

-- Dry-run row counts used for migration validation:
-- select count(*) from public.inventory_items where active = true;
-- select count(*) from public.inventory_reorder_rules;
-- select count(*) from public.quick_order_reorder_rules;
-- select count(*) from public.inventory_status_terms;
-- select count(*) from public.quick_order_status_terms;
-- select count(*) from public.unit_synonyms;
-- select count(*) from public.employee_quick_order_aliases;
-- select count(*) from public.quick_order_alias_rules;
-- select count(*) from public.quick_order_unit_rules;

create table if not exists public.qo_items (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  name text not null,
  item_key text generated always as (public.normalize_quick_order_alias_text(name)) stored,
  category text,
  aliases text,
  supplier text not null default '',
  supplier_id uuid references public.suppliers(id) on delete set null,
  order_unit text not null,
  target_stock numeric,
  location_scope text,
  location_id uuid references public.locations(id) on delete set null,
  location_key text generated always as (coalesce(location_id::text, public.normalize_quick_order_alias_text(location_scope), 'global')) stored,
  active boolean not null default true,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qo_items_name_not_blank check (item_key is not null),
  constraint qo_items_order_unit_not_blank check (length(trim(order_unit)) > 0),
  constraint qo_items_target_stock_nonnegative check (coalesce(target_stock, 0) >= 0)
);

create unique index if not exists qo_items_item_key_location_key_idx
  on public.qo_items(item_key, location_key);
create unique index if not exists qo_items_inventory_item_id_idx
  on public.qo_items(inventory_item_id)
  where inventory_item_id is not null;
create index if not exists qo_items_active_idx on public.qo_items(active);
create index if not exists qo_items_location_id_idx on public.qo_items(location_id);
create index if not exists qo_items_supplier_id_idx on public.qo_items(supplier_id);

create table if not exists public.qo_reorder_rules (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  item_name_key text generated always as (public.normalize_quick_order_alias_text(item_name)) stored,
  qo_item_id uuid references public.qo_items(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  location_scope text,
  location_key text generated always as (coalesce(location_id::text, public.normalize_quick_order_alias_text(location_scope), 'global')) stored,
  trigger_at_or_below numeric not null,
  trigger_unit text not null,
  trigger_unit_key text generated always as (public.normalize_quick_order_alias_text(trigger_unit)) stored,
  order_qty numeric not null,
  order_unit text,
  active boolean not null default true,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qo_reorder_rules_nonnegative check (trigger_at_or_below >= 0 and order_qty >= 0),
  constraint qo_reorder_rules_trigger_unit_not_blank check (trigger_unit_key is not null)
);

create unique index if not exists qo_reorder_rules_sheet_key_idx
  on public.qo_reorder_rules(item_name_key, location_key, trigger_unit_key, trigger_at_or_below);
create index if not exists qo_reorder_rules_qo_item_id_idx on public.qo_reorder_rules(qo_item_id);
create index if not exists qo_reorder_rules_location_id_idx on public.qo_reorder_rules(location_id);
create index if not exists qo_reorder_rules_active_idx on public.qo_reorder_rules(active);

create table if not exists public.qo_personalization (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  employee_name_key text generated always as (public.normalize_quick_order_employee_name(employee_name)) stored,
  employee_user_id uuid references public.users(id) on delete set null,
  rule_type text not null,
  phrase text,
  phrase_key text generated always as (coalesce(public.normalize_quick_order_alias_text(phrase), 'none')) stored,
  item_name text not null,
  item_name_key text generated always as (public.normalize_quick_order_alias_text(item_name)) stored,
  qo_item_id uuid references public.qo_items(id) on delete cascade,
  personal_unit text,
  personal_unit_key text generated always as (coalesce(public.normalize_quick_order_alias_text(personal_unit), 'none')) stored,
  personal_unit_equals text,
  trigger_at_or_below numeric,
  order_qty numeric,
  order_unit text,
  location_scope text,
  location_id uuid references public.locations(id) on delete set null,
  location_key text generated always as (coalesce(location_id::text, public.normalize_quick_order_alias_text(location_scope), 'global')) stored,
  active boolean not null default true,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qo_personalization_rule_type_check check (rule_type in ('alias', 'item_config')),
  constraint qo_personalization_employee_not_blank check (employee_name_key is not null),
  constraint qo_personalization_item_not_blank check (item_name_key is not null),
  constraint qo_personalization_alias_shape check (
    rule_type <> 'alias'
    or (
      phrase_key <> 'none'
      and personal_unit is null
      and personal_unit_equals is null
      and trigger_at_or_below is null
      and order_qty is null
      and order_unit is null
    )
  ),
  constraint qo_personalization_item_config_nonnegative check (
    coalesce(trigger_at_or_below, 0) >= 0 and coalesce(order_qty, 0) >= 0
  )
);

create unique index if not exists qo_personalization_sheet_key_idx
  on public.qo_personalization(employee_name_key, rule_type, phrase_key, item_name_key, personal_unit_key, location_key);
create index if not exists qo_personalization_employee_name_key_idx on public.qo_personalization(employee_name_key);
create index if not exists qo_personalization_employee_user_id_idx on public.qo_personalization(employee_user_id);
create index if not exists qo_personalization_qo_item_id_idx on public.qo_personalization(qo_item_id);
create index if not exists qo_personalization_active_idx on public.qo_personalization(active);

create table if not exists public.qo_keywords (
  id uuid primary key default gen_random_uuid(),
  phrase text not null,
  phrase_key text generated always as (public.normalize_quick_order_alias_text(phrase)) stored,
  meaning_type text not null,
  equals_unit text,
  status text,
  remaining_qty numeric,
  action text,
  active boolean not null default true,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qo_keywords_phrase_not_blank check (phrase_key is not null),
  constraint qo_keywords_meaning_type_check check (meaning_type in ('status_term', 'unit_alias', 'ignore')),
  constraint qo_keywords_status_check check (status is null or status in ('enough', 'zero', 'partial', 'low')),
  constraint qo_keywords_action_check check (action is null or action in ('no_order', 'check_reorder_rule', 'strip_and_continue')),
  constraint qo_keywords_shape_check check (
    (meaning_type = 'unit_alias' and equals_unit is not null and status is null and remaining_qty is null and action is null)
    or (meaning_type = 'status_term' and status is not null and action is not null)
    or (meaning_type = 'ignore' and equals_unit is null and status is null and remaining_qty is null and action = 'strip_and_continue')
  )
);

create unique index if not exists qo_keywords_phrase_meaning_key_idx
  on public.qo_keywords(phrase_key, meaning_type);
create index if not exists qo_keywords_active_idx on public.qo_keywords(active);
create index if not exists qo_keywords_meaning_type_idx on public.qo_keywords(meaning_type);

create table if not exists public.qo_holiday_overrides (
  id uuid primary key default gen_random_uuid(),
  holiday_name text not null,
  start_date date not null,
  end_date date not null,
  item_name text not null,
  location_scope text,
  target_multiplier numeric not null default 1,
  active boolean not null default true,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qo_holiday_overrides_dates_check check (end_date >= start_date),
  constraint qo_holiday_overrides_multiplier_positive check (target_multiplier > 0)
);

create unique index if not exists qo_holiday_overrides_sheet_key_idx
  on public.qo_holiday_overrides(holiday_name, start_date, end_date, item_name, coalesce(public.normalize_quick_order_alias_text(location_scope), 'global'));
create index if not exists qo_holiday_overrides_active_idx on public.qo_holiday_overrides(active);

do $$
declare
  tbl text;
begin
  foreach tbl in array array['qo_items','qo_reorder_rules','qo_personalization','qo_keywords','qo_holiday_overrides']
  loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || tbl || '_updated_at', tbl);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'set_' || tbl || '_updated_at', tbl);
    execute format('alter table public.%I enable row level security', tbl);
  end loop;
end $$;

drop policy if exists qo_items_select_authenticated on public.qo_items;
create policy qo_items_select_authenticated on public.qo_items for select to authenticated
using (active = true or public.current_user_is_manager());
drop policy if exists qo_items_modify_manager on public.qo_items;
create policy qo_items_modify_manager on public.qo_items for all to authenticated
using (public.current_user_is_manager()) with check (public.current_user_is_manager());

drop policy if exists qo_reorder_rules_select_authenticated on public.qo_reorder_rules;
create policy qo_reorder_rules_select_authenticated on public.qo_reorder_rules for select to authenticated
using (active = true or public.current_user_is_manager());
drop policy if exists qo_reorder_rules_modify_manager on public.qo_reorder_rules;
create policy qo_reorder_rules_modify_manager on public.qo_reorder_rules for all to authenticated
using (public.current_user_is_manager()) with check (public.current_user_is_manager());

drop policy if exists qo_personalization_select_authenticated on public.qo_personalization;
create policy qo_personalization_select_authenticated on public.qo_personalization for select to authenticated
using (active = true or public.current_user_is_manager());
drop policy if exists qo_personalization_modify_manager on public.qo_personalization;
create policy qo_personalization_modify_manager on public.qo_personalization for all to authenticated
using (public.current_user_is_manager()) with check (public.current_user_is_manager());

drop policy if exists qo_keywords_select_authenticated on public.qo_keywords;
create policy qo_keywords_select_authenticated on public.qo_keywords for select to authenticated
using (active = true or public.current_user_is_manager());
drop policy if exists qo_keywords_modify_manager on public.qo_keywords;
create policy qo_keywords_modify_manager on public.qo_keywords for all to authenticated
using (public.current_user_is_manager()) with check (public.current_user_is_manager());

drop policy if exists qo_holiday_overrides_select_authenticated on public.qo_holiday_overrides;
create policy qo_holiday_overrides_select_authenticated on public.qo_holiday_overrides for select to authenticated
using (active = true or public.current_user_is_manager());
drop policy if exists qo_holiday_overrides_modify_manager on public.qo_holiday_overrides;
create policy qo_holiday_overrides_modify_manager on public.qo_holiday_overrides for all to authenticated
using (public.current_user_is_manager()) with check (public.current_user_is_manager());

grant select on public.qo_items, public.qo_reorder_rules, public.qo_personalization, public.qo_keywords, public.qo_holiday_overrides to authenticated;
grant insert, update, delete on public.qo_items, public.qo_reorder_rules, public.qo_personalization, public.qo_keywords, public.qo_holiday_overrides to authenticated;
grant all on public.qo_items, public.qo_reorder_rules, public.qo_personalization, public.qo_keywords, public.qo_holiday_overrides to service_role;

alter table public.current_stock_snapshots
  add column if not exists tracking_unit text,
  add column if not exists tracking_unit_key text generated always as (coalesce(public.normalize_quick_order_alias_text(tracking_unit), '__default__')) stored;

drop index if exists public.current_stock_snapshots_user_item_location_tracking_unit_idx;
create unique index current_stock_snapshots_user_item_location_tracking_unit_idx
  on public.current_stock_snapshots(
    coalesce(entered_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    item_id,
    location_id,
    tracking_unit_key
  )
  where tracking_unit is not null;

insert into public.qo_items (
  inventory_item_id, name, category, aliases, supplier, supplier_id, order_unit,
  target_stock, location_scope, location_id, active, notes, sync_status
)
select
  i.id,
  i.name,
  i.category,
  case when i.aliases is null then null else array_to_string(i.aliases, ', ') end,
  coalesce(s.name, nullif(i.default_supplier, ''), ''),
  i.supplier_id,
  coalesce(nullif(i.default_order_unit, ''), nullif(i.base_unit, ''), nullif(i.pack_unit, ''), 'each'),
  i.target_stock,
  l.name,
  i.location_id,
  i.active,
  i.notes,
  'Migrated'
from public.inventory_items i
left join public.suppliers s on s.id = i.supplier_id
left join public.locations l on l.id = i.location_id
where i.active = true
on conflict (item_key, location_key) do update set
  inventory_item_id = excluded.inventory_item_id,
  category = excluded.category,
  aliases = excluded.aliases,
  supplier = excluded.supplier,
  supplier_id = excluded.supplier_id,
  order_unit = excluded.order_unit,
  target_stock = excluded.target_stock,
  location_scope = excluded.location_scope,
  location_id = excluded.location_id,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

insert into public.qo_reorder_rules (
  item_name, qo_item_id, location_id, trigger_at_or_below, trigger_unit, order_qty, order_unit, active, notes, sync_status
)
select
  i.name,
  qi.id,
  r.location_id,
  r.trigger_qty,
  coalesce(r.trigger_unit, qi.order_unit),
  coalesce(r.order_qty, 0),
  r.order_unit,
  r.active,
  r.notes,
  'Migrated'
from public.inventory_reorder_rules r
join public.inventory_items i on i.id = r.inventory_item_id
join public.qo_items qi on qi.inventory_item_id = i.id
where r.order_strategy = 'fixed_order_qty'
  and r.trigger_type in ('below', 'at_or_below', 'equal')
  and r.trigger_qty is not null
on conflict (item_name_key, location_key, trigger_unit_key, trigger_at_or_below) do update set
  qo_item_id = excluded.qo_item_id,
  location_id = excluded.location_id,
  order_qty = excluded.order_qty,
  order_unit = excluded.order_unit,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

insert into public.qo_reorder_rules (
  item_name, qo_item_id, location_id, trigger_at_or_below, trigger_unit, order_qty, order_unit, active, notes, sync_status
)
select
  i.name,
  qi.id,
  r.location_id,
  r.trigger_qty_min,
  coalesce(r.counted_unit, qi.order_unit),
  coalesce(r.order_qty, 0),
  r.order_unit,
  r.active,
  r.notes,
  'Migrated'
from public.quick_order_reorder_rules r
join public.inventory_items i on i.id = r.item_id
join public.qo_items qi on qi.inventory_item_id = i.id
where r.scope_type = 'global'
  and r.action_type = 'fixed_order_qty'
  and r.trigger_qty_min is not null
on conflict (item_name_key, location_key, trigger_unit_key, trigger_at_or_below) do update set
  qo_item_id = excluded.qo_item_id,
  location_id = excluded.location_id,
  order_qty = excluded.order_qty,
  order_unit = excluded.order_unit,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

insert into public.qo_keywords (phrase, meaning_type, status, remaining_qty, action, active, notes, sync_status)
select phrase, 'status_term', status, remaining_qty, recommendation_action, active, notes, 'Migrated'
from public.inventory_status_terms
where phrase is not null
on conflict (phrase_key, meaning_type) do update set
  status = excluded.status,
  remaining_qty = excluded.remaining_qty,
  action = excluded.action,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

insert into public.qo_keywords (phrase, meaning_type, status, remaining_qty, action, active, notes, sync_status)
select
  phrase,
  'status_term',
  case status when 'out' then 'zero' else status end,
  case recommendation_action when 'order_needed' then 0 else null end,
  case recommendation_action when 'no_order' then 'no_order' else 'check_reorder_rule' end,
  active,
  notes,
  'Migrated'
from public.quick_order_status_terms
where phrase is not null
on conflict (phrase_key, meaning_type) do update set
  status = excluded.status,
  remaining_qty = excluded.remaining_qty,
  action = excluded.action,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

insert into public.qo_keywords (phrase, meaning_type, equals_unit, active, sync_status)
select from_unit, 'unit_alias', to_unit, true, 'Migrated'
from public.unit_synonyms
where from_unit is not null and to_unit is not null
on conflict (phrase_key, meaning_type) do update set
  equals_unit = excluded.equals_unit,
  active = excluded.active,
  sync_status = excluded.sync_status,
  updated_at = now();

insert into public.qo_personalization (
  employee_name, employee_user_id, rule_type, phrase, item_name, qo_item_id, location_id, active, notes, sync_status
)
select
  a.employee_name,
  a.employee_user_id,
  'alias',
  a.alias_text,
  i.name,
  qi.id,
  a.location_id,
  a.active,
  a.notes,
  'Migrated'
from public.employee_quick_order_aliases a
join public.inventory_items i on i.id = a.inventory_item_id
join public.qo_items qi on qi.inventory_item_id = i.id
on conflict (employee_name_key, rule_type, phrase_key, item_name_key, personal_unit_key, location_key) do update set
  employee_user_id = excluded.employee_user_id,
  qo_item_id = excluded.qo_item_id,
  location_id = excluded.location_id,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

insert into public.qo_personalization (
  employee_name, employee_user_id, rule_type, phrase, item_name, qo_item_id, location_id, active, notes, sync_status
)
select
  a.employee_name,
  a.employee_user_id,
  'alias',
  a.alias_text,
  i.name,
  qi.id,
  a.location_id,
  a.active,
  a.notes,
  'Migrated'
from public.quick_order_alias_rules a
join public.inventory_items i on i.id = a.item_id
join public.qo_items qi on qi.inventory_item_id = i.id
where a.scope_type = 'employee'
on conflict (employee_name_key, rule_type, phrase_key, item_name_key, personal_unit_key, location_key) do update set
  employee_user_id = excluded.employee_user_id,
  qo_item_id = excluded.qo_item_id,
  location_id = excluded.location_id,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

update public.qo_items qi
set aliases = concat_ws(', ',
  nullif(qi.aliases, ''),
  global_aliases.alias_list
),
updated_at = now()
from (
  select item_id, string_agg(alias_text, ', ' order by alias_text) as alias_list
  from public.quick_order_alias_rules
  where scope_type = 'global' and active = true
  group by item_id
) global_aliases
where qi.inventory_item_id = global_aliases.item_id
  and coalesce(qi.aliases, '') not ilike '%' || global_aliases.alias_list || '%';

insert into public.qo_personalization (
  employee_name, employee_user_id, rule_type, item_name, qo_item_id, personal_unit,
  personal_unit_equals, location_id, active, notes, sync_status
)
select
  r.employee_name,
  r.employee_user_id,
  'item_config',
  i.name,
  qi.id,
  r.from_unit,
  nullif(r.to_unit, ''),
  r.location_id,
  r.active,
  r.notes,
  'Migrated'
from public.quick_order_unit_rules r
join public.inventory_items i on i.id = r.item_id
join public.qo_items qi on qi.inventory_item_id = i.id
where r.scope_type = 'employee'
on conflict (employee_name_key, rule_type, phrase_key, item_name_key, personal_unit_key, location_key) do update set
  employee_user_id = excluded.employee_user_id,
  qo_item_id = excluded.qo_item_id,
  personal_unit_equals = excluded.personal_unit_equals,
  location_id = excluded.location_id,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

insert into public.qo_keywords (phrase, meaning_type, equals_unit, active, notes, sync_status)
select from_unit, 'unit_alias', to_unit, active, notes, 'Migrated'
from public.quick_order_unit_rules
where scope_type = 'global' and from_unit is not null and to_unit is not null
on conflict (phrase_key, meaning_type) do update set
  equals_unit = excluded.equals_unit,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

insert into public.qo_personalization (
  employee_name, employee_user_id, rule_type, item_name, qo_item_id, personal_unit,
  trigger_at_or_below, order_qty, order_unit, location_id, active, notes, sync_status
)
select
  r.employee_name,
  r.employee_user_id,
  'item_config',
  i.name,
  qi.id,
  r.counted_unit,
  r.trigger_qty_min,
  r.order_qty,
  r.order_unit,
  r.location_id,
  r.active,
  r.notes,
  'Migrated'
from public.quick_order_reorder_rules r
join public.inventory_items i on i.id = r.item_id
join public.qo_items qi on qi.inventory_item_id = i.id
where r.scope_type = 'employee'
  and r.action_type = 'fixed_order_qty'
on conflict (employee_name_key, rule_type, phrase_key, item_name_key, personal_unit_key, location_key) do update set
  employee_user_id = excluded.employee_user_id,
  qo_item_id = excluded.qo_item_id,
  trigger_at_or_below = excluded.trigger_at_or_below,
  order_qty = excluded.order_qty,
  order_unit = excluded.order_unit,
  location_id = excluded.location_id,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

comment on table public.quick_order_alias_rules is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';
comment on table public.quick_order_unit_rules is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';
comment on table public.quick_order_reorder_rules is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';
comment on table public.quick_order_status_terms is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';
comment on table public.employee_quick_order_aliases is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';
comment on table public.inventory_reorder_rules is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';
comment on table public.inventory_status_terms is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';
comment on table public.unit_synonyms is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';
comment on table public.item_allowed_units is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';
comment on table public.item_order_limits is 'DEPRECATED: superseded by qo_* tables on 2026-05-26. Scheduled for drop ~30 days after stability confirmed.';

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
