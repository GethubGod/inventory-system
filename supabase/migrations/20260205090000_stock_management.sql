-- Stock management schema for NFC-based inventory counting

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.storage_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  location_id uuid not null references public.locations(id) on delete cascade,
  nfc_tag_id text unique,
  qr_code text unique,
  check_frequency text not null check (check_frequency in ('daily', 'every_2_days', 'every_3_days', 'weekly')),
  last_checked_at timestamp with time zone,
  last_checked_by uuid references public.users(id),
  icon text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.area_items (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.storage_areas(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  min_quantity numeric not null default 0,
  max_quantity numeric not null default 0,
  par_level numeric,
  current_quantity numeric not null default 0,
  unit_type text not null,
  last_updated_at timestamp with time zone,
  last_updated_by uuid references public.users(id),
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (area_id, inventory_item_id)
);

create table if not exists public.stock_updates (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.storage_areas(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  previous_quantity numeric,
  new_quantity numeric not null,
  updated_by uuid not null references public.users(id),
  update_method text not null check (update_method in ('nfc', 'qr', 'manual', 'quick_select')),
  quick_select_value text check (quick_select_value in ('empty', 'low', 'good', 'full')),
  photo_url text,
  notes text,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.stock_check_sessions (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.storage_areas(id) on delete cascade,
  user_id uuid not null references public.users(id),
  started_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  items_checked integer not null default 0,
  items_skipped integer not null default 0,
  items_total integer not null default 0,
  status text not null check (status in ('in_progress', 'completed', 'abandoned')),
  scan_method text not null check (scan_method in ('nfc', 'qr', 'manual'))
);

create index if not exists storage_areas_location_idx on public.storage_areas(location_id);
create index if not exists storage_areas_active_idx on public.storage_areas(active);
create index if not exists area_items_area_idx on public.area_items(area_id);
create index if not exists area_items_inventory_idx on public.area_items(inventory_item_id);
create index if not exists stock_updates_area_idx on public.stock_updates(area_id);
create index if not exists stock_updates_item_idx on public.stock_updates(inventory_item_id);
create index if not exists stock_check_sessions_area_idx on public.stock_check_sessions(area_id);

create trigger set_storage_areas_updated_at
before update on public.storage_areas
for each row execute function public.set_updated_at();

create trigger set_area_items_updated_at
before update on public.area_items
for each row execute function public.set_updated_at();

-- Seed data for Babytuna locations
with sushi_location as (
  select id from public.locations
  where lower(name) like '%sushi%'
     or lower(short_code) like 's%'
  order by created_at asc
  limit 1
),
poki_location as (
  select id from public.locations
  where lower(name) like '%poki%'
     or lower(name) like '%poke%'
     or lower(name) like '%pho%'
     or lower(short_code) like 'p%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Sushi Station', 'Fish and sushi prep items', sushi_location.id,
       'nfc_sushi_station', 'qr_sushi_station', 'daily', '🍣', 1, true
from sushi_location
on conflict (nfc_tag_id) do nothing;

with sushi_location as (
  select id from public.locations
  where lower(name) like '%sushi%'
     or lower(short_code) like 's%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Cold Storage', 'Produce and dairy', sushi_location.id,
       'nfc_sushi_cold_storage', 'qr_sushi_cold_storage', 'every_2_days', '🧊', 2, true
from sushi_location
on conflict (nfc_tag_id) do nothing;

with sushi_location as (
  select id from public.locations
  where lower(name) like '%sushi%'
     or lower(short_code) like 's%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Dry Storage', 'Dry goods and packaging', sushi_location.id,
       'nfc_sushi_dry_storage', 'qr_sushi_dry_storage', 'weekly', '📦', 3, true
from sushi_location
on conflict (nfc_tag_id) do nothing;

with sushi_location as (
  select id from public.locations
  where lower(name) like '%sushi%'
     or lower(short_code) like 's%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Freezer', 'Frozen items', sushi_location.id,
       'nfc_sushi_freezer', 'qr_sushi_freezer', 'every_2_days', '❄️', 4, true
from sushi_location
on conflict (nfc_tag_id) do nothing;

with sushi_location as (
  select id from public.locations
  where lower(name) like '%sushi%'
     or lower(short_code) like 's%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Sauce Station', 'Sauces and seasonings', sushi_location.id,
       'nfc_sushi_sauce_station', 'qr_sushi_sauce_station', 'every_3_days', '🥫', 5, true
from sushi_location
on conflict (nfc_tag_id) do nothing;

with poki_location as (
  select id from public.locations
  where lower(name) like '%poki%'
     or lower(name) like '%poke%'
     or lower(name) like '%pho%'
     or lower(short_code) like 'p%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Poke Station', 'Fish and poke prep items', poki_location.id,
       'nfc_poki_station', 'qr_poki_station', 'daily', '🥗', 1, true
from poki_location
on conflict (nfc_tag_id) do nothing;

with poki_location as (
  select id from public.locations
  where lower(name) like '%poki%'
     or lower(name) like '%poke%'
     or lower(name) like '%pho%'
     or lower(short_code) like 'p%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Pho Station', 'Sauces and seasonings', poki_location.id,
       'nfc_pho_station', 'qr_pho_station', 'daily', '🍜', 2, true
from poki_location
on conflict (nfc_tag_id) do nothing;

with poki_location as (
  select id from public.locations
  where lower(name) like '%poki%'
     or lower(name) like '%poke%'
     or lower(name) like '%pho%'
     or lower(short_code) like 'p%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Cold Storage', 'Produce and dairy', poki_location.id,
       'nfc_poki_cold_storage', 'qr_poki_cold_storage', 'every_2_days', '🧊', 3, true
from poki_location
on conflict (nfc_tag_id) do nothing;

with poki_location as (
  select id from public.locations
  where lower(name) like '%poki%'
     or lower(name) like '%poke%'
     or lower(name) like '%pho%'
     or lower(short_code) like 'p%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Dry Storage', 'Dry goods and packaging', poki_location.id,
       'nfc_poki_dry_storage', 'qr_poki_dry_storage', 'weekly', '📦', 4, true
from poki_location
on conflict (nfc_tag_id) do nothing;

with poki_location as (
  select id from public.locations
  where lower(name) like '%poki%'
     or lower(name) like '%poke%'
     or lower(name) like '%pho%'
     or lower(short_code) like 'p%'
  order by created_at asc
  limit 1
)
insert into public.storage_areas
  (name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active)
select 'Freezer', 'Frozen items', poki_location.id,
       'nfc_poki_freezer', 'qr_poki_freezer', 'every_2_days', '❄️', 5, true
from poki_location
on conflict (nfc_tag_id) do nothing;

-- Link inventory items to storage areas
with
sushi_location as (
  select id from public.locations
  where lower(name) like '%sushi%'
     or lower(short_code) like 's%'
  order by created_at asc
  limit 1
),
poki_location as (
  select id from public.locations
  where lower(name) like '%poki%'
     or lower(name) like '%poke%'
     or lower(name) like '%pho%'
     or lower(short_code) like 'p%'
  order by created_at asc
  limit 1
),
areas as (
  select id, name, location_id
  from public.storage_areas
  where location_id in (
    select id from sushi_location
    union
    select id from poki_location
  )
),
item_base as (
  select
    inventory_items.id,
    inventory_items.name,
    inventory_items.category,
    inventory_items.base_unit,
    case
      when lower(inventory_items.name) like '%salmon%'
        or lower(inventory_items.name) like '%avocado%'
        then 4
      when inventory_items.category in ('fish', 'produce', 'dairy_cold') then 3
      when inventory_items.category in ('dry', 'packaging', 'sauces') then 2
      when inventory_items.category = 'frozen' then 2
      else 1
    end as min_qty,
    case
      when lower(inventory_items.name) like '%salmon%'
        or lower(inventory_items.name) like '%avocado%'
        then 12
      when inventory_items.category in ('fish', 'produce', 'dairy_cold') then 8
      when inventory_items.category in ('dry', 'packaging', 'sauces') then 6
      when inventory_items.category = 'frozen' then 6
      else 4
    end as max_qty
  from public.inventory_items
  where inventory_items.active = true
)
insert into public.area_items
  (area_id, inventory_item_id, min_quantity, max_quantity, par_level, current_quantity, unit_type)
select
  areas.id,
  items.id,
  items.min_qty,
  items.max_qty,
  (items.min_qty + items.max_qty) / 2.0,
  items.max_qty,
  coalesce(items.base_unit, 'each')
from areas
join item_base items on (
  (areas.name in ('Sushi Station', 'Poke Station') and items.category = 'fish')
  or (areas.name = 'Cold Storage' and items.category in ('produce', 'dairy_cold'))
  or (areas.name = 'Dry Storage' and items.category in ('dry', 'packaging'))
  or (areas.name = 'Freezer' and items.category = 'frozen')
  or (areas.name in ('Sauce Station', 'Pho Station') and items.category = 'sauces')
)
on conflict (area_id, inventory_item_id) do nothing;
