-- Normalize org_settings access codes to hashed values.
-- Validation uses crypt() against stored hashes, so plain 4-digit values
-- (e.g. manual SQL edits) cause all sign-up checks to fail.

create extension if not exists "pgcrypto";

create or replace function public.normalize_org_settings_access_codes()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.employee_access_code ~ '^[0-9]{4}$' then
    new.employee_access_code := extensions.crypt(new.employee_access_code, extensions.gen_salt('bf'));
  end if;

  if new.manager_access_code ~ '^[0-9]{4}$' then
    new.manager_access_code := extensions.crypt(new.manager_access_code, extensions.gen_salt('bf'));
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

-- Backfill existing rows that were stored as plain 4-digit codes.
update public.org_settings
set employee_access_code = extensions.crypt(employee_access_code, extensions.gen_salt('bf'))
where employee_access_code ~ '^[0-9]{4}$';

update public.org_settings
set manager_access_code = extensions.crypt(manager_access_code, extensions.gen_salt('bf'))
where manager_access_code ~ '^[0-9]{4}$';
