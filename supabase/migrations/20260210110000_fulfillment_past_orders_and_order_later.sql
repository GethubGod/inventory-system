-- Persist manager fulfillment history and order-later queue items.

create extension if not exists "pgcrypto";

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

create table if not exists public.order_later_items (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  scheduled_at timestamp with time zone not null,
  item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  unit text not null,
  location_id uuid references public.locations(id) on delete set null,
  location_name text,
  notes text,
  preferred_supplier_id text,
  preferred_location_group text check (preferred_location_group in ('sushi', 'poki')),
  source_order_item_id uuid references public.order_items(id) on delete set null,
  source_order_id uuid references public.orders(id) on delete set null,
  notification_id text,
  status text not null default 'queued' check (status in ('queued', 'added', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  added_at timestamp with time zone,
  cancelled_at timestamp with time zone
);

create index if not exists past_orders_created_by_created_at_idx
  on public.past_orders(created_by, created_at desc);

create index if not exists past_orders_supplier_created_at_idx
  on public.past_orders(supplier_id, created_at desc);

create index if not exists order_later_items_created_by_status_scheduled_idx
  on public.order_later_items(created_by, status, scheduled_at asc);

create index if not exists order_later_items_scheduled_at_idx
  on public.order_later_items(scheduled_at asc);

drop trigger if exists set_order_later_items_updated_at on public.order_later_items;
create trigger set_order_later_items_updated_at
before update on public.order_later_items
for each row execute function public.set_updated_at();

alter table public.past_orders enable row level security;
alter table public.order_later_items enable row level security;

drop policy if exists past_orders_select_manager_or_owner on public.past_orders;
create policy past_orders_select_manager_or_owner
on public.past_orders
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

drop policy if exists past_orders_insert_manager_or_owner on public.past_orders;
create policy past_orders_insert_manager_or_owner
on public.past_orders
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

drop policy if exists past_orders_update_manager_or_owner on public.past_orders;
create policy past_orders_update_manager_or_owner
on public.past_orders
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

drop policy if exists past_orders_delete_manager_or_owner on public.past_orders;
create policy past_orders_delete_manager_or_owner
on public.past_orders
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

drop policy if exists order_later_items_select_manager_or_owner on public.order_later_items;
create policy order_later_items_select_manager_or_owner
on public.order_later_items
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

drop policy if exists order_later_items_insert_manager_or_owner on public.order_later_items;
create policy order_later_items_insert_manager_or_owner
on public.order_later_items
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

drop policy if exists order_later_items_update_manager_or_owner on public.order_later_items;
create policy order_later_items_update_manager_or_owner
on public.order_later_items
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

drop policy if exists order_later_items_delete_manager_or_owner on public.order_later_items;
create policy order_later_items_delete_manager_or_owner
on public.order_later_items
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

grant select, insert, update, delete on public.past_orders to authenticated;
grant select, insert, update, delete on public.order_later_items to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.past_orders;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.order_later_items;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;
end;
$$;
