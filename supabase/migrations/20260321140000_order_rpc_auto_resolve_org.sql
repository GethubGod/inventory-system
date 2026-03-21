-- Make create_order_rpc resilient to missing org_id by resolving it server-side.
-- This avoids a slow edge-function round-trip on the client before every order insert.

create or replace function public.create_order_rpc(
  p_id uuid,
  p_org_id uuid default null,
  p_location_id uuid default null,
  p_user_id uuid default null,
  p_status text default 'submitted'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_org_id uuid := p_org_id;
begin
  set local statement_timeout = '8s';

  -- Auto-resolve org_id when the client couldn't determine it.
  if v_org_id is null then
    begin
      select om.org_id into v_org_id
      from public.org_memberships om
      where om.user_id = p_user_id
      limit 1;
    exception
      when undefined_table then null;
    end;
  end if;

  if v_org_id is null then
    begin
      select o.id into v_org_id
      from public.organizations o
      limit 1;
    exception
      when undefined_table then null;
    end;
  end if;

  if v_org_id is null then
    raise exception 'Could not resolve organization for user %', p_user_id
      using errcode = 'P0002';
  end if;

  insert into public.orders (id, org_id, location_id, user_id, status)
  values (p_id, v_org_id, p_location_id, p_user_id, p_status::order_status)
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

-- Permissions unchanged — signature (uuid,uuid,uuid,uuid,text) is the same.
revoke all on function public.create_order_rpc(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.create_order_rpc(uuid, uuid, uuid, uuid, text) to authenticated;
