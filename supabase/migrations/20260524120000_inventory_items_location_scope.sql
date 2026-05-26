-- Optional location scoping for inventory items.
-- NULL means the item is available at all locations.
alter table public.inventory_items
  add column if not exists location_id uuid references public.locations(id) on delete set null;

create index if not exists inventory_items_location_id_idx
  on public.inventory_items(location_id);

notify pgrst, 'reload schema';
