-- Remove org_id from profiles table.
-- There are currently no organizations, and this NOT NULL column blocks
-- sign-in/sign-up flows (RLS + constraint violations on INSERT).

-- 1. Drop the org-scoped RLS policy and the column itself.
drop policy if exists "profiles_org_scope_enforced" on public.profiles;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'org_id'
  ) then
    alter table public.profiles drop column org_id;
  end if;
end;
$$;

-- 2. Recreate trigger function without org_id references.
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
    role = excluded.role,
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
    role = coalesce(excluded.role, public.profiles.role),
    provider = coalesce(public.profiles.provider, excluded.provider),
    profile_completed = public.profiles.profile_completed or excluded.profile_completed,
    updated_at = now();

  return new;
end;
$$;

-- 3. Recreate identity repair RPC without org_id references.
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
    role = excluded.role,
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
    role = coalesce(excluded.role, public.profiles.role),
    provider = coalesce(public.profiles.provider, excluded.provider),
    profile_completed = public.profiles.profile_completed or excluded.profile_completed,
    updated_at = now();
end;
$$;

-- 4. Ensure triggers are wired up.
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_updated_identity on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.sync_auth_user_identity();

create trigger on_auth_user_updated_identity
after update of email, raw_user_meta_data, raw_app_meta_data on auth.users
for each row execute function public.sync_auth_user_identity();

-- 5. Ensure RPC permissions.
revoke all on function public.upsert_identity_from_auth_user(uuid) from public, anon, authenticated;
grant execute on function public.upsert_identity_from_auth_user(uuid) to service_role;

revoke all on function public.ensure_current_user_identity() from public, anon;
grant execute on function public.ensure_current_user_identity() to authenticated, service_role;

-- 6. Re-grant profile table permissions (in case policies reference dropped column).
drop policy if exists "profiles_select_own_or_manager" on public.profiles;
create policy "profiles_select_own_or_manager"
on public.profiles
for select
to authenticated
using (
  auth.uid() = id
  or public.current_user_is_manager()
);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "profiles_update_manager_suspend_employee" on public.profiles;
create policy "profiles_update_manager_suspend_employee"
on public.profiles
for update
to authenticated
using (
  public.current_user_is_manager()
  and id <> auth.uid()
  and role = 'employee'
)
with check (
  public.current_user_is_manager()
  and id <> auth.uid()
  and role = 'employee'
);
