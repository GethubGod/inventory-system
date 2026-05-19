-- Audit remediation security hardening.
--
-- This migration intentionally builds on:
--   20260518120000_harden_order_rpc_and_orders_rls.sql
--   20260518120100_harden_role_escalation_and_users_rls.sql
--
-- Goals:
--   * Durable access-code throttling/auditing without changing the 4-digit UX.
--   * Trusted role grants from successful access-code validation, not auth metadata.
--   * Quick Order metadata tagging through submit_order_rpc.
--   * Server-side location/catalog checks for order submission.
--   * Remaining RLS/RPC hardening found in the audit.

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. Access-code throttling, audit log, and trusted role grants
-- ============================================================

create table if not exists public.access_code_rate_limits (
  identifier_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  locked_until timestamptz,
  last_attempt_at timestamptz not null default now()
);

create table if not exists public.access_code_validation_events (
  id uuid primary key default gen_random_uuid(),
  identifier_hash text not null,
  outcome text not null
    check (outcome in ('success', 'invalid', 'rate_limited', 'locked', 'error')),
  created_at timestamptz not null default now()
);

create index if not exists access_code_validation_events_identifier_created_idx
  on public.access_code_validation_events(identifier_hash, created_at desc);

create table if not exists public.access_code_role_grants (
  id uuid primary key default gen_random_uuid(),
  subject_hash text not null,
  role public.user_role not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  consumed_at timestamptz
);

create index if not exists access_code_role_grants_subject_active_idx
  on public.access_code_role_grants(subject_hash, expires_at desc)
  where consumed_at is null;

alter table public.access_code_rate_limits enable row level security;
alter table public.access_code_validation_events enable row level security;
alter table public.access_code_role_grants enable row level security;

revoke all on table public.access_code_rate_limits from anon, authenticated;
revoke all on table public.access_code_validation_events from anon, authenticated;
revoke all on table public.access_code_role_grants from anon, authenticated;

create or replace function public.consume_access_code_role_grant(p_email text)
returns public.user_role
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_subject_hash text;
  v_grant record;
begin
  if nullif(btrim(coalesce(p_email, '')), '') is null then
    return null;
  end if;

  v_subject_hash := encode(extensions.digest(lower(btrim(p_email)), 'sha256'), 'hex');

  select id, role
  into v_grant
  from public.access_code_role_grants
  where subject_hash = v_subject_hash
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  update public.access_code_role_grants
  set consumed_at = now()
  where id = v_grant.id;

  return v_grant.role;
end;
$$;

revoke all on function public.consume_access_code_role_grant(text) from public, anon, authenticated;
grant execute on function public.consume_access_code_role_grant(text) to service_role;

