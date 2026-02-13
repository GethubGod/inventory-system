-- Optional explicit per-item unit conversion rules for fulfillment/review.
-- Used only when manager chooses to combine unit lines (e.g., pack <-> case).

create extension if not exists "pgcrypto";

create table if not exists public.unit_conversions (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  from_unit text not null,
  to_unit text not null,
  multiplier numeric not null check (multiplier > 0),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint unit_conversions_non_empty_units_check check (
    length(trim(from_unit)) > 0
    and length(trim(to_unit)) > 0
  )
);

create index if not exists unit_conversions_inventory_item_id_idx
  on public.unit_conversions(inventory_item_id);

create unique index if not exists unit_conversions_inventory_from_to_key
  on public.unit_conversions(
    inventory_item_id,
    lower(trim(from_unit)),
    lower(trim(to_unit))
  );

drop trigger if exists set_unit_conversions_updated_at on public.unit_conversions;
create trigger set_unit_conversions_updated_at
before update on public.unit_conversions
for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.unit_conversions to authenticated;
