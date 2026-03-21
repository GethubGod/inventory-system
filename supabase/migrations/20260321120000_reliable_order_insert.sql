-- Remove AFTER INSERT triggers from orders table.
-- These triggers (profile timestamp sync, reminder auto-resolution) were
-- blocking order inserts for 15-30+ seconds due to lock contention on
-- profiles and reminders rows.  The app already handles both tasks
-- client-side after a successful submit, so the triggers are redundant.

-- 1. Drop the two blocking triggers
drop trigger if exists sync_profile_last_order_at_on_order on public.orders;
drop trigger if exists resolve_active_reminders_on_order_insert on public.orders;

-- 2. Kill any zombie idle-in-transaction sessions left over from
--    previous timed-out order inserts (they may still hold row locks).
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

-- 3. Create a lean RPC for order creation.
--    • Runs as SECURITY DEFINER so it works regardless of RLS state on orders.
--    • Sets a hard 8-second statement_timeout to guarantee a fast failure
--      instead of an indefinite hang.
--    • Returns the new row as JSONB so the client gets id + order_number.
create or replace function public.create_order_rpc(
  p_id uuid,
  p_org_id uuid,
  p_location_id uuid,
  p_user_id uuid,
  p_status text default 'submitted'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  set local statement_timeout = '8s';

  insert into public.orders (id, org_id, location_id, user_id, status)
  values (p_id, p_org_id, p_location_id, p_user_id, p_status::order_status)
  returning id, order_number, user_id, location_id, status, notes,
            created_at, fulfilled_at, fulfilled_by
  into v_row;

  return jsonb_build_object(
    'id',           v_row.id,
    'order_number', v_row.order_number,
    'user_id',      v_row.user_id,
    'location_id',  v_row.location_id,
    'status',       v_row.status,
    'notes',        v_row.notes,
    'created_at',   v_row.created_at,
    'fulfilled_at', v_row.fulfilled_at,
    'fulfilled_by', v_row.fulfilled_by
  );
end;
$$;

-- Only authenticated users may call this function.
revoke all on function public.create_order_rpc(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.create_order_rpc(uuid, uuid, uuid, uuid, text) to authenticated;

-- 4. Best-effort profile timestamp helper the client can call after submit.
--    Swallows all errors so it never blocks the happy path.
create or replace function public.sync_profile_after_order(
  p_user_id uuid,
  p_order_created_at timestamp with time zone default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  set local lock_timeout = '2s';

  update public.profiles
  set
    last_order_at  = greatest(coalesce(last_order_at,  to_timestamp(0)), p_order_created_at),
    last_active_at = greatest(coalesce(last_active_at, to_timestamp(0)), p_order_created_at),
    updated_at     = now()
  where id = p_user_id;
exception
  when others then null;   -- best-effort; never fail
end;
$$;

revoke all on function public.sync_profile_after_order(uuid, timestamp with time zone) from public, anon;
grant execute on function public.sync_profile_after_order(uuid, timestamp with time zone) to authenticated;