create or replace function public.validate_access_code_attempt(
  p_access_code text,
  p_identifier_hash text,
  p_subject_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_identifier_hash text := nullif(btrim(coalesce(p_identifier_hash, '')), '');
  v_subject_hash text := nullif(btrim(coalesce(p_subject_hash, '')), '');
  v_access_code text := btrim(coalesce(p_access_code, ''));
  v_now timestamptz := now();
  v_window_seconds integer := 60;
  v_max_attempts integer := 10;
  v_lockout_threshold integer := 20;
  v_lockout_minutes integer := 15;
  v_failure_delay_seconds numeric := 0.35;
  v_bucket public.access_code_rate_limits%rowtype;
  v_next_attempt_count integer;
  v_role text;
begin
  if v_identifier_hash is null then
    v_identifier_hash := 'unknown';
  end if;

  insert into public.access_code_rate_limits(identifier_hash)
  values (v_identifier_hash)
  on conflict (identifier_hash) do nothing;

  select *
  into v_bucket
  from public.access_code_rate_limits
  where identifier_hash = v_identifier_hash
  for update;

  if v_bucket.locked_until is not null and v_bucket.locked_until > v_now then
    insert into public.access_code_validation_events(identifier_hash, outcome)
    values (v_identifier_hash, 'locked');
    perform pg_sleep(v_failure_delay_seconds);
    return jsonb_build_object('ok', false, 'code', 'invalid_or_limited');
  end if;

  if v_bucket.window_started_at <= v_now - make_interval(secs => v_window_seconds) then
    update public.access_code_rate_limits
    set window_started_at = v_now,
        attempt_count = 0,
        locked_until = null,
        last_attempt_at = v_now
    where identifier_hash = v_identifier_hash
    returning *
    into v_bucket;
  end if;

  if v_bucket.attempt_count >= v_max_attempts then
    update public.access_code_rate_limits
    set locked_until = greatest(
          coalesce(locked_until, v_now),
          v_now + make_interval(mins => v_lockout_minutes)
        ),
        last_attempt_at = v_now
    where identifier_hash = v_identifier_hash;

    insert into public.access_code_validation_events(identifier_hash, outcome)
    values (v_identifier_hash, 'rate_limited');
    perform pg_sleep(v_failure_delay_seconds);
    return jsonb_build_object('ok', false, 'code', 'invalid_or_limited');
  end if;

  if v_access_code ~ '^[0-9]{4}$' then
    v_role := public.get_access_code_role(v_access_code);
  else
    v_role := null;
  end if;

  if v_role in ('employee', 'manager') then
    update public.access_code_rate_limits
    set window_started_at = v_now,
        attempt_count = 0,
        locked_until = null,
        last_attempt_at = v_now
    where identifier_hash = v_identifier_hash;

    insert into public.access_code_validation_events(identifier_hash, outcome)
    values (v_identifier_hash, 'success');

    if v_subject_hash is not null then
      insert into public.access_code_role_grants(subject_hash, role)
      values (v_subject_hash, v_role::public.user_role);
    end if;

    return jsonb_build_object('ok', true, 'role', v_role);
  end if;

  v_next_attempt_count := v_bucket.attempt_count + 1;

  update public.access_code_rate_limits
  set attempt_count = v_next_attempt_count,
      locked_until = case
        when v_next_attempt_count >= v_lockout_threshold
          then v_now + make_interval(mins => v_lockout_minutes)
        else locked_until
      end,
      last_attempt_at = v_now
  where identifier_hash = v_identifier_hash;

  insert into public.access_code_validation_events(identifier_hash, outcome)
  values (v_identifier_hash, 'invalid');

  perform pg_sleep(v_failure_delay_seconds);
  return jsonb_build_object('ok', false, 'code', 'invalid_or_limited');
exception
  when others then
    begin
      insert into public.access_code_validation_events(identifier_hash, outcome)
      values (coalesce(v_identifier_hash, 'unknown'), 'error');
    exception
      when others then null;
    end;
    perform pg_sleep(v_failure_delay_seconds);
    return jsonb_build_object('ok', false, 'code', 'invalid_or_limited');
end;
$$;

revoke all on function public.validate_access_code_attempt(text, text, text) from public, anon, authenticated;
grant execute on function public.validate_access_code_attempt(text, text, text) to service_role;

-- ============================================================
-- 2. Trusted auth identity sync (no auth user_metadata role authz)
-- ============================================================

create or replace function public.upsert_identity_from_auth_user(p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user auth.users%rowtype;
  v_email text;
  v_full_name text;
  v_granted_role public.user_role;
  v_provider text;
  v_default_location_id uuid;
  v_profile_completed boolean;
begin
  if p_auth_user_id is null then
    raise exception 'Auth user id is required';
  end if;

  select *
  into v_auth_user
  from auth.users
  where id = p_auth_user_id;

  if not found then
    raise exception 'Auth user not found';
  end if;

  v_email := v_auth_user.email;
  v_full_name := nullif(
    btrim(
      coalesce(
        v_auth_user.raw_user_meta_data->>'full_name',
        v_auth_user.raw_user_meta_data->>'name',
        split_part(coalesce(v_auth_user.email, ''), '@', 1)
      )
    ),
    ''
  );
  v_granted_role := public.consume_access_code_role_grant(v_email);
  v_provider := case
    when coalesce(v_auth_user.raw_app_meta_data->>'provider', v_auth_user.raw_user_meta_data->>'provider')
      in ('google', 'apple', 'email')
      then coalesce(v_auth_user.raw_app_meta_data->>'provider', v_auth_user.raw_user_meta_data->>'provider')
    else 'email'
  end;
  v_default_location_id := case
    when coalesce(v_auth_user.raw_user_meta_data->>'default_location_id', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (v_auth_user.raw_user_meta_data->>'default_location_id')::uuid
    else null
  end;
  v_profile_completed := v_full_name is not null and v_granted_role is not null;

  insert into public.users (
    id, email, name, role, default_location_id
  )
  values (
    v_auth_user.id,
    coalesce(v_email, ''),
    coalesce(v_full_name, 'User'),
    coalesce(v_granted_role, 'employee'::public.user_role),
    v_default_location_id
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = excluded.name,
    role = coalesce(v_granted_role, public.users.role),
    default_location_id = coalesce(excluded.default_location_id, public.users.default_location_id);

  insert into public.profiles (
    id, email, full_name, role, provider, profile_completed
  )
  values (
    v_auth_user.id,
    v_email,
    v_full_name,
    coalesce(v_granted_role, 'employee'::public.user_role),
    v_provider,
    v_profile_completed
  )
  on conflict (id) do update
  set
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = coalesce(v_granted_role, public.profiles.role),
    provider = coalesce(public.profiles.provider, excluded.provider),
    profile_completed = public.profiles.profile_completed
      or (v_full_name is not null and coalesce(v_granted_role, public.profiles.role) is not null),
    updated_at = now();
end;
$$;

revoke all on function public.upsert_identity_from_auth_user(uuid) from public, anon, authenticated;
grant execute on function public.upsert_identity_from_auth_user(uuid) to service_role;

create or replace function public.sync_auth_user_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.upsert_identity_from_auth_user(new.id);
  return new;
end;
$$;

create or replace function public.enforce_profile_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Cannot modify role';
  end if;

  if new.is_suspended is distinct from old.is_suspended
    or new.suspended_at is distinct from old.suspended_at
    or new.suspended_by is distinct from old.suspended_by then
    if not public.current_user_is_manager() or new.id = auth.uid() or old.role <> 'employee' then
      raise exception 'Cannot modify suspension state';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_profile_security on public.profiles;
create trigger enforce_profile_security
before update on public.profiles
for each row execute function public.enforce_profile_security();

-- ============================================================
-- 3. Orders and order_items authorization hardening
-- ============================================================

drop policy if exists "order_items_select_authenticated" on public.order_items;
drop policy if exists "order_items_select_owner_or_manager" on public.order_items;

create policy "order_items_select_owner_or_manager"
on public.order_items
for select
to authenticated
using (
  public.current_user_is_manager()
  or exists (
    select 1
    from public.orders o
    where o.id = order_id
      and o.user_id = auth.uid()
  )
);

create or replace function public.enforce_order_metadata_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.allow_order_metadata', true) = 'on' then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.entry_method := 'manual';
    new.quick_session_id := null;
    new.manager_review_status := coalesce(new.manager_review_status, 'not_required');
    new.manager_review_notes := null;
    new.manager_reviewed_at := null;
    new.manager_reviewed_by := null;
    return new;
  end if;

  if tg_op = 'UPDATE' and not public.current_user_is_manager() then
    new.entry_method := old.entry_method;
    new.quick_session_id := old.quick_session_id;
    new.manager_review_status := old.manager_review_status;
    new.manager_review_notes := old.manager_review_notes;
    new.manager_reviewed_at := old.manager_reviewed_at;
    new.manager_reviewed_by := old.manager_reviewed_by;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_order_metadata_security on public.orders;
create trigger enforce_order_metadata_security
before insert or update on public.orders
for each row execute function public.enforce_order_metadata_security();

drop function if exists public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb);

create or replace function public.submit_order_rpc(
  p_id uuid,
  p_org_id uuid default null,
  p_location_id uuid default null,
  p_user_id uuid default null,
  p_status text default 'submitted',
  p_items jsonb default '[]'::jsonb,
  p_entry_method text default 'manual',
  p_quick_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_inventory_item_id uuid;
  v_quantity numeric;
  v_input_mode text;
  v_is_existing boolean := false;
  v_has_suggested boolean := false;
  v_order_type text := 'manual';
  v_user_id uuid;
  v_profile record;
  v_default_location_id uuid;
  v_entry_method text := 'manual';
begin
  set local statement_timeout = '10s';

  if auth.uid() is null or p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'Unauthorized'
      using errcode = 'P0001';
  end if;

  if p_location_id is null then
    raise exception 'Location is required'
      using errcode = 'P0001';
  end if;

  v_user_id := auth.uid();

  select role, is_suspended
  into v_profile
  from public.profiles
  where id = v_user_id;

  if coalesce(v_profile.is_suspended, false) then
    raise exception 'Suspended accounts cannot submit orders'
      using errcode = 'P0001';
  end if;

  select default_location_id
  into v_default_location_id
  from public.users
  where id = v_user_id;

  if not exists (
    select 1
    from public.locations l
    where l.id = p_location_id
      and coalesce(l.active, true)
  ) then
    raise exception 'Invalid or inactive location'
      using errcode = 'P0001';
  end if;

  if coalesce(v_profile.role::text, '') <> 'manager'
    and v_default_location_id is distinct from p_location_id then
    raise exception 'You do not have access to this location'
      using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) != 'array' then
    raise exception 'p_items must be a JSON array'
      using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item'
      using errcode = 'P0001';
  end if;

  if p_quick_session_id is not null then
    if not exists (
      select 1
      from public.quick_order_sessions qos
      where qos.id = p_quick_session_id
        and qos.user_id = v_user_id
        and (qos.location_id is null or qos.location_id = p_location_id)
    ) then
      raise exception 'Invalid Quick Order session'
        using errcode = 'P0001';
    end if;
    v_entry_method := 'quick_order';
  elsif coalesce(p_entry_method, 'manual') <> 'manual' then
    raise exception 'Order entry metadata requires a valid Quick Order session'
      using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if v_item->>'inventory_item_id' is null then
      raise exception 'Each item must have an inventory_item_id'
        using errcode = 'P0001';
    end if;

    v_inventory_item_id := (v_item->>'inventory_item_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_input_mode := coalesce(v_item->>'input_mode', 'quantity');

    if v_input_mode not in ('quantity', 'remaining') then
      raise exception 'Invalid input_mode'
        using errcode = 'P0001';
    end if;

    if v_quantity is null
      or (v_input_mode = 'quantity' and v_quantity <= 0)
      or (v_input_mode = 'remaining' and v_quantity < 0) then
      raise exception 'Each item must have a valid quantity'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1
      from public.inventory_items ii
      where ii.id = v_inventory_item_id
        and coalesce(ii.active, true)
    ) then
      raise exception 'Inventory item is inactive or unavailable'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1
      from public.area_items ai
      join public.storage_areas sa on sa.id = ai.storage_area_id
      where ai.inventory_item_id = v_inventory_item_id
        and sa.location_id = p_location_id
        and coalesce(ai.active, true)
        and coalesce(sa.active, true)
    ) then
      raise exception 'Inventory item is not available for this location'
        using errcode = 'P0001';
    end if;
  end loop;

  select exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where coalesce((item->>'was_suggested')::boolean, false)
  )
  into v_has_suggested;

  v_order_type := case when v_has_suggested then 'from_suggestion' else 'manual' end;

  perform set_config('app.allow_order_metadata', 'on', true);

  insert into public.orders (
    id,
    org_id,
    location_id,
    user_id,
    status,
    order_type,
    entry_method,
    quick_session_id,
    manager_review_status
  )
  values (
    p_id,
    p_org_id,
    p_location_id,
    v_user_id,
    p_status::order_status,
    v_order_type,
    v_entry_method,
    p_quick_session_id,
    'not_required'
  )
  on conflict (id) do nothing
  returning *
  into v_order;

  if v_order.id is null then
    select * into v_order
      from public.orders
     where id = p_id;
    v_is_existing := true;
  end if;

  if v_order.user_id is distinct from v_user_id then
    raise exception 'Forbidden'
      using errcode = 'P0001';
  end if;

  if not v_is_existing then
    insert into public.order_items (
      org_id,
      order_id,
      inventory_item_id,
      quantity,
      unit_type,
      input_mode,
      quantity_requested,
      remaining_reported,
      decided_quantity,
      decided_by,
      decided_at,
      note,
      was_suggested,
      original_suggested_qty
    )
    select
      p_org_id,
      p_id,
      payload.inventory_item_id,
      payload.quantity,
      case
        when payload.requested_unit_type = 'pack' and payload.has_pack_unit then 'pack'::unit_type
        when payload.requested_unit_type = 'base' and payload.has_base_unit then 'base'::unit_type
        when payload.has_pack_unit and not payload.has_base_unit then 'pack'::unit_type
        when payload.has_base_unit and not payload.has_pack_unit then 'base'::unit_type
        else 'base'::unit_type
      end,
      payload.input_mode,
      payload.quantity_requested,
      payload.remaining_reported,
      payload.decided_quantity,
      payload.decided_by,
      payload.decided_at,
      payload.note,
      payload.was_suggested,
      payload.original_suggested_qty
    from (
      select
        (item->>'inventory_item_id')::uuid as inventory_item_id,
        (item->>'quantity')::numeric as quantity,
        case
          when item->>'unit_type' in ('base', 'pack') then item->>'unit_type'
          else null
        end as requested_unit_type,
        coalesce(item->>'input_mode', 'quantity') as input_mode,
        (item->>'quantity_requested')::numeric as quantity_requested,
        (item->>'remaining_reported')::numeric as remaining_reported,
        (item->>'decided_quantity')::numeric as decided_quantity,
        (item->>'decided_by')::uuid as decided_by,
        (item->>'decided_at')::timestamptz as decided_at,
        item->>'note' as note,
        coalesce((item->>'was_suggested')::boolean, false) as was_suggested,
        (item->>'original_suggested_qty')::numeric as original_suggested_qty,
        nullif(trim(ii.base_unit), '') is not null as has_base_unit,
        nullif(trim(ii.pack_unit), '') is not null as has_pack_unit
      from jsonb_array_elements(p_items) as item
      left join public.inventory_items ii
        on ii.id = (item->>'inventory_item_id')::uuid
    ) as payload;

    if p_quick_session_id is not null then
      update public.quick_order_sessions
      set
        status = 'submitted',
        submitted_order_id = p_id,
        updated_at = now()
      where id = p_quick_session_id
        and user_id = v_user_id;
    end if;
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id',                     oi.id,
      'order_id',               oi.order_id,
      'inventory_item_id',      oi.inventory_item_id,
      'quantity',               oi.quantity,
      'unit_type',              oi.unit_type,
      'input_mode',             oi.input_mode,
      'quantity_requested',     oi.quantity_requested,
      'remaining_reported',     oi.remaining_reported,
      'decided_quantity',       oi.decided_quantity,
      'decided_by',             oi.decided_by,
      'decided_at',             oi.decided_at,
      'note',                   oi.note,
      'status',                 oi.status,
      'supplier_override_id',   oi.supplier_override_id,
      'was_suggested',          oi.was_suggested,
      'original_suggested_qty', oi.original_suggested_qty,
      'created_at',             oi.created_at,
      'inventory_item',         jsonb_build_object(
        'id',                ii.id,
        'name',              ii.name,
        'category',          ii.category,
        'supplier_category', ii.supplier_category,
        'supplier_id',       ii.supplier_id,
        'base_unit',         ii.base_unit,
        'pack_unit',         ii.pack_unit,
        'pack_size',         ii.pack_size,
        'active',            ii.active,
        'created_at',        ii.created_at
      )
    )
  )
  into v_items
  from public.order_items oi
  join public.inventory_items ii on ii.id = oi.inventory_item_id
  where oi.order_id = p_id;

  return jsonb_build_object(
    'id',               v_order.id,
    'order_number',     v_order.order_number,
    'org_id',           v_order.org_id,
    'user_id',          v_order.user_id,
    'location_id',      v_order.location_id,
    'status',           v_order.status,
    'order_type',       coalesce(v_order.order_type, v_order_type),
    'entry_method',     coalesce(v_order.entry_method, v_entry_method),
    'quick_session_id', v_order.quick_session_id,
    'notes',            v_order.notes,
    'created_at',       v_order.created_at,
    'fulfilled_at',     v_order.fulfilled_at,
    'fulfilled_by',     v_order.fulfilled_by,
    'order_items',      coalesce(v_items, '[]'::jsonb),
    'is_existing',      v_is_existing
  );
