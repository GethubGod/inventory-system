-- Add editable stock settings fields to area_items
alter table public.area_items
  add column if not exists active boolean not null default true,
  add column if not exists order_unit text,
  add column if not exists conversion_factor numeric;

create index if not exists area_items_active_idx on public.area_items(active);
