-- Persist queryable fulfillment line-item history for last-ordered suggestions.

create extension if not exists "pgcrypto";

-- Safety: this migration can be run independently in environments where
-- the earlier fulfillment migration was not applied yet.
create table if not exists public.past_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id text,
  supplier_name text not null,
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  payload jsonb not null default '{}'::jsonb,
  message_text text not null,
  share_method text not null default 'share' check (share_method in ('share', 'copy'))
);

create table if not exists public.past_order_items (
  id uuid primary key default gen_random_uuid(),
  past_order_id uuid not null references public.past_orders(id) on delete cascade,
  supplier_id text not null,
  created_by uuid not null references public.users(id) on delete cascade,
  item_id text not null,
  item_name text not null,
  unit text not null,
  quantity numeric not null check (quantity > 0),
  location_id text,
  location_name text,
  location_group text check (location_group in ('sushi', 'poki')),
  unit_type text check (unit_type in ('base', 'pack')),
  ordered_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

create index if not exists past_order_items_supplier_item_unit_ordered_idx
  on public.past_order_items(supplier_id, item_id, unit, ordered_at desc);

create index if not exists past_order_items_supplier_item_unit_created_idx
  on public.past_order_items(supplier_id, item_id, unit, created_at desc);

create index if not exists past_order_items_created_by_supplier_ordered_idx
  on public.past_order_items(created_by, supplier_id, ordered_at desc);

create index if not exists past_order_items_past_order_id_idx
  on public.past_order_items(past_order_id);

alter table public.past_order_items enable row level security;

drop policy if exists past_order_items_select_manager_or_owner on public.past_order_items;
create policy past_order_items_select_manager_or_owner
on public.past_order_items
for select
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'manager'
  )
);

drop policy if exists past_order_items_insert_manager_or_owner on public.past_order_items;
create policy past_order_items_insert_manager_or_owner
on public.past_order_items
for insert
to authenticated
with check (
  auth.uid() = created_by
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'manager'
  )
);

drop policy if exists past_order_items_update_manager_or_owner on public.past_order_items;
create policy past_order_items_update_manager_or_owner
on public.past_order_items
for update
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'manager'
  )
)
with check (
  auth.uid() = created_by
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'manager'
  )
);

drop policy if exists past_order_items_delete_manager_or_owner on public.past_order_items;
create policy past_order_items_delete_manager_or_owner
on public.past_order_items
for delete
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'manager'
  )
);

grant select, insert, update, delete on public.past_order_items to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.past_order_items;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;
end;
$$;
