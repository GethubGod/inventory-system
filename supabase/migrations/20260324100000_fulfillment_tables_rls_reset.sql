-- Reset RLS on ALL tables without org_id to remove dashboard-created org-scoped
-- policies (e.g. "past_orders_org_scope_enforced").
--
-- These tables do not have an org_id column, so org-scoped policies always
-- reject inserts/updates/selects.  This is the same class of bug fixed for
-- profiles (20260323110000) and inventory_items (20260323140000).
--
-- This migration:
--   1. Ensures RLS is enabled in standard mode (not forced)
--   2. Drops ALL existing policies (including any dashboard-created ones)
--   3. Recreates simple role-based policies matching the original design
--   4. Grants table permissions
--   5. Reloads PostgREST schema cache

-- ============================================================
-- past_orders
-- ============================================================
alter table public.past_orders enable row level security;
alter table public.past_orders no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'past_orders'
  loop
    execute format('drop policy if exists %I on public.past_orders', pol.policyname);
  end loop;
end;
$$;

create policy "past_orders_select_manager_or_owner"
on public.past_orders
for select
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

create policy "past_orders_insert_manager_or_owner"
on public.past_orders
for insert
to authenticated
with check (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

create policy "past_orders_update_manager_or_owner"
on public.past_orders
for update
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
)
with check (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

create policy "past_orders_delete_manager_or_owner"
on public.past_orders
for delete
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

grant select, insert, update, delete on public.past_orders to authenticated;

-- ============================================================
-- past_order_items
-- ============================================================
alter table public.past_order_items enable row level security;
alter table public.past_order_items no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'past_order_items'
  loop
    execute format('drop policy if exists %I on public.past_order_items', pol.policyname);
  end loop;
end;
$$;

create policy "past_order_items_select_manager_or_owner"
on public.past_order_items
for select
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

create policy "past_order_items_insert_manager_or_owner"
on public.past_order_items
for insert
to authenticated
with check (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

create policy "past_order_items_update_manager_or_owner"
on public.past_order_items
for update
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
)
with check (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

create policy "past_order_items_delete_manager_or_owner"
on public.past_order_items
for delete
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

grant select, insert, update, delete on public.past_order_items to authenticated;

-- ============================================================
-- order_later_items
-- ============================================================
alter table public.order_later_items enable row level security;
alter table public.order_later_items no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'order_later_items'
  loop
    execute format('drop policy if exists %I on public.order_later_items', pol.policyname);
  end loop;
end;
$$;

create policy "order_later_items_select_manager_or_owner"
on public.order_later_items
for select
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

create policy "order_later_items_insert_manager_or_owner"
on public.order_later_items
for insert
to authenticated
with check (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

create policy "order_later_items_update_manager_or_owner"
on public.order_later_items
for update
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
)
with check (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

create policy "order_later_items_delete_manager_or_owner"
on public.order_later_items
for delete
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  )
);

grant select, insert, update, delete on public.order_later_items to authenticated;

-- ============================================================
-- reminders
-- ============================================================
alter table public.reminders enable row level security;
alter table public.reminders no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'reminders'
  loop
    execute format('drop policy if exists %I on public.reminders', pol.policyname);
  end loop;
end;
$$;

create policy "reminders_select_manager_or_employee"
on public.reminders
for select
to authenticated
using (
  public.current_user_is_manager()
  or auth.uid() = employee_id
);

create policy "reminders_insert_manager_only"
on public.reminders
for insert
to authenticated
with check (public.current_user_is_manager());

create policy "reminders_update_manager_only"
on public.reminders
for update
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

grant select, insert, update on public.reminders to authenticated;

-- ============================================================
-- reminder_events
-- ============================================================
alter table public.reminder_events enable row level security;
alter table public.reminder_events no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'reminder_events'
  loop
    execute format('drop policy if exists %I on public.reminder_events', pol.policyname);
  end loop;
end;
$$;

create policy "reminder_events_select_manager_or_employee"
on public.reminder_events
for select
to authenticated
using (
  public.current_user_is_manager()
  or exists (
    select 1
    from public.reminders r
    where r.id = reminder_id
      and r.employee_id = auth.uid()
  )
);

create policy "reminder_events_insert_manager_only"
on public.reminder_events
for insert
to authenticated
with check (public.current_user_is_manager());

grant select, insert on public.reminder_events to authenticated;

-- ============================================================
-- recurring_reminder_rules
-- ============================================================
alter table public.recurring_reminder_rules enable row level security;
alter table public.recurring_reminder_rules no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'recurring_reminder_rules'
  loop
    execute format('drop policy if exists %I on public.recurring_reminder_rules', pol.policyname);
  end loop;
end;
$$;

create policy "recurring_rules_manager_select"
on public.recurring_reminder_rules
for select
to authenticated
using (public.current_user_is_manager());

create policy "recurring_rules_manager_insert"
on public.recurring_reminder_rules
for insert
to authenticated
with check (public.current_user_is_manager());

create policy "recurring_rules_manager_update"
on public.recurring_reminder_rules
for update
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

create policy "recurring_rules_manager_delete"
on public.recurring_reminder_rules
for delete
to authenticated
using (public.current_user_is_manager());

grant select, insert, update, delete on public.recurring_reminder_rules to authenticated;

-- ============================================================
-- notifications
-- ============================================================
alter table public.notifications enable row level security;
alter table public.notifications no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
  loop
    execute format('drop policy if exists %I on public.notifications', pol.policyname);
  end loop;
end;
$$;

create policy "notifications_select_manager_or_owner"
on public.notifications
for select
to authenticated
using (
  public.current_user_is_manager()
  or auth.uid() = user_id
);

create policy "notifications_insert_manager_or_owner"
on public.notifications
for insert
to authenticated
with check (
  public.current_user_is_manager()
  or auth.uid() = user_id
);

create policy "notifications_update_owner_or_manager"
on public.notifications
for update
to authenticated
using (
  auth.uid() = user_id
  or public.current_user_is_manager()
)
with check (
  auth.uid() = user_id
  or public.current_user_is_manager()
);

grant select, insert, update on public.notifications to authenticated;

-- ============================================================
-- device_push_tokens
-- ============================================================
alter table public.device_push_tokens enable row level security;
alter table public.device_push_tokens no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'device_push_tokens'
  loop
    execute format('drop policy if exists %I on public.device_push_tokens', pol.policyname);
  end loop;
end;
$$;

create policy "device_push_tokens_select_own_or_manager"
on public.device_push_tokens
for select
to authenticated
using (
  auth.uid() = user_id
  or public.current_user_is_manager()
);

create policy "device_push_tokens_insert_own"
on public.device_push_tokens
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "device_push_tokens_update_own"
on public.device_push_tokens
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "device_push_tokens_delete_own"
on public.device_push_tokens
for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update, delete on public.device_push_tokens to authenticated;

-- ============================================================
-- suggested_orders
-- ============================================================
do $$
declare
  pol record;
begin
  if to_regclass('public.suggested_orders') is not null then
    execute 'alter table public.suggested_orders enable row level security';
    execute 'alter table public.suggested_orders no force row level security';

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'suggested_orders'
    loop
      execute format('drop policy if exists %I on public.suggested_orders', pol.policyname);
    end loop;

    execute '
      create policy "suggested_orders_select_authenticated"
      on public.suggested_orders
      for select
      to authenticated
      using (true)
    ';

    execute 'grant select on public.suggested_orders to authenticated';
  end if;
end;
$$;

-- ============================================================
-- storage_areas, area_items, stock_updates, stock_check_sessions
-- (originally hardened in 20260314110000, may have dashboard policies)
-- ============================================================
do $$
declare
  tbl text;
  pol record;
begin
  foreach tbl in array array['storage_areas', 'area_items', 'stock_updates', 'stock_check_sessions'] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('alter table public.%I no force row level security', tbl);

      for pol in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = tbl
      loop
        execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
      end loop;

      execute format('
        create policy %I on public.%I
        for all to authenticated
        using (public.current_user_is_manager())
        with check (public.current_user_is_manager())
      ', tbl || '_manager_all', tbl);

      execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
    end if;
  end loop;
end;
$$;

-- ============================================================
-- unit_conversions (read-only for authenticated)
-- ============================================================
do $$
declare
  pol record;
begin
  if to_regclass('public.unit_conversions') is not null then
    alter table public.unit_conversions enable row level security;
    alter table public.unit_conversions no force row level security;

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'unit_conversions'
    loop
      execute format('drop policy if exists %I on public.unit_conversions', pol.policyname);
    end loop;

    execute '
      create policy "unit_conversions_select_authenticated"
      on public.unit_conversions
      for select
      to authenticated
      using (true)
    ';

    revoke insert, update, delete on public.unit_conversions from authenticated;
    grant select on public.unit_conversions to authenticated;
  end if;
end;
$$;

-- ============================================================
-- reminder_system_settings (has org_id, but reset for safety)
-- ============================================================
alter table public.reminder_system_settings enable row level security;
alter table public.reminder_system_settings no force row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'reminder_system_settings'
  loop
    execute format('drop policy if exists %I on public.reminder_system_settings', pol.policyname);
  end loop;
end;
$$;

create policy "reminder_system_settings_manager_read"
on public.reminder_system_settings
for select
to authenticated
using (public.current_user_is_manager());

create policy "reminder_system_settings_manager_update"
on public.reminder_system_settings
for update
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

grant select, update on public.reminder_system_settings to authenticated;

-- ============================================================
-- Reload PostgREST schema cache
-- ============================================================
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
