-- Add created_by to inventory_items for client-side item creation tracking
alter table public.inventory_items
  add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists inventory_items_created_by_idx
  on public.inventory_items(created_by);