end;
$$;

revoke all on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) to authenticated;

-- ============================================================
-- 4. Remaining SECURITY DEFINER hardening
-- ============================================================

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
  if auth.uid() is null or p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'Unauthorized'
      using errcode = 'P0001';
  end if;

  begin
    set local lock_timeout = '2s';

    update public.profiles
    set
      last_order_at  = greatest(coalesce(last_order_at,  to_timestamp(0)), p_order_created_at),
      last_active_at = greatest(coalesce(last_active_at, to_timestamp(0)), p_order_created_at),
      updated_at     = now()
    where id = p_user_id;
  exception
    when others then null;
  end;
end;
$$;

revoke all on function public.sync_profile_after_order(uuid, timestamp with time zone) from public, anon;
grant execute on function public.sync_profile_after_order(uuid, timestamp with time zone) to authenticated;

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
  v_default_location_id uuid;
begin
  if p_location_id is null then
    return 0;
  end if;

  if auth.uid() is not null and not public.current_user_is_manager() then
    select default_location_id
    into v_default_location_id
    from public.users
    where id = auth.uid();

    if v_default_location_id is distinct from p_location_id then
      raise exception 'You do not have access to this location'
        using errcode = 'P0001';
    end if;
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

revoke all on function public.resolve_active_location_banners_for_location(uuid, timestamp with time zone, uuid) from public, anon;
grant execute on function public.resolve_active_location_banners_for_location(uuid, timestamp with time zone, uuid)
  to authenticated, service_role;

drop policy if exists reminders_select_location_banners on public.reminders;
create policy reminders_select_location_banners
on public.reminders
for select
to authenticated
using (
  scope = 'location_banner'
  and status = 'active'
  and (
    public.current_user_is_manager()
    or exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.default_location_id = reminders.location_id
    )
  )
);

create or replace function public.check_parser_anomalies()
returns table (alert_type text, detail jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  today_count int;
  avg_count numeric;
begin
  select count(*) into today_count
  from public.parser_usage_log
  where created_at >= current_date
    and parser_mode = 'live';

  select avg(daily_count) into avg_count
  from (
    select date(created_at) as d, count(*) as daily_count
    from public.parser_usage_log
    where created_at >= current_date - interval '7 days'
      and created_at < current_date
      and parser_mode = 'live'
    group by date(created_at)
  ) recent;

  if today_count > coalesce(avg_count, 0) * 3 and today_count > 50 then
    return query select
      'high_volume_spike'::text,
      jsonb_build_object('today', today_count, 'avg_7d', avg_count);
  end if;
end;
$$;

revoke all on function public.check_parser_anomalies() from public, anon, authenticated;
grant execute on function public.check_parser_anomalies() to service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
