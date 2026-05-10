-- Babytuna Quick Order foundation.
--
-- Adds parser context, session history, correction feedback, and order review
-- metadata for the natural-language Quick Order flow.

create extension if not exists "pgcrypto";

-- The prompt refers to "items"; this app's canonical table is inventory_items.
alter table public.inventory_items
  add column if not exists aliases text[] not null default '{}'::text[];

create index if not exists inventory_items_aliases_gin_idx
  on public.inventory_items using gin (aliases);

create table if not exists public.quick_order_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  location_id uuid references public.locations(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'submitted', 'abandoned')),
  messages jsonb not null default '[]'::jsonb,
  parsed_items jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  submitted_order_id uuid references public.orders(id) on delete set null
);

create index if not exists quick_order_sessions_user_created_idx
  on public.quick_order_sessions(user_id, created_at desc);

create index if not exists quick_order_sessions_location_created_idx
  on public.quick_order_sessions(location_id, created_at desc);

create index if not exists quick_order_sessions_status_updated_idx
  on public.quick_order_sessions(status, updated_at desc);

create index if not exists quick_order_sessions_submitted_order_idx
  on public.quick_order_sessions(submitted_order_id);

drop trigger if exists set_quick_order_sessions_updated_at on public.quick_order_sessions;
create trigger set_quick_order_sessions_updated_at
before update on public.quick_order_sessions
for each row execute function public.set_updated_at();

alter table public.orders
  add column if not exists entry_method text not null default 'manual',
  add column if not exists quick_session_id uuid references public.quick_order_sessions(id) on delete set null,
  add column if not exists manager_review_status text not null default 'not_required',
  add column if not exists manager_review_notes text,
  add column if not exists manager_reviewed_at timestamp with time zone,
  add column if not exists manager_reviewed_by uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_entry_method_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_entry_method_check
      check (entry_method in ('manual', 'quick_order', 'voice_order', 'suggested_order'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_manager_review_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_manager_review_status_check
      check (manager_review_status in ('not_required', 'pending', 'approved', 'changes_requested'));
  end if;
end;
$$;

create index if not exists orders_quick_session_idx
  on public.orders(quick_session_id);

create index if not exists orders_entry_method_created_idx
  on public.orders(entry_method, created_at desc);

create index if not exists orders_manager_review_status_created_idx
  on public.orders(manager_review_status, created_at desc);

create table if not exists public.parser_corrections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.quick_order_sessions(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  raw_token text not null,
  parser_suggested_item_id uuid references public.inventory_items(id) on delete set null,
  user_corrected_item_id uuid references public.inventory_items(id) on delete set null,
  user_corrected_qty numeric,
  user_corrected_unit text,
  created_at timestamp with time zone not null default now()
);

create index if not exists parser_corrections_raw_token_idx
  on public.parser_corrections(raw_token);

create index if not exists parser_corrections_corrected_item_created_idx
  on public.parser_corrections(user_corrected_item_id, created_at desc);

create index if not exists parser_corrections_session_created_idx
  on public.parser_corrections(session_id, created_at desc);

create table if not exists public.parser_examples (
  id uuid primary key default gen_random_uuid(),
  raw_text text not null,
  structured_output jsonb not null default '[]'::jsonb,
  source text not null default 'manager'
    check (source in ('manager', 'correction', 'seed')),
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create index if not exists parser_examples_active_created_idx
  on public.parser_examples(is_active, created_at desc);

create index if not exists parser_examples_source_created_idx
  on public.parser_examples(source, created_at desc);

alter table public.quick_order_sessions enable row level security;
alter table public.parser_corrections enable row level security;
alter table public.parser_examples enable row level security;

drop policy if exists quick_order_sessions_select_own_or_manager on public.quick_order_sessions;
create policy quick_order_sessions_select_own_or_manager
on public.quick_order_sessions
for select
to authenticated
using (user_id = auth.uid() or public.current_user_is_manager());

drop policy if exists quick_order_sessions_insert_own on public.quick_order_sessions;
create policy quick_order_sessions_insert_own
on public.quick_order_sessions
for insert
to authenticated
with check (user_id = auth.uid() or public.current_user_is_manager());

drop policy if exists quick_order_sessions_update_own_or_manager on public.quick_order_sessions;
create policy quick_order_sessions_update_own_or_manager
on public.quick_order_sessions
for update
to authenticated
using (user_id = auth.uid() or public.current_user_is_manager())
with check (user_id = auth.uid() or public.current_user_is_manager());

drop policy if exists parser_corrections_select_manager_or_owner on public.parser_corrections;
create policy parser_corrections_select_manager_or_owner
on public.parser_corrections
for select
to authenticated
using (user_id = auth.uid() or public.current_user_is_manager());

drop policy if exists parser_corrections_insert_own on public.parser_corrections;
create policy parser_corrections_insert_own
on public.parser_corrections
for insert
to authenticated
with check (user_id = auth.uid() or public.current_user_is_manager());

drop policy if exists parser_examples_select_authenticated on public.parser_examples;
create policy parser_examples_select_authenticated
on public.parser_examples
for select
to authenticated
using (true);

drop policy if exists parser_examples_modify_manager on public.parser_examples;
create policy parser_examples_modify_manager
on public.parser_examples
for all
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

grant select, insert, update on public.quick_order_sessions to authenticated;
grant select, insert on public.parser_corrections to authenticated;
grant select, insert, update, delete on public.parser_examples to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

-- Rollback, if this migration needs to be manually reversed:
--
-- drop policy if exists parser_examples_modify_manager on public.parser_examples;
-- drop policy if exists parser_examples_select_authenticated on public.parser_examples;
-- drop policy if exists parser_corrections_insert_own on public.parser_corrections;
-- drop policy if exists parser_corrections_select_manager_or_owner on public.parser_corrections;
-- drop policy if exists quick_order_sessions_update_own_or_manager on public.quick_order_sessions;
-- drop policy if exists quick_order_sessions_insert_own on public.quick_order_sessions;
-- drop policy if exists quick_order_sessions_select_own_or_manager on public.quick_order_sessions;
-- drop table if exists public.parser_examples;
-- drop table if exists public.parser_corrections;
-- alter table public.orders drop constraint if exists orders_manager_review_status_check;
-- alter table public.orders drop constraint if exists orders_entry_method_check;
-- drop index if exists public.orders_manager_review_status_created_idx;
-- drop index if exists public.orders_entry_method_created_idx;
-- drop index if exists public.orders_quick_session_idx;
-- alter table public.orders drop column if exists manager_reviewed_by;
-- alter table public.orders drop column if exists manager_reviewed_at;
-- alter table public.orders drop column if exists manager_review_notes;
-- alter table public.orders drop column if exists manager_review_status;
-- alter table public.orders drop column if exists quick_session_id;
-- alter table public.orders drop column if exists entry_method;
-- drop table if exists public.quick_order_sessions;
-- drop index if exists public.inventory_items_aliases_gin_idx;
-- alter table public.inventory_items drop column if exists aliases;
