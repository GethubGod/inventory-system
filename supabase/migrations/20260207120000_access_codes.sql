-- Secure access codes for role assignment during sign up
create extension if not exists "pgcrypto";

create table if not exists public.org_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique default '00000000-0000-0000-0000-000000000001'::uuid,
  employee_access_code text not null,
  manager_access_code text not null,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid references auth.users(id),
  check (org_id = '00000000-0000-0000-0000-000000000001'::uuid)
);

create index if not exists org_settings_org_id_idx on public.org_settings(org_id);

create or replace function public.set_org_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_org_settings_updated_at on public.org_settings;
create trigger set_org_settings_updated_at
before update on public.org_settings
for each row execute function public.set_org_settings_updated_at();

insert into public.org_settings (org_id, employee_access_code, manager_access_code)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  crypt('1234', gen_salt('bf')),
  crypt('9999', gen_salt('bf'))
)
on conflict (org_id) do nothing;

alter table public.org_settings enable row level security;

create or replace function public.get_access_code_role(p_access_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.org_settings%rowtype;
begin
  if p_access_code is null or p_access_code !~ '^[0-9]{4}$' then
    return null;
  end if;

  select * into settings_row
  from public.org_settings
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid
  limit 1;

  if not found then
    return null;
  end if;

  if settings_row.manager_access_code = crypt(p_access_code, settings_row.manager_access_code) then
    return 'manager';
  end if;

  if settings_row.employee_access_code = crypt(p_access_code, settings_row.employee_access_code) then
    return 'employee';
  end if;

  return null;
end;
$$;

create or replace function public.update_org_access_codes(
  p_employee_access_code text,
  p_manager_access_code text,
  p_updated_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_employee_access_code is null or p_employee_access_code !~ '^[0-9]{4}$' then
    raise exception 'Employee access code must be exactly 4 digits';
  end if;

  if p_manager_access_code is null or p_manager_access_code !~ '^[0-9]{4}$' then
    raise exception 'Manager access code must be exactly 4 digits';
  end if;

  if p_employee_access_code = p_manager_access_code then
    raise exception 'Employee and manager access codes must be different';
  end if;

  update public.org_settings
  set
    employee_access_code = crypt(p_employee_access_code, gen_salt('bf')),
    manager_access_code = crypt(p_manager_access_code, gen_salt('bf')),
    updated_by = p_updated_by,
    updated_at = now()
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid;

  if not found then
    insert into public.org_settings (
      org_id,
      employee_access_code,
      manager_access_code,
      updated_by
    ) values (
      '00000000-0000-0000-0000-000000000001'::uuid,
      crypt(p_employee_access_code, gen_salt('bf')),
      crypt(p_manager_access_code, gen_salt('bf')),
      p_updated_by
    );
  end if;
end;
$$;

revoke all on table public.org_settings from anon, authenticated;
revoke all on function public.get_access_code_role(text) from public, anon, authenticated;
revoke all on function public.update_org_access_codes(text, text, uuid) from public, anon, authenticated;

grant execute on function public.get_access_code_role(text) to service_role;
grant execute on function public.update_org_access_codes(text, text, uuid) to service_role;
