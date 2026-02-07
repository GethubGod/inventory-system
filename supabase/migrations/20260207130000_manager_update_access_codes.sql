-- Direct RPC for managers to update access codes (replaces edge function approach).
-- Uses auth.uid() to verify the caller is a manager internally.

create extension if not exists "pgcrypto";

create or replace function public.manager_update_access_codes(
  p_employee_code text,
  p_manager_code text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller_role text;
begin
  select role into caller_role
  from public.users
  where id = auth.uid();

  if caller_role is null or caller_role != 'manager' then
    raise exception 'Only managers can update access codes';
  end if;

  if p_employee_code is null or p_employee_code !~ '^[0-9]{4}$' then
    raise exception 'Employee access code must be exactly 4 digits';
  end if;

  if p_manager_code is null or p_manager_code !~ '^[0-9]{4}$' then
    raise exception 'Manager access code must be exactly 4 digits';
  end if;

  if p_employee_code = p_manager_code then
    raise exception 'Employee and manager access codes must be different';
  end if;

  update public.org_settings
  set
    employee_access_code = crypt(p_employee_code, gen_salt('bf')),
    manager_access_code = crypt(p_manager_code, gen_salt('bf')),
    updated_by = auth.uid()
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid;

  if not found then
    insert into public.org_settings (org_id, employee_access_code, manager_access_code, updated_by)
    values (
      '00000000-0000-0000-0000-000000000001'::uuid,
      crypt(p_employee_code, gen_salt('bf')),
      crypt(p_manager_code, gen_salt('bf')),
      auth.uid()
    );
  end if;
end;
$$;

revoke all on function public.manager_update_access_codes(text, text) from public, anon;
grant execute on function public.manager_update_access_codes(text, text) to authenticated;
