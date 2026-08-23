-- Onboarding/auth phase: flip the employee default for ordering_simple to TRUE.
-- The simple ordering checklist is now the default employee surface, so the
-- role default becomes on-for-everyone; explicit user_modules rows still win.
--
-- Tri-sync: these role defaults MUST stay mirrored in
--   src/store/moduleStore.helpers.ts (getRoleDefaultModules) and
--   web/src/lib/dashboard/modules.ts (getRoleDefaultModules).
-- This migration replaces the function from 20260812110000_user_modules.sql;
-- only the ordering_simple default row changes.

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
      ('ordering_simple'::text, true),
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
