-- Harden access-code handling so manual SQL edits don't break signup.
-- Handles:
-- 1) plain text 4-digit codes (auto-hash)
-- 2) leading/trailing whitespace
-- 3) fallback when org_id constant row is missing

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
  else
    new.employee_access_code := normalized_employee;
  end if;

  if normalized_manager ~ '^[0-9]{4}$' then
    new.manager_access_code := extensions.crypt(normalized_manager, extensions.gen_salt('bf'));
  else
    new.manager_access_code := normalized_manager;
  end if;

  return new;
end;
$$;

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

  select * into settings_row
  from public.org_settings
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid
  limit 1;

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

  -- Compatibility fallback for accidental plain-text storage.
  if manager_code = normalized_input then
    return 'manager';
  end if;

  if employee_code = normalized_input then
    return 'employee';
  end if;

  if manager_code <> '' and manager_code = extensions.crypt(normalized_input, manager_code) then
    return 'manager';
  end if;

  if employee_code <> '' and employee_code = extensions.crypt(normalized_input, employee_code) then
    return 'employee';
  end if;

  return null;
end;
$$;

-- Normalize and hash existing rows that still contain plain 4-digit values.
update public.org_settings
set employee_access_code = extensions.crypt(trim(employee_access_code), extensions.gen_salt('bf'))
where trim(employee_access_code) ~ '^[0-9]{4}$';

update public.org_settings
set manager_access_code = extensions.crypt(trim(manager_access_code), extensions.gen_salt('bf'))
where trim(manager_access_code) ~ '^[0-9]{4}$';
