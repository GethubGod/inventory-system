-- Employee reminder tracking, recurring rules, and notification delivery infrastructure

create extension if not exists "pgcrypto";

alter table public.profiles
  add column if not exists notifications_enabled boolean not null default true;

create or replace function public.current_user_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'manager'
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.reminder_system_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique default '00000000-0000-0000-0000-000000000001'::uuid,
  overdue_threshold_days integer not null default 7,
  reminder_rate_limit_minutes integer not null default 15,
  recurring_window_minutes integer not null default 15,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (overdue_threshold_days between 1 and 60),
  check (reminder_rate_limit_minutes between 1 and 240),
  check (recurring_window_minutes between 1 and 120)
);

insert into public.reminder_system_settings (org_id)
values ('00000000-0000-0000-0000-000000000001'::uuid)
on conflict (org_id) do nothing;

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.users(id) on delete cascade,
  manager_id uuid references public.users(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'resolved', 'cancelled')),
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  last_reminded_at timestamp with time zone not null default now(),
  reminder_count integer not null default 1 check (reminder_count >= 1)
);

create table if not exists public.reminder_events (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  event_type text not null default 'sent' check (event_type in ('sent', 'reminded_again', 'auto_resolved', 'cancelled')),
  sent_at timestamp with time zone not null default now(),
  channels_attempted jsonb not null default '[]'::jsonb,
  delivery_result jsonb not null default '{}'::jsonb
);

create table if not exists public.recurring_reminder_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('employee', 'location')),
  employee_id uuid references public.users(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  days_of_week integer[] not null,
  time_of_day time not null,
  timezone text not null default 'America/Los_Angeles',
  condition_type text not null check (condition_type in ('no_order_today', 'days_since_last_order_gte')),
  condition_value integer,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  channels jsonb not null default '{"push": true, "in_app": true}'::jsonb,
  enabled boolean not null default true,
  created_by uuid not null references public.users(id) on delete cascade,
  last_triggered_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (
    (scope = 'employee' and employee_id is not null and location_id is null)
    or
    (scope = 'location' and location_id is not null and employee_id is null)
  ),
  check (array_length(days_of_week, 1) is not null),
  check (days_of_week <@ array[0,1,2,3,4,5,6]),
  check (
    (condition_type = 'days_since_last_order_gte' and condition_value is not null and condition_value >= 0)
    or
    (condition_type = 'no_order_today' and condition_value is null)
  )
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  body text not null,
  notification_type text not null default 'general',
  payload jsonb not null default '{}'::jsonb,
  read_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null default 'unknown' check (platform in ('ios', 'android', 'web', 'unknown')),
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (user_id, expo_push_token)
);

create index if not exists reminders_employee_status_idx
  on public.reminders(employee_id, status, created_at desc);

create index if not exists reminders_location_status_idx
  on public.reminders(location_id, status, created_at desc);

create unique index if not exists reminders_one_active_per_employee_location_idx
  on public.reminders(employee_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';

create index if not exists reminder_events_reminder_sent_idx
  on public.reminder_events(reminder_id, sent_at desc);

create index if not exists recurring_rules_enabled_idx
  on public.recurring_reminder_rules(enabled, scope, time_of_day);

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, read_at, created_at desc);

create index if not exists device_push_tokens_user_active_idx
  on public.device_push_tokens(user_id, active, updated_at desc);

drop trigger if exists set_reminder_system_settings_updated_at on public.reminder_system_settings;
create trigger set_reminder_system_settings_updated_at
before update on public.reminder_system_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_recurring_reminder_rules_updated_at on public.recurring_reminder_rules;
create trigger set_recurring_reminder_rules_updated_at
before update on public.recurring_reminder_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_device_push_tokens_updated_at on public.device_push_tokens;
create trigger set_device_push_tokens_updated_at
before update on public.device_push_tokens
for each row execute function public.set_updated_at();

