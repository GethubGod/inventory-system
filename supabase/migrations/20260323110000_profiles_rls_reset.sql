-- Reset RLS on profiles table to fix 42501 errors.
-- This migration:
--   1. Disables FORCE ROW LEVEL SECURITY (which makes RLS apply even to table owners / SECURITY DEFINER)
--   2. Drops ALL existing policies (including any added via dashboard)
--   3. Recreates the correct policies
--   4. Reloads PostgREST schema cache

-- 1. Disable force RLS so SECURITY DEFINER functions (owned by postgres) bypass RLS.
alter table public.profiles no force row level security;

-- Also ensure RLS is enabled (standard mode, not forced).
alter table public.profiles enable row level security;

-- 2. Drop ALL existing policies on profiles (catch any dashboard-created ones).
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
  end loop;
end;
$$;

-- 3. Recreate the correct policies.
create policy "profiles_select_own_or_manager"
on public.profiles
for select
to authenticated
using (
  auth.uid() = id
  or public.current_user_is_manager()
);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

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

-- 4. Also reset RLS on users table in case it has the same issue.
alter table public.users no force row level security;
alter table public.users enable row level security;

-- 5. Reload PostgREST schema cache so it picks up the policy changes.
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
