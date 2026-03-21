-- Keep order inserts fast even if reminder/profile housekeeping rows are locked.
-- The app already performs best-effort reminder cleanup client-side after submit,
-- so these trigger paths should never block order creation.

-- Kill any zombie transactions that are blocking inserts into orders, profiles, or reminders.
-- These can accumulate from timed-out client requests whose server-side transactions
-- were left waiting on locks.
do $$
declare
  r record;
begin
  for r in
    select pid
    from pg_stat_activity
    where state = 'idle in transaction'
      and xact_start < now() - interval '30 seconds'
      and pid <> pg_backend_pid()
  loop
    perform pg_terminate_backend(r.pid);
    raise notice 'Terminated zombie idle-in-transaction pid %', r.pid;
  end loop;
end;
$$;

create or replace function public.sync_profile_last_order_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    -- Short lock_timeout so we never block the order INSERT for more than 2s
    -- even if SKIP LOCKED somehow doesn't apply.
    set local lock_timeout = '2s';

    with target_profile as (
      select p.id
      from public.profiles p
      where p.id = new.user_id
      for update skip locked
    )
    update public.profiles p
    set
      last_order_at = greatest(coalesce(p.last_order_at, to_timestamp(0)), new.created_at),
      last_active_at = greatest(coalesce(p.last_active_at, to_timestamp(0)), new.created_at),
      updated_at = now()
    from target_profile
    where p.id = target_profile.id;
  exception
    when others then
      raise notice 'Skipping sync_profile_last_order_at for order %: %', new.id, SQLERRM;
  end;

  return new;
end;
$$;

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
  if p_employee_id is null then
    return 0;
  end if;

  with target_rows as (
    select r.id
    from public.reminders r
    where r.employee_id = p_employee_id
      and coalesce(r.scope, 'employee') = 'employee'
      and r.status = 'active'
      and coalesce(r.last_reminded_at, r.created_at) <= coalesce(p_order_created_at, now())
    for update skip locked
  ), resolved as (
    update public.reminders r
    set
      status = 'resolved',
      resolved_at = coalesce(p_order_created_at, now())
    where r.id in (select id from target_rows)
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

create or replace function public.resolve_active_location_banners_for_location(
  p_location_id uuid,
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
  if p_location_id is null then
    return 0;
  end if;

  with target_rows as (
    select r.id
    from public.reminders r
    where r.location_id = p_location_id
      and r.scope = 'location_banner'
      and r.status = 'active'
      and coalesce(r.last_reminded_at, r.created_at) <= coalesce(p_order_created_at, now())
    for update skip locked
  ), resolved as (
    update public.reminders r
    set
      status = 'resolved',
      resolved_at = coalesce(p_order_created_at, now())
    where r.id in (select id from target_rows)
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
        'scope', 'location_banner',
        'location_id', p_location_id,
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
  begin
    set local lock_timeout = '2s';
    perform public.resolve_active_reminders_for_employee(new.user_id, new.created_at, new.id);
  exception
    when others then
      raise notice 'Skipping employee reminder resolution for order %: %', new.id, SQLERRM;
  end;

  begin
    set local lock_timeout = '2s';
    perform public.resolve_active_location_banners_for_location(new.location_id, new.created_at, new.id);
  exception
    when undefined_function then null;
    when others then
      raise notice 'Skipping location reminder resolution for order %: %', new.id, SQLERRM;
  end;

  return new;
end;
$$;