create or replace function public.resolve_active_reminders_for_employee(
  p_employee_id uuid,
  p_order_created_at timestamp with time zone default now(),
  p_order_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resolved_count integer := 0;
begin
  with resolved as (
    update public.reminders r
    set
      status = 'resolved',
      resolved_at = coalesce(p_order_created_at, now())
    where r.employee_id = p_employee_id
      and r.status = 'active'
      and coalesce(r.last_reminded_at, r.created_at) <= coalesce(p_order_created_at, now())
    returning r.id
  ), inserted_events as (
    insert into public.reminder_events (
      reminder_id,
      event_type,
      sent_at,
      channels_attempted,
      delivery_result
    )
    select
      resolved.id,
      'auto_resolved',
      coalesce(p_order_created_at, now()),
      '[]'::jsonb,
      jsonb_build_object(
        'resolved_by', 'order',
        'order_id', p_order_id,
        'resolved_at', coalesce(p_order_created_at, now())
      )
    from resolved
    returning reminder_id
  )
  select count(*) into v_resolved_count from inserted_events;

  return coalesce(v_resolved_count, 0);
end;
$$;

create or replace function public.resolve_active_reminders_on_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.resolve_active_reminders_for_employee(new.user_id, new.created_at, new.id);
  return new;
end;
$$;

drop trigger if exists resolve_active_reminders_on_order_insert on public.orders;
create trigger resolve_active_reminders_on_order_insert
after insert on public.orders
for each row execute function public.resolve_active_reminders_on_order_insert();

alter table public.reminder_system_settings enable row level security;
alter table public.reminders enable row level security;
alter table public.reminder_events enable row level security;
alter table public.recurring_reminder_rules enable row level security;
alter table public.notifications enable row level security;
alter table public.device_push_tokens enable row level security;

drop policy if exists reminder_system_settings_manager_read on public.reminder_system_settings;
create policy reminder_system_settings_manager_read
on public.reminder_system_settings
for select
to authenticated
using (public.current_user_is_manager());

drop policy if exists reminder_system_settings_manager_update on public.reminder_system_settings;
create policy reminder_system_settings_manager_update
on public.reminder_system_settings
for update
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists reminders_select_manager_or_employee on public.reminders;
create policy reminders_select_manager_or_employee
on public.reminders
for select
to authenticated
using (
  public.current_user_is_manager()
  or auth.uid() = employee_id
);

drop policy if exists reminders_insert_manager_only on public.reminders;
create policy reminders_insert_manager_only
on public.reminders
for insert
to authenticated
with check (public.current_user_is_manager());

drop policy if exists reminders_update_manager_only on public.reminders;
create policy reminders_update_manager_only
on public.reminders
for update
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists reminder_events_select_manager_or_employee on public.reminder_events;
create policy reminder_events_select_manager_or_employee
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

drop policy if exists reminder_events_insert_manager_only on public.reminder_events;
create policy reminder_events_insert_manager_only
on public.reminder_events
for insert
to authenticated
with check (public.current_user_is_manager());

drop policy if exists recurring_rules_manager_select on public.recurring_reminder_rules;
create policy recurring_rules_manager_select
on public.recurring_reminder_rules
for select
to authenticated
using (public.current_user_is_manager());

drop policy if exists recurring_rules_manager_insert on public.recurring_reminder_rules;
create policy recurring_rules_manager_insert
on public.recurring_reminder_rules
for insert
to authenticated
with check (public.current_user_is_manager());

drop policy if exists recurring_rules_manager_update on public.recurring_reminder_rules;
create policy recurring_rules_manager_update
on public.recurring_reminder_rules
for update
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists recurring_rules_manager_delete on public.recurring_reminder_rules;
create policy recurring_rules_manager_delete
on public.recurring_reminder_rules
for delete
to authenticated
using (public.current_user_is_manager());

drop policy if exists notifications_select_manager_or_owner on public.notifications;
create policy notifications_select_manager_or_owner
on public.notifications
for select
to authenticated
using (
  public.current_user_is_manager()
  or auth.uid() = user_id
);

drop policy if exists notifications_insert_manager_or_owner on public.notifications;
create policy notifications_insert_manager_or_owner
on public.notifications
for insert
to authenticated
with check (
  public.current_user_is_manager()
  or auth.uid() = user_id
);

drop policy if exists notifications_update_owner_or_manager on public.notifications;
create policy notifications_update_owner_or_manager
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

drop policy if exists device_push_tokens_select_own_or_manager on public.device_push_tokens;
create policy device_push_tokens_select_own_or_manager
on public.device_push_tokens
for select
to authenticated
using (
  auth.uid() = user_id
  or public.current_user_is_manager()
);

drop policy if exists device_push_tokens_insert_own on public.device_push_tokens;
create policy device_push_tokens_insert_own
on public.device_push_tokens
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists device_push_tokens_update_own on public.device_push_tokens;
create policy device_push_tokens_update_own
on public.device_push_tokens
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists device_push_tokens_delete_own on public.device_push_tokens;
create policy device_push_tokens_delete_own
on public.device_push_tokens
for delete
to authenticated
using (auth.uid() = user_id);

grant select, update on public.reminder_system_settings to authenticated;
grant select, insert, update on public.reminders to authenticated;
grant select, insert on public.reminder_events to authenticated;
grant select, insert, update, delete on public.recurring_reminder_rules to authenticated;
grant select, insert, update on public.notifications to authenticated;
grant select, insert, update, delete on public.device_push_tokens to authenticated;

revoke all on function public.current_user_is_manager() from public, anon;
grant execute on function public.current_user_is_manager() to authenticated, service_role;

do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.order_items;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.profiles;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.reminders;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.reminder_events;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.notifications;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;
end;
$$;

-- Optional pg_cron schedule to invoke recurring reminder evaluation every 10 minutes.
-- This only runs when pg_cron + pg_net extensions and app settings are available.
do $$
declare
  v_supabase_url text;
  v_service_role_key text;
  v_job_sql text;
begin
  begin
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'Skipping recurring reminder cron setup (extensions unavailable): %', sqlerrm;
    return;
  end;

  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_role_key := current_setting('app.settings.service_role_key', true);

  if coalesce(v_supabase_url, '') = '' or coalesce(v_service_role_key, '') = '' then
    raise notice 'Skipping recurring reminder cron setup (missing app.settings.supabase_url/service_role_key)';
    return;
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'evaluate-recurring-reminders-every-10m';

  v_job_sql := format(
    $cron_sql$select net.http_post(
      url := %L,
      headers := %L::jsonb,
      body := '{"source":"pg_cron"}'::jsonb
    );$cron_sql$,
    v_supabase_url || '/functions/v1/evaluate-recurring-reminders',
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    )::text
  );

  perform cron.schedule(
    'evaluate-recurring-reminders-every-10m',
    '*/10 * * * *',
    v_job_sql
  );
exception when others then
  raise notice 'Unable to schedule evaluate-recurring-reminders cron: %', sqlerrm;
end;
$$;
