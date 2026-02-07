-- Fix both triggers: correct column name and restore proper error behavior

-- handle_new_user: insert into public.users on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'employee'::public.user_role
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(excluded.name, public.users.name);

  return new;
end;
$$;

-- handle_new_auth_user_profile: insert into public.profiles on signup
-- Fix: use raw_app_meta_data (not app_metadata)
create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, provider, profile_completed)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      null
    ),
    coalesce(new.raw_app_meta_data->>'provider', 'email'),
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Clean up debug artifacts
drop table if exists public._trigger_debug_log cascade;
drop function if exists public.debug_auth_triggers();
drop function if exists public.debug_users_constraints();
drop function if exists public.debug_role_type();
drop function if exists public.debug_all_auth_triggers();
