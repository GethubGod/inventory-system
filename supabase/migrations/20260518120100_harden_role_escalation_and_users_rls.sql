-- Prevent role escalation via auth metadata and harden public.users access.
--   • sync_auth_user_identity / upsert_identity_from_auth_user: role set only on INSERT
--   • current_user_is_manager reads profiles.role (canonical)
--   • enforce_user_security blocks authenticated role changes
--   • explicit users RLS policies

-- ============================================================
-- 1. current_user_is_manager — canonical profiles.role
-- ============================================================
create or replace function public.current_user_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'manager'
      and coalesce(p.is_suspended, false) = false
  );
$$;

revoke all on function public.current_user_is_manager() from public, anon;
grant execute on function public.current_user_is_manager() to authenticated, service_role;

-- ============================================================
-- 2. upsert_identity_from_auth_user — immutable role on conflict
-- ============================================================
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
    id, email, name, role, default_location_id
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
    default_location_id = coalesce(excluded.default_location_id, public.users.default_location_id);

  insert into public.profiles (
    id, email, full_name, role, provider, profile_completed
  )
  values (
    v_auth_user.id, v_email, v_full_name, v_role_text, v_provider, v_profile_completed
  )
  on conflict (id) do update
  set
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    provider = coalesce(public.profiles.provider, excluded.provider),
    profile_completed = public.profiles.profile_completed or excluded.profile_completed,
    updated_at = now();
end;
$$;

revoke all on function public.upsert_identity_from_auth_user(uuid) from public, anon, authenticated;
grant execute on function public.upsert_identity_from_auth_user(uuid) to service_role;

-- ============================================================
-- 3. sync_auth_user_identity — immutable role on conflict
-- ============================================================
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
begin
  insert into public.users (
    id, email, name, role, default_location_id
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
    default_location_id = coalesce(excluded.default_location_id, public.users.default_location_id);

  insert into public.profiles (
    id, email, full_name, role, provider, profile_completed
  )
  values (
    new.id, v_email, v_full_name, v_role_text, v_provider, v_profile_completed
  )
  on conflict (id) do update
  set
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    provider = coalesce(public.profiles.provider, excluded.provider),
    profile_completed = public.profiles.profile_completed or excluded.profile_completed,
    updated_at = now();

  return new;
end;
$$;

-- ============================================================
-- 4. enforce_user_security — block authenticated role changes
-- ============================================================
create or replace function public.enforce_user_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / trigger contexts without a JWT may change role.
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Cannot modify role';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_user_security on public.users;
create trigger enforce_user_security
before update on public.users
for each row execute function public.enforce_user_security();

-- ============================================================
-- 5. public.users RLS policies
-- ============================================================
alter table public.users no force row level security;
alter table public.users enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'users'
  loop
    execute format('drop policy if exists %I on public.users', pol.policyname);
  end loop;
end;
$$;

create policy "users_select_own_or_manager"
on public.users
for select
to authenticated
using (
  auth.uid() = id
  or public.current_user_is_manager()
);

create policy "users_update_own"
on public.users
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

grant select, update on public.users to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
