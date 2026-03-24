-- Keep auth.users, public.users, and public.profiles in sync for every environment.
-- This removes the client-side dependency on an immediate authenticated session after sign up.

create or replace function public.sync_auth_user_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := new.email;
  v_full_name text := nullif(
    btrim(
      coalesce(
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'name',
        split_part(coalesce(new.email, ''), '@', 1)
      )
    ),
    ''
  );
  v_role_text text := case
    when coalesce(new.raw_user_meta_data->>'role', new.raw_app_meta_data->>'role') in ('employee', 'manager')
      then coalesce(new.raw_user_meta_data->>'role', new.raw_app_meta_data->>'role')
    else null
  end;
  v_provider text := case
    when coalesce(new.raw_app_meta_data->>'provider', new.raw_user_meta_data->>'provider') in ('google', 'apple', 'email')
      then coalesce(new.raw_app_meta_data->>'provider', new.raw_user_meta_data->>'provider')
    else 'email'
  end;
  v_default_location_id uuid := case
    when coalesce(new.raw_user_meta_data->>'default_location_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (new.raw_user_meta_data->>'default_location_id')::uuid
    else null
  end;
  v_profile_completed boolean := v_full_name is not null and v_role_text is not null;
  v_org_id uuid;
begin
  -- Resolve org_id: existing profile → org_memberships → organizations → null
  select p.org_id into v_org_id from public.profiles p where p.id = new.id;
  if v_org_id is null then
    begin
      select om.org_id into v_org_id from public.org_memberships om where om.user_id = new.id limit 1;
    exception when undefined_table then null;
    end;
  end if;
  if v_org_id is null then
    begin
      select o.id into v_org_id from public.organizations o limit 1;
    exception when undefined_table then null;
    end;
  end if;

  insert into public.users (
    id,
    email,
    name,
    role,
    default_location_id
  )
  values (
    new.id,
    coalesce(v_email, ''),
    coalesce(v_full_name, 'User'),
    coalesce(v_role_text, 'employee')::public.user_role,
    v_default_location_id
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = excluded.name,
    role = excluded.role,
    default_location_id = coalesce(excluded.default_location_id, public.users.default_location_id);

  insert into public.profiles (
    id,
    org_id,
    email,
    full_name,
    role,
    provider,
    profile_completed
  )
  values (
    new.id,
    v_org_id,
    v_email,
    v_full_name,
    v_role_text,
    v_provider,
    v_profile_completed
  )
  on conflict (id) do update
  set
    org_id = coalesce(public.profiles.org_id, excluded.org_id),
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = coalesce(excluded.role, public.profiles.role),
    provider = coalesce(public.profiles.provider, excluded.provider),
    profile_completed = public.profiles.profile_completed or excluded.profile_completed,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
drop trigger if exists on_auth_user_updated_profile_email on auth.users;
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_updated_identity on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.sync_auth_user_identity();

create trigger on_auth_user_updated_identity
after update of email, raw_user_meta_data, raw_app_meta_data on auth.users
for each row execute function public.sync_auth_user_identity();

with auth_identity as (
  select
    au.id,
    au.email,
    nullif(
      btrim(
        coalesce(
          au.raw_user_meta_data->>'full_name',
          au.raw_user_meta_data->>'name',
          split_part(coalesce(au.email, ''), '@', 1)
        )
      ),
      ''
    ) as full_name,
    case
      when coalesce(au.raw_user_meta_data->>'role', au.raw_app_meta_data->>'role') in ('employee', 'manager')
        then coalesce(au.raw_user_meta_data->>'role', au.raw_app_meta_data->>'role')
      else null
    end as role_text,
    case
      when coalesce(au.raw_app_meta_data->>'provider', au.raw_user_meta_data->>'provider') in ('google', 'apple', 'email')
        then coalesce(au.raw_app_meta_data->>'provider', au.raw_user_meta_data->>'provider')
      else 'email'
    end as provider,
    case
      when coalesce(au.raw_user_meta_data->>'default_location_id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (au.raw_user_meta_data->>'default_location_id')::uuid
      else null
    end as default_location_id
  from auth.users au
)
insert into public.users (
  id,
  email,
  name,
  role,
  default_location_id
)
select
  ai.id,
  coalesce(ai.email, pu.email, ''),
  coalesce(ai.full_name, pu.name, 'User'),
  coalesce(
    case
      when ai.role_text in ('employee', 'manager') then ai.role_text::public.user_role
      else null
    end,
    pu.role,
    'employee'::public.user_role
  ),
  coalesce(ai.default_location_id, pu.default_location_id)
from auth_identity ai
left join public.users pu on pu.id = ai.id
on conflict (id) do update
set
  email = excluded.email,
  name = excluded.name,
  role = excluded.role,
  default_location_id = coalesce(excluded.default_location_id, public.users.default_location_id);

with auth_identity as (
  select
    au.id,
    au.email,
    nullif(
      btrim(
        coalesce(
          au.raw_user_meta_data->>'full_name',
          au.raw_user_meta_data->>'name',
          split_part(coalesce(au.email, ''), '@', 1)
        )
      ),
      ''
    ) as full_name,
    case
      when coalesce(au.raw_user_meta_data->>'role', au.raw_app_meta_data->>'role') in ('employee', 'manager')
        then coalesce(au.raw_user_meta_data->>'role', au.raw_app_meta_data->>'role')
      else null
    end as role_text,
    case
      when coalesce(au.raw_app_meta_data->>'provider', au.raw_user_meta_data->>'provider') in ('google', 'apple', 'email')
        then coalesce(au.raw_app_meta_data->>'provider', au.raw_user_meta_data->>'provider')
      else 'email'
    end as provider
  from auth.users au
)
insert into public.profiles (
  id,
  org_id,
  email,
  full_name,
  role,
  provider,
  profile_completed,
  is_suspended,
  suspended_at,
  suspended_by,
  last_active_at,
  last_order_at
)
select
  ai.id,
  p.org_id,
  coalesce(ai.email, p.email),
  coalesce(ai.full_name, p.full_name),
  coalesce(ai.role_text, p.role),
  coalesce(p.provider, ai.provider),
  coalesce(p.profile_completed, false) or (ai.full_name is not null and ai.role_text is not null),
  coalesce(p.is_suspended, false),
  p.suspended_at,
  p.suspended_by,
  coalesce(p.last_active_at, p.created_at, now()),
  p.last_order_at
from auth_identity ai
left join public.profiles p on p.id = ai.id
where p.id is not null
on conflict (id) do update
set
  org_id = coalesce(public.profiles.org_id, excluded.org_id),
  email = coalesce(excluded.email, public.profiles.email),
  full_name = coalesce(excluded.full_name, public.profiles.full_name),
  role = coalesce(excluded.role, public.profiles.role),
  provider = coalesce(public.profiles.provider, excluded.provider),
  profile_completed = public.profiles.profile_completed or excluded.profile_completed,
  updated_at = now();
