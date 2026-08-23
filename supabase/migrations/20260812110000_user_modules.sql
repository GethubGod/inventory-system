-- Phase 3: per-user module overrides. Role defaults remain centralized in
-- get_effective_modules so clients never need to duplicate access rules.

create table if not exists public.user_modules (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_key text not null,
  enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_key),
  constraint user_modules_module_key_check check (
    module_key in (
      'ordering_simple',
      'ordering_advanced',
      'stock_check',
      'tips',
      'fulfillment'
    )
  )
);

drop trigger if exists set_user_modules_updated_at on public.user_modules;
create trigger set_user_modules_updated_at
before update on public.user_modules
for each row execute function public.set_updated_at();

alter table public.user_modules enable row level security;

drop policy if exists user_modules_select_own on public.user_modules;
create policy user_modules_select_own
on public.user_modules
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists user_modules_manager_all on public.user_modules;
create policy user_modules_manager_all
on public.user_modules
for all
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

revoke all on table public.user_modules from anon;
grant select, insert, update, delete on table public.user_modules to authenticated;

create or replace function public.get_effective_modules(p_user_id uuid)
returns table(module_key text, enabled boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_is_manager boolean;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;

  -- This function reads through RLS as its owner, so authorize the caller
  -- explicitly before exposing another user's effective module set.
  if auth.uid() is distinct from p_user_id
    and not public.current_user_is_manager() then
    raise exception 'not authorized to read these modules' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role = 'manager'
  )
  into target_is_manager;

  return query
  select defaults.module_key, coalesce(overrides.enabled, defaults.enabled)
  from (
    values
      ('ordering_simple'::text, target_is_manager),
      ('ordering_advanced'::text, target_is_manager),
      ('stock_check'::text, true),
      ('tips'::text, target_is_manager),
      ('fulfillment'::text, target_is_manager)
  ) as defaults(module_key, enabled)
  left join public.user_modules as overrides
    on overrides.user_id = p_user_id
   and overrides.module_key = defaults.module_key
  order by case defaults.module_key
    when 'ordering_simple' then 1
    when 'ordering_advanced' then 2
    when 'stock_check' then 3
    when 'tips' then 4
    when 'fulfillment' then 5
  end;
end;
$$;

revoke all on function public.get_effective_modules(uuid) from public, anon;
grant execute on function public.get_effective_modules(uuid) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.user_modules;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;
end;
$$;
