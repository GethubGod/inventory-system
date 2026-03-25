-- Purge every RLS policy that still references the dropped org_memberships
-- or organizations tables.  The previous migration (20260324110000) dropped
-- those tables with CASCADE, which removed FK constraints but left behind
-- Dashboard-created RLS policies whose USING/WITH CHECK clauses contain
-- subqueries against the now-missing tables.
--
-- This migration:
--   1. Dynamically finds and drops every broken policy on every table
--   2. Recreates clean policies for Dashboard-created tables (suppliers, locations)
--   3. Reloads PostgREST schema cache

-- ============================================================
-- 1. Drop ALL policies that reference org_memberships or organizations
-- ============================================================
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where qual::text         ilike '%org_memberships%'
       or with_check::text   ilike '%org_memberships%'
       or qual::text         ilike '%organizations%'
       or with_check::text   ilike '%organizations%'
  loop
    raise notice 'Dropping broken policy %.%.%', pol.schemaname, pol.tablename, pol.policyname;
    execute format(
      'drop policy if exists %I on %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
  end loop;
end;
$$;

-- ============================================================
-- 2. Reset RLS on suppliers (Dashboard-created table, no migration)
-- ============================================================
do $$
declare
  pol record;
begin
  if to_regclass('public.suppliers') is not null then
    execute 'alter table public.suppliers enable row level security';
    execute 'alter table public.suppliers no force row level security';

    -- Drop any remaining policies (not just the broken ones)
    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'suppliers'
    loop
      execute format('drop policy if exists %I on public.suppliers', pol.policyname);
    end loop;

    -- All authenticated users can read suppliers.
    execute '
      create policy "suppliers_select_authenticated"
      on public.suppliers
      for select to authenticated
      using (true)
    ';

    -- Only managers can modify suppliers.
    execute '
      create policy "suppliers_modify_manager"
      on public.suppliers
      for all to authenticated
      using (public.current_user_is_manager())
      with check (public.current_user_is_manager())
    ';

    execute 'grant select, insert, update, delete on public.suppliers to authenticated';
  end if;
end;
$$;

-- ============================================================
-- 3. Reset RLS on locations (Dashboard-created table, no migration)
-- ============================================================
do $$
declare
  pol record;
begin
  if to_regclass('public.locations') is not null then
    execute 'alter table public.locations enable row level security';
    execute 'alter table public.locations no force row level security';

    -- Drop any remaining policies
    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'locations'
    loop
      execute format('drop policy if exists %I on public.locations', pol.policyname);
    end loop;

    -- All authenticated users can read locations.
    execute '
      create policy "locations_select_authenticated"
      on public.locations
      for select to authenticated
      using (true)
    ';

    -- Only managers can modify locations.
    execute '
      create policy "locations_modify_manager"
      on public.locations
      for all to authenticated
      using (public.current_user_is_manager())
      with check (public.current_user_is_manager())
    ';

    execute 'grant select, insert, update, delete on public.locations to authenticated';
  end if;
end;
$$;

-- ============================================================
-- 4. Safety net: check ALL tables for any remaining policyless state
--    If a table has RLS enabled but zero policies, authenticated users
--    get zero rows.  For any such table, add a blanket select policy.
-- ============================================================
do $$
declare
  tbl record;
  policy_count integer;
begin
  for tbl in
    select t.schemaname, t.tablename
    from pg_tables t
    join pg_class c on c.relname = t.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
    where t.schemaname = 'public'
      and t.tablename not in ('schema_migrations')
      and c.relrowsecurity = true
  loop
    select count(*) into policy_count
    from pg_policies p
    where p.schemaname = tbl.schemaname
      and p.tablename = tbl.tablename;

    if policy_count = 0 then
      raise notice 'Table %.% has RLS enabled but zero policies — adding fallback select policy',
        tbl.schemaname, tbl.tablename;
      execute format(
        'create policy "fallback_select_authenticated" on %I.%I for select to authenticated using (true)',
        tbl.schemaname, tbl.tablename
      );
      execute format(
        'grant select on %I.%I to authenticated',
        tbl.schemaname, tbl.tablename
      );
    end if;
  end loop;
end;
$$;

-- ============================================================
-- 5. Reload PostgREST schema cache
-- ============================================================
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
