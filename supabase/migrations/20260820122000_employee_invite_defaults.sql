-- Onboarding/auth phase: org-wide "new employee defaults" for invite module
-- presets, stored as one app_config JSON row (existing app_config pattern —
-- authenticated read policy already exists; writes go through the RPC below).
-- create-invite seeds an employee invite's module_preset from this row when
-- the caller does not supply one. Applies to invites only; existing
-- user_modules rows are untouched.

insert into public.app_config (key, value, description)
values (
  'employee_invite_module_defaults',
  '{"ordering_simple": true, "ordering_advanced": false, "stock_check": true, "tips": false}'::jsonb,
  'Module preset seeded into new employee invites when the manager does not override it. Managed from the New employee defaults screen.'
)
on conflict (key) do nothing;

-- Manager-only write path (app_config has no authenticated write policy by
-- design). Validates the payload down to the employee-manageable module keys.
create or replace function public.set_employee_invite_defaults(p_defaults jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  entry record;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can change employee invite defaults'
      using errcode = '42501';
  end if;

  if p_defaults is null or jsonb_typeof(p_defaults) is distinct from 'object' then
    raise exception 'Defaults must be a JSON object' using errcode = '22023';
  end if;

  for entry in select key, value from jsonb_each(p_defaults) loop
    if entry.key not in ('ordering_simple', 'ordering_advanced', 'stock_check', 'tips') then
      raise exception 'Unknown module key: %', entry.key using errcode = '22023';
    end if;
    if jsonb_typeof(entry.value) is distinct from 'boolean' then
      raise exception 'Module % must be true or false', entry.key using errcode = '22023';
    end if;
  end loop;

  insert into public.app_config (key, value, description, updated_at, updated_by)
  values (
    'employee_invite_module_defaults',
    p_defaults,
    'Module preset seeded into new employee invites when the manager does not override it. Managed from the New employee defaults screen.',
    now(),
    auth.uid()
  )
  on conflict (key) do update
  set value = excluded.value,
      updated_at = now(),
      updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.set_employee_invite_defaults(jsonb) from public, anon;
grant execute on function public.set_employee_invite_defaults(jsonb) to authenticated, service_role;
