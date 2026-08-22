-- baseline_public_schema.sql
-- Snapshot of the PRODUCTION public schema of Supabase project whrohvitvmcrmedepurd,
-- generated 2026-08-11 from pg_catalog/information_schema queries (read-only).
-- Load order: auth_stub.sql first, then this file.
--
-- This file is generated output; do not hand-edit table definitions. Regenerate
-- from prod if the production schema changes (see scripts/local-db/README.md).

\set ON_ERROR_STOP on

-- Function bodies reference tables that are created later in this file (and one
-- function references the long-dropped public.org_memberships table, exactly as
-- in prod), so skip body validation during load.
SET check_function_bodies = off;

-- Extensions used by prod's public schema objects (pgcrypto: crypt/gen_salt/
-- digest/gen_random_bytes; uuid-ossp: uuid_generate_v4). Prod installs both in
-- the "extensions" schema.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- Match Supabase's database-level search_path so unqualified references
-- (uuid_generate_v4, gen_random_uuid, etc.) resolve the same way as in prod.
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;
SET search_path TO "$user", public, extensions;

-- ---------------------------------------------------------------------------
-- Enum types and sequences
-- ---------------------------------------------------------------------------
-- Enum types
CREATE TYPE public.order_status AS ENUM ('draft', 'submitted', 'fulfilled', 'cancelled', 'processing');
CREATE TYPE public.unit_type AS ENUM ('base', 'pack');
CREATE TYPE public.user_role AS ENUM ('employee', 'manager');

-- Sequences
-- (tip_auth_attempts_id_seq is created implicitly by the identity column on public.tip_auth_attempts)
CREATE SEQUENCE public.orders_order_number_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;

-- ---------------------------------------------------------------------------
-- Functions (created before tables: several tables use them in GENERATED
-- ALWAYS AS expressions; bodies are not validated thanks to
-- check_function_bodies = off above)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_prepare_user_delete(p_target_user_id uuid, p_replacement_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_target_user_id is null or p_replacement_user_id is null then
    raise exception 'Both target and replacement user ids are required';
  end if;

  if p_target_user_id = p_replacement_user_id then
    raise exception 'Target and replacement users must be different';
  end if;

  update public.orders
  set user_id = p_replacement_user_id
  where user_id = p_target_user_id;

  update public.stock_check_sessions
  set user_id = p_replacement_user_id
  where user_id = p_target_user_id;

  update public.stock_updates
  set updated_by = p_replacement_user_id
  where updated_by = p_target_user_id;

  update public.storage_areas
  set last_checked_by = null
  where last_checked_by = p_target_user_id;

  update public.area_items
  set last_updated_by = null
  where last_updated_by = p_target_user_id;

  update public.inventory_items
  set created_by = null
  where created_by = p_target_user_id;

  update public.org_settings
  set updated_by = null
  where updated_by = p_target_user_id;

end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_parser_anomalies()
 RETURNS TABLE(alert_type text, detail jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.consume_access_code_role_grant(p_email text)
 RETURNS user_role
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_order_rpc(p_id uuid, p_org_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'submitted'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_user_id uuid;
begin
  set local statement_timeout = '8s';

  if auth.uid() is null or p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'Unauthorized'
      using errcode = 'P0001';
  end if;

  v_user_id := auth.uid();

  insert into public.orders (id, org_id, location_id, user_id, status)
  values (p_id, p_org_id, p_location_id, v_user_id, p_status::order_status)
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
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_is_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'manager'
      and coalesce(p.is_suspended, false) = false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_order_metadata_security()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_profile_security()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_user_security()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Service role / trigger contexts without a JWT may change role.
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Cannot modify role';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_current_user_identity()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  perform public.upsert_identity_from_auth_user(auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_access_code_role(p_access_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  settings_row public.org_settings%rowtype;
  normalized_input text;
  employee_code text;
  manager_code text;
begin
  normalized_input := trim(coalesce(p_access_code, ''));
  if normalized_input !~ '^[0-9]{4}$' then
    return null;
  end if;

  -- Prefer canonical org row when present.
  select * into settings_row
  from public.org_settings
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid
  limit 1;

  -- Fallback for environments with non-canonical org_id rows.
  if not found then
    select * into settings_row
    from public.org_settings
    order by updated_at desc nulls last
    limit 1;
  end if;

  if not found then
    return null;
  end if;

  employee_code := trim(coalesce(settings_row.employee_access_code, ''));
  manager_code := trim(coalesce(settings_row.manager_access_code, ''));

  if manager_code <> '' and manager_code = extensions.crypt(normalized_input, manager_code) then
    return 'manager';
  end if;

  if employee_code <> '' and employee_code = extensions.crypt(normalized_input, employee_code) then
    return 'employee';
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_dow_suggestions(p_location_id uuid, p_min_frequency numeric DEFAULT 0.4, p_lookback_months integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with same_dow_orders as (
    select
      o.id,
      o.created_at
    from public.orders o
    where o.location_id = p_location_id
      and o.status = 'fulfilled'
      and extract(dow from o.created_at) = extract(dow from now())
      and o.created_at >= now() - make_interval(months => greatest(coalesce(p_lookback_months, 6), 1))
  ),
  total_count as (
    select count(distinct id) as cnt
    from same_dow_orders
  ),
  item_occurrences as (
    select
      sdo.id as order_id,
      oi.inventory_item_id as item_id,
      ii.name as item_name,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ) as unit,
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      ) as supplier_name,
      sum(oi.quantity) as ordered_qty
    from same_dow_orders sdo
    join public.order_items oi
      on oi.order_id = sdo.id
    join public.inventory_items ii
      on ii.id = oi.inventory_item_id
    left join public.suppliers override_supplier
      on override_supplier.id = oi.supplier_override_id
    left join public.suppliers primary_supplier
      on primary_supplier.id = ii.supplier_id
    where coalesce(oi.status, 'sent') not in ('cancelled', 'order_later')
    group by
      sdo.id,
      oi.inventory_item_id,
      ii.name,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ),
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      )
  ),
  item_stats as (
    select
      io.item_id,
      io.item_name,
      io.unit_type,
      io.unit,
      io.supplier_name,
      count(*) as times_ordered,
      percentile_cont(0.5) within group (order by io.ordered_qty) as suggested_qty,
      round(avg(io.ordered_qty)::numeric, 1) as avg_qty
    from item_occurrences io
    group by
      io.item_id,
      io.item_name,
      io.unit_type,
      io.unit,
      io.supplier_name
  )
  select coalesce(
    jsonb_agg(row_to_json(row_data) order by row_data.frequency desc, row_data.times_ordered desc, row_data.item_name asc),
    '[]'::jsonb
  )
  from (
    select
      s.item_id,
      s.item_name,
      s.unit_type,
      s.unit,
      s.supplier_name,
      s.times_ordered,
      t.cnt as total_orders,
      round(s.times_ordered::numeric / nullif(t.cnt, 0), 2) as frequency,
      s.suggested_qty,
      s.avg_qty
    from item_stats s
    cross join total_count t
    where t.cnt > 0
      and s.times_ordered::numeric / nullif(t.cnt, 0) >= coalesce(p_min_frequency, 0.4)
  ) as row_data;
$function$
;

CREATE OR REPLACE FUNCTION public.get_dow_suggestions(p_location_id uuid, p_min_frequency numeric DEFAULT 0.4, p_lookback_months integer DEFAULT 6, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with same_dow_orders as (
    select
      o.id,
      o.created_at
    from public.orders o
    where o.location_id = p_location_id
      and o.status::text in ('submitted', 'processing', 'fulfilled')
      and extract(dow from o.created_at) = extract(dow from now())
      and o.created_at >= now() - make_interval(months => greatest(coalesce(p_lookback_months, 6), 1))
      and (p_user_id is null or o.user_id = p_user_id)
  ),
  total_count as (
    select count(distinct id) as cnt
    from same_dow_orders
  ),
  item_occurrences as (
    select
      sdo.id as order_id,
      oi.inventory_item_id as item_id,
      ii.name as item_name,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ) as unit,
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      ) as supplier_name,
      sum(oi.quantity) as ordered_qty
    from same_dow_orders sdo
    join public.order_items oi
      on oi.order_id = sdo.id
    join public.inventory_items ii
      on ii.id = oi.inventory_item_id
    left join public.suppliers override_supplier
      on override_supplier.id = oi.supplier_override_id
    left join public.suppliers primary_supplier
      on primary_supplier.id = ii.supplier_id
    where coalesce(oi.status, 'sent') not in ('cancelled', 'order_later')
    group by
      sdo.id,
      oi.inventory_item_id,
      ii.name,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ),
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      )
  ),
  item_stats as (
    select
      io.item_id,
      io.item_name,
      io.unit_type,
      io.unit,
      io.supplier_name,
      count(*) as times_ordered,
      percentile_cont(0.5) within group (order by io.ordered_qty) as suggested_qty,
      round(avg(io.ordered_qty)::numeric, 1) as avg_qty
    from item_occurrences io
    group by
      io.item_id,
      io.item_name,
      io.unit_type,
      io.unit,
      io.supplier_name
  )
  select coalesce(
    jsonb_agg(row_to_json(row_data) order by row_data.frequency desc, row_data.times_ordered desc, row_data.item_name asc),
    '[]'::jsonb
  )
  from (
    select
      s.item_id,
      s.item_name,
      s.unit_type,
      s.unit,
      s.supplier_name,
      s.times_ordered,
      t.cnt as total_orders,
      round(s.times_ordered::numeric / nullif(t.cnt, 0), 2) as frequency,
      s.suggested_qty,
      s.avg_qty
    from item_stats s
    cross join total_count t
    where t.cnt > 0
      and s.times_ordered::numeric / nullif(t.cnt, 0) >= coalesce(p_min_frequency, 0.4)
  ) as row_data;
$function$
;
CREATE OR REPLACE FUNCTION public.get_last_inventory_session_items(p_location_id uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with latest_session as (
    select css.quick_order_session_id as session_id
    from public.current_stock_snapshots css
    where css.location_id = p_location_id
      and css.quick_order_session_id is not null
      and (p_user_id is null or css.entered_by_user_id = p_user_id)
    group by css.quick_order_session_id
    order by max(css.created_at) desc
    limit 1
  ),
  session_items as (
    select
      css.item_id,
      ii.name as item_name,
      css.quantity,
      css.unit,
      css.created_at,
      css.id,
      row_number() over (
        partition by css.item_id
        order by css.created_at desc, css.id desc
      ) as rn
    from public.current_stock_snapshots css
    join latest_session ls
      on ls.session_id = css.quick_order_session_id
    join public.inventory_items ii
      on ii.id = css.item_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_id', item_id,
        'item_name', item_name,
        'quantity', quantity,
        'unit', unit
      )
      order by created_at asc, id asc
    ),
    '[]'::jsonb
  )
  from session_items
  where rn = 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_orders(p_location_id uuid, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with recent_orders as (
    select
      o.id,
      o.created_at
    from public.orders o
    where o.location_id = p_location_id
      and o.status = 'fulfilled'
      and exists (
        select 1
        from public.order_items oi
        where oi.order_id = o.id
          and coalesce(oi.status, 'sent') not in ('cancelled', 'order_later')
      )
    order by o.created_at desc
    limit greatest(coalesce(p_limit, 10), 1)
  ),
  resolved_order_items as (
    select
      ro.id as order_id,
      oi.inventory_item_id as item_id,
      ii.name as item_name,
      oi.quantity,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ) as unit,
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      ) as supplier_name
    from recent_orders ro
    join public.order_items oi
      on oi.order_id = ro.id
    join public.inventory_items ii
      on ii.id = oi.inventory_item_id
    left join public.suppliers override_supplier
      on override_supplier.id = oi.supplier_override_id
    left join public.suppliers primary_supplier
      on primary_supplier.id = ii.supplier_id
    where coalesce(oi.status, 'sent') not in ('cancelled', 'order_later')
  ),
  order_rows as (
    select
      ro.id,
      ro.created_at,
      trim(to_char(ro.created_at, 'Dy, Mon DD')) as display_date,
      extract(dow from ro.created_at)::int as day_of_week,
      (
        select count(*)
        from resolved_order_items roi
        where roi.order_id = ro.id
      ) as item_count,
      coalesce(
        (
          select jsonb_agg(supplier_row.supplier_name order by supplier_row.supplier_name)
          from (
            select distinct roi.supplier_name
            from resolved_order_items roi
            where roi.order_id = ro.id
              and roi.supplier_name is not null
              and length(trim(roi.supplier_name)) > 0
          ) supplier_row
        ),
        '[]'::jsonb
      ) as suppliers,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'item_id', roi.item_id,
              'item_name', roi.item_name,
              'quantity', roi.quantity,
              'unit_type', roi.unit_type,
              'unit', roi.unit,
              'supplier_name', roi.supplier_name
            )
            order by roi.item_name asc
          )
          from resolved_order_items roi
          where roi.order_id = ro.id
        ),
        '[]'::jsonb
      ) as items
    from recent_orders ro
  )
  select coalesce(
    jsonb_agg(to_jsonb(order_rows) order by order_rows.created_at desc),
    '[]'::jsonb
  )
  from order_rows;
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_orders(p_location_id uuid, p_limit integer DEFAULT 10, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with recent_orders as (
    select
      o.id,
      o.created_at
    from public.orders o
    where o.location_id = p_location_id
      and o.status::text in ('submitted', 'processing', 'fulfilled')
      and (p_user_id is null or o.user_id = p_user_id)
      and exists (
        select 1
        from public.order_items oi
        where oi.order_id = o.id
          and coalesce(oi.status, 'sent') not in ('cancelled', 'order_later')
      )
    order by o.created_at desc
    limit greatest(coalesce(p_limit, 10), 1)
  ),
  resolved_order_items as (
    select
      ro.id as order_id,
      oi.inventory_item_id as item_id,
      ii.name as item_name,
      oi.quantity,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ) as unit,
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      ) as supplier_name
    from recent_orders ro
    join public.order_items oi
      on oi.order_id = ro.id
    join public.inventory_items ii
      on ii.id = oi.inventory_item_id
    left join public.suppliers override_supplier
      on override_supplier.id = oi.supplier_override_id
    left join public.suppliers primary_supplier
      on primary_supplier.id = ii.supplier_id
    where coalesce(oi.status, 'sent') not in ('cancelled', 'order_later')
  ),
  order_rows as (
    select
      ro.id,
      ro.created_at,
      trim(to_char(ro.created_at, 'Dy, Mon DD')) as display_date,
      extract(dow from ro.created_at)::int as day_of_week,
      (
        select count(*)
        from resolved_order_items roi
        where roi.order_id = ro.id
      ) as item_count,
      coalesce(
        (
          select jsonb_agg(supplier_row.supplier_name order by supplier_row.supplier_name)
          from (
            select distinct roi.supplier_name
            from resolved_order_items roi
            where roi.order_id = ro.id
              and roi.supplier_name is not null
              and length(trim(roi.supplier_name)) > 0
          ) supplier_row
        ),
        '[]'::jsonb
      ) as suppliers,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'item_id', roi.item_id,
              'item_name', roi.item_name,
              'quantity', roi.quantity,
              'unit_type', roi.unit_type,
              'unit', roi.unit,
              'supplier_name', roi.supplier_name
            )
            order by roi.item_name asc
          )
          from resolved_order_items roi
          where roi.order_id = ro.id
        ),
        '[]'::jsonb
      ) as items
    from recent_orders ro
  )
  select coalesce(
    jsonb_agg(to_jsonb(order_rows) order by order_rows.created_at desc),
    '[]'::jsonb
  )
  from order_rows;
$function$
;

