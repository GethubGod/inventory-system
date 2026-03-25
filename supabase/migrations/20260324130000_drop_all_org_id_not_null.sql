-- Fix NOT NULL constraint on org_id columns that were added via the Supabase
-- Dashboard (not in any migration file).  The previous migration made
-- orders.org_id and order_items.org_id nullable, but missed Dashboard-added
-- org_id columns on other tables like past_orders, suppliers, unmapped_menu_items.
--
-- This migration finds EVERY table with an org_id column and either:
--   • Drops the column entirely with CASCADE (for Dashboard-added columns)
--   • Makes it nullable (for orders / order_items which are in the core schema)
--   • Skips config tables (org_settings, reminder_system_settings)
-- After dropping, it ensures every affected table still has working RLS policies.

do $$
declare
  tbl record;
  pol record;
begin
  for tbl in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'org_id'
    order by c.table_name
  loop
    raise notice 'Found org_id on table: %', tbl.table_name;

    -- orders / order_items: keep column, ensure nullable
    if tbl.table_name in ('orders', 'order_items') then
      begin
        execute format(
          'alter table public.%I alter column org_id drop not null',
          tbl.table_name
        );
        raise notice '  → made org_id nullable on %', tbl.table_name;
      exception when others then
        raise notice '  → already nullable on %', tbl.table_name;
      end;

    -- Config tables: leave alone
    elsif tbl.table_name in ('org_settings', 'reminder_system_settings') then
      raise notice '  → skipped % (config table)', tbl.table_name;

    -- Everything else: drop org_id CASCADE (takes out dependent policies)
    else
      execute format(
        'alter table public.%I drop column if exists org_id cascade',
        tbl.table_name
      );
      raise notice '  → dropped org_id (cascade) from %', tbl.table_name;

      -- After cascade drop, the table may have zero policies.
      -- Re-check and add fallback if needed.
      if not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = tbl.table_name
      ) then
        -- Check if RLS is enabled on this table
        if exists (
          select 1 from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = tbl.table_name
            and c.relrowsecurity = true
        ) then
          raise notice '  → adding fallback select policy on %', tbl.table_name;
          execute format(
            'create policy "fallback_select_authenticated" on public.%I for select to authenticated using (true)',
            tbl.table_name
          );
          execute format(
            'create policy "fallback_modify_manager" on public.%I for all to authenticated using (public.current_user_is_manager()) with check (public.current_user_is_manager())',
            tbl.table_name
          );
          execute format(
            'grant select, insert, update, delete on public.%I to authenticated',
            tbl.table_name
          );
        end if;
      end if;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
