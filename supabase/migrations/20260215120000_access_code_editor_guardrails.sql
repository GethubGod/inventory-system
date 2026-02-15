-- Guardrails for manual org_settings edits and a canonical SQL setter.
-- Goal:
-- 1) Allow changing access codes in Supabase safely
-- 2) Prevent invalid placeholder text from breaking signup validation

create extension if not exists "pgcrypto";

create or replace function public.normalize_org_settings_access_codes()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  normalized_employee text;
  normalized_manager text;
begin
  normalized_employee := trim(coalesce(new.employee_access_code, ''));
  normalized_manager := trim(coalesce(new.manager_access_code, ''));

  if normalized_employee ~ '^[0-9]{4}$' then
    new.employee_access_code := extensions.crypt(normalized_employee, extensions.gen_salt('bf'));
  elsif normalized_employee ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    new.employee_access_code := normalized_employee;
  else
    raise exception 'employee_access_code must be exactly 4 digits';
  end if;

  if normalized_manager ~ '^[0-9]{4}$' then
    new.manager_access_code := extensions.crypt(normalized_manager, extensions.gen_salt('bf'));
  elsif normalized_manager ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    new.manager_access_code := normalized_manager;
  else
    raise exception 'manager_access_code must be exactly 4 digits';
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_org_settings_access_codes on public.org_settings;
create trigger normalize_org_settings_access_codes
before insert or update of employee_access_code, manager_access_code
on public.org_settings
for each row
execute function public.normalize_org_settings_access_codes();

create or replace function public.get_access_code_role(p_access_code text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings_row public.org_settings%rowtype;
  normalized_input text;
  employee_code text;
  manager_code text;
begin
  normalized_input := trim(coalesce(p_access_code, ''));
  if normalized_input !~ '^[0-9]{4}$' then
    return null;
  end if;

  -- Prefer canonical org row when present.
  select * into settings_row
  from public.org_settings
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid
  limit 1;

  -- Fallback for environments with non-canonical org_id rows.
  if not found then
    select * into settings_row
    from public.org_settings
    order by updated_at desc nulls last
    limit 1;
  end if;

  if not found then
    return null;
  end if;

  employee_code := trim(coalesce(settings_row.employee_access_code, ''));
  manager_code := trim(coalesce(settings_row.manager_access_code, ''));

  if manager_code <> '' and manager_code = extensions.crypt(normalized_input, manager_code) then
    return 'manager';
  end if;

  if employee_code <> '' and employee_code = extensions.crypt(normalized_input, employee_code) then
    return 'employee';
  end if;

  return null;
end;
$$;

-- SQL-editor helper: set access codes by plain 4-digit values.
-- This always stores hashed values.
create or replace function public.set_org_access_codes_plain(
  p_employee_access_code text,
  p_manager_access_code text,
  p_updated_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  employee_code text := trim(coalesce(p_employee_access_code, ''));
  manager_code text := trim(coalesce(p_manager_access_code, ''));
begin
  if employee_code !~ '^[0-9]{4}$' then
    raise exception 'Employee access code must be exactly 4 digits';
  end if;

  if manager_code !~ '^[0-9]{4}$' then
    raise exception 'Manager access code must be exactly 4 digits';
  end if;

  if employee_code = manager_code then
    raise exception 'Employee and manager access codes must be different';
  end if;

  -- Prefer canonical row.
  update public.org_settings
  set
    employee_access_code = extensions.crypt(employee_code, extensions.gen_salt('bf')),
    manager_access_code = extensions.crypt(manager_code, extensions.gen_salt('bf')),
    updated_by = p_updated_by,
    updated_at = now()
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid;

  if found then
    return;
  end if;

  -- Fallback: update latest row if canonical row doesn't exist.
  update public.org_settings
  set
    employee_access_code = extensions.crypt(employee_code, extensions.gen_salt('bf')),
    manager_access_code = extensions.crypt(manager_code, extensions.gen_salt('bf')),
    updated_by = p_updated_by,
    updated_at = now()
  where id = (
    select id
    from public.org_settings
    order by updated_at desc nulls last
    limit 1
  );

  if found then
    return;
  end if;

  insert into public.org_settings (
    org_id,
    employee_access_code,
    manager_access_code,
    updated_by
  ) values (
    '00000000-0000-0000-0000-000000000001'::uuid,
    extensions.crypt(employee_code, extensions.gen_salt('bf')),
    extensions.crypt(manager_code, extensions.gen_salt('bf')),
    p_updated_by
  );
end;
$$;

revoke all on function public.set_org_access_codes_plain(text, text, uuid) from public, anon, authenticated;
grant execute on function public.set_org_access_codes_plain(text, text, uuid) to service_role;
