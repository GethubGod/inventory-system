-- Reset RLS on inventory_items to remove org_memberships requirement.
-- Mobile users do not have org_memberships rows, so the dashboard-created
-- org-scoped policies return empty results for every authenticated user.
--
-- This migration:
--   1. Ensures RLS is enabled (standard mode, not forced)
--   2. Drops ALL existing policies (including any dashboard-created org-scoped ones)
--   3. Creates simple role-based policies:
--        - SELECT: all authenticated users (employees browse & order)
--        - INSERT/UPDATE: managers only (add/edit items)
--   4. Grants table permissions
--   5. Reloads PostgREST schema cache

-- 1. Ensure RLS is enabled in standard mode.
alter table public.inventory_items enable row level security;
alter table public.inventory_items no force row level security;

-- 2. Drop ALL existing policies (catch any dashboard-created org-scoped ones).
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'inventory_items'
  loop
    execute format('drop policy if exists %I on public.inventory_items', pol.policyname);
  end loop;
end;
$$;

-- 3. Create role-based policies.

-- All authenticated users can read inventory items.
create policy "inventory_items_select_authenticated"
on public.inventory_items
for select
to authenticated
using (true);

-- Only managers can insert new items.
create policy "inventory_items_insert_manager"
on public.inventory_items
for insert
to authenticated
with check (public.current_user_is_manager());

-- Only managers can update items (includes soft-delete via active = false).
create policy "inventory_items_update_manager"
on public.inventory_items
for update
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

-- 4. Grant table permissions to authenticated role.
grant select on public.inventory_items to authenticated;
grant insert, update on public.inventory_items to authenticated;

-- 5. Reload PostgREST schema cache.
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