CREATE OR REPLACE FUNCTION public.get_usual_order(p_location_id uuid, p_min_frequency numeric DEFAULT 0.25, p_lookback_months integer DEFAULT 6, p_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with candidate_orders as (
    select
      o.id,
      o.created_at
    from public.orders o
    where o.location_id = p_location_id
      and o.status::text in ('submitted', 'processing', 'fulfilled')
      and o.created_at >= now() - make_interval(months => greatest(coalesce(p_lookback_months, 6), 1))
      and (p_user_id is null or o.user_id = p_user_id)
      and exists (
        select 1
        from public.order_items oi
        where oi.order_id = o.id
          and coalesce(oi.status, 'sent') not in ('cancelled', 'order_later')
      )
  ),
  total_count as (
    select count(distinct id) as cnt
    from candidate_orders
  ),
  item_occurrences as (
    select
      co.id as order_id,
      oi.inventory_item_id as item_id,
      ii.name as item_name,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ) as unit,
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      ) as supplier_name,
      sum(oi.quantity) as ordered_qty,
      max(co.created_at) as last_ordered_at
    from candidate_orders co
    join public.order_items oi
      on oi.order_id = co.id
    join public.inventory_items ii
      on ii.id = oi.inventory_item_id
    left join public.suppliers override_supplier
      on override_supplier.id = oi.supplier_override_id
    left join public.suppliers primary_supplier
      on primary_supplier.id = ii.supplier_id
    where coalesce(oi.status, 'sent') not in ('cancelled', 'order_later')
    group by
      co.id,
      oi.inventory_item_id,
      ii.name,
      oi.unit_type,
      coalesce(
        nullif(trim(
          case
            when oi.unit_type = 'base' then ii.base_unit
            else ii.pack_unit
          end
        ), ''),
        nullif(trim(ii.base_unit), ''),
        nullif(trim(ii.pack_unit), '')
      ),
      coalesce(
        nullif(trim(override_supplier.name), ''),
        nullif(trim(primary_supplier.name), ''),
        nullif(trim(ii.default_supplier), ''),
        nullif(trim(ii.secondary_supplier), '')
      )
  ),
  item_stats as (
    select
      io.item_id,
      io.item_name,
      io.unit_type,
      io.unit,
      io.supplier_name,
      count(*) as times_ordered,
      max(io.last_ordered_at) as last_ordered_at,
      percentile_cont(0.5) within group (order by io.ordered_qty) as suggested_qty,
      round(avg(io.ordered_qty)::numeric, 1) as avg_qty
    from item_occurrences io
    group by
      io.item_id,
      io.item_name,
      io.unit_type,
      io.unit,
      io.supplier_name
  )
  select coalesce(
    jsonb_agg(row_to_json(row_data) order by row_data.frequency desc, row_data.times_ordered desc, row_data.last_ordered_at desc, row_data.item_name asc),
    '[]'::jsonb
  )
  from (
    select
      s.item_id,
      s.item_name,
      s.unit_type,
      s.unit,
      s.supplier_name,
      s.times_ordered,
      s.last_ordered_at,
      t.cnt as total_orders,
      round(s.times_ordered::numeric / nullif(t.cnt, 0), 2) as frequency,
      s.suggested_qty,
      s.avg_qty,
      'Usually ordered at this location' as reason
    from item_stats s
    cross join total_count t
    where t.cnt > 0
      and s.times_ordered::numeric / nullif(t.cnt, 0) >= coalesce(p_min_frequency, 0.25)
    order by
      round(s.times_ordered::numeric / nullif(t.cnt, 0), 2) desc,
      s.times_ordered desc,
      s.last_ordered_at desc,
      s.item_name asc
    limit greatest(coalesce(p_limit, 12), 1)
  ) as row_data;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, full_name, provider, profile_completed)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      null
    ),
    coalesce(new.raw_app_meta_data->>'provider', 'email'),
    false
  )
  on conflict (id) do update
  set email = coalesce(excluded.email, public.profiles.email);

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'employee'::public.user_role
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(excluded.name, public.users.name);

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.has_org_role(target_org_id uuid, allowed_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.org_memberships m
    where m.org_id = target_org_id
      and m.user_id = auth.uid()
      and m.accepted_at is not null
      and m.role = any(allowed_roles)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_org_member(target_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.org_memberships m
    where m.org_id = target_org_id
      and m.user_id = auth.uid()
      and m.accepted_at is not null
  );
$function$
;

CREATE OR REPLACE FUNCTION public.link_employee_quick_order_aliases_for_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name_key text;
begin
  v_name_key := public.normalize_quick_order_employee_name(new.full_name);
  if v_name_key is null then
    return new;
  end if;

  update public.employee_quick_order_aliases
  set employee_user_id = new.id
  where employee_user_id is null
    and employee_name_key = v_name_key;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.link_employee_quick_order_aliases_for_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name_key text;
begin
  v_name_key := public.normalize_quick_order_employee_name(new.name);
  if v_name_key is null then
    return new;
  end if;

  update public.employee_quick_order_aliases
  set employee_user_id = new.id
  where employee_user_id is null
    and employee_name_key = v_name_key;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.link_historical_imports_for_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name_key text;
begin
  v_name_key := public.normalize_history_employee_name(new.name);
  if v_name_key is null then
    return new;
  end if;

  update public.historical_order_imports
  set employee_id = new.id
  where employee_id is null
    and employee_name_key = v_name_key;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.manager_update_access_codes(p_employee_code text, p_manager_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  caller_role text;
begin
  select role into caller_role
  from public.users
  where id = auth.uid();

  if caller_role is null or caller_role != 'manager' then
    raise exception 'Only managers can update access codes';
  end if;

  if p_employee_code is null or p_employee_code !~ '^[0-9]{4}$' then
    raise exception 'Employee access code must be exactly 4 digits';
  end if;

  if p_manager_code is null or p_manager_code !~ '^[0-9]{4}$' then
    raise exception 'Manager access code must be exactly 4 digits';
  end if;

  if p_employee_code = p_manager_code then
    raise exception 'Employee and manager access codes must be different';
  end if;

  update public.org_settings
  set
    employee_access_code = crypt(p_employee_code, gen_salt('bf')),
    manager_access_code = crypt(p_manager_code, gen_salt('bf')),
    updated_by = auth.uid()
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid;

  if not found then
    insert into public.org_settings (org_id, employee_access_code, manager_access_code, updated_by)
    values (
      '00000000-0000-0000-0000-000000000001'::uuid,
      crypt(p_employee_code, gen_salt('bf')),
      crypt(p_manager_code, gen_salt('bf')),
      auth.uid()
    );
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.normalize_history_employee_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(regexp_replace(lower(trim(coalesce(p_name, ''))), '\s+', ' ', 'g'), '')
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_org_settings_access_codes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  normalized_employee text;
  normalized_manager text;
begin
  normalized_employee := trim(coalesce(new.employee_access_code, ''));
  normalized_manager := trim(coalesce(new.manager_access_code, ''));

  if normalized_employee ~ '^[0-9]{4}$' then
    new.employee_access_code := extensions.crypt(normalized_employee, extensions.gen_salt('bf'));
  elsif normalized_employee ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    new.employee_access_code := normalized_employee;
  else
    raise exception 'employee_access_code must be exactly 4 digits';
  end if;

  if normalized_manager ~ '^[0-9]{4}$' then
    new.manager_access_code := extensions.crypt(normalized_manager, extensions.gen_salt('bf'));
  elsif normalized_manager ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    new.manager_access_code := normalized_manager;
  else
    raise exception 'manager_access_code must be exactly 4 digits';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_quick_order_alias_text(p_alias text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(regexp_replace(lower(trim(coalesce(p_alias, ''))), '\s+', ' ', 'g'), '')
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_quick_order_employee_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(regexp_replace(lower(trim(coalesce(p_name, ''))), '\s+', ' ', 'g'), '')
$function$
;

CREATE OR REPLACE FUNCTION public.org_has_members(target_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.org_memberships m
    where m.org_id = target_org_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_item_order_profiles(p_location_id uuid DEFAULT NULL::uuid, p_lookback_orders integer DEFAULT 12)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows integer := 0;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can refresh Quick Order profiles';
  end if;

  with history_items as (
    select
      oi.inventory_item_id as item_id,
      o.location_id,
      null::uuid as supplier_id,
      oi.quantity::numeric as quantity,
      case
        when oi.unit_type = 'pack' then ii.pack_unit
        when oi.unit_type = 'base' then ii.base_unit
        else oi.unit_type
      end as unit,
      o.created_at as placed_at,
      extract(dow from o.created_at)::int as weekday,
      'submitted_orders'::text as source,
      o.id::text as order_key
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join public.inventory_items ii on ii.id = oi.inventory_item_id
    where oi.inventory_item_id is not null
      and oi.quantity > 0
      and o.status <> 'draft'
      and (p_location_id is null or o.location_id = p_location_id)

    union all

    select
      hii.item_id,
      hi.location_id,
      coalesce(hii.supplier_id, hi.supplier_id) as supplier_id,
      hii.quantity::numeric as quantity,
      hii.unit,
      hi.placed_at,
      extract(dow from hi.placed_at)::int as weekday,
      'manager_import'::text as source,
      hi.id::text as order_key
    from public.historical_order_import_items hii
    join public.historical_order_imports hi on hi.id = hii.import_id
    where hi.status = 'imported'
      and hii.quantity > 0
      and (p_location_id is null or hi.location_id = p_location_id)
  ),
  ranked_items as (
    select
      *,
      row_number() over (
        partition by item_id, location_id, coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
        order by placed_at desc
      ) as rn
    from history_items
  ),
  recent as (
    select * from ranked_items where rn <= greatest(1, p_lookback_orders)
  ),
  grouped as (
    select
      item_id,
      location_id,
      supplier_id,
      percentile_cont(0.5) within group (order by quantity) as p50_quantity,
      percentile_cont(0.75) within group (order by quantity) as p75_quantity,
      percentile_cont(0.95) within group (order by quantity) as p95_quantity,
      (array_agg(quantity order by placed_at desc))[1] as last_order_quantity,
      (array_agg(unit order by placed_at desc))[1] as last_order_unit,
      max(placed_at) as last_ordered_at,
      count(*)::int as sample_size,
      count(*)::int as ordered_count_recent,
      count(distinct order_key)::int as total_similar_orders,
      (array_agg(weekday order by placed_at desc))[1] as weekday,
      case when count(*) > 0 then least(1, count(*)::numeric / greatest(1, p_lookback_orders)::numeric) else 0 end as confidence_score,
      case when bool_or(source = 'manager_import') then 'manager_import' else 'submitted_orders' end as source
    from recent
    group by item_id, location_id, supplier_id
  )
  insert into public.item_order_profiles (
    item_id,
    location_id,
    supplier_id,
    usual_quantity,
    usual_unit,
    p50_quantity,
    p75_quantity,
    p95_quantity,
    last_order_quantity,
    last_order_unit,
    last_ordered_at,
    sample_size,
    weekday,
    ordered_count_recent,
    total_similar_orders,
    confidence_score,
    source,
    updated_at
  )
  select
    item_id,
    location_id,
    supplier_id,
    p50_quantity,
    last_order_unit,
    p50_quantity,
    p75_quantity,
    p95_quantity,
    last_order_quantity,
    last_order_unit,
    last_ordered_at,
    sample_size,
    weekday,
    ordered_count_recent,
    total_similar_orders,
    confidence_score,
    source,
    now()
  from grouped
  on conflict (
    item_id,
    (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  do update set
    usual_quantity = excluded.usual_quantity,
    usual_unit = excluded.usual_unit,
    p50_quantity = excluded.p50_quantity,
    p75_quantity = excluded.p75_quantity,
    p95_quantity = excluded.p95_quantity,
    last_order_quantity = excluded.last_order_quantity,
    last_order_unit = excluded.last_order_unit,
    last_ordered_at = excluded.last_ordered_at,
    sample_size = excluded.sample_size,
    weekday = excluded.weekday,
    ordered_count_recent = excluded.ordered_count_recent,
    total_similar_orders = excluded.total_similar_orders,
    confidence_score = excluded.confidence_score,
    source = excluded.source,
    updated_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_active_location_banners_for_location(p_location_id uuid, p_order_created_at timestamp with time zone DEFAULT now(), p_order_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_active_reminders_for_employee(p_employee_id uuid, p_order_created_at timestamp with time zone DEFAULT now(), p_order_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_active_reminders_on_order_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_employee_quick_order_alias_keys()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.employee_name_key := public.normalize_quick_order_employee_name(new.employee_name);
  new.alias_key := public.normalize_quick_order_alias_text(new.alias_text);

  if new.employee_name_key is null then
    raise exception 'employee_name is required';
  end if;

  if new.alias_key is null then
    raise exception 'alias_text is required';
  end if;

  if new.employee_user_id is null then
    select u.id
      into new.employee_user_id
    from public.users u
    where public.normalize_quick_order_employee_name(u.name) = new.employee_name_key
    order by u.created_at asc
    limit 1;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_historical_import_employee_name_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.employee_name_key := public.normalize_history_employee_name(new.employee_name_text);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_org_access_codes_plain(p_employee_access_code text, p_manager_access_code text, p_updated_by uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  employee_code text := trim(coalesce(p_employee_access_code, ''));
  manager_code text := trim(coalesce(p_manager_access_code, ''));
begin
  if employee_code !~ '^[0-9]{4}$' then
    raise exception 'Employee access code must be exactly 4 digits';
  end if;

  if manager_code !~ '^[0-9]{4}$' then
    raise exception 'Manager access code must be exactly 4 digits';
  end if;

  if employee_code = manager_code then
    raise exception 'Employee and manager access codes must be different';
  end if;

  -- Prefer canonical row.
  update public.org_settings
  set
    employee_access_code = extensions.crypt(employee_code, extensions.gen_salt('bf')),
    manager_access_code = extensions.crypt(manager_code, extensions.gen_salt('bf')),
    updated_by = p_updated_by,
    updated_at = now()
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid;

  if found then
    return;
  end if;

  -- Fallback: update latest row if canonical row doesn't exist.
  update public.org_settings
  set
    employee_access_code = extensions.crypt(employee_code, extensions.gen_salt('bf')),
    manager_access_code = extensions.crypt(manager_code, extensions.gen_salt('bf')),
    updated_by = p_updated_by,
    updated_at = now()
  where id = (
    select id
    from public.org_settings
    order by updated_at desc nulls last
    limit 1
  );

  if found then
    return;
  end if;

  insert into public.org_settings (
    org_id,
    employee_access_code,
    manager_access_code,
    updated_by
  ) values (
    '00000000-0000-0000-0000-000000000001'::uuid,
    extensions.crypt(employee_code, extensions.gen_salt('bf')),
    extensions.crypt(manager_code, extensions.gen_salt('bf')),
    p_updated_by
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_org_settings_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_profiles_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_order_rpc(p_id uuid, p_org_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'submitted'::text, p_items jsonb DEFAULT '[]'::jsonb, p_entry_method text DEFAULT 'manual'::text, p_quick_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    if coalesce(p_entry_method, 'manual') in ('manual', 'quick_order', 'voice_order', 'suggested_order') then
      v_entry_method := coalesce(p_entry_method, 'manual');
    else
      v_entry_method := 'manual';
    end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_auth_user_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.upsert_identity_from_auth_user(new.id);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_profile_after_order(p_user_id uuid, p_order_created_at timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set
      email = new.email,
      updated_at = now()
    where id = new.id
      and email is distinct from new.email;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_profile_last_order_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
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
$function$
;

CREATE OR REPLACE FUNCTION public.tip_auth_attempt_allowed(p_identifier_hash text, p_scope text, p_location_id uuid, p_max_per_identifier integer, p_max_per_location integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  identifier_failures integer;
  location_failures integer;
begin
  -- Serialize concurrent attempts for this identifier (and location) so a
  -- burst of parallel requests cannot all read a below-limit count before
  -- any failure is recorded (transaction-scoped advisory locks).
  perform pg_advisory_xact_lock(hashtext('tip_auth:' || p_scope || ':' || p_identifier_hash));
  if p_location_id is not null then
    perform pg_advisory_xact_lock(hashtext('tip_auth_loc:' || p_scope || ':' || p_location_id::text));
  end if;

  -- Opportunistic cleanup keeps the ledger small.
  delete from public.tip_auth_attempts where attempted_at < now() - interval '2 days';

  select count(*) into identifier_failures
  from public.tip_auth_attempts
  where identifier_hash = p_identifier_hash
    and scope = p_scope
    and success = false
    and attempted_at > now() - interval '10 minutes';

  if identifier_failures >= p_max_per_identifier then
    return false;
  end if;

  if p_location_id is not null then
    select count(*) into location_failures
    from public.tip_auth_attempts
    where location_id = p_location_id
      and scope = p_scope
      and success = false
      and attempted_at > now() - interval '10 minutes';
    if location_failures >= p_max_per_location then
      return false;
    end if;
  end if;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tip_revoke_location_sessions(p_location_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can sign out devices';
  end if;
  update public.tip_entry_sessions
  set revoked = true
  where location_id = p_location_id
    and revoked = false;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tip_rotate_entry_pin(p_location_id uuid, p_pin text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_pin text;
  v_rand bytea;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can rotate entry PINs';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id) then
    raise exception 'Unknown location';
  end if;

  if p_pin is not null then
    if p_pin !~ '^[0-9]{4}$' then
      raise exception 'PIN must be exactly 4 digits';
    end if;
    v_pin := p_pin;
  else
    -- Cryptographic randomness (random() is a predictable PRNG).
    v_rand := extensions.gen_random_bytes(3);
    v_pin := lpad((
      (get_byte(v_rand, 0) * 65536 + get_byte(v_rand, 1) * 256 + get_byte(v_rand, 2)) % 10000
    )::text, 4, '0');
  end if;

  insert into public.tip_location_access (location_id, pin_hash, pin_rotated_at, updated_by)
  values (p_location_id, extensions.crypt(v_pin, extensions.gen_salt('bf')), now(), auth.uid())
  on conflict (location_id) do update
    set pin_hash = excluded.pin_hash,
        pin_rotated_at = excluded.pin_rotated_at,
        updated_by = excluded.updated_by;

  return v_pin;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tip_rotate_entry_token(p_location_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_token text;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can rotate entry tokens';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id) then
    raise exception 'Unknown location';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');

  insert into public.tip_location_access (location_id, entry_token_hash, token_rotated_at, updated_by)
  values (p_location_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now(), auth.uid())
  on conflict (location_id) do update
    set entry_token_hash = excluded.entry_token_hash,
        token_rotated_at = excluded.token_rotated_at,
        updated_by = excluded.updated_by;

  return v_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tip_save_entry(p_business_date date, p_location_id uuid, p_meal_period text, p_cash numeric, p_card numeric, p_people uuid[], p_entry_method text, p_voice_variant text, p_corrections integer, p_entered_by uuid, p_flagged boolean, p_anomaly_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry_id uuid;
begin
  if array_length(p_people, 1) is null or array_length(p_people, 1) < 1 then
    raise exception 'At least one person must split the entry';
  end if;

  insert into public.tip_entries (
    business_date, location_id, meal_period, cash_amount, card_amount,
    split_count, entry_method, voice_variant, corrections_count,
    entered_by, flagged_anomaly, anomaly_reason
  ) values (
    p_business_date, p_location_id, p_meal_period, p_cash, p_card,
    array_length(p_people, 1), p_entry_method,
    case when p_entry_method = 'voice' then p_voice_variant else null end,
    p_corrections, p_entered_by, p_flagged, p_anomaly_reason
  )
  on conflict (business_date, location_id, meal_period) do update
    set cash_amount = excluded.cash_amount,
        card_amount = excluded.card_amount,
        split_count = excluded.split_count,
        entry_method = excluded.entry_method,
        voice_variant = coalesce(excluded.voice_variant, public.tip_entries.voice_variant),
        corrections_count = case
          when excluded.entry_method = 'voice' then excluded.corrections_count
          else public.tip_entries.corrections_count
        end,
        entered_by = excluded.entered_by,
        flagged_anomaly = excluded.flagged_anomaly,
        anomaly_reason = excluded.anomaly_reason
  returning id into v_entry_id;

  delete from public.tip_entry_people where tip_entry_id = v_entry_id;
  insert into public.tip_entry_people (tip_entry_id, tip_employee_id)
  select v_entry_id, unnest(p_people);

  return v_entry_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.tip_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tip_validate_entry_pin(p_location_id uuid, p_pin text, p_identifier_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_pin_hash text;
  v_location_name text;
  v_ok boolean := false;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or p_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if not public.tip_auth_attempt_allowed(p_identifier_hash, 'pin', p_location_id, 6, 30) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  select a.pin_hash, l.name
    into v_pin_hash, v_location_name
  from public.tip_location_access a
  join public.locations l on l.id = a.location_id
  where a.location_id = p_location_id;

  if v_pin_hash is not null then
    v_ok := v_pin_hash = extensions.crypt(p_pin, v_pin_hash);
  end if;

  insert into public.tip_auth_attempts (identifier_hash, scope, location_id, success)
  values (p_identifier_hash, 'pin', p_location_id, v_ok);

  if not v_ok then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  return jsonb_build_object(
    'ok', true,
    'location_id', p_location_id,
    'location_name', v_location_name
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tip_validate_entry_token(p_token text, p_identifier_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash text;
  v_location_id uuid;
  v_location_name text;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if not public.tip_auth_attempt_allowed(p_identifier_hash, 'token', null, 20, 0) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select a.location_id, l.name
    into v_location_id, v_location_name
  from public.tip_location_access a
  join public.locations l on l.id = a.location_id
  where a.entry_token_hash = v_hash;

  insert into public.tip_auth_attempts (identifier_hash, scope, location_id, success)
  values (p_identifier_hash, 'token', v_location_id, v_location_id is not null);

  if v_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  return jsonb_build_object(
    'ok', true,
    'location_id', v_location_id,
    'location_name', v_location_name
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_org_access_codes(p_employee_access_code text, p_manager_access_code text, p_updated_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if p_employee_access_code is null or p_employee_access_code !~ '^[0-9]{4}$' then
    raise exception 'Employee access code must be exactly 4 digits';
  end if;

  if p_manager_access_code is null or p_manager_access_code !~ '^[0-9]{4}$' then
    raise exception 'Manager access code must be exactly 4 digits';
  end if;

  if p_employee_access_code = p_manager_access_code then
    raise exception 'Employee and manager access codes must be different';
  end if;

  update public.org_settings
  set
    employee_access_code = extensions.crypt(p_employee_access_code, extensions.gen_salt('bf')),
    manager_access_code = extensions.crypt(p_manager_access_code, extensions.gen_salt('bf')),
    updated_by = p_updated_by,
    updated_at = now()
  where org_id = '00000000-0000-0000-0000-000000000001'::uuid;

  if not found then
    insert into public.org_settings (
      org_id,
      employee_access_code,
      manager_access_code,
      updated_by
    ) values (
      '00000000-0000-0000-0000-000000000001'::uuid,
      extensions.crypt(p_employee_access_code, extensions.gen_salt('bf')),
      extensions.crypt(p_manager_access_code, extensions.gen_salt('bf')),
      p_updated_by
    );
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_identity_from_auth_user(p_auth_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    role = coalesce(v_granted_role::text, public.profiles.role),
    provider = coalesce(public.profiles.provider, excluded.provider),
    profile_completed = public.profiles.profile_completed
      or (v_full_name is not null and coalesce(v_granted_role::text, public.profiles.role) is not null),
    updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_access_code_attempt(p_access_code text, p_identifier_hash text, p_subject_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.access_code_rate_limits (
  identifier_hash text NOT NULL,
  window_started_at timestamp with time zone DEFAULT now() NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  locked_until timestamp with time zone,
  last_attempt_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.access_code_role_grants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  subject_hash text NOT NULL,
  role user_role NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
  consumed_at timestamp with time zone
);
CREATE TABLE public.access_code_validation_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  identifier_hash text NOT NULL,
  outcome text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.app_config (
  key text NOT NULL,
  value jsonb NOT NULL,
  description text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);
CREATE TABLE public.area_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  area_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  min_quantity numeric DEFAULT 0 NOT NULL,
  max_quantity numeric DEFAULT 0 NOT NULL,
  par_level numeric,
  current_quantity numeric DEFAULT 0 NOT NULL,
  unit_type text NOT NULL,
  last_updated_at timestamp with time zone,
  last_updated_by uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  active boolean DEFAULT true NOT NULL,
  order_unit text,
  conversion_factor numeric
);
CREATE TABLE public.calibration_results (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  location_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  calibration_date date,
  counted_start numeric,
  counted_end numeric,
  calculated_usage numeric,
  actual_usage numeric,
  discrepancy_pct numeric,
  adjustment_factor numeric,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.current_stock_snapshots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  location_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity numeric NOT NULL,
  unit text,
  source_message text,
  source text NOT NULL,
  entered_by_user_id uuid,
  quick_order_session_id uuid,
  confidence numeric DEFAULT 0.8 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  tracking_unit text,
  tracking_unit_key text GENERATED ALWAYS AS (COALESCE(normalize_quick_order_alias_text(tracking_unit), '__default__'::text)) STORED
);
CREATE TABLE public.daily_sales (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  location_id uuid NOT NULL,
  square_order_id text NOT NULL,
  square_catalog_item_id text,
  item_name text,
  quantity_sold numeric NOT NULL,
  sold_at timestamp with time zone NOT NULL,
  synced_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.demand_forecasts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  location_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  forecast_date date NOT NULL,
  forecast_quantity numeric NOT NULL,
  forecast_unit text NOT NULL,
  confidence text DEFAULT 'none'::text NOT NULL,
  reasoning_text text,
  data_points_used integer,
  computed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.device_push_tokens (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  expo_push_token text NOT NULL,
  platform text DEFAULT 'unknown'::text NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.employee_quick_order_aliases (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_name text NOT NULL,
  employee_name_key text NOT NULL,
  employee_user_id uuid,
  alias_text text NOT NULL,
  alias_key text NOT NULL,
  inventory_item_id uuid NOT NULL,
  location_id uuid,
  location_key text GENERATED ALWAYS AS (COALESCE((location_id)::text, 'global'::text)) STORED,
  active boolean DEFAULT true NOT NULL,
  notes text,
  source text DEFAULT 'google_sheet'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.forecast_accuracy (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  location_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  forecast_date date,
  predicted_quantity numeric,
  actual_quantity numeric,
  error_pct numeric,
  manager_adjusted boolean DEFAULT false NOT NULL,
  manager_adjusted_to numeric,
  suggestion_accepted boolean,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.historical_order_import_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  import_id uuid NOT NULL,
  item_id uuid NOT NULL,
  item_name_snapshot text NOT NULL,
  quantity numeric NOT NULL,
  unit text NOT NULL,
  supplier_id uuid,
  original_line text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.historical_order_imports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  imported_by uuid,
  employee_id uuid,
  location_id uuid NOT NULL,
  supplier_id uuid,
  placed_at timestamp with time zone NOT NULL,
  original_text text NOT NULL,
  status text DEFAULT 'imported'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  employee_name_text text,
  employee_name_key text,
  placed_at_text text
);
CREATE TABLE public.historical_orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  location_id uuid NOT NULL,
  order_date date NOT NULL,
  inventory_item_id uuid NOT NULL,
  quantity numeric NOT NULL,
  unit_type text NOT NULL,
  source text NOT NULL,
  raw_item_name text,
  import_batch_id uuid,
  cleaned_by_ai boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.holiday_multipliers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  category text,
  multiplier numeric DEFAULT 1.0 NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.import_batches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  file_name text,
  file_type text NOT NULL,
  status text DEFAULT 'processing'::text NOT NULL,
  total_rows integer,
  matched_rows integer,
  unmatched_rows integer,
  ai_cleaned boolean DEFAULT false NOT NULL,
  error_log jsonb DEFAULT '[]'::jsonb NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);
CREATE TABLE public.integrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  provider text NOT NULL,
  status text DEFAULT 'connected'::text NOT NULL,
  oauth_state text NOT NULL,
  merchant_id text,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.inventory_items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  name text NOT NULL,
  base_unit text DEFAULT ''::text NOT NULL,
  pack_unit text DEFAULT ''::text NOT NULL,
  pack_size integer DEFAULT 1 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  default_supplier text,
  emoji text DEFAULT ''::text,
  secondary_supplier text,
  supplier_id uuid,
  category text NOT NULL,
  supplier_category text NOT NULL,
  aliases text[] DEFAULT '{}'::text[] NOT NULL,
  allowed_units text[],
  hard_cap numeric,
  soft_cap numeric,
  safety_stock numeric,
  target_stock numeric,
  default_order_unit text,
  location_id uuid,
  item_key text,
  secondary_supplier_id uuid,
  notes text
);
CREATE TABLE public.inventory_reorder_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  active boolean DEFAULT true NOT NULL,
  location_id uuid,
  location_key text GENERATED ALWAYS AS (COALESCE((location_id)::text, 'global'::text)) STORED,
  inventory_item_id uuid NOT NULL,
  applies_to_mode text DEFAULT 'inventory_only'::text NOT NULL,
  trigger_type text NOT NULL,
  trigger_qty numeric,
  trigger_qty_max numeric,
  trigger_qty_key text GENERATED ALWAYS AS (COALESCE((trigger_qty)::text, 'none'::text)) STORED,
  trigger_qty_max_key text GENERATED ALWAYS AS (COALESCE((trigger_qty_max)::text, 'none'::text)) STORED,
  trigger_unit text,
  trigger_unit_key text GENERATED ALWAYS AS (COALESCE(lower(TRIM(BOTH FROM trigger_unit)), 'none'::text)) STORED,
  order_strategy text NOT NULL,
  order_qty numeric,
  order_unit text,
  priority integer DEFAULT 100 NOT NULL,
  notes text,
  source text DEFAULT 'google_sheet'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.inventory_status_terms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  active boolean DEFAULT true NOT NULL,
  phrase text NOT NULL,
  phrase_key text NOT NULL,
  status text NOT NULL,
  remaining_qty numeric,
  remaining_unit_behavior text DEFAULT 'none'::text NOT NULL,
  recommendation_action text NOT NULL,
  priority integer DEFAULT 100 NOT NULL,
  notes text,
  source text DEFAULT 'google_sheet'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.item_allowed_units (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_id uuid NOT NULL,
  unit text NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  conversion_to_base_unit numeric,
  min_quantity numeric,
  soft_max_quantity numeric,
  hard_max_quantity numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  employee_names text,
  max_quantity numeric,
  order_quantity numeric,
  order_unit text
);
CREATE TABLE public.item_order_constraints (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  inventory_item_id uuid NOT NULL,
  min_order_qty numeric,
  max_order_qty numeric,
  max_change_pct numeric DEFAULT 50 NOT NULL,
  preferred_supplier_id uuid,
  delivery_days integer[],
  lead_time_days integer DEFAULT 1 NOT NULL,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.item_order_limits (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_id uuid NOT NULL,
  location_id uuid,
  supplier_id uuid,
  default_order_unit text,
  typical_min_quantity numeric,
  typical_max_quantity numeric,
  soft_max_quantity numeric,
  hard_max_quantity numeric,
  manager_approval_quantity numeric,
  allow_employee_override boolean DEFAULT false NOT NULL,
  allow_manager_override boolean DEFAULT true NOT NULL,
  max_single_order_quantity numeric,
  max_daily_quantity numeric,
  max_weekly_quantity numeric,
  historical_median_quantity numeric,
  historical_p95_quantity numeric,
  historical_max_quantity numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.item_order_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_id uuid NOT NULL,
  location_id uuid,
  supplier_id uuid,
  usual_quantity numeric,
  usual_unit text,
  p50_quantity numeric,
  p75_quantity numeric,
  p95_quantity numeric,
  last_order_quantity numeric,
  last_order_unit text,
  last_ordered_at timestamp with time zone,
  weekday_pattern_json jsonb,
  monthly_pattern_json jsonb,
  sample_size integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  weekday integer,
  ordered_count_recent integer DEFAULT 0 NOT NULL,
  total_similar_orders integer DEFAULT 0 NOT NULL,
  confidence_score numeric,
  source text DEFAULT 'submitted_orders'::text NOT NULL
);
CREATE TABLE public.item_reorder_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_id uuid NOT NULL,
  location_id uuid,
  supplier_id uuid,
  target_stock_quantity numeric,
  target_stock_unit text,
  min_stock_quantity numeric,
  max_stock_quantity numeric,
  usual_order_quantity numeric,
  usual_order_unit text,
  min_order_quantity numeric DEFAULT 1 NOT NULL,
  order_increment numeric DEFAULT 1 NOT NULL,
  allow_fractional_stock_count boolean DEFAULT true NOT NULL,
  allow_fractional_order boolean DEFAULT false NOT NULL,
  rounding_policy text DEFAULT 'nearest'::text NOT NULL,
  criticality text,
  shelf_life_days integer,
  lead_time_days integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.locations (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  name text NOT NULL,
  short_code text NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  address text,
  phone text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  location_key text
);
CREATE TABLE public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  notification_type text DEFAULT 'general'::text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.order_items (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  order_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  quantity numeric(10,2) NOT NULL,
  unit_type unit_type DEFAULT 'base'::unit_type NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  input_mode text DEFAULT 'quantity'::text NOT NULL,
  quantity_requested numeric,
  remaining_reported numeric,
  decided_quantity numeric,
  decided_by uuid,
  decided_at timestamp with time zone,
  note text,
  supplier_override_id uuid,
  status text DEFAULT 'pending'::text NOT NULL,
  org_id uuid,
  was_suggested boolean DEFAULT false NOT NULL,
  original_suggested_qty numeric
);
CREATE TABLE public.order_later_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  scheduled_at timestamp with time zone NOT NULL,
  item_id uuid,
  item_name text NOT NULL,
  unit text NOT NULL,
  location_id uuid,
  location_name text,
  notes text,
  preferred_supplier_id text,
  preferred_location_group text,
  source_order_item_id uuid,
  source_order_id uuid,
  notification_id text,
  status text DEFAULT 'queued'::text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  added_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  qty numeric,
  suggested_supplier_id uuid,
  original_order_item_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL
);
CREATE TABLE public.ordering_patterns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  location_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  day_of_week integer NOT NULL,
  weighted_avg_quantity numeric,
  seasonality_index numeric DEFAULT 1.0 NOT NULL,
  trend_pct numeric DEFAULT 0.0 NOT NULL,
  variance numeric,
  coefficient_of_variation numeric,
  data_maturity text DEFAULT 'none'::text NOT NULL,
  last_computed_at timestamp with time zone
);
CREATE TABLE public.orders (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  order_number integer DEFAULT nextval('orders_order_number_seq'::regclass) NOT NULL,
  user_id uuid NOT NULL,
  location_id uuid NOT NULL,
  status order_status DEFAULT 'draft'::order_status NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  fulfilled_at timestamp with time zone,
  fulfilled_by uuid,
  org_id uuid,
  order_type text DEFAULT 'manual'::text NOT NULL,
  entry_method text DEFAULT 'manual'::text NOT NULL,
  quick_session_id uuid,
  manager_review_status text DEFAULT 'not_required'::text NOT NULL,
  manager_review_notes text,
  manager_reviewed_at timestamp with time zone,
  manager_reviewed_by uuid
);
CREATE TABLE public.org_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  employee_access_code text NOT NULL,
  manager_access_code text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid,
  notes text
);
CREATE TABLE public.parser_corrections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid,
  user_id uuid,
  raw_token text NOT NULL,
  parser_suggested_item_id uuid,
  user_corrected_item_id uuid,
  user_corrected_qty numeric,
  user_corrected_unit text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  location_id uuid,
  correction_type text
);
CREATE TABLE public.parser_examples (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  raw_text text NOT NULL,
  structured_output jsonb DEFAULT '[]'::jsonb NOT NULL,
  source text DEFAULT 'manager'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.parser_usage_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  org_id uuid,
  session_id uuid,
  call_type text NOT NULL,
  parser_mode text NOT NULL,
  ai_provider text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  estimated_cost_usd numeric(10,6),
  duration_ms integer,
  succeeded boolean DEFAULT true NOT NULL,
  error_code text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  metrics jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.past_order_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  past_order_id uuid NOT NULL,
  supplier_id text NOT NULL,
  created_by uuid NOT NULL,
  item_id text NOT NULL,
  item_name text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL,
  location_id text,
  location_name text,
  location_group text,
  unit_type text,
  ordered_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  note text
);
CREATE TABLE public.past_orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  supplier_id text,
  supplier_name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  message_text text NOT NULL,
  share_method text DEFAULT 'share'::text NOT NULL
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text,
  role text,
  profile_completed boolean DEFAULT false NOT NULL,
  provider text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  notifications_enabled boolean DEFAULT true NOT NULL,
  is_suspended boolean DEFAULT false NOT NULL,
  last_active_at timestamp with time zone,
  last_order_at timestamp with time zone,
  email text,
  suspended_at timestamp with time zone,
  suspended_by uuid
);
CREATE TABLE public.qo_holiday_overrides (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  holiday_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  item_name text NOT NULL,
  location_scope text,
  target_multiplier numeric DEFAULT 1 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.qo_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  inventory_item_id uuid,
  name text NOT NULL,
  item_key text GENERATED ALWAYS AS (normalize_quick_order_alias_text(name)) STORED,
  category text,
  aliases text,
  supplier text DEFAULT ''::text NOT NULL,
  supplier_id uuid,
  order_unit text NOT NULL,
  target_stock numeric,
  location_scope text,
  location_id uuid,
  location_key text GENERATED ALWAYS AS (COALESCE((location_id)::text, normalize_quick_order_alias_text(location_scope), 'global'::text)) STORED,
  active boolean DEFAULT true NOT NULL,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.qo_keywords (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  phrase text NOT NULL,
  phrase_key text GENERATED ALWAYS AS (normalize_quick_order_alias_text(phrase)) STORED,
  meaning_type text NOT NULL,
  equals_unit text,
  status text,
  remaining_qty numeric,
  action text,
  active boolean DEFAULT true NOT NULL,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.qo_personalization (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_name text NOT NULL,
  employee_name_key text GENERATED ALWAYS AS (normalize_quick_order_employee_name(employee_name)) STORED,
  employee_user_id uuid,
  rule_type text NOT NULL,
  phrase text,
  phrase_key text GENERATED ALWAYS AS (COALESCE(normalize_quick_order_alias_text(phrase), 'none'::text)) STORED,
  item_name text NOT NULL,
  item_name_key text GENERATED ALWAYS AS (normalize_quick_order_alias_text(item_name)) STORED,
  qo_item_id uuid,
  personal_unit text,
  personal_unit_key text GENERATED ALWAYS AS (COALESCE(normalize_quick_order_alias_text(personal_unit), 'none'::text)) STORED,
  personal_unit_equals text,
  trigger_at_or_below numeric,
  order_qty numeric,
  order_unit text,
  location_scope text,
  location_id uuid,
  location_key text GENERATED ALWAYS AS (COALESCE((location_id)::text, normalize_quick_order_alias_text(location_scope), 'global'::text)) STORED,
  active boolean DEFAULT true NOT NULL,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.qo_reorder_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_name text NOT NULL,
  item_name_key text GENERATED ALWAYS AS (normalize_quick_order_alias_text(item_name)) STORED,
  qo_item_id uuid,
  location_id uuid,
  location_scope text,
  location_key text GENERATED ALWAYS AS (COALESCE((location_id)::text, normalize_quick_order_alias_text(location_scope), 'global'::text)) STORED,
  trigger_at_or_below numeric NOT NULL,
  trigger_unit text NOT NULL,
  trigger_unit_key text GENERATED ALWAYS AS (normalize_quick_order_alias_text(trigger_unit)) STORED,
  order_qty numeric NOT NULL,
  order_unit text,
  active boolean DEFAULT true NOT NULL,
  notes text,
  sync_status text,
  sync_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.quick_order_alias_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  alias_text text NOT NULL,
  alias_key text GENERATED ALWAYS AS (normalize_quick_order_alias_text(alias_text)) STORED,
  item_id uuid NOT NULL,
  scope_type text DEFAULT 'global'::text NOT NULL,
  employee_name text,
  employee_name_key text GENERATED ALWAYS AS (normalize_quick_order_employee_name(employee_name)) STORED,
  employee_scope_key text GENERATED ALWAYS AS (COALESCE(normalize_quick_order_employee_name(employee_name), 'global'::text)) STORED,
  employee_user_id uuid,
  mode_scope text DEFAULT 'both'::text NOT NULL,
  location_id uuid,
  location_key text GENERATED ALWAYS AS (COALESCE((location_id)::text, 'global'::text)) STORED,
  active boolean DEFAULT true NOT NULL,
  notes text,
  source text DEFAULT 'google_sheet'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.quick_order_cart_mutations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid,
  user_id uuid,
  order_id uuid,
  location_id uuid,
  mutation_type text NOT NULL,
  source_message text,
  assistant_message text,
  before_cart jsonb NOT NULL,
  after_cart jsonb NOT NULL,
  delta jsonb,
  affected_items jsonb,
  revert_status text DEFAULT 'active'::text NOT NULL,
  reverted_at timestamp with time zone,
  reverted_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.quick_order_ignored_suggestions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  location_id uuid,
  item_id uuid NOT NULL,
  suggestion_type text,
  context jsonb DEFAULT '{}'::jsonb NOT NULL,
  ignored_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.quick_order_reorder_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_id uuid NOT NULL,
  scope_type text DEFAULT 'global'::text NOT NULL,
  employee_name text,
  employee_name_key text GENERATED ALWAYS AS (normalize_quick_order_employee_name(employee_name)) STORED,
  employee_scope_key text GENERATED ALWAYS AS (COALESCE(normalize_quick_order_employee_name(employee_name), 'global'::text)) STORED,
  employee_user_id uuid,
  mode_scope text DEFAULT 'inventory'::text NOT NULL,
  location_id uuid,
  location_key text GENERATED ALWAYS AS (COALESCE((location_id)::text, 'global'::text)) STORED,
  counted_unit text,
  counted_unit_key text GENERATED ALWAYS AS (COALESCE(normalize_quick_order_alias_text(counted_unit), 'any'::text)) STORED,
  trigger_type text NOT NULL,
  trigger_qty_min numeric,
  trigger_qty_max numeric,
  trigger_qty_min_key text GENERATED ALWAYS AS (COALESCE((trigger_qty_min)::text, 'none'::text)) STORED,
  trigger_qty_max_key text GENERATED ALWAYS AS (COALESCE((trigger_qty_max)::text, 'none'::text)) STORED,
  action_type text NOT NULL,
  order_qty numeric,
  order_unit text,
  target_qty numeric,
  target_unit text,
  priority integer,
  active boolean DEFAULT true NOT NULL,
  notes text,
  source text DEFAULT 'google_sheet'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.quick_order_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid,
  location_id uuid,
  user_id uuid,
  status text DEFAULT 'active'::text NOT NULL,
  messages jsonb DEFAULT '[]'::jsonb NOT NULL,
  parsed_items jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  submitted_order_id uuid
);
CREATE TABLE public.quick_order_status_terms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  phrase text NOT NULL,
  phrase_key text GENERATED ALWAYS AS (normalize_quick_order_alias_text(phrase)) STORED,
  status text NOT NULL,
  recommendation_action text NOT NULL,
  active boolean DEFAULT true NOT NULL,
  notes text,
  source text DEFAULT 'google_sheet'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.quick_order_unit_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_id uuid,
  item_scope_key text GENERATED ALWAYS AS (COALESCE((item_id)::text, 'global'::text)) STORED,
  from_unit text,
  from_unit_key text GENERATED ALWAYS AS (COALESCE(normalize_quick_order_alias_text(from_unit), 'missing'::text)) STORED,
  to_unit text NOT NULL,
  to_unit_key text GENERATED ALWAYS AS (normalize_quick_order_alias_text(to_unit)) STORED,
  multiplier numeric DEFAULT 1 NOT NULL,
  scope_type text DEFAULT 'global'::text NOT NULL,
  employee_name text,
  employee_name_key text GENERATED ALWAYS AS (normalize_quick_order_employee_name(employee_name)) STORED,
  employee_scope_key text GENERATED ALWAYS AS (COALESCE(normalize_quick_order_employee_name(employee_name), 'global'::text)) STORED,
  employee_user_id uuid,
  mode_scope text DEFAULT 'both'::text NOT NULL,
  location_id uuid,
  location_key text GENERATED ALWAYS AS (COALESCE((location_id)::text, 'global'::text)) STORED,
  is_default_when_missing boolean DEFAULT false NOT NULL,
  active boolean DEFAULT true NOT NULL,
  notes text,
  source text DEFAULT 'google_sheet'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.quick_order_voice_parse_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  location_id uuid,
  session_id uuid,
  raw_transcript text,
  normalized_text text,
  parsed_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
  warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
  error_code text,
  model_used text,
  fallback_used boolean DEFAULT false NOT NULL,
  latency_ms integer,
  confidence numeric(4,3),
  outcome text DEFAULT 'shown'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  latency_breakdown jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.recipes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  square_catalog_item_id text NOT NULL,
  square_item_name text,
  inventory_item_id uuid NOT NULL,
  quantity_per_sale numeric NOT NULL,
  unit text NOT NULL,
  adjustment_factor numeric DEFAULT 1.0 NOT NULL,
  is_auto_suggested boolean DEFAULT false NOT NULL,
  confirmed_by uuid,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.recurring_reminder_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  scope text NOT NULL,
  employee_id uuid,
  location_id uuid,
  days_of_week integer[] NOT NULL,
  time_of_day time without time zone NOT NULL,
  timezone text DEFAULT 'America/Los_Angeles'::text NOT NULL,
  condition_type text NOT NULL,
  condition_value integer,
  quiet_hours_enabled boolean DEFAULT false NOT NULL,
  quiet_hours_start time without time zone,
  quiet_hours_end time without time zone,
  channels jsonb DEFAULT '{"push": true, "in_app": true}'::jsonb NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  created_by uuid NOT NULL,
  last_triggered_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.reminder_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  reminder_id uuid NOT NULL,
  event_type text DEFAULT 'sent'::text NOT NULL,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  channels_attempted jsonb DEFAULT '[]'::jsonb NOT NULL,
  delivery_result jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.reminder_system_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  overdue_threshold_days integer DEFAULT 7 NOT NULL,
  reminder_rate_limit_minutes integer DEFAULT 15 NOT NULL,
  recurring_window_minutes integer DEFAULT 15 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.reminders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid,
  manager_id uuid,
  location_id uuid,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  last_reminded_at timestamp with time zone DEFAULT now() NOT NULL,
  reminder_count integer DEFAULT 1 NOT NULL,
  scope text DEFAULT 'employee'::text NOT NULL,
  message text,
  sender_name text
);
CREATE TABLE public.square_connections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  merchant_id text NOT NULL,
  square_location_ids text[] DEFAULT '{}'::text[] NOT NULL,
  token_expires_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  sync_status text DEFAULT 'active'::text NOT NULL,
  sync_error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.stock_check_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  area_id uuid NOT NULL,
  user_id uuid NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  items_checked integer DEFAULT 0 NOT NULL,
  items_skipped integer DEFAULT 0 NOT NULL,
  items_total integer DEFAULT 0 NOT NULL,
  status text NOT NULL,
  scan_method text NOT NULL
);
CREATE TABLE public.stock_updates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  area_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  previous_quantity numeric,
  new_quantity numeric NOT NULL,
  updated_by uuid NOT NULL,
  update_method text NOT NULL,
  quick_select_value text,
  photo_url text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.storage_areas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  description text,
  location_id uuid NOT NULL,
  nfc_tag_id text,
  qr_code text,
  check_frequency text NOT NULL,
  last_checked_at timestamp with time zone,
  last_checked_by uuid,
  icon text,
  sort_order integer DEFAULT 0 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.suggested_orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  date date NOT NULL,
  location_id uuid NOT NULL,
  item_id uuid NOT NULL,
  item_name text NOT NULL,
  supplier_name text,
  suggested_qty numeric NOT NULL,
  unit text,
  confidence_score numeric,
  confidence_tier text DEFAULT 'medium'::text NOT NULL,
  source text DEFAULT 'heuristic'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.suppliers (
  id uuid DEFAULT uuid_generate_v4() NOT NULL,
  name text NOT NULL,
  phone text,
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  active boolean DEFAULT true,
  email text,
  supplier_category text,
  supplier_key text
);
CREATE TABLE public.tip_auth_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  identifier_hash text NOT NULL,
  scope text DEFAULT 'token'::text NOT NULL,
  location_id uuid,
  success boolean DEFAULT false NOT NULL,
  attempted_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.tip_employees (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  location_id uuid,
  active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.tip_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  business_date date NOT NULL,
  location_id uuid NOT NULL,
  meal_period text NOT NULL,
  cash_amount numeric(10,2) DEFAULT 0 NOT NULL,
  card_amount numeric(10,2) DEFAULT 0 NOT NULL,
  split_count integer DEFAULT 1 NOT NULL,
  entry_method text NOT NULL,
  voice_variant text,
  corrections_count integer DEFAULT 0 NOT NULL,
  entered_by uuid,
  flagged_anomaly boolean DEFAULT false NOT NULL,
  anomaly_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.tip_entry_people (
  tip_entry_id uuid NOT NULL,
  tip_employee_id uuid NOT NULL
);
CREATE TABLE public.tip_entry_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  location_id uuid NOT NULL,
  closer_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '180 days'::interval) NOT NULL,
  revoked boolean DEFAULT false NOT NULL
);
CREATE TABLE public.tip_location_access (
  location_id uuid NOT NULL,
  entry_token_hash text,
  token_rotated_at timestamp with time zone,
  pin_hash text,
  pin_rotated_at timestamp with time zone,
  updated_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.tip_ws_tickets (
  token_hash text NOT NULL,
  session_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '00:01:00'::interval) NOT NULL,
  used boolean DEFAULT false NOT NULL
);
CREATE TABLE public.unit_conversions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  inventory_item_id uuid NOT NULL,
  from_unit text NOT NULL,
  to_unit text NOT NULL,
  multiplier numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.unit_synonyms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  from_unit text NOT NULL,
  to_unit text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.unmapped_menu_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  square_catalog_item_id text,
  square_item_name text,
  detected_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'needs_mapping'::text NOT NULL,
  auto_suggestions jsonb DEFAULT '[]'::jsonb NOT NULL,
  resolved_by uuid,
  resolved_at timestamp with time zone
);
CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  invited_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.users (
  id uuid NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  role user_role DEFAULT 'employee'::user_role NOT NULL,
  default_location_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------------------
-- Primary keys, unique constraints, check constraints
-- ---------------------------------------------------------------------------
ALTER TABLE public.access_code_rate_limits ADD CONSTRAINT access_code_rate_limits_pkey PRIMARY KEY (identifier_hash);
ALTER TABLE public.access_code_role_grants ADD CONSTRAINT access_code_role_grants_pkey PRIMARY KEY (id);
ALTER TABLE public.access_code_validation_events ADD CONSTRAINT access_code_validation_events_pkey PRIMARY KEY (id);
ALTER TABLE public.access_code_validation_events ADD CONSTRAINT access_code_validation_events_outcome_check CHECK ((outcome = ANY (ARRAY['success'::text, 'invalid'::text, 'rate_limited'::text, 'locked'::text, 'error'::text])));
ALTER TABLE public.app_config ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);
ALTER TABLE public.area_items ADD CONSTRAINT area_items_pkey PRIMARY KEY (id);
ALTER TABLE public.area_items ADD CONSTRAINT area_items_area_id_inventory_item_id_key UNIQUE (area_id, inventory_item_id);
ALTER TABLE public.calibration_results ADD CONSTRAINT calibration_results_pkey PRIMARY KEY (id);
ALTER TABLE public.current_stock_snapshots ADD CONSTRAINT current_stock_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.current_stock_snapshots ADD CONSTRAINT current_stock_snapshots_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));
ALTER TABLE public.current_stock_snapshots ADD CONSTRAINT current_stock_snapshots_quantity_nonnegative CHECK ((quantity >= (0)::numeric));
ALTER TABLE public.current_stock_snapshots ADD CONSTRAINT current_stock_snapshots_source_check CHECK ((source = ANY (ARRAY['typed'::text, 'voice'::text])));
ALTER TABLE public.daily_sales ADD CONSTRAINT daily_sales_pkey PRIMARY KEY (id);
ALTER TABLE public.daily_sales ADD CONSTRAINT daily_sales_square_order_id_key UNIQUE (square_order_id);
ALTER TABLE public.demand_forecasts ADD CONSTRAINT demand_forecasts_pkey PRIMARY KEY (id);
ALTER TABLE public.demand_forecasts ADD CONSTRAINT demand_forecasts_confidence_chk CHECK ((confidence = ANY (ARRAY['none'::text, 'low'::text, 'medium'::text, 'high'::text])));
ALTER TABLE public.device_push_tokens ADD CONSTRAINT device_push_tokens_pkey PRIMARY KEY (id);
ALTER TABLE public.device_push_tokens ADD CONSTRAINT device_push_tokens_user_id_expo_push_token_key UNIQUE (user_id, expo_push_token);
ALTER TABLE public.device_push_tokens ADD CONSTRAINT device_push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text, 'unknown'::text])));
ALTER TABLE public.employee_quick_order_aliases ADD CONSTRAINT employee_quick_order_aliases_pkey PRIMARY KEY (id);
ALTER TABLE public.forecast_accuracy ADD CONSTRAINT forecast_accuracy_pkey PRIMARY KEY (id);
ALTER TABLE public.historical_order_import_items ADD CONSTRAINT historical_order_import_items_pkey PRIMARY KEY (id);
ALTER TABLE public.historical_order_import_items ADD CONSTRAINT historical_order_import_items_quantity_check CHECK ((quantity > (0)::numeric));
ALTER TABLE public.historical_order_imports ADD CONSTRAINT historical_order_imports_pkey PRIMARY KEY (id);
ALTER TABLE public.historical_order_imports ADD CONSTRAINT historical_order_imports_status_check CHECK ((status = ANY (ARRAY['imported'::text, 'voided'::text])));
ALTER TABLE public.historical_orders ADD CONSTRAINT historical_orders_pkey PRIMARY KEY (id);
ALTER TABLE public.historical_orders ADD CONSTRAINT historical_orders_source_chk CHECK ((source = ANY (ARRAY['csv_upload'::text, 'square_import'::text, 'manual_entry'::text, 'app_order'::text])));
ALTER TABLE public.holiday_multipliers ADD CONSTRAINT holiday_multipliers_pkey PRIMARY KEY (id);
ALTER TABLE public.holiday_multipliers ADD CONSTRAINT holiday_multipliers_date_range_chk CHECK ((end_date >= start_date));
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_file_type_chk CHECK ((file_type = ANY (ARRAY['csv'::text, 'xlsx'::text, 'manual'::text])));
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_matched_rows_chk CHECK (((matched_rows IS NULL) OR (matched_rows >= 0)));
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_status_chk CHECK ((status = ANY (ARRAY['processing'::text, 'needs_review'::text, 'completed'::text, 'failed'::text])));
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_total_rows_chk CHECK (((total_rows IS NULL) OR (total_rows >= 0)));
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_unmatched_rows_chk CHECK (((unmatched_rows IS NULL) OR (unmatched_rows >= 0)));
ALTER TABLE public.integrations ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);
ALTER TABLE public.integrations ADD CONSTRAINT integrations_oauth_state_key UNIQUE (oauth_state);
ALTER TABLE public.integrations ADD CONSTRAINT integrations_provider_chk CHECK ((provider = 'square'::text));
ALTER TABLE public.integrations ADD CONSTRAINT integrations_status_chk CHECK ((status = ANY (ARRAY['connected'::text, 'paused'::text, 'error'::text, 'revoked'::text])));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_base_unit_not_empty CHECK ((length(TRIM(BOTH FROM base_unit)) > 0));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_hard_cap_nonnegative CHECK ((hard_cap >= (0)::numeric));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_pack_size_positive_check CHECK ((pack_size > 0));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_safety_stock_nonnegative CHECK ((safety_stock >= (0)::numeric));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_soft_cap_nonnegative CHECK ((soft_cap >= (0)::numeric));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_target_stock_nonnegative CHECK ((target_stock >= (0)::numeric));
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_between_check CHECK (((trigger_type <> 'between'::text) OR ((trigger_qty IS NOT NULL) AND (trigger_qty_max IS NOT NULL) AND (trigger_qty <= trigger_qty_max))));
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_fixed_order_check CHECK (((order_strategy <> 'fixed_order_qty'::text) OR ((order_qty IS NOT NULL) AND (order_qty > (0)::numeric) AND (order_unit IS NOT NULL) AND (length(TRIM(BOTH FROM order_unit)) > 0))));
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_mode_check CHECK ((applies_to_mode = ANY (ARRAY['inventory_only'::text, 'order_only'::text, 'both'::text])));
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_nonnegative CHECK (((COALESCE(trigger_qty, (0)::numeric) >= (0)::numeric) AND (COALESCE(trigger_qty_max, (0)::numeric) >= (0)::numeric) AND (COALESCE(order_qty, (0)::numeric) >= (0)::numeric)));
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_order_strategy_check CHECK ((order_strategy = ANY (ARRAY['fixed_order_qty'::text, 'no_order'::text, 'use_existing_recommendation_engine'::text])));
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_trigger_bounds_check CHECK (((trigger_type = 'always'::text) OR ((trigger_qty IS NOT NULL) AND (trigger_unit IS NOT NULL) AND (length(TRIM(BOTH FROM trigger_unit)) > 0))));
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['below'::text, 'at_or_below'::text, 'equal'::text, 'between'::text, 'at_or_above'::text, 'always'::text])));
ALTER TABLE public.inventory_status_terms ADD CONSTRAINT inventory_status_terms_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory_status_terms ADD CONSTRAINT inventory_status_terms_phrase_key_not_blank CHECK ((length(TRIM(BOTH FROM phrase_key)) > 0));
ALTER TABLE public.inventory_status_terms ADD CONSTRAINT inventory_status_terms_phrase_not_blank CHECK ((length(TRIM(BOTH FROM phrase)) > 0));
ALTER TABLE public.inventory_status_terms ADD CONSTRAINT inventory_status_terms_recommendation_action_check CHECK ((recommendation_action = ANY (ARRAY['no_order'::text, 'check_reorder_rule'::text, 'ask_quantity'::text, 'use_existing_recommendation_engine'::text])));
ALTER TABLE public.inventory_status_terms ADD CONSTRAINT inventory_status_terms_remaining_qty_nonnegative CHECK ((COALESCE(remaining_qty, (0)::numeric) >= (0)::numeric));
ALTER TABLE public.inventory_status_terms ADD CONSTRAINT inventory_status_terms_remaining_unit_behavior_check CHECK ((remaining_unit_behavior = ANY (ARRAY['none'::text, 'detected_unit'::text, 'item_default_unit'::text])));
ALTER TABLE public.inventory_status_terms ADD CONSTRAINT inventory_status_terms_status_check CHECK ((status = ANY (ARRAY['enough'::text, 'zero'::text, 'partial'::text, 'low'::text, 'unknown'::text])));
ALTER TABLE public.item_allowed_units ADD CONSTRAINT item_allowed_units_pkey PRIMARY KEY (id);
ALTER TABLE public.item_allowed_units ADD CONSTRAINT item_allowed_units_nonnegative CHECK (((COALESCE(conversion_to_base_unit, (0)::numeric) >= (0)::numeric) AND (COALESCE(min_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(soft_max_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(hard_max_quantity, (0)::numeric) >= (0)::numeric)));
ALTER TABLE public.item_allowed_units ADD CONSTRAINT item_allowed_units_thresholds_check CHECK (((COALESCE(max_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(order_quantity, (0)::numeric) >= (0)::numeric)));
ALTER TABLE public.item_allowed_units ADD CONSTRAINT item_allowed_units_unit_not_blank CHECK ((length(TRIM(BOTH FROM unit)) > 0));
ALTER TABLE public.item_order_constraints ADD CONSTRAINT item_order_constraints_pkey PRIMARY KEY (id);
ALTER TABLE public.item_order_constraints ADD CONSTRAINT item_order_constraints_delivery_days_chk CHECK (((delivery_days IS NULL) OR (delivery_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6])));
ALTER TABLE public.item_order_constraints ADD CONSTRAINT item_order_constraints_lead_time_days_chk CHECK ((lead_time_days >= 0));
ALTER TABLE public.item_order_constraints ADD CONSTRAINT item_order_constraints_qty_range_chk CHECK (((min_order_qty IS NULL) OR (max_order_qty IS NULL) OR (min_order_qty <= max_order_qty)));
ALTER TABLE public.item_order_limits ADD CONSTRAINT item_order_limits_pkey PRIMARY KEY (id);
ALTER TABLE public.item_order_limits ADD CONSTRAINT item_order_limits_nonnegative CHECK (((COALESCE(typical_min_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(typical_max_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(soft_max_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(hard_max_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(manager_approval_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(max_single_order_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(max_daily_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(max_weekly_quantity, (0)::numeric) >= (0)::numeric)));
ALTER TABLE public.item_order_profiles ADD CONSTRAINT item_order_profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.item_order_profiles ADD CONSTRAINT item_order_profiles_nonnegative CHECK (((COALESCE(usual_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(p50_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(p75_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(p95_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(last_order_quantity, (0)::numeric) >= (0)::numeric) AND (sample_size >= 0)));
ALTER TABLE public.item_reorder_rules ADD CONSTRAINT item_reorder_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.item_reorder_rules ADD CONSTRAINT item_reorder_rules_nonnegative CHECK (((COALESCE(target_stock_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(min_stock_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(max_stock_quantity, (0)::numeric) >= (0)::numeric) AND (COALESCE(usual_order_quantity, (0)::numeric) >= (0)::numeric) AND (min_order_quantity >= (0)::numeric) AND (order_increment > (0)::numeric) AND (COALESCE(shelf_life_days, 0) >= 0) AND (COALESCE(lead_time_days, 0) >= 0)));
ALTER TABLE public.item_reorder_rules ADD CONSTRAINT item_reorder_rules_rounding_policy_check CHECK ((rounding_policy = ANY (ARRAY['floor_conservative'::text, 'ceil_prevent_stockout'::text, 'nearest'::text, 'floor_normal_ceil_if_low'::text, 'custom_threshold'::text])));
ALTER TABLE public.locations ADD CONSTRAINT locations_pkey PRIMARY KEY (id);
ALTER TABLE public.locations ADD CONSTRAINT locations_short_code_key UNIQUE (short_code);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);
ALTER TABLE public.order_items ADD CONSTRAINT order_items_input_mode_check CHECK ((input_mode = ANY (ARRAY['quantity'::text, 'remaining'::text])));
ALTER TABLE public.order_items ADD CONSTRAINT order_items_mode_fields_check CHECK ((((input_mode = 'quantity'::text) AND (quantity_requested IS NOT NULL) AND (quantity_requested > (0)::numeric) AND (remaining_reported IS NULL)) OR ((input_mode = 'remaining'::text) AND (remaining_reported IS NOT NULL) AND (remaining_reported >= (0)::numeric) AND (quantity_requested IS NULL))));
ALTER TABLE public.order_items ADD CONSTRAINT order_items_quantity_mode_check CHECK ((((COALESCE(input_mode, 'quantity'::text) = 'quantity'::text) AND (quantity IS NOT NULL) AND (quantity > (0)::numeric)) OR ((COALESCE(input_mode, 'quantity'::text) = 'remaining'::text) AND (quantity IS NOT NULL) AND (quantity >= (0)::numeric))));
ALTER TABLE public.order_items ADD CONSTRAINT order_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'order_later'::text, 'sent'::text, 'cancelled'::text])));
ALTER TABLE public.order_later_items ADD CONSTRAINT order_later_items_pkey PRIMARY KEY (id);
ALTER TABLE public.order_later_items ADD CONSTRAINT order_later_items_preferred_location_group_check CHECK ((preferred_location_group = ANY (ARRAY['sushi'::text, 'poki'::text])));
ALTER TABLE public.order_later_items ADD CONSTRAINT order_later_items_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'added'::text, 'cancelled'::text])));
ALTER TABLE public.ordering_patterns ADD CONSTRAINT ordering_patterns_pkey PRIMARY KEY (id);
ALTER TABLE public.ordering_patterns ADD CONSTRAINT ordering_patterns_data_maturity_chk CHECK ((data_maturity = ANY (ARRAY['none'::text, 'low'::text, 'medium'::text, 'high'::text])));
ALTER TABLE public.ordering_patterns ADD CONSTRAINT ordering_patterns_day_of_week_chk CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
ALTER TABLE public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE public.orders ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);
ALTER TABLE public.orders ADD CONSTRAINT orders_entry_method_check CHECK ((entry_method = ANY (ARRAY['manual'::text, 'quick_order'::text, 'voice_order'::text, 'suggested_order'::text])));
ALTER TABLE public.orders ADD CONSTRAINT orders_manager_review_status_check CHECK ((manager_review_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'approved'::text, 'changes_requested'::text, 'rejected'::text])));
ALTER TABLE public.org_settings ADD CONSTRAINT org_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.org_settings ADD CONSTRAINT org_settings_org_id_key UNIQUE (org_id);
ALTER TABLE public.parser_corrections ADD CONSTRAINT parser_corrections_pkey PRIMARY KEY (id);
ALTER TABLE public.parser_examples ADD CONSTRAINT parser_examples_pkey PRIMARY KEY (id);
ALTER TABLE public.parser_examples ADD CONSTRAINT parser_examples_source_check CHECK ((source = ANY (ARRAY['manager'::text, 'correction'::text, 'seed'::text])));
ALTER TABLE public.parser_usage_log ADD CONSTRAINT parser_usage_log_pkey PRIMARY KEY (id);
ALTER TABLE public.past_order_items ADD CONSTRAINT past_order_items_pkey PRIMARY KEY (id);
ALTER TABLE public.past_order_items ADD CONSTRAINT past_order_items_location_group_check CHECK ((location_group = ANY (ARRAY['sushi'::text, 'poki'::text])));
ALTER TABLE public.past_order_items ADD CONSTRAINT past_order_items_quantity_check CHECK ((quantity > (0)::numeric));
ALTER TABLE public.past_order_items ADD CONSTRAINT past_order_items_unit_type_check CHECK ((unit_type = ANY (ARRAY['base'::text, 'pack'::text])));
ALTER TABLE public.past_orders ADD CONSTRAINT past_orders_pkey PRIMARY KEY (id);
ALTER TABLE public.past_orders ADD CONSTRAINT past_orders_share_method_check CHECK ((share_method = ANY (ARRAY['share'::text, 'copy'::text])));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_provider_check CHECK ((provider = ANY (ARRAY['email'::text, 'google'::text, 'apple'::text])));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['employee'::text, 'manager'::text])));
ALTER TABLE public.qo_holiday_overrides ADD CONSTRAINT qo_holiday_overrides_pkey PRIMARY KEY (id);
ALTER TABLE public.qo_holiday_overrides ADD CONSTRAINT qo_holiday_overrides_dates_check CHECK ((end_date >= start_date));
ALTER TABLE public.qo_holiday_overrides ADD CONSTRAINT qo_holiday_overrides_multiplier_positive CHECK ((target_multiplier > (0)::numeric));
ALTER TABLE public.qo_items ADD CONSTRAINT qo_items_pkey PRIMARY KEY (id);
ALTER TABLE public.qo_items ADD CONSTRAINT qo_items_name_not_blank CHECK ((item_key IS NOT NULL));
ALTER TABLE public.qo_items ADD CONSTRAINT qo_items_order_unit_not_blank CHECK ((length(TRIM(BOTH FROM order_unit)) > 0));
ALTER TABLE public.qo_items ADD CONSTRAINT qo_items_target_stock_nonnegative CHECK ((COALESCE(target_stock, (0)::numeric) >= (0)::numeric));
ALTER TABLE public.qo_keywords ADD CONSTRAINT qo_keywords_pkey PRIMARY KEY (id);
ALTER TABLE public.qo_keywords ADD CONSTRAINT qo_keywords_action_check CHECK (((action IS NULL) OR (action = ANY (ARRAY['no_order'::text, 'check_reorder_rule'::text, 'strip_and_continue'::text]))));
ALTER TABLE public.qo_keywords ADD CONSTRAINT qo_keywords_meaning_type_check CHECK ((meaning_type = ANY (ARRAY['status_term'::text, 'unit_alias'::text, 'ignore'::text])));
ALTER TABLE public.qo_keywords ADD CONSTRAINT qo_keywords_phrase_not_blank CHECK ((phrase_key IS NOT NULL));
ALTER TABLE public.qo_keywords ADD CONSTRAINT qo_keywords_shape_check CHECK ((((meaning_type = 'unit_alias'::text) AND (equals_unit IS NOT NULL) AND (status IS NULL) AND (remaining_qty IS NULL) AND (action IS NULL)) OR ((meaning_type = 'status_term'::text) AND (status IS NOT NULL) AND (action IS NOT NULL)) OR ((meaning_type = 'ignore'::text) AND (equals_unit IS NULL) AND (status IS NULL) AND (remaining_qty IS NULL) AND (action = 'strip_and_continue'::text))));
ALTER TABLE public.qo_keywords ADD CONSTRAINT qo_keywords_status_check CHECK (((status IS NULL) OR (status = ANY (ARRAY['enough'::text, 'zero'::text, 'partial'::text, 'low'::text]))));
ALTER TABLE public.qo_personalization ADD CONSTRAINT qo_personalization_pkey PRIMARY KEY (id);
ALTER TABLE public.qo_personalization ADD CONSTRAINT qo_personalization_alias_shape CHECK (((rule_type <> 'alias'::text) OR ((phrase_key <> 'none'::text) AND (personal_unit IS NULL) AND (personal_unit_equals IS NULL) AND (trigger_at_or_below IS NULL) AND (order_qty IS NULL) AND (order_unit IS NULL))));
ALTER TABLE public.qo_personalization ADD CONSTRAINT qo_personalization_employee_not_blank CHECK ((employee_name_key IS NOT NULL));
ALTER TABLE public.qo_personalization ADD CONSTRAINT qo_personalization_item_config_nonnegative CHECK (((COALESCE(trigger_at_or_below, (0)::numeric) >= (0)::numeric) AND (COALESCE(order_qty, (0)::numeric) >= (0)::numeric)));
ALTER TABLE public.qo_personalization ADD CONSTRAINT qo_personalization_item_not_blank CHECK ((item_name_key IS NOT NULL));
ALTER TABLE public.qo_personalization ADD CONSTRAINT qo_personalization_rule_type_check CHECK ((rule_type = ANY (ARRAY['alias'::text, 'item_config'::text])));
ALTER TABLE public.qo_reorder_rules ADD CONSTRAINT qo_reorder_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.qo_reorder_rules ADD CONSTRAINT qo_reorder_rules_nonnegative CHECK (((trigger_at_or_below >= (0)::numeric) AND (order_qty >= (0)::numeric)));
ALTER TABLE public.qo_reorder_rules ADD CONSTRAINT qo_reorder_rules_trigger_unit_not_blank CHECK ((trigger_unit_key IS NOT NULL));
ALTER TABLE public.quick_order_alias_rules ADD CONSTRAINT quick_order_alias_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.quick_order_alias_rules ADD CONSTRAINT quick_order_alias_rules_alias_not_blank CHECK ((alias_key IS NOT NULL));
ALTER TABLE public.quick_order_alias_rules ADD CONSTRAINT quick_order_alias_rules_employee_scope_check CHECK (((scope_type = 'global'::text) OR (employee_name_key IS NOT NULL) OR (employee_user_id IS NOT NULL)));
ALTER TABLE public.quick_order_alias_rules ADD CONSTRAINT quick_order_alias_rules_mode_check CHECK ((mode_scope = ANY (ARRAY['order'::text, 'inventory'::text, 'both'::text])));
ALTER TABLE public.quick_order_alias_rules ADD CONSTRAINT quick_order_alias_rules_scope_check CHECK ((scope_type = ANY (ARRAY['global'::text, 'employee'::text])));
ALTER TABLE public.quick_order_cart_mutations ADD CONSTRAINT quick_order_cart_mutations_pkey PRIMARY KEY (id);
ALTER TABLE public.quick_order_cart_mutations ADD CONSTRAINT quick_order_cart_mutations_mutation_type_check CHECK ((mutation_type = ANY (ARRAY['smart_suggestion_applied'::text, 'stock_recommendation_applied'::text, 'history_reorder_applied'::text, 'manual_update'::text, 'clarification_applied'::text])));
ALTER TABLE public.quick_order_cart_mutations ADD CONSTRAINT quick_order_cart_mutations_revert_status_check CHECK ((revert_status = ANY (ARRAY['active'::text, 'reverted'::text, 'failed'::text])));
ALTER TABLE public.quick_order_ignored_suggestions ADD CONSTRAINT quick_order_ignored_suggestions_pkey PRIMARY KEY (id);
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_action_check CHECK ((action_type = ANY (ARRAY['fixed_order_qty'::text, 'top_up_to_target'::text, 'no_order'::text, 'ask'::text])));
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_between_check CHECK (((trigger_type <> 'between'::text) OR ((trigger_qty_min IS NOT NULL) AND (trigger_qty_max IS NOT NULL) AND (trigger_qty_min <= trigger_qty_max))));
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_employee_scope_check CHECK (((scope_type = 'global'::text) OR (employee_name_key IS NOT NULL) OR (employee_user_id IS NOT NULL)));
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_fixed_order_check CHECK (((action_type <> 'fixed_order_qty'::text) OR ((order_qty IS NOT NULL) AND (order_qty > (0)::numeric) AND (order_unit IS NOT NULL) AND (length(TRIM(BOTH FROM order_unit)) > 0))));
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_mode_check CHECK ((mode_scope = ANY (ARRAY['order'::text, 'inventory'::text, 'both'::text])));
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_nonnegative CHECK (((COALESCE(trigger_qty_min, (0)::numeric) >= (0)::numeric) AND (COALESCE(trigger_qty_max, (0)::numeric) >= (0)::numeric) AND (COALESCE(order_qty, (0)::numeric) >= (0)::numeric) AND (COALESCE(target_qty, (0)::numeric) >= (0)::numeric)));
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_scope_check CHECK ((scope_type = ANY (ARRAY['global'::text, 'employee'::text])));
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_top_up_check CHECK (((action_type <> 'top_up_to_target'::text) OR ((target_qty IS NOT NULL) AND (target_unit IS NOT NULL) AND (length(TRIM(BOTH FROM target_unit)) > 0))));
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_trigger_check CHECK ((trigger_type = ANY (ARRAY['below'::text, 'at_or_below'::text, 'between'::text, 'equal'::text, 'status'::text])));
ALTER TABLE public.quick_order_sessions ADD CONSTRAINT quick_order_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.quick_order_sessions ADD CONSTRAINT quick_order_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'submitted'::text, 'abandoned'::text])));
ALTER TABLE public.quick_order_status_terms ADD CONSTRAINT quick_order_status_terms_pkey PRIMARY KEY (id);
ALTER TABLE public.quick_order_status_terms ADD CONSTRAINT quick_order_status_terms_action_check CHECK ((recommendation_action = ANY (ARRAY['no_order'::text, 'order_needed'::text, 'calculate_order'::text, 'ask'::text])));
ALTER TABLE public.quick_order_status_terms ADD CONSTRAINT quick_order_status_terms_phrase_not_blank CHECK ((phrase_key IS NOT NULL));
ALTER TABLE public.quick_order_status_terms ADD CONSTRAINT quick_order_status_terms_status_check CHECK ((status = ANY (ARRAY['enough'::text, 'out'::text, 'low'::text, 'unknown'::text])));
ALTER TABLE public.quick_order_unit_rules ADD CONSTRAINT quick_order_unit_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.quick_order_unit_rules ADD CONSTRAINT quick_order_unit_rules_employee_scope_check CHECK (((scope_type = 'global'::text) OR (employee_name_key IS NOT NULL) OR (employee_user_id IS NOT NULL)));
ALTER TABLE public.quick_order_unit_rules ADD CONSTRAINT quick_order_unit_rules_mode_check CHECK ((mode_scope = ANY (ARRAY['order'::text, 'inventory'::text, 'both'::text])));
ALTER TABLE public.quick_order_unit_rules ADD CONSTRAINT quick_order_unit_rules_multiplier_positive CHECK ((multiplier > (0)::numeric));
ALTER TABLE public.quick_order_unit_rules ADD CONSTRAINT quick_order_unit_rules_scope_check CHECK ((scope_type = ANY (ARRAY['global'::text, 'employee'::text])));
ALTER TABLE public.quick_order_unit_rules ADD CONSTRAINT quick_order_unit_rules_to_unit_not_blank CHECK ((to_unit_key IS NOT NULL));
ALTER TABLE public.quick_order_voice_parse_events ADD CONSTRAINT quick_order_voice_parse_events_pkey PRIMARY KEY (id);
ALTER TABLE public.quick_order_voice_parse_events ADD CONSTRAINT quick_order_voice_parse_events_outcome_check CHECK ((outcome = ANY (ARRAY['shown'::text, 'accepted'::text, 'edited'::text, 'rejected'::text, 'failed'::text])));
ALTER TABLE public.recipes ADD CONSTRAINT recipes_pkey PRIMARY KEY (id);
ALTER TABLE public.recipes ADD CONSTRAINT recipes_adjustment_factor_chk CHECK ((adjustment_factor > (0)::numeric));
ALTER TABLE public.recipes ADD CONSTRAINT recipes_quantity_per_sale_chk CHECK ((quantity_per_sale > (0)::numeric));
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_check CHECK ((((scope = 'employee'::text) AND (employee_id IS NOT NULL) AND (location_id IS NULL)) OR ((scope = 'location'::text) AND (location_id IS NOT NULL) AND (employee_id IS NULL))));
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_check1 CHECK ((((condition_type = 'days_since_last_order_gte'::text) AND (condition_value IS NOT NULL) AND (condition_value >= 0)) OR ((condition_type = 'no_order_today'::text) AND (condition_value IS NULL))));
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_condition_type_check CHECK ((condition_type = ANY (ARRAY['no_order_today'::text, 'days_since_last_order_gte'::text])));
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_days_of_week_check CHECK ((array_length(days_of_week, 1) IS NOT NULL));
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_days_of_week_check1 CHECK ((days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]));
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_scope_check CHECK ((scope = ANY (ARRAY['employee'::text, 'location'::text])));
ALTER TABLE public.reminder_events ADD CONSTRAINT reminder_events_pkey PRIMARY KEY (id);
ALTER TABLE public.reminder_events ADD CONSTRAINT reminder_events_event_type_check CHECK ((event_type = ANY (ARRAY['sent'::text, 'reminded_again'::text, 'auto_resolved'::text, 'cancelled'::text])));
ALTER TABLE public.reminder_system_settings ADD CONSTRAINT reminder_system_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.reminder_system_settings ADD CONSTRAINT reminder_system_settings_org_id_key UNIQUE (org_id);
ALTER TABLE public.reminder_system_settings ADD CONSTRAINT reminder_system_settings_overdue_threshold_days_check CHECK (((overdue_threshold_days >= 1) AND (overdue_threshold_days <= 60)));
ALTER TABLE public.reminder_system_settings ADD CONSTRAINT reminder_system_settings_recurring_window_minutes_check CHECK (((recurring_window_minutes >= 1) AND (recurring_window_minutes <= 120)));
ALTER TABLE public.reminder_system_settings ADD CONSTRAINT reminder_system_settings_reminder_rate_limit_minutes_check CHECK (((reminder_rate_limit_minutes >= 1) AND (reminder_rate_limit_minutes <= 240)));
ALTER TABLE public.reminders ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);
ALTER TABLE public.reminders ADD CONSTRAINT reminders_reminder_count_check CHECK ((reminder_count >= 1));
ALTER TABLE public.reminders ADD CONSTRAINT reminders_scope_check CHECK ((scope = ANY (ARRAY['employee'::text, 'location_banner'::text])));
ALTER TABLE public.reminders ADD CONSTRAINT reminders_status_check CHECK ((status = ANY (ARRAY['active'::text, 'resolved'::text, 'cancelled'::text])));
ALTER TABLE public.square_connections ADD CONSTRAINT square_connections_pkey PRIMARY KEY (id);
ALTER TABLE public.square_connections ADD CONSTRAINT square_connections_sync_status_chk CHECK ((sync_status = ANY (ARRAY['active'::text, 'paused'::text, 'error'::text])));
ALTER TABLE public.stock_check_sessions ADD CONSTRAINT stock_check_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.stock_check_sessions ADD CONSTRAINT stock_check_sessions_scan_method_check CHECK ((scan_method = ANY (ARRAY['nfc'::text, 'qr'::text, 'manual'::text])));
ALTER TABLE public.stock_check_sessions ADD CONSTRAINT stock_check_sessions_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text])));
ALTER TABLE public.stock_updates ADD CONSTRAINT stock_updates_pkey PRIMARY KEY (id);
ALTER TABLE public.stock_updates ADD CONSTRAINT stock_updates_quick_select_value_check CHECK ((quick_select_value = ANY (ARRAY['empty'::text, 'low'::text, 'good'::text, 'full'::text])));
ALTER TABLE public.stock_updates ADD CONSTRAINT stock_updates_update_method_check CHECK ((update_method = ANY (ARRAY['nfc'::text, 'qr'::text, 'manual'::text, 'quick_select'::text])));
ALTER TABLE public.storage_areas ADD CONSTRAINT storage_areas_pkey PRIMARY KEY (id);
ALTER TABLE public.storage_areas ADD CONSTRAINT storage_areas_nfc_tag_id_key UNIQUE (nfc_tag_id);
ALTER TABLE public.storage_areas ADD CONSTRAINT storage_areas_qr_code_key UNIQUE (qr_code);
ALTER TABLE public.storage_areas ADD CONSTRAINT storage_areas_check_frequency_check CHECK ((check_frequency = ANY (ARRAY['daily'::text, 'every_2_days'::text, 'every_3_days'::text, 'weekly'::text])));
ALTER TABLE public.suggested_orders ADD CONSTRAINT suggested_orders_pkey PRIMARY KEY (id);
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
ALTER TABLE public.tip_auth_attempts ADD CONSTRAINT tip_auth_attempts_pkey PRIMARY KEY (id);
ALTER TABLE public.tip_auth_attempts ADD CONSTRAINT tip_auth_attempts_scope_check CHECK ((scope = ANY (ARRAY['token'::text, 'pin'::text, 'voice'::text])));
ALTER TABLE public.tip_employees ADD CONSTRAINT tip_employees_pkey PRIMARY KEY (id);
ALTER TABLE public.tip_employees ADD CONSTRAINT tip_employees_name_check CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 60)));
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_business_date_location_id_meal_period_key UNIQUE (business_date, location_id, meal_period);
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_card_amount_check CHECK ((card_amount >= (0)::numeric));
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_cash_amount_check CHECK ((cash_amount >= (0)::numeric));
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_corrections_count_check CHECK ((corrections_count >= 0));
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_entry_method_check CHECK ((entry_method = ANY (ARRAY['typed'::text, 'voice'::text])));
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_meal_period_check CHECK ((meal_period = ANY (ARRAY['lunch'::text, 'dinner'::text])));
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_split_count_check CHECK ((split_count >= 1));
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_voice_variant_check CHECK ((voice_variant = ANY (ARRAY['waveform'::text, 'live_transcript'::text])));
ALTER TABLE public.tip_entry_people ADD CONSTRAINT tip_entry_people_pkey PRIMARY KEY (tip_entry_id, tip_employee_id);
ALTER TABLE public.tip_entry_sessions ADD CONSTRAINT tip_entry_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.tip_entry_sessions ADD CONSTRAINT tip_entry_sessions_token_hash_key UNIQUE (token_hash);
ALTER TABLE public.tip_location_access ADD CONSTRAINT tip_location_access_pkey PRIMARY KEY (location_id);
ALTER TABLE public.tip_ws_tickets ADD CONSTRAINT tip_ws_tickets_pkey PRIMARY KEY (token_hash);
ALTER TABLE public.unit_conversions ADD CONSTRAINT unit_conversions_pkey PRIMARY KEY (id);
ALTER TABLE public.unit_conversions ADD CONSTRAINT unit_conversions_multiplier_check CHECK ((multiplier > (0)::numeric));
ALTER TABLE public.unit_conversions ADD CONSTRAINT unit_conversions_non_empty_units_check CHECK (((length(TRIM(BOTH FROM from_unit)) > 0) AND (length(TRIM(BOTH FROM to_unit)) > 0)));
ALTER TABLE public.unit_synonyms ADD CONSTRAINT unit_synonyms_pkey PRIMARY KEY (id);
ALTER TABLE public.unmapped_menu_items ADD CONSTRAINT unmapped_menu_items_pkey PRIMARY KEY (id);
ALTER TABLE public.unmapped_menu_items ADD CONSTRAINT unmapped_menu_items_status_chk CHECK ((status = ANY (ARRAY['needs_mapping'::text, 'mapped'::text, 'ignored'::text])));
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_chk CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text])));
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text])));
ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_config ADD CONSTRAINT app_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.area_items ADD CONSTRAINT area_items_area_id_fkey FOREIGN KEY (area_id) REFERENCES storage_areas(id) ON DELETE CASCADE;
ALTER TABLE public.area_items ADD CONSTRAINT area_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.area_items ADD CONSTRAINT area_items_last_updated_by_fkey FOREIGN KEY (last_updated_by) REFERENCES users(id);
ALTER TABLE public.calibration_results ADD CONSTRAINT calibration_results_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.calibration_results ADD CONSTRAINT calibration_results_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.calibration_results ADD CONSTRAINT calibration_results_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.current_stock_snapshots ADD CONSTRAINT current_stock_snapshots_entered_by_user_id_fkey FOREIGN KEY (entered_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.current_stock_snapshots ADD CONSTRAINT current_stock_snapshots_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.current_stock_snapshots ADD CONSTRAINT current_stock_snapshots_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.current_stock_snapshots ADD CONSTRAINT current_stock_snapshots_quick_order_session_id_fkey FOREIGN KEY (quick_order_session_id) REFERENCES quick_order_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.daily_sales ADD CONSTRAINT daily_sales_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.demand_forecasts ADD CONSTRAINT demand_forecasts_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.demand_forecasts ADD CONSTRAINT demand_forecasts_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.device_push_tokens ADD CONSTRAINT device_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.employee_quick_order_aliases ADD CONSTRAINT employee_quick_order_aliases_employee_user_id_fkey FOREIGN KEY (employee_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.employee_quick_order_aliases ADD CONSTRAINT employee_quick_order_aliases_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.employee_quick_order_aliases ADD CONSTRAINT employee_quick_order_aliases_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.forecast_accuracy ADD CONSTRAINT forecast_accuracy_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.forecast_accuracy ADD CONSTRAINT forecast_accuracy_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.historical_order_import_items ADD CONSTRAINT historical_order_import_items_import_id_fkey FOREIGN KEY (import_id) REFERENCES historical_order_imports(id) ON DELETE CASCADE;
ALTER TABLE public.historical_order_import_items ADD CONSTRAINT historical_order_import_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT;
ALTER TABLE public.historical_order_import_items ADD CONSTRAINT historical_order_import_items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.historical_order_imports ADD CONSTRAINT historical_order_imports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.historical_order_imports ADD CONSTRAINT historical_order_imports_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.historical_order_imports ADD CONSTRAINT historical_order_imports_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.historical_order_imports ADD CONSTRAINT historical_order_imports_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.historical_orders ADD CONSTRAINT historical_orders_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.historical_orders ADD CONSTRAINT historical_orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.holiday_multipliers ADD CONSTRAINT holiday_multipliers_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_secondary_supplier_id_fkey FOREIGN KEY (secondary_supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.inventory_reorder_rules ADD CONSTRAINT inventory_reorder_rules_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.item_allowed_units ADD CONSTRAINT item_allowed_units_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.item_order_constraints ADD CONSTRAINT item_order_constraints_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.item_order_constraints ADD CONSTRAINT item_order_constraints_preferred_supplier_id_fkey FOREIGN KEY (preferred_supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.item_order_constraints ADD CONSTRAINT item_order_constraints_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.item_order_limits ADD CONSTRAINT item_order_limits_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.item_order_limits ADD CONSTRAINT item_order_limits_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.item_order_limits ADD CONSTRAINT item_order_limits_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.item_order_profiles ADD CONSTRAINT item_order_profiles_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.item_order_profiles ADD CONSTRAINT item_order_profiles_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.item_order_profiles ADD CONSTRAINT item_order_profiles_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.item_reorder_rules ADD CONSTRAINT item_reorder_rules_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.item_reorder_rules ADD CONSTRAINT item_reorder_rules_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.item_reorder_rules ADD CONSTRAINT item_reorder_rules_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_supplier_override_id_fkey FOREIGN KEY (supplier_override_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.order_later_items ADD CONSTRAINT order_later_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.order_later_items ADD CONSTRAINT order_later_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.order_later_items ADD CONSTRAINT order_later_items_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.order_later_items ADD CONSTRAINT order_later_items_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE public.order_later_items ADD CONSTRAINT order_later_items_source_order_item_id_fkey FOREIGN KEY (source_order_item_id) REFERENCES order_items(id) ON DELETE SET NULL;
ALTER TABLE public.order_later_items ADD CONSTRAINT order_later_items_suggested_supplier_id_fkey FOREIGN KEY (suggested_supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.ordering_patterns ADD CONSTRAINT ordering_patterns_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.ordering_patterns ADD CONSTRAINT ordering_patterns_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_fulfilled_by_fkey FOREIGN KEY (fulfilled_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD CONSTRAINT orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE public.orders ADD CONSTRAINT orders_manager_reviewed_by_fkey FOREIGN KEY (manager_reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD CONSTRAINT orders_quick_session_id_fkey FOREIGN KEY (quick_session_id) REFERENCES quick_order_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE public.org_settings ADD CONSTRAINT org_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.parser_corrections ADD CONSTRAINT parser_corrections_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.parser_corrections ADD CONSTRAINT parser_corrections_parser_suggested_item_id_fkey FOREIGN KEY (parser_suggested_item_id) REFERENCES inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.parser_corrections ADD CONSTRAINT parser_corrections_session_id_fkey FOREIGN KEY (session_id) REFERENCES quick_order_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.parser_corrections ADD CONSTRAINT parser_corrections_user_corrected_item_id_fkey FOREIGN KEY (user_corrected_item_id) REFERENCES inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.parser_corrections ADD CONSTRAINT parser_corrections_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.parser_usage_log ADD CONSTRAINT parser_usage_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.past_order_items ADD CONSTRAINT past_order_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.past_order_items ADD CONSTRAINT past_order_items_past_order_id_fkey FOREIGN KEY (past_order_id) REFERENCES past_orders(id) ON DELETE CASCADE;
ALTER TABLE public.past_orders ADD CONSTRAINT past_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.qo_items ADD CONSTRAINT qo_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.qo_items ADD CONSTRAINT qo_items_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.qo_items ADD CONSTRAINT qo_items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.qo_personalization ADD CONSTRAINT qo_personalization_employee_user_id_fkey FOREIGN KEY (employee_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.qo_personalization ADD CONSTRAINT qo_personalization_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.qo_personalization ADD CONSTRAINT qo_personalization_qo_item_id_fkey FOREIGN KEY (qo_item_id) REFERENCES qo_items(id) ON DELETE CASCADE;
ALTER TABLE public.qo_reorder_rules ADD CONSTRAINT qo_reorder_rules_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.qo_reorder_rules ADD CONSTRAINT qo_reorder_rules_qo_item_id_fkey FOREIGN KEY (qo_item_id) REFERENCES qo_items(id) ON DELETE CASCADE;
ALTER TABLE public.quick_order_alias_rules ADD CONSTRAINT quick_order_alias_rules_employee_user_id_fkey FOREIGN KEY (employee_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_alias_rules ADD CONSTRAINT quick_order_alias_rules_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.quick_order_alias_rules ADD CONSTRAINT quick_order_alias_rules_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.quick_order_cart_mutations ADD CONSTRAINT quick_order_cart_mutations_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_cart_mutations ADD CONSTRAINT quick_order_cart_mutations_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_cart_mutations ADD CONSTRAINT quick_order_cart_mutations_reverted_by_fkey FOREIGN KEY (reverted_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_cart_mutations ADD CONSTRAINT quick_order_cart_mutations_session_id_fkey FOREIGN KEY (session_id) REFERENCES quick_order_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_cart_mutations ADD CONSTRAINT quick_order_cart_mutations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_ignored_suggestions ADD CONSTRAINT quick_order_ignored_suggestions_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.quick_order_ignored_suggestions ADD CONSTRAINT quick_order_ignored_suggestions_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.quick_order_ignored_suggestions ADD CONSTRAINT quick_order_ignored_suggestions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_employee_user_id_fkey FOREIGN KEY (employee_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.quick_order_reorder_rules ADD CONSTRAINT quick_order_reorder_rules_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.quick_order_sessions ADD CONSTRAINT quick_order_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_sessions ADD CONSTRAINT quick_order_sessions_submitted_order_id_fkey FOREIGN KEY (submitted_order_id) REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_sessions ADD CONSTRAINT quick_order_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_unit_rules ADD CONSTRAINT quick_order_unit_rules_employee_user_id_fkey FOREIGN KEY (employee_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_unit_rules ADD CONSTRAINT quick_order_unit_rules_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.quick_order_unit_rules ADD CONSTRAINT quick_order_unit_rules_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.quick_order_voice_parse_events ADD CONSTRAINT quick_order_voice_parse_events_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_voice_parse_events ADD CONSTRAINT quick_order_voice_parse_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES quick_order_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.quick_order_voice_parse_events ADD CONSTRAINT quick_order_voice_parse_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.recipes ADD CONSTRAINT recipes_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.recipes ADD CONSTRAINT recipes_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.recurring_reminder_rules ADD CONSTRAINT recurring_reminder_rules_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.reminder_events ADD CONSTRAINT reminder_events_reminder_id_fkey FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE;
ALTER TABLE public.reminders ADD CONSTRAINT reminders_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE public.reminders ADD CONSTRAINT reminders_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.reminders ADD CONSTRAINT reminders_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.stock_check_sessions ADD CONSTRAINT stock_check_sessions_area_id_fkey FOREIGN KEY (area_id) REFERENCES storage_areas(id) ON DELETE CASCADE;
ALTER TABLE public.stock_check_sessions ADD CONSTRAINT stock_check_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE public.stock_updates ADD CONSTRAINT stock_updates_area_id_fkey FOREIGN KEY (area_id) REFERENCES storage_areas(id) ON DELETE CASCADE;
ALTER TABLE public.stock_updates ADD CONSTRAINT stock_updates_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.stock_updates ADD CONSTRAINT stock_updates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);
ALTER TABLE public.storage_areas ADD CONSTRAINT storage_areas_last_checked_by_fkey FOREIGN KEY (last_checked_by) REFERENCES users(id);
ALTER TABLE public.storage_areas ADD CONSTRAINT storage_areas_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.suggested_orders ADD CONSTRAINT suggested_orders_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.suggested_orders ADD CONSTRAINT suggested_orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.tip_employees ADD CONSTRAINT tip_employees_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES tip_employees(id) ON DELETE SET NULL;
ALTER TABLE public.tip_entries ADD CONSTRAINT tip_entries_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.tip_entry_people ADD CONSTRAINT tip_entry_people_tip_employee_id_fkey FOREIGN KEY (tip_employee_id) REFERENCES tip_employees(id) ON DELETE CASCADE;
ALTER TABLE public.tip_entry_people ADD CONSTRAINT tip_entry_people_tip_entry_id_fkey FOREIGN KEY (tip_entry_id) REFERENCES tip_entries(id) ON DELETE CASCADE;
ALTER TABLE public.tip_entry_sessions ADD CONSTRAINT tip_entry_sessions_closer_id_fkey FOREIGN KEY (closer_id) REFERENCES tip_employees(id) ON DELETE SET NULL;
ALTER TABLE public.tip_entry_sessions ADD CONSTRAINT tip_entry_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.tip_location_access ADD CONSTRAINT tip_location_access_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE public.tip_location_access ADD CONSTRAINT tip_location_access_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.tip_ws_tickets ADD CONSTRAINT tip_ws_tickets_session_id_fkey FOREIGN KEY (session_id) REFERENCES tip_entry_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.unit_conversions ADD CONSTRAINT unit_conversions_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE;
ALTER TABLE public.unmapped_menu_items ADD CONSTRAINT unmapped_menu_items_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD CONSTRAINT users_default_location_id_fkey FOREIGN KEY (default_location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Indexes (non-constraint)
-- ---------------------------------------------------------------------------
CREATE INDEX access_code_role_grants_subject_active_idx ON public.access_code_role_grants USING btree (subject_hash, expires_at DESC) WHERE (consumed_at IS NULL);
CREATE INDEX access_code_validation_events_identifier_created_idx ON public.access_code_validation_events USING btree (identifier_hash, created_at DESC);
CREATE INDEX area_items_active_idx ON public.area_items USING btree (active);
CREATE INDEX area_items_area_idx ON public.area_items USING btree (area_id);
CREATE INDEX area_items_inventory_idx ON public.area_items USING btree (inventory_item_id);
CREATE INDEX current_stock_snapshots_location_item_created_idx ON public.current_stock_snapshots USING btree (location_id, item_id, created_at DESC);
CREATE INDEX current_stock_snapshots_session_created_idx ON public.current_stock_snapshots USING btree (quick_order_session_id, created_at DESC);
CREATE INDEX current_stock_snapshots_user_created_idx ON public.current_stock_snapshots USING btree (entered_by_user_id, created_at DESC);
CREATE UNIQUE INDEX current_stock_snapshots_user_item_location_tracking_unit_idx ON public.current_stock_snapshots USING btree (entered_by_user_id, item_id, location_id, tracking_unit_key);
CREATE INDEX device_push_tokens_user_active_idx ON public.device_push_tokens USING btree (user_id, active, updated_at DESC);
CREATE INDEX employee_quick_order_aliases_active_idx ON public.employee_quick_order_aliases USING btree (active);
CREATE INDEX employee_quick_order_aliases_alias_key_idx ON public.employee_quick_order_aliases USING btree (alias_key);
CREATE INDEX employee_quick_order_aliases_employee_name_key_idx ON public.employee_quick_order_aliases USING btree (employee_name_key);
CREATE INDEX employee_quick_order_aliases_employee_user_id_idx ON public.employee_quick_order_aliases USING btree (employee_user_id);
CREATE INDEX employee_quick_order_aliases_location_id_idx ON public.employee_quick_order_aliases USING btree (location_id);
CREATE UNIQUE INDEX employee_quick_order_aliases_scope_unique_idx ON public.employee_quick_order_aliases USING btree (employee_name_key, alias_key, location_key);
CREATE INDEX historical_order_import_items_import_idx ON public.historical_order_import_items USING btree (import_id);
CREATE INDEX historical_order_import_items_item_idx ON public.historical_order_import_items USING btree (item_id);
CREATE INDEX historical_order_imports_employee_name_key_idx ON public.historical_order_imports USING btree (employee_name_key) WHERE ((employee_id IS NULL) AND (employee_name_key IS NOT NULL));
CREATE INDEX historical_order_imports_location_placed_idx ON public.historical_order_imports USING btree (location_id, placed_at DESC);
CREATE INDEX idx_calibration_results_inventory_item_id ON public.calibration_results USING btree (inventory_item_id);
CREATE INDEX idx_daily_sales_square_catalog_item_id ON public.daily_sales USING btree (square_catalog_item_id);
CREATE INDEX idx_demand_forecasts_location_item_date ON public.demand_forecasts USING btree (location_id, inventory_item_id, forecast_date);
CREATE INDEX idx_forecast_accuracy_location_id ON public.forecast_accuracy USING btree (location_id);
CREATE INDEX idx_historical_orders_import_batch_id ON public.historical_orders USING btree (import_batch_id);
CREATE INDEX idx_holiday_multipliers_category ON public.holiday_multipliers USING btree (category);
CREATE INDEX idx_holiday_multipliers_date_range ON public.holiday_multipliers USING btree (start_date, end_date);
CREATE INDEX idx_import_batches_created_at ON public.import_batches USING btree (created_at);
CREATE INDEX idx_import_batches_status ON public.import_batches USING btree (status);
CREATE INDEX idx_import_batches_uploaded_by ON public.import_batches USING btree (uploaded_by);
CREATE INDEX idx_integrations_user_id_provider ON public.integrations USING btree (user_id, provider);
CREATE INDEX idx_inventory_items_active_name ON public.inventory_items USING btree (active, name);
CREATE INDEX idx_item_order_constraints_inventory_item_id ON public.item_order_constraints USING btree (inventory_item_id);
CREATE INDEX idx_item_order_constraints_preferred_supplier_id ON public.item_order_constraints USING btree (preferred_supplier_id);
CREATE INDEX idx_order_items_inventory_item_id ON public.order_items USING btree (inventory_item_id);
CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);
CREATE INDEX idx_order_items_order_id_status ON public.order_items USING btree (order_id, status);
CREATE INDEX idx_order_items_org_id ON public.order_items USING btree (org_id);
CREATE INDEX idx_order_later_items_status_scheduled ON public.order_later_items USING btree (status, scheduled_at);
CREATE INDEX idx_ordering_patterns_location_item ON public.ordering_patterns USING btree (location_id, inventory_item_id);
CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);
CREATE INDEX idx_orders_location_id ON public.orders USING btree (location_id);
CREATE INDEX idx_orders_location_status_created_at ON public.orders USING btree (location_id, status, created_at DESC);
CREATE INDEX idx_orders_org_id ON public.orders USING btree (org_id);
CREATE INDEX idx_orders_status ON public.orders USING btree (status);
CREATE INDEX idx_orders_status_created_at ON public.orders USING btree (status, created_at DESC);
CREATE INDEX idx_orders_user_id ON public.orders USING btree (user_id);
CREATE INDEX idx_recipes_inventory_item_id ON public.recipes USING btree (inventory_item_id);
CREATE INDEX idx_recipes_square_catalog_item_id ON public.recipes USING btree (square_catalog_item_id);
CREATE INDEX idx_square_connections_last_synced_at ON public.square_connections USING btree (last_synced_at);
CREATE INDEX idx_square_connections_sync_status ON public.square_connections USING btree (sync_status);
CREATE INDEX idx_suggested_orders_lookup ON public.suggested_orders USING btree (date, location_id);
CREATE INDEX idx_unmapped_menu_items_square_catalog_item_id ON public.unmapped_menu_items USING btree (square_catalog_item_id);
CREATE INDEX idx_unmapped_menu_items_status ON public.unmapped_menu_items USING btree (status);
CREATE INDEX idx_user_roles_email ON public.user_roles USING btree (email);
CREATE INDEX inventory_items_aliases_gin_idx ON public.inventory_items USING gin (aliases);
CREATE INDEX inventory_items_created_by_idx ON public.inventory_items USING btree (created_by);
CREATE UNIQUE INDEX inventory_items_item_key_unique_idx ON public.inventory_items USING btree (item_key) WHERE ((item_key IS NOT NULL) AND (active = true));
CREATE INDEX inventory_items_location_id_idx ON public.inventory_items USING btree (location_id);
CREATE INDEX inventory_items_supplier_id_idx ON public.inventory_items USING btree (supplier_id);
CREATE INDEX inventory_reorder_rules_active_idx ON public.inventory_reorder_rules USING btree (active);
CREATE INDEX inventory_reorder_rules_inventory_item_id_idx ON public.inventory_reorder_rules USING btree (inventory_item_id);
CREATE INDEX inventory_reorder_rules_location_id_idx ON public.inventory_reorder_rules USING btree (location_id);
CREATE INDEX inventory_reorder_rules_priority_idx ON public.inventory_reorder_rules USING btree (priority);
CREATE UNIQUE INDEX inventory_reorder_rules_sheet_key_idx ON public.inventory_reorder_rules USING btree (inventory_item_id, location_key, trigger_type, trigger_qty_key, trigger_qty_max_key, trigger_unit_key);
CREATE INDEX inventory_status_terms_active_idx ON public.inventory_status_terms USING btree (active);
CREATE INDEX inventory_status_terms_phrase_key_idx ON public.inventory_status_terms USING btree (phrase_key);
CREATE INDEX inventory_status_terms_priority_idx ON public.inventory_status_terms USING btree (priority);
CREATE UNIQUE INDEX inventory_status_terms_sheet_phrase_key_idx ON public.inventory_status_terms USING btree (phrase_key);
CREATE INDEX item_allowed_units_item_default_idx ON public.item_allowed_units USING btree (item_id, is_default);
CREATE UNIQUE INDEX item_allowed_units_item_unit_employee_unique_idx ON public.item_allowed_units USING btree (item_id, lower(TRIM(BOTH FROM unit)), COALESCE(lower(TRIM(BOTH FROM employee_names)), 'global'::text));
CREATE INDEX item_order_limits_item_location_idx ON public.item_order_limits USING btree (item_id, location_id);
CREATE UNIQUE INDEX item_order_limits_scope_unique_idx ON public.item_order_limits USING btree (item_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX item_order_profiles_item_location_idx ON public.item_order_profiles USING btree (item_id, location_id);
CREATE UNIQUE INDEX item_order_profiles_plain_scope_unique_idx ON public.item_order_profiles USING btree (item_id, location_id, supplier_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX item_order_profiles_scope_unique_idx ON public.item_order_profiles USING btree (item_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX item_reorder_rules_item_location_idx ON public.item_reorder_rules USING btree (item_id, location_id);
CREATE UNIQUE INDEX item_reorder_rules_scope_unique_idx ON public.item_reorder_rules USING btree (item_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE UNIQUE INDEX locations_location_key_unique_idx ON public.locations USING btree (location_key) WHERE (location_key IS NOT NULL);
CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id, read_at, created_at DESC);
CREATE INDEX order_items_decided_by_idx ON public.order_items USING btree (decided_by);
CREATE INDEX order_items_input_mode_idx ON public.order_items USING btree (input_mode);
CREATE INDEX order_items_status_idx ON public.order_items USING btree (status);
CREATE INDEX order_items_supplier_override_id_idx ON public.order_items USING btree (supplier_override_id);
CREATE UNIQUE INDEX order_later_items_active_source_order_item_uidx ON public.order_later_items USING btree (source_order_item_id) WHERE ((source_order_item_id IS NOT NULL) AND (status = ANY (ARRAY['queued'::text, 'added'::text])));
CREATE INDEX order_later_items_created_by_status_scheduled_idx ON public.order_later_items USING btree (created_by, status, scheduled_at);
CREATE INDEX order_later_items_scheduled_at_idx ON public.order_later_items USING btree (scheduled_at);
CREATE INDEX order_later_items_status_location_scheduled_idx ON public.order_later_items USING btree (status, location_id, scheduled_at);
CREATE INDEX order_later_items_suggested_supplier_id_idx ON public.order_later_items USING btree (suggested_supplier_id);
CREATE INDEX orders_entry_method_created_idx ON public.orders USING btree (entry_method, created_at DESC);
CREATE INDEX orders_location_user_status_created_idx ON public.orders USING btree (location_id, user_id, status, created_at DESC);
CREATE INDEX orders_manager_review_status_created_idx ON public.orders USING btree (manager_review_status, created_at DESC);
CREATE INDEX orders_quick_session_idx ON public.orders USING btree (quick_session_id);
CREATE INDEX org_settings_org_id_idx ON public.org_settings USING btree (org_id);
CREATE INDEX parser_corrections_corrected_item_created_idx ON public.parser_corrections USING btree (user_corrected_item_id, created_at DESC);
CREATE INDEX parser_corrections_raw_token_idx ON public.parser_corrections USING btree (raw_token);
CREATE INDEX parser_corrections_session_created_idx ON public.parser_corrections USING btree (session_id, created_at DESC);
CREATE INDEX parser_corrections_user_location_raw_created_idx ON public.parser_corrections USING btree (user_id, location_id, raw_token, created_at DESC);
CREATE INDEX parser_examples_active_created_idx ON public.parser_examples USING btree (is_active, created_at DESC);
CREATE INDEX parser_examples_source_created_idx ON public.parser_examples USING btree (source, created_at DESC);
CREATE INDEX parser_usage_log_created ON public.parser_usage_log USING btree (created_at DESC);
CREATE INDEX parser_usage_log_org_month ON public.parser_usage_log USING btree (org_id, created_at DESC);
CREATE INDEX parser_usage_log_user_day ON public.parser_usage_log USING btree (user_id, created_at DESC);
CREATE INDEX past_order_items_created_by_supplier_ordered_idx ON public.past_order_items USING btree (created_by, supplier_id, ordered_at DESC);
CREATE INDEX past_order_items_past_order_id_idx ON public.past_order_items USING btree (past_order_id);
CREATE INDEX past_order_items_supplier_item_unit_created_idx ON public.past_order_items USING btree (supplier_id, item_id, unit, created_at DESC);
CREATE INDEX past_order_items_supplier_item_unit_ordered_idx ON public.past_order_items USING btree (supplier_id, item_id, unit, ordered_at DESC);
CREATE INDEX past_orders_created_by_created_at_idx ON public.past_orders USING btree (created_by, created_at DESC);
CREATE INDEX past_orders_supplier_created_at_idx ON public.past_orders USING btree (supplier_id, created_at DESC);
CREATE INDEX profiles_role_suspension_activity_idx ON public.profiles USING btree (role, is_suspended, last_order_at, last_active_at);
CREATE INDEX qo_holiday_overrides_active_idx ON public.qo_holiday_overrides USING btree (active);
CREATE UNIQUE INDEX qo_holiday_overrides_sheet_key_idx ON public.qo_holiday_overrides USING btree (holiday_name, start_date, end_date, item_name, COALESCE(normalize_quick_order_alias_text(location_scope), 'global'::text));
CREATE INDEX qo_items_active_idx ON public.qo_items USING btree (active);
CREATE UNIQUE INDEX qo_items_inventory_item_id_location_idx ON public.qo_items USING btree (inventory_item_id, location_key) WHERE (inventory_item_id IS NOT NULL);
CREATE UNIQUE INDEX qo_items_item_key_location_key_idx ON public.qo_items USING btree (item_key, location_key);
CREATE INDEX qo_items_location_id_idx ON public.qo_items USING btree (location_id);
CREATE INDEX qo_items_supplier_id_idx ON public.qo_items USING btree (supplier_id);
CREATE INDEX qo_keywords_active_idx ON public.qo_keywords USING btree (active);
CREATE INDEX qo_keywords_meaning_type_idx ON public.qo_keywords USING btree (meaning_type);
CREATE UNIQUE INDEX qo_keywords_phrase_meaning_key_idx ON public.qo_keywords USING btree (phrase_key, meaning_type);
CREATE INDEX qo_personalization_active_idx ON public.qo_personalization USING btree (active);
CREATE INDEX qo_personalization_employee_name_key_idx ON public.qo_personalization USING btree (employee_name_key);
CREATE INDEX qo_personalization_employee_user_id_idx ON public.qo_personalization USING btree (employee_user_id);
CREATE INDEX qo_personalization_qo_item_id_idx ON public.qo_personalization USING btree (qo_item_id);
CREATE UNIQUE INDEX qo_personalization_sheet_key_idx ON public.qo_personalization USING btree (employee_name_key, rule_type, phrase_key, item_name_key, personal_unit_key, location_key);
CREATE INDEX qo_reorder_rules_active_idx ON public.qo_reorder_rules USING btree (active);
CREATE INDEX qo_reorder_rules_location_id_idx ON public.qo_reorder_rules USING btree (location_id);
CREATE INDEX qo_reorder_rules_qo_item_id_idx ON public.qo_reorder_rules USING btree (qo_item_id);
CREATE UNIQUE INDEX qo_reorder_rules_sheet_key_idx ON public.qo_reorder_rules USING btree (item_name_key, location_key, trigger_unit_key, trigger_at_or_below);
CREATE INDEX quick_order_alias_rules_active_idx ON public.quick_order_alias_rules USING btree (active);
CREATE INDEX quick_order_alias_rules_alias_key_idx ON public.quick_order_alias_rules USING btree (alias_key);
CREATE INDEX quick_order_alias_rules_employee_name_key_idx ON public.quick_order_alias_rules USING btree (employee_name_key);
CREATE INDEX quick_order_alias_rules_employee_user_id_idx ON public.quick_order_alias_rules USING btree (employee_user_id);
CREATE INDEX quick_order_alias_rules_item_id_idx ON public.quick_order_alias_rules USING btree (item_id);
CREATE INDEX quick_order_alias_rules_location_id_idx ON public.quick_order_alias_rules USING btree (location_id);
CREATE INDEX quick_order_alias_rules_mode_scope_idx ON public.quick_order_alias_rules USING btree (mode_scope);
CREATE INDEX quick_order_alias_rules_scope_type_idx ON public.quick_order_alias_rules USING btree (scope_type);
CREATE UNIQUE INDEX quick_order_alias_rules_sheet_key_idx ON public.quick_order_alias_rules USING btree (alias_key, scope_type, employee_scope_key, mode_scope, location_key);
CREATE INDEX quick_order_cart_mutations_session_created_idx ON public.quick_order_cart_mutations USING btree (session_id, created_at DESC);
CREATE INDEX quick_order_cart_mutations_user_created_idx ON public.quick_order_cart_mutations USING btree (user_id, created_at DESC);
CREATE INDEX quick_order_ignored_suggestions_session_idx ON public.quick_order_ignored_suggestions USING btree (user_id, location_id, ignored_at DESC);
CREATE INDEX quick_order_reorder_rules_active_idx ON public.quick_order_reorder_rules USING btree (active);
CREATE INDEX quick_order_reorder_rules_employee_name_key_idx ON public.quick_order_reorder_rules USING btree (employee_name_key);
CREATE INDEX quick_order_reorder_rules_employee_user_id_idx ON public.quick_order_reorder_rules USING btree (employee_user_id);
CREATE INDEX quick_order_reorder_rules_item_id_idx ON public.quick_order_reorder_rules USING btree (item_id);
CREATE INDEX quick_order_reorder_rules_location_id_idx ON public.quick_order_reorder_rules USING btree (location_id);
CREATE INDEX quick_order_reorder_rules_mode_scope_idx ON public.quick_order_reorder_rules USING btree (mode_scope);
CREATE INDEX quick_order_reorder_rules_scope_type_idx ON public.quick_order_reorder_rules USING btree (scope_type);
CREATE UNIQUE INDEX quick_order_reorder_rules_sheet_key_idx ON public.quick_order_reorder_rules USING btree (item_id, scope_type, employee_scope_key, mode_scope, location_key, counted_unit_key, trigger_type, trigger_qty_min_key, trigger_qty_max_key);
CREATE INDEX quick_order_sessions_location_created_idx ON public.quick_order_sessions USING btree (location_id, created_at DESC);
CREATE INDEX quick_order_sessions_status_updated_idx ON public.quick_order_sessions USING btree (status, updated_at DESC);
CREATE INDEX quick_order_sessions_submitted_order_idx ON public.quick_order_sessions USING btree (submitted_order_id);
CREATE INDEX quick_order_sessions_user_created_idx ON public.quick_order_sessions USING btree (user_id, created_at DESC);
CREATE INDEX quick_order_status_terms_active_idx ON public.quick_order_status_terms USING btree (active);
CREATE UNIQUE INDEX quick_order_status_terms_phrase_key_idx ON public.quick_order_status_terms USING btree (phrase_key);
CREATE INDEX quick_order_unit_rules_active_idx ON public.quick_order_unit_rules USING btree (active);
CREATE INDEX quick_order_unit_rules_employee_name_key_idx ON public.quick_order_unit_rules USING btree (employee_name_key);
CREATE INDEX quick_order_unit_rules_employee_user_id_idx ON public.quick_order_unit_rules USING btree (employee_user_id);
CREATE INDEX quick_order_unit_rules_from_unit_key_idx ON public.quick_order_unit_rules USING btree (from_unit_key);
CREATE INDEX quick_order_unit_rules_item_id_idx ON public.quick_order_unit_rules USING btree (item_id);
CREATE INDEX quick_order_unit_rules_location_id_idx ON public.quick_order_unit_rules USING btree (location_id);
CREATE INDEX quick_order_unit_rules_mode_scope_idx ON public.quick_order_unit_rules USING btree (mode_scope);
CREATE INDEX quick_order_unit_rules_scope_type_idx ON public.quick_order_unit_rules USING btree (scope_type);
CREATE UNIQUE INDEX quick_order_unit_rules_sheet_key_idx ON public.quick_order_unit_rules USING btree (item_scope_key, from_unit_key, scope_type, employee_scope_key, mode_scope, location_key, is_default_when_missing);
CREATE INDEX quick_order_voice_parse_events_location_created_idx ON public.quick_order_voice_parse_events USING btree (location_id, created_at DESC);
CREATE INDEX quick_order_voice_parse_events_session_created_idx ON public.quick_order_voice_parse_events USING btree (session_id, created_at DESC);
CREATE INDEX quick_order_voice_parse_events_user_created_idx ON public.quick_order_voice_parse_events USING btree (user_id, created_at DESC);
CREATE INDEX recurring_rules_enabled_idx ON public.recurring_reminder_rules USING btree (enabled, scope, time_of_day);
CREATE INDEX reminder_events_reminder_sent_idx ON public.reminder_events USING btree (reminder_id, sent_at DESC);
CREATE INDEX reminders_employee_status_idx ON public.reminders USING btree (employee_id, status, created_at DESC);
CREATE INDEX reminders_location_status_idx ON public.reminders USING btree (location_id, status, created_at DESC);
CREATE UNIQUE INDEX reminders_one_active_location_banner_idx ON public.reminders USING btree (location_id) WHERE ((status = 'active'::text) AND (scope = 'location_banner'::text));
CREATE UNIQUE INDEX reminders_one_active_per_employee_location_idx ON public.reminders USING btree (employee_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE ((status = 'active'::text) AND (scope = 'employee'::text));
CREATE INDEX stock_check_sessions_area_idx ON public.stock_check_sessions USING btree (area_id);
CREATE INDEX stock_updates_area_idx ON public.stock_updates USING btree (area_id);
CREATE INDEX stock_updates_item_idx ON public.stock_updates USING btree (inventory_item_id);
CREATE INDEX storage_areas_active_idx ON public.storage_areas USING btree (active);
CREATE INDEX storage_areas_location_idx ON public.storage_areas USING btree (location_id);
CREATE UNIQUE INDEX suppliers_supplier_key_unique_idx ON public.suppliers USING btree (supplier_key) WHERE (supplier_key IS NOT NULL);
CREATE INDEX tip_auth_attempts_ident_idx ON public.tip_auth_attempts USING btree (identifier_hash, attempted_at DESC);
CREATE INDEX tip_auth_attempts_location_idx ON public.tip_auth_attempts USING btree (location_id, attempted_at DESC);
CREATE INDEX tip_entries_slot_history_idx ON public.tip_entries USING btree (location_id, meal_period, business_date DESC);
CREATE INDEX tip_entry_people_employee_idx ON public.tip_entry_people USING btree (tip_employee_id);
CREATE UNIQUE INDEX unit_conversions_inventory_from_to_key ON public.unit_conversions USING btree (inventory_item_id, lower(TRIM(BOTH FROM from_unit)), lower(TRIM(BOTH FROM to_unit)));
CREATE INDEX unit_conversions_inventory_item_id_idx ON public.unit_conversions USING btree (inventory_item_id);
CREATE UNIQUE INDEX unit_synonyms_from_unit_unique_idx ON public.unit_synonyms USING btree (lower(TRIM(BOTH FROM from_unit)));

-- ---------------------------------------------------------------------------
-- Sequence ownership
-- ---------------------------------------------------------------------------
ALTER SEQUENCE public.orders_order_number_seq OWNED BY public.orders.order_number;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER set_area_items_updated_at BEFORE UPDATE ON public.area_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_device_push_tokens_updated_at BEFORE UPDATE ON public.device_push_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_employee_quick_order_alias_keys BEFORE INSERT OR UPDATE OF employee_name, alias_text, employee_user_id ON public.employee_quick_order_aliases FOR EACH ROW EXECUTE FUNCTION set_employee_quick_order_alias_keys();
CREATE TRIGGER set_employee_quick_order_aliases_updated_at BEFORE UPDATE ON public.employee_quick_order_aliases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_historical_import_employee_name_key BEFORE INSERT OR UPDATE OF employee_name_text ON public.historical_order_imports FOR EACH ROW EXECUTE FUNCTION set_historical_import_employee_name_key();
CREATE TRIGGER set_integrations_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_inventory_reorder_rules_updated_at BEFORE UPDATE ON public.inventory_reorder_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_inventory_status_terms_updated_at BEFORE UPDATE ON public.inventory_status_terms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_item_allowed_units_updated_at BEFORE UPDATE ON public.item_allowed_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_item_order_constraints_updated_at BEFORE UPDATE ON public.item_order_constraints FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_item_order_limits_updated_at BEFORE UPDATE ON public.item_order_limits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_item_order_profiles_updated_at BEFORE UPDATE ON public.item_order_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_item_reorder_rules_updated_at BEFORE UPDATE ON public.item_reorder_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_locations_updated_at BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_order_later_items_updated_at BEFORE UPDATE ON public.order_later_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER enforce_order_metadata_security BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION enforce_order_metadata_security();
CREATE TRIGGER normalize_org_settings_access_codes BEFORE INSERT OR UPDATE OF employee_access_code, manager_access_code ON public.org_settings FOR EACH ROW EXECUTE FUNCTION normalize_org_settings_access_codes();
CREATE TRIGGER set_org_settings_updated_at BEFORE UPDATE ON public.org_settings FOR EACH ROW EXECUTE FUNCTION set_org_settings_updated_at();
CREATE TRIGGER enforce_profile_security BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION enforce_profile_security();
CREATE TRIGGER link_employee_quick_order_aliases_after_profile_change AFTER INSERT OR UPDATE OF full_name ON public.profiles FOR EACH ROW EXECUTE FUNCTION link_employee_quick_order_aliases_for_profile();
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_profiles_updated_at();
CREATE TRIGGER set_qo_holiday_overrides_updated_at BEFORE UPDATE ON public.qo_holiday_overrides FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_qo_items_updated_at BEFORE UPDATE ON public.qo_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_qo_keywords_updated_at BEFORE UPDATE ON public.qo_keywords FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_qo_personalization_updated_at BEFORE UPDATE ON public.qo_personalization FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_qo_reorder_rules_updated_at BEFORE UPDATE ON public.qo_reorder_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_quick_order_alias_rules_updated_at BEFORE UPDATE ON public.quick_order_alias_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_quick_order_reorder_rules_updated_at BEFORE UPDATE ON public.quick_order_reorder_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_quick_order_sessions_updated_at BEFORE UPDATE ON public.quick_order_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_quick_order_status_terms_updated_at BEFORE UPDATE ON public.quick_order_status_terms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_quick_order_unit_rules_updated_at BEFORE UPDATE ON public.quick_order_unit_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_quick_order_voice_parse_events_updated_at BEFORE UPDATE ON public.quick_order_voice_parse_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_recipes_updated_at BEFORE UPDATE ON public.recipes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_recurring_reminder_rules_updated_at BEFORE UPDATE ON public.recurring_reminder_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_reminder_system_settings_updated_at BEFORE UPDATE ON public.reminder_system_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_square_connections_updated_at BEFORE UPDATE ON public.square_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_storage_areas_updated_at BEFORE UPDATE ON public.storage_areas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tip_employees_set_updated_at BEFORE UPDATE ON public.tip_employees FOR EACH ROW EXECUTE FUNCTION tip_set_updated_at();
CREATE TRIGGER tip_entries_set_updated_at BEFORE UPDATE ON public.tip_entries FOR EACH ROW EXECUTE FUNCTION tip_set_updated_at();
CREATE TRIGGER tip_location_access_set_updated_at BEFORE UPDATE ON public.tip_location_access FOR EACH ROW EXECUTE FUNCTION tip_set_updated_at();
CREATE TRIGGER set_unit_conversions_updated_at BEFORE UPDATE ON public.unit_conversions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_user_roles_updated_at BEFORE UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER enforce_user_security BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION enforce_user_security();
CREATE TRIGGER link_employee_quick_order_aliases_after_user_change AFTER INSERT OR UPDATE OF name ON public.users FOR EACH ROW EXECUTE FUNCTION link_employee_quick_order_aliases_for_user();
CREATE TRIGGER link_historical_imports_after_user_insert AFTER INSERT OR UPDATE OF name ON public.users FOR EACH ROW EXECUTE FUNCTION link_historical_imports_for_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.access_code_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_code_role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_code_validation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.area_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calibration_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.current_stock_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_quick_order_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_accuracy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_order_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_order_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holiday_multipliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reorder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_status_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_allowed_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_order_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_order_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_order_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_reorder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_later_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordering_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parser_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parser_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parser_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.past_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.past_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qo_holiday_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qo_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qo_personalization ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qo_reorder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_order_alias_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_order_cart_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_order_ignored_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_order_reorder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_order_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_order_status_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_order_unit_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_order_voice_parse_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_reminder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_check_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suggested_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tip_auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tip_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tip_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tip_entry_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tip_entry_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tip_location_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tip_ws_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_synonyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unmapped_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_config_read_authenticated ON public.app_config AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY area_items_manager_all ON public.area_items AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_modify_manager ON public.calibration_results AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.calibration_results AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY current_stock_snapshots_insert_own ON public.current_stock_snapshots AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((entered_by_user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY current_stock_snapshots_select_own_or_manager ON public.current_stock_snapshots AS PERMISSIVE FOR SELECT TO authenticated
USING (((entered_by_user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY daily_sales_service_insert ON public.daily_sales AS PERMISSIVE FOR INSERT TO service_role
WITH CHECK (true);
CREATE POLICY demand_forecasts_service_delete ON public.demand_forecasts AS PERMISSIVE FOR DELETE TO service_role
USING (true);
CREATE POLICY demand_forecasts_service_insert ON public.demand_forecasts AS PERMISSIVE FOR INSERT TO service_role
WITH CHECK (true);
CREATE POLICY demand_forecasts_service_update ON public.demand_forecasts AS PERMISSIVE FOR UPDATE TO service_role
USING (true)
WITH CHECK (true);
CREATE POLICY device_push_tokens_delete_own ON public.device_push_tokens AS PERMISSIVE FOR DELETE TO authenticated
USING ((auth.uid() = user_id));
CREATE POLICY device_push_tokens_insert_own ON public.device_push_tokens AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK ((auth.uid() = user_id));
CREATE POLICY device_push_tokens_select_own_or_manager ON public.device_push_tokens AS PERMISSIVE FOR SELECT TO authenticated
USING (((auth.uid() = user_id) OR current_user_is_manager()));
CREATE POLICY device_push_tokens_update_own ON public.device_push_tokens AS PERMISSIVE FOR UPDATE TO authenticated
USING ((auth.uid() = user_id))
WITH CHECK ((auth.uid() = user_id));
CREATE POLICY employee_quick_order_aliases_modify_manager ON public.employee_quick_order_aliases AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY employee_quick_order_aliases_select_active_authenticated ON public.employee_quick_order_aliases AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY forecast_accuracy_service_insert ON public.forecast_accuracy AS PERMISSIVE FOR INSERT TO service_role
WITH CHECK (true);
CREATE POLICY forecast_accuracy_service_update ON public.forecast_accuracy AS PERMISSIVE FOR UPDATE TO service_role
USING (true)
WITH CHECK (true);
CREATE POLICY historical_order_import_items_manager_all ON public.historical_order_import_items AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY historical_order_imports_manager_all ON public.historical_order_imports AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_modify_manager ON public.historical_orders AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.historical_orders AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY fallback_modify_manager ON public.holiday_multipliers AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.holiday_multipliers AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY fallback_modify_manager ON public.import_batches AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.import_batches AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY fallback_modify_manager ON public.integrations AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.integrations AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY inventory_items_insert_manager ON public.inventory_items AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (current_user_is_manager());
CREATE POLICY inventory_items_select_authenticated ON public.inventory_items AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY inventory_items_update_manager ON public.inventory_items AS PERMISSIVE FOR UPDATE TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY inventory_reorder_rules_modify_manager ON public.inventory_reorder_rules AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY inventory_reorder_rules_select_authenticated ON public.inventory_reorder_rules AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY inventory_status_terms_modify_manager ON public.inventory_status_terms AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY inventory_status_terms_select_authenticated ON public.inventory_status_terms AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY item_allowed_units_modify_manager ON public.item_allowed_units AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY item_allowed_units_select_authenticated ON public.item_allowed_units AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY fallback_modify_manager ON public.item_order_constraints AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.item_order_constraints AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY item_order_limits_modify_manager ON public.item_order_limits AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY item_order_limits_select_authenticated ON public.item_order_limits AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY item_order_profiles_modify_manager ON public.item_order_profiles AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY item_order_profiles_select_authenticated ON public.item_order_profiles AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY item_reorder_rules_modify_manager ON public.item_reorder_rules AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY item_reorder_rules_select_authenticated ON public.item_reorder_rules AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY locations_modify_manager ON public.locations AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY locations_select_authenticated ON public.locations AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY notifications_insert_manager_or_owner ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK ((current_user_is_manager() OR (auth.uid() = user_id)));
CREATE POLICY notifications_select_manager_or_owner ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated
USING ((current_user_is_manager() OR (auth.uid() = user_id)));
CREATE POLICY notifications_update_owner_or_manager ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated
USING (((auth.uid() = user_id) OR current_user_is_manager()))
WITH CHECK (((auth.uid() = user_id) OR current_user_is_manager()));
CREATE POLICY order_items_insert_owner_or_manager ON public.order_items AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.user_id = auth.uid())))) OR current_user_is_manager()));
CREATE POLICY order_items_select_owner_or_manager ON public.order_items AS PERMISSIVE FOR SELECT TO authenticated
USING ((current_user_is_manager() OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.user_id = auth.uid()))))));
CREATE POLICY order_items_update_manager_or_owner ON public.order_items AS PERMISSIVE FOR UPDATE TO authenticated
USING ((current_user_is_manager() OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.user_id = auth.uid()))))))
WITH CHECK ((current_user_is_manager() OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.user_id = auth.uid()))))));
CREATE POLICY order_later_items_delete_manager_or_owner ON public.order_later_items AS PERMISSIVE FOR DELETE TO authenticated
USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY order_later_items_insert_manager_or_owner ON public.order_later_items AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY order_later_items_select_manager_or_owner ON public.order_later_items AS PERMISSIVE FOR SELECT TO authenticated
USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY order_later_items_update_manager_or_owner ON public.order_later_items AS PERMISSIVE FOR UPDATE TO authenticated
USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))))
WITH CHECK (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY ordering_patterns_service_delete ON public.ordering_patterns AS PERMISSIVE FOR DELETE TO service_role
USING (true);
CREATE POLICY ordering_patterns_service_insert ON public.ordering_patterns AS PERMISSIVE FOR INSERT TO service_role
WITH CHECK (true);
CREATE POLICY ordering_patterns_service_update ON public.ordering_patterns AS PERMISSIVE FOR UPDATE TO service_role
USING (true)
WITH CHECK (true);
CREATE POLICY orders_insert_authenticated ON public.orders AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK ((auth.uid() = user_id));
CREATE POLICY orders_select_owner_or_manager ON public.orders AS PERMISSIVE FOR SELECT TO authenticated
USING (((auth.uid() = user_id) OR current_user_is_manager()));
CREATE POLICY orders_update_manager_or_owner ON public.orders AS PERMISSIVE FOR UPDATE TO authenticated
USING (((auth.uid() = user_id) OR current_user_is_manager()))
WITH CHECK (((auth.uid() = user_id) OR current_user_is_manager()));
CREATE POLICY fallback_select_authenticated ON public.org_settings AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY parser_corrections_insert_own ON public.parser_corrections AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY parser_corrections_select_manager_or_owner ON public.parser_corrections AS PERMISSIVE FOR SELECT TO authenticated
USING (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY parser_examples_modify_manager ON public.parser_examples AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY parser_examples_select_authenticated ON public.parser_examples AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY parser_usage_log_select_manager ON public.parser_usage_log AS PERMISSIVE FOR SELECT TO authenticated
USING (current_user_is_manager());
CREATE POLICY past_order_items_delete_manager_or_owner ON public.past_order_items AS PERMISSIVE FOR DELETE TO authenticated
USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY past_order_items_insert_manager_or_owner ON public.past_order_items AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY past_order_items_select_manager_or_owner ON public.past_order_items AS PERMISSIVE FOR SELECT TO authenticated
USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY past_order_items_update_manager_or_owner ON public.past_order_items AS PERMISSIVE FOR UPDATE TO authenticated
USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))))
WITH CHECK (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY past_orders_delete_manager_or_owner ON public.past_orders AS PERMISSIVE FOR DELETE TO authenticated
USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY past_orders_insert_manager_or_owner ON public.past_orders AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY past_orders_select_manager_or_owner ON public.past_orders AS PERMISSIVE FOR SELECT TO authenticated
USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY past_orders_update_manager_or_owner ON public.past_orders AS PERMISSIVE FOR UPDATE TO authenticated
USING (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))))
WITH CHECK (((auth.uid() = created_by) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.role = 'manager'::user_role))))));
CREATE POLICY profiles_insert_own ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK ((auth.uid() = id));
CREATE POLICY profiles_select_own_or_manager ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated
USING (((auth.uid() = id) OR current_user_is_manager()));
CREATE POLICY profiles_update_manager_suspend_employee ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
USING ((current_user_is_manager() AND (id <> auth.uid()) AND (role = 'employee'::text)))
WITH CHECK ((current_user_is_manager() AND (id <> auth.uid()) AND (role = 'employee'::text)));
CREATE POLICY profiles_update_own ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated
USING ((auth.uid() = id))
WITH CHECK ((auth.uid() = id));
CREATE POLICY qo_holiday_overrides_modify_manager ON public.qo_holiday_overrides AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY qo_holiday_overrides_select_authenticated ON public.qo_holiday_overrides AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY qo_items_modify_manager ON public.qo_items AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY qo_items_select_authenticated ON public.qo_items AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY qo_keywords_modify_manager ON public.qo_keywords AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY qo_keywords_select_authenticated ON public.qo_keywords AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY qo_personalization_modify_manager ON public.qo_personalization AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY qo_personalization_select_authenticated ON public.qo_personalization AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY qo_reorder_rules_modify_manager ON public.qo_reorder_rules AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY qo_reorder_rules_select_authenticated ON public.qo_reorder_rules AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY quick_order_alias_rules_modify_manager ON public.quick_order_alias_rules AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY quick_order_alias_rules_select_authenticated ON public.quick_order_alias_rules AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY quick_order_cart_mutations_insert_owner_or_manager ON public.quick_order_cart_mutations AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY quick_order_cart_mutations_select_owner_or_manager ON public.quick_order_cart_mutations AS PERMISSIVE FOR SELECT TO authenticated
USING (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY quick_order_cart_mutations_update_owner_or_manager ON public.quick_order_cart_mutations AS PERMISSIVE FOR UPDATE TO authenticated
USING (((user_id = auth.uid()) OR current_user_is_manager()))
WITH CHECK (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY quick_order_ignored_suggestions_owner_or_manager ON public.quick_order_ignored_suggestions AS PERMISSIVE FOR ALL TO authenticated
USING (((user_id = auth.uid()) OR current_user_is_manager()))
WITH CHECK (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY quick_order_reorder_rules_modify_manager ON public.quick_order_reorder_rules AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY quick_order_reorder_rules_select_authenticated ON public.quick_order_reorder_rules AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY quick_order_sessions_insert_own ON public.quick_order_sessions AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY quick_order_sessions_select_own_or_manager ON public.quick_order_sessions AS PERMISSIVE FOR SELECT TO authenticated
USING (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY quick_order_sessions_update_own_or_manager ON public.quick_order_sessions AS PERMISSIVE FOR UPDATE TO authenticated
USING (((user_id = auth.uid()) OR current_user_is_manager()))
WITH CHECK (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY quick_order_status_terms_modify_manager ON public.quick_order_status_terms AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY quick_order_status_terms_select_authenticated ON public.quick_order_status_terms AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY quick_order_unit_rules_modify_manager ON public.quick_order_unit_rules AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY quick_order_unit_rules_select_authenticated ON public.quick_order_unit_rules AS PERMISSIVE FOR SELECT TO authenticated
USING (((active = true) OR current_user_is_manager()));
CREATE POLICY quick_order_voice_parse_events_select_owner_or_manager ON public.quick_order_voice_parse_events AS PERMISSIVE FOR SELECT TO authenticated
USING (((user_id = auth.uid()) OR current_user_is_manager()));
CREATE POLICY fallback_modify_manager ON public.recipes AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.recipes AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY recurring_rules_manager_delete ON public.recurring_reminder_rules AS PERMISSIVE FOR DELETE TO authenticated
USING (current_user_is_manager());
CREATE POLICY recurring_rules_manager_insert ON public.recurring_reminder_rules AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (current_user_is_manager());
CREATE POLICY recurring_rules_manager_select ON public.recurring_reminder_rules AS PERMISSIVE FOR SELECT TO authenticated
USING (current_user_is_manager());
CREATE POLICY recurring_rules_manager_update ON public.recurring_reminder_rules AS PERMISSIVE FOR UPDATE TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY reminder_events_insert_manager_only ON public.reminder_events AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (current_user_is_manager());
CREATE POLICY reminder_events_select_manager_or_employee ON public.reminder_events AS PERMISSIVE FOR SELECT TO authenticated
USING ((current_user_is_manager() OR (EXISTS ( SELECT 1
   FROM reminders r
  WHERE ((r.id = reminder_events.reminder_id) AND (r.employee_id = auth.uid()))))));
CREATE POLICY reminder_system_settings_manager_read ON public.reminder_system_settings AS PERMISSIVE FOR SELECT TO authenticated
USING (current_user_is_manager());
CREATE POLICY reminder_system_settings_manager_update ON public.reminder_system_settings AS PERMISSIVE FOR UPDATE TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY reminders_insert_manager_only ON public.reminders AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (current_user_is_manager());
CREATE POLICY reminders_select_location_banners ON public.reminders AS PERMISSIVE FOR SELECT TO authenticated
USING (((scope = 'location_banner'::text) AND (status = 'active'::text) AND (current_user_is_manager() OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.default_location_id = reminders.location_id)))))));
CREATE POLICY reminders_select_manager_or_employee ON public.reminders AS PERMISSIVE FOR SELECT TO authenticated
USING ((current_user_is_manager() OR (auth.uid() = employee_id)));
CREATE POLICY reminders_update_manager_only ON public.reminders AS PERMISSIVE FOR UPDATE TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_modify_manager ON public.square_connections AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.square_connections AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY stock_check_sessions_manager_all ON public.stock_check_sessions AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY stock_updates_manager_all ON public.stock_updates AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY storage_areas_manager_all ON public.storage_areas AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY suggested_orders_select_authenticated ON public.suggested_orders AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY suppliers_modify_manager ON public.suppliers AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY suppliers_select_authenticated ON public.suppliers AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY tip_employees_manager_all ON public.tip_employees AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY tip_entries_manager_all ON public.tip_entries AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY tip_entry_people_manager_all ON public.tip_entry_people AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY tip_location_access_manager_read ON public.tip_location_access AS PERMISSIVE FOR SELECT TO authenticated
USING (current_user_is_manager());
CREATE POLICY unit_conversions_select_authenticated ON public.unit_conversions AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY unit_synonyms_all_service_role ON public.unit_synonyms AS PERMISSIVE FOR ALL TO service_role
USING (true)
WITH CHECK (true);
CREATE POLICY unit_synonyms_read_authenticated ON public.unit_synonyms AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY fallback_modify_manager ON public.unmapped_menu_items AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.unmapped_menu_items AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY fallback_modify_manager ON public.user_roles AS PERMISSIVE FOR ALL TO authenticated
USING (current_user_is_manager())
WITH CHECK (current_user_is_manager());
CREATE POLICY fallback_select_authenticated ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated
USING (true);
CREATE POLICY users_select_own_or_manager ON public.users AS PERMISSIVE FOR SELECT TO authenticated
USING (((auth.uid() = id) OR current_user_is_manager()));
CREATE POLICY users_update_own ON public.users AS PERMISSIVE FOR UPDATE TO authenticated
USING ((auth.uid() = id))
WITH CHECK ((auth.uid() = id));
