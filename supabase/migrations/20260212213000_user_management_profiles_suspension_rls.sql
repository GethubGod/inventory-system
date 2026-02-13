-- Canonical profile identity + manager-only suspension controls for User Management.

alter table public.profiles
  add column if not exists email text,
  add column if not exists is_suspended boolean not null default false,
  add column if not exists suspended_at timestamp with time zone,
  add column if not exists suspended_by uuid,
  add column if not exists last_active_at timestamp with time zone,
  add column if not exists last_order_at timestamp with time zone;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_suspended_by_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_suspended_by_fkey
      foreign key (suspended_by)
      references public.users(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists profiles_role_suspension_activity_idx
  on public.profiles(role, is_suspended, last_order_at, last_active_at);

update public.profiles p
set email = coalesce(au.email, u.email, p.email)
from auth.users au
left join public.users u on u.id = au.id
where p.id = au.id
  and (p.email is null or btrim(p.email) = '');

update public.profiles
set suspended_at = coalesce(suspended_at, updated_at, created_at, now())
where coalesce(is_suspended, false) = true
  and suspended_at is null;

update public.profiles
set
  suspended_at = null,
  suspended_by = null
where coalesce(is_suspended, false) = false
  and (suspended_at is not null or suspended_by is not null);

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

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, provider, profile_completed)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      null
    ),
    coalesce(new.raw_app_meta_data->>'provider', 'email'),
    false
  )
  on conflict (id) do update
  set email = coalesce(excluded.email, public.profiles.email);

  return new;
end;
$$;

create or replace function public.sync_profile_email_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set
      email = new.email,
      updated_at = now()
    where id = new.id
      and email is distinct from new.email;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_updated_profile_email on auth.users;
create trigger on_auth_user_updated_profile_email
after update of email on auth.users
for each row execute function public.sync_profile_email_from_auth_user();

create or replace function public.enforce_profile_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_manager boolean := public.current_user_is_manager();
  v_old_without_suspend jsonb;
  v_new_without_suspend jsonb;
begin
  -- Service role/admin contexts are allowed.
  if auth.uid() is null then
    if new.is_suspended then
      new.suspended_at := coalesce(new.suspended_at, now());
      new.suspended_by := coalesce(new.suspended_by, old.suspended_by);
    else
      new.suspended_at := null;
      new.suspended_by := null;
    end if;

    return new;
  end if;

  -- Cross-user update: only non-suspended managers, and only for employee suspension fields.
  if auth.uid() <> old.id then
    if not v_is_manager then
      raise exception 'Not authorized to update this profile';
    end if;

    if old.role is distinct from 'employee' then
      raise exception 'Managers can only change suspension state for employees';
    end if;

    v_old_without_suspend :=
      to_jsonb(old) - array['is_suspended', 'suspended_at', 'suspended_by', 'updated_at'];
    v_new_without_suspend :=
      to_jsonb(new) - array['is_suspended', 'suspended_at', 'suspended_by', 'updated_at'];

    if v_old_without_suspend is distinct from v_new_without_suspend then
      raise exception 'Only suspension fields can be updated';
    end if;

    if new.is_suspended then
      new.suspended_at := now();
      new.suspended_by := auth.uid();
    else
      new.suspended_at := null;
      new.suspended_by := null;
    end if;

    return new;
  end if;

  -- Own profile updates cannot alter suspension state.
  if new.is_suspended is distinct from old.is_suspended
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_by is distinct from old.suspended_by then
    raise exception 'Cannot modify suspension state';
  end if;

  -- Own profile role is immutable after onboarding.
  if new.role is distinct from old.role
     and not (old.role is null and old.profile_completed = false) then
    raise exception 'Cannot modify role';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_profile_security on public.profiles;
create trigger enforce_profile_security
before update on public.profiles
for each row execute function public.enforce_profile_security();

alter table public.profiles enable row level security;

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

grant select, insert, update on public.profiles to authenticated;

revoke all on function public.current_user_is_manager() from public, anon;
grant execute on function public.current_user_is_manager() to authenticated, service_role;
