alter table public.reminders
  alter column employee_id drop not null;

alter table public.reminders
  add column if not exists scope text not null default 'employee'
    check (scope in ('employee', 'location_banner'));

alter table public.reminders
  add column if not exists message text;

alter table public.reminders
  add column if not exists sender_name text;

drop index if exists reminders_one_active_per_employee_location_idx;

create unique index if not exists reminders_one_active_per_employee_location_idx
  on public.reminders(
    employee_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'active' and scope = 'employee';

create unique index if not exists reminders_one_active_location_banner_idx
  on public.reminders(location_id)
  where status = 'active' and scope = 'location_banner';

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

  with resolved as (
    update public.reminders r
    set
      status = 'resolved',
      resolved_at = coalesce(p_order_created_at, now())
    where r.location_id = p_location_id
      and r.scope = 'location_banner'
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
  perform public.resolve_active_reminders_for_employee(new.user_id, new.created_at, new.id);
  perform public.resolve_active_location_banners_for_location(new.location_id, new.created_at, new.id);
  return new;
end;
$$;

drop policy if exists reminders_select_location_banners on public.reminders;
create policy reminders_select_location_banners
on public.reminders
for select
to authenticated
using (
  scope = 'location_banner'
  and status = 'active'
);

grant execute on function public.resolve_active_location_banners_for_location(uuid, timestamp with time zone, uuid)
  to authenticated;
