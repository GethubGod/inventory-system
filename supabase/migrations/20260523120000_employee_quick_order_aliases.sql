-- Employee-specific Quick Order aliases managed from Google Sheets.
-- These rows answer only: when this employee says this phrase, which inventory
-- item do they mean? Units continue to come from inventory item/order-unit logic.

create extension if not exists "pgcrypto";

create or replace function public.normalize_quick_order_employee_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(trim(coalesce(p_name, ''))), '\s+', ' ', 'g'), '')
$$;

create or replace function public.normalize_quick_order_alias_text(p_alias text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(trim(coalesce(p_alias, ''))), '\s+', ' ', 'g'), '')
$$;

create table if not exists public.employee_quick_order_aliases (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  employee_name_key text not null,
  employee_user_id uuid references public.users(id) on delete set null,
  alias_text text not null,
  alias_key text not null,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  location_key text generated always as (coalesce(location_id::text, 'global')) stored,
  active boolean not null default true,
  notes text,
  source text not null default 'google_sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employee_quick_order_aliases_scope_unique_idx
  on public.employee_quick_order_aliases(employee_name_key, alias_key, location_key);

create index if not exists employee_quick_order_aliases_employee_user_id_idx
  on public.employee_quick_order_aliases(employee_user_id);

create index if not exists employee_quick_order_aliases_employee_name_key_idx
  on public.employee_quick_order_aliases(employee_name_key);

create index if not exists employee_quick_order_aliases_alias_key_idx
  on public.employee_quick_order_aliases(alias_key);

create index if not exists employee_quick_order_aliases_location_id_idx
  on public.employee_quick_order_aliases(location_id);

create index if not exists employee_quick_order_aliases_active_idx
  on public.employee_quick_order_aliases(active);

create or replace function public.set_employee_quick_order_alias_keys()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.employee_name_key := public.normalize_quick_order_employee_name(new.employee_name);
  new.alias_key := public.normalize_quick_order_alias_text(new.alias_text);

  if new.employee_name_key is null then
    raise exception 'employee_name is required';
  end if;

  if new.alias_key is null then
    raise exception 'alias_text is required';
  end if;

  if new.employee_user_id is null then
    select u.id
      into new.employee_user_id
    from public.users u
    where public.normalize_quick_order_employee_name(u.name) = new.employee_name_key
    order by u.created_at asc
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists set_employee_quick_order_alias_keys on public.employee_quick_order_aliases;
create trigger set_employee_quick_order_alias_keys
before insert or update of employee_name, alias_text, employee_user_id
on public.employee_quick_order_aliases
for each row execute function public.set_employee_quick_order_alias_keys();

drop trigger if exists set_employee_quick_order_aliases_updated_at on public.employee_quick_order_aliases;
create trigger set_employee_quick_order_aliases_updated_at
before update on public.employee_quick_order_aliases
for each row execute function public.set_updated_at();

create or replace function public.link_employee_quick_order_aliases_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name_key text;
begin
  v_name_key := public.normalize_quick_order_employee_name(new.name);
  if v_name_key is null then
    return new;
  end if;

  update public.employee_quick_order_aliases
  set employee_user_id = new.id
  where employee_user_id is null
    and employee_name_key = v_name_key;

  return new;
end;
$$;

drop trigger if exists link_employee_quick_order_aliases_after_user_change on public.users;
create trigger link_employee_quick_order_aliases_after_user_change
after insert or update of name
on public.users
for each row execute function public.link_employee_quick_order_aliases_for_user();

create or replace function public.link_employee_quick_order_aliases_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name_key text;
begin
  v_name_key := public.normalize_quick_order_employee_name(new.full_name);
  if v_name_key is null then
    return new;
  end if;

  update public.employee_quick_order_aliases
  set employee_user_id = new.id
  where employee_user_id is null
    and employee_name_key = v_name_key;

  return new;
end;
$$;

drop trigger if exists link_employee_quick_order_aliases_after_profile_change on public.profiles;
create trigger link_employee_quick_order_aliases_after_profile_change
after insert or update of full_name
on public.profiles
for each row execute function public.link_employee_quick_order_aliases_for_profile();

update public.employee_quick_order_aliases a
set employee_user_id = matched.id
from (
  select id, public.normalize_quick_order_employee_name(name) as name_key
  from public.users
) matched
where a.employee_user_id is null
  and matched.name_key is not null
  and a.employee_name_key = matched.name_key;

update public.employee_quick_order_aliases a
set employee_user_id = matched.id
from (
  select id, public.normalize_quick_order_employee_name(full_name) as name_key
  from public.profiles
) matched
where a.employee_user_id is null
  and matched.name_key is not null
  and a.employee_name_key = matched.name_key;

alter table public.employee_quick_order_aliases enable row level security;

drop policy if exists employee_quick_order_aliases_select_active_authenticated on public.employee_quick_order_aliases;
create policy employee_quick_order_aliases_select_active_authenticated
on public.employee_quick_order_aliases
for select
to authenticated
using (active = true or public.current_user_is_manager());

drop policy if exists employee_quick_order_aliases_modify_manager on public.employee_quick_order_aliases;
create policy employee_quick_order_aliases_modify_manager
on public.employee_quick_order_aliases
for all
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

grant select on public.employee_quick_order_aliases to authenticated;
grant insert, update, delete on public.employee_quick_order_aliases to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
