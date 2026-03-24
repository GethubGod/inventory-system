-- Server-side identity repair for authenticated users.
-- This allows the mobile client to recover when public.users is missing
-- without violating RLS from the client.

create or replace function public.upsert_identity_from_auth_user(p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user auth.users%rowtype;
  v_email text;
  v_full_name text;
  v_role_text text;
  v_provider text;
  v_default_location_id uuid;
  v_profile_completed boolean;
  v_org_id uuid;
begin
  if p_auth_user_id is null then
    raise exception 'Auth user id is required';
  end if;

  select *
  into v_auth_user
  from auth.users
  where id = p_auth_user_id;

  if not found then
    raise exception 'Auth user not found';
  end if;

  -- Resolve org_id: existing profile → org_memberships → organizations → null
  select p.org_id into v_org_id from public.profiles p where p.id = p_auth_user_id;
  if v_org_id is null then
    begin
      select om.org_id into v_org_id from public.org_memberships om where om.user_id = p_auth_user_id limit 1;
    exception when undefined_table then null;
    end;
  end if;
  if v_org_id is null then
    begin
      select o.id into v_org_id from public.organizations o limit 1;
    exception when undefined_table then null;
    end;
  end if;

  v_email := v_auth_user.email;
  v_full_name := nullif(
    btrim(
      coalesce(
        v_auth_user.raw_user_meta_data->>'full_name',
        v_auth_user.raw_user_meta_data->>'name',
        split_part(coalesce(v_auth_user.email, ''), '@', 1)
      )
    ),
    ''
  );
  v_role_text := case
    when coalesce(v_auth_user.raw_user_meta_data->>'role', v_auth_user.raw_app_meta_data->>'role')
      in ('employee', 'manager')
      then coalesce(v_auth_user.raw_user_meta_data->>'role', v_auth_user.raw_app_meta_data->>'role')
    else null
  end;
  v_provider := case
    when coalesce(v_auth_user.raw_app_meta_data->>'provider', v_auth_user.raw_user_meta_data->>'provider')
      in ('google', 'apple', 'email')
      then coalesce(v_auth_user.raw_app_meta_data->>'provider', v_auth_user.raw_user_meta_data->>'provider')
    else 'email'
  end;
  v_default_location_id := case
    when coalesce(v_auth_user.raw_user_meta_data->>'default_location_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_auth_user.raw_user_meta_data->>'default_location_id')::uuid
    else null
  end;
  v_profile_completed := v_full_name is not null and v_role_text is not null;

  insert into public.users (
    id,
    email,
    name,
    role,
    default_location_id
  )
  values (
    v_auth_user.id,
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
    v_auth_user.id,
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
end;
$$;

create or replace function public.sync_auth_user_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.upsert_identity_from_auth_user(new.id);
  return new;
end;
$$;

create or replace function public.ensure_current_user_identity()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  perform public.upsert_identity_from_auth_user(auth.uid());
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_updated_identity on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.sync_auth_user_identity();

create trigger on_auth_user_updated_identity
after update of email, raw_user_meta_data, raw_app_meta_data on auth.users
for each row execute function public.sync_auth_user_identity();

revoke all on function public.upsert_identity_from_auth_user(uuid) from public, anon, authenticated;
grant execute on function public.upsert_identity_from_auth_user(uuid) to service_role;

revoke all on function public.ensure_current_user_identity() from public, anon;
grant execute on function public.ensure_current_user_identity() to authenticated, service_role;
