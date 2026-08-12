-- Phase 9a: guided stock-check core.
--
-- The existing stock domain remains canonical: area_items owns the physical
-- location/area configuration, stock_updates remains the count ledger, and
-- stock_check_sessions owns walk state.  This migration only adds the fields
-- needed for a resumable, location-wide checklist walk and its checklist
-- hand-off.

-- ---------------------------------------------------------------------------
-- Area configuration: pars/reorder points and deterministic shelf order.
-- ---------------------------------------------------------------------------

alter table public.area_items
  add column if not exists reorder_point numeric,
  add column if not exists shelf_sort_order integer not null default 0;

-- Existing min_quantity has always been the stock-warning threshold, so it is
-- the safest backwards-compatible starting value for the new explicit field.
update public.area_items
set reorder_point = coalesce(reorder_point, min_quantity, 0)
where reorder_point is null;

with ordered_area_items as (
  select
    id,
    row_number() over (
      partition by area_id
      order by created_at asc, id asc
    ) - 1 as next_shelf_sort_order
  from public.area_items
)
update public.area_items area_item
set shelf_sort_order = ordered.next_shelf_sort_order
from ordered_area_items ordered
where ordered.id = area_item.id
  and area_item.shelf_sort_order = 0;

alter table public.area_items
  drop constraint if exists area_items_stock_check_par_level_nonnegative,
  drop constraint if exists area_items_stock_check_reorder_point_nonnegative,
  drop constraint if exists area_items_stock_check_reorder_point_at_most_par;

alter table public.area_items
  add constraint area_items_stock_check_par_level_nonnegative
    check (par_level is null or par_level >= 0),
  add constraint area_items_stock_check_reorder_point_nonnegative
    check (reorder_point is null or reorder_point >= 0),
  add constraint area_items_stock_check_reorder_point_at_most_par
    check (reorder_point is null or par_level is null or reorder_point <= par_level);

create index if not exists area_items_area_shelf_sort_idx
  on public.area_items(area_id, shelf_sort_order, id)
  where active = true;

-- ---------------------------------------------------------------------------
-- Session and count ledger extensions.
-- ---------------------------------------------------------------------------

alter table public.stock_check_sessions
  add column if not exists location_id uuid references public.locations(id) on delete cascade,
  add column if not exists current_area_id uuid references public.storage_areas(id) on delete set null,
  add column if not exists area_progress jsonb not null default '{}'::jsonb,
  add column if not exists entry_mode text;

update public.stock_check_sessions session
set
  location_id = coalesce(session.location_id, area.location_id),
  current_area_id = coalesce(session.current_area_id, session.area_id)
from public.storage_areas area
where area.id = session.area_id
  and (session.location_id is null or session.current_area_id is null);

alter table public.stock_check_sessions
  drop constraint if exists stock_check_sessions_area_progress_object,
  drop constraint if exists stock_check_sessions_entry_mode_check;

alter table public.stock_check_sessions
  add constraint stock_check_sessions_area_progress_object
    check (jsonb_typeof(area_progress) = 'object'),
  add constraint stock_check_sessions_entry_mode_check
    check (entry_mode is null or entry_mode in ('numeric', 'status'));

create index if not exists stock_check_sessions_location_user_status_idx
  on public.stock_check_sessions(location_id, user_id, status, started_at desc);

create index if not exists stock_check_sessions_current_area_idx
  on public.stock_check_sessions(current_area_id)
  where current_area_id is not null;

alter table public.stock_updates
  add column if not exists stock_check_session_id uuid references public.stock_check_sessions(id) on delete cascade,
  add column if not exists area_item_id uuid references public.area_items(id) on delete set null,
  add column if not exists entry_mode text,
  add column if not exists status_value text;

alter table public.stock_updates
  drop constraint if exists stock_updates_update_method_check,
  drop constraint if exists stock_updates_quick_select_value_check,
  drop constraint if exists stock_updates_stock_check_entry_check;

alter table public.stock_updates
  add constraint stock_updates_update_method_check
    check (update_method in (
      'nfc',
      'qr',
      'manual',
      'quick_select',
      'stock_check_numeric',
      'stock_check_status'
    )),
  add constraint stock_updates_quick_select_value_check
    check (quick_select_value is null or quick_select_value in ('empty', 'out', 'low', 'good', 'full')),
  add constraint stock_updates_stock_check_entry_check
    check (
      stock_check_session_id is null
      or (
        area_item_id is not null
        and entry_mode in ('numeric', 'status')
        and (
          (entry_mode = 'numeric' and status_value is null)
          or (entry_mode = 'status' and status_value in ('full', 'low', 'out'))
        )
      )
    );

-- Nullable legacy fields remain distinct under a normal UNIQUE constraint,
-- while one active count per (session, area item) can be upserted by the
-- guided walk without creating a parallel session-items table.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_updates_stock_check_session_area_item_key'
      and conrelid = 'public.stock_updates'::regclass
  ) then
    alter table public.stock_updates
      add constraint stock_updates_stock_check_session_area_item_key
      unique (stock_check_session_id, area_item_id);
  end if;
end;
$$;

create index if not exists stock_updates_stock_check_session_idx
  on public.stock_updates(stock_check_session_id, area_item_id, created_at desc)
  where stock_check_session_id is not null;

-- ---------------------------------------------------------------------------
-- Phase 5 checklist provenance.
-- ---------------------------------------------------------------------------

alter table public.order_checklists
  drop constraint if exists order_checklists_generation_source_check;

alter table public.order_checklists
  add constraint order_checklists_generation_source_check
    check (generation_source in ('history_v1', 'manual', 'import', 'stock_check'));

alter table public.order_checklist_items
  add column if not exists stock_check_session_id uuid
    references public.stock_check_sessions(id) on delete set null;

alter table public.order_checklist_items
  drop constraint if exists order_checklist_items_item_source_check;

alter table public.order_checklist_items
  add constraint order_checklist_items_item_source_check
    check (item_source in ('generated', 'manual', 'import', 'stock_check'));

create index if not exists order_checklist_items_stock_check_session_idx
  on public.order_checklist_items(stock_check_session_id)
  where stock_check_session_id is not null;

-- ---------------------------------------------------------------------------
-- Guided-walk RPCs. They deliberately write only count/progress fields; pars
-- remain covered by the existing manager-only area_items policy.
-- ---------------------------------------------------------------------------

create or replace function public.start_or_resume_stock_check(
  p_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.stock_check_sessions%rowtype;
  v_current_area_id uuid;
  v_area_progress jsonb;
  v_items_total integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to start a stock check' using errcode = 'P0001';
  end if;

  if p_location_id is null or not exists (
    select 1 from public.locations location where location.id = p_location_id
  ) then
    raise exception 'Invalid stock-check location' using errcode = 'P0001';
  end if;

  select session.*
  into v_session
  from public.stock_check_sessions session
  where session.location_id = p_location_id
    and session.user_id = v_user_id
    and session.status = 'in_progress'
  order by session.started_at desc, session.id desc
  limit 1;

  if found then
    return to_jsonb(v_session);
  end if;

  select area.id
  into v_current_area_id
  from public.storage_areas area
  where area.location_id = p_location_id
    and area.active = true
  order by area.sort_order asc, area.name asc, area.id asc
  limit 1;

  if v_current_area_id is null then
    raise exception 'This location has no active storage areas' using errcode = 'P0001';
  end if;

  select
    coalesce(sum(area_item_counts.items_total), 0)::integer,
    coalesce(
      jsonb_object_agg(
        area_item_counts.area_id::text,
        jsonb_build_object(
          'items_total', area_item_counts.items_total,
          'items_checked', 0,
          'items_skipped', 0,
          'skipped_item_ids', '[]'::jsonb,
          'completed_at', null
        )
      ),
      '{}'::jsonb
    )
  into v_items_total, v_area_progress
  from (
    select
      area.id as area_id,
      count(area_item.id)::integer as items_total
    from public.storage_areas area
    left join public.area_items area_item
      on area_item.area_id = area.id
      and area_item.active = true
    where area.location_id = p_location_id
      and area.active = true
    group by area.id
  ) area_item_counts;

  insert into public.stock_check_sessions (
    -- area_id remains the legacy initial-area anchor. location_id/current_area_id
    -- define the new whole-location guided-walk scope.
    area_id,
    location_id,
    current_area_id,
    area_progress,
    user_id,
    items_total,
    status,
    scan_method
  )
  values (
    v_current_area_id,
    p_location_id,
    v_current_area_id,
    v_area_progress,
    v_user_id,
    v_items_total,
    'in_progress',
    'manual'
  )
  returning * into v_session;

  return to_jsonb(v_session);
end;
$$;

create or replace function public.set_stock_check_current_area(
  p_session_id uuid,
  p_area_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.stock_check_sessions%rowtype;
begin
  select session.*
  into v_session
  from public.stock_check_sessions session
  where session.id = p_session_id;

  if not found then
    raise exception 'Stock-check session not found' using errcode = 'P0001';
  end if;

  if v_user_id is null or (
    v_session.user_id <> v_user_id and not public.current_user_is_manager()
  ) then
    raise exception 'Not authorized to update this stock check' using errcode = 'P0001';
  end if;

  if v_session.status <> 'in_progress' then
    raise exception 'Only an in-progress stock check can change areas' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.storage_areas area
    where area.id = p_area_id
      and area.location_id = v_session.location_id
      and area.active = true
  ) then
    raise exception 'Area is not part of this stock-check location' using errcode = 'P0001';
  end if;

  update public.stock_check_sessions
  set current_area_id = p_area_id
  where id = p_session_id
  returning * into v_session;

  return to_jsonb(v_session);
end;
$$;

create or replace function public.record_stock_check_count(
  p_session_id uuid,
  p_area_item_id uuid,
  p_entry_mode text,
  p_quantity numeric default null,
  p_status_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.stock_check_sessions%rowtype;
  v_area_item public.area_items%rowtype;
  v_area public.storage_areas%rowtype;
  v_quantity numeric;
  v_existing_count boolean;
  v_was_skipped boolean;
  v_area_items_total integer;
  v_area_checked integer;
  v_area_skipped integer;
  v_items_checked integer;
  v_items_skipped integer;
  v_progress jsonb;
  v_area_progress jsonb;
  v_skipped_item_ids jsonb;
  v_update public.stock_updates%rowtype;
begin
  select session.*
  into v_session
  from public.stock_check_sessions session
  where session.id = p_session_id;

  if not found then
    raise exception 'Stock-check session not found' using errcode = 'P0001';
  end if;

  if v_user_id is null or (
    v_session.user_id <> v_user_id and not public.current_user_is_manager()
  ) then
    raise exception 'Not authorized to record this stock count' using errcode = 'P0001';
  end if;

  if v_session.status <> 'in_progress' then
    raise exception 'Only an in-progress stock check can accept counts' using errcode = 'P0001';
  end if;

  -- Fetched in two steps on purpose: PL/pgSQL rejects a row variable that
  -- shares an INTO list with anything else, so the item and its area cannot
  -- be selected through one join. `found` still reflects the pair: a missing
  -- item skips the second lookup and leaves it false.
  select area_item.*
  into v_area_item
  from public.area_items area_item
  where area_item.id = p_area_item_id
    and area_item.active = true;

  if found then
    select area.*
    into v_area
    from public.storage_areas area
    where area.id = v_area_item.area_id
      and area.active = true;
  end if;

  if not found or v_area.location_id <> v_session.location_id then
    raise exception 'Item is not part of this stock-check location' using errcode = 'P0001';
  end if;

  if p_entry_mode = 'numeric' then
    if p_quantity is null or p_quantity < 0 or p_status_value is not null then
      raise exception 'Numeric stock counts require one non-negative quantity' using errcode = 'P0001';
    end if;
    v_quantity := p_quantity;
  elsif p_entry_mode = 'status' then
    if p_quantity is not null
      or p_status_value is null
      or p_status_value not in ('full', 'low', 'out') then
      raise exception 'Status counts must be Full, Low, or Out' using errcode = 'P0001';
    end if;

    -- Full means the configured target. Low is deliberately one numpad step
    -- below the reorder point, so it is immediately actionable by the strict
    -- below-reorder-point suggestion rule. Out is always zero.
    v_quantity := case p_status_value
      when 'full' then coalesce(v_area_item.par_level, v_area_item.max_quantity, 0)
      when 'low' then greatest(
        0,
        coalesce(
          v_area_item.reorder_point,
          v_area_item.min_quantity,
          coalesce(v_area_item.par_level, v_area_item.max_quantity, 0) / 2
        ) - 1
      )
      when 'out' then 0
    end;
  else
    raise exception 'Unknown stock-count entry mode' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.stock_updates stock_update
    where stock_update.stock_check_session_id = p_session_id
      and stock_update.area_item_id = p_area_item_id
  )
  into v_existing_count;

  v_area_progress := coalesce(v_session.area_progress, '{}'::jsonb);
  select count(*)::integer
  into v_area_items_total
  from public.area_items area_item
  where area_item.area_id = v_area.id
    and area_item.active = true;

  v_progress := coalesce(
    v_area_progress -> v_area.id::text,
    jsonb_build_object(
      'items_total', v_area_items_total,
      'items_checked', 0,
      'items_skipped', 0,
      'skipped_item_ids', '[]'::jsonb,
      'completed_at', null
    )
  );
  v_skipped_item_ids := coalesce(v_progress -> 'skipped_item_ids', '[]'::jsonb);
  v_was_skipped := v_skipped_item_ids @> jsonb_build_array(p_area_item_id::text);

  if v_was_skipped then
    select coalesce(jsonb_agg(skipped_item_id), '[]'::jsonb)
    into v_skipped_item_ids
    from jsonb_array_elements_text(v_skipped_item_ids) skipped_item_id
    where skipped_item_id <> p_area_item_id::text;
  end if;

  insert into public.stock_updates (
    area_id,
    inventory_item_id,
    previous_quantity,
    new_quantity,
    updated_by,
    update_method,
    quick_select_value,
    stock_check_session_id,
    area_item_id,
    entry_mode,
    status_value,
    created_at
  )
  values (
    v_area.id,
    v_area_item.inventory_item_id,
    v_area_item.current_quantity,
    v_quantity,
    v_user_id,
    case when p_entry_mode = 'numeric' then 'stock_check_numeric' else 'stock_check_status' end,
    case when p_entry_mode = 'status' then p_status_value else null end,
    p_session_id,
    p_area_item_id,
    p_entry_mode,
    case when p_entry_mode = 'status' then p_status_value else null end,
    now()
  )
  on conflict (stock_check_session_id, area_item_id) do update
  set
    previous_quantity = excluded.previous_quantity,
    new_quantity = excluded.new_quantity,
    updated_by = excluded.updated_by,
    update_method = excluded.update_method,
    quick_select_value = excluded.quick_select_value,
    entry_mode = excluded.entry_mode,
    status_value = excluded.status_value,
    created_at = excluded.created_at
  returning * into v_update;

  update public.area_items
  set
    current_quantity = v_quantity,
    last_updated_at = now(),
    last_updated_by = v_user_id
  where id = p_area_item_id;

  update public.storage_areas
  set
    last_checked_at = now(),
    last_checked_by = v_user_id
  where id = v_area.id;

  select count(*)::integer
  into v_area_checked
  from public.stock_updates stock_update
  join public.area_items area_item on area_item.id = stock_update.area_item_id
  where stock_update.stock_check_session_id = p_session_id
    and area_item.area_id = v_area.id;

  v_area_skipped := greatest(
    0,
    coalesce((v_progress ->> 'items_skipped')::integer, 0) - case when v_was_skipped then 1 else 0 end
  );

  v_progress := v_progress || jsonb_build_object(
    'items_total', v_area_items_total,
    'items_checked', v_area_checked,
    'items_skipped', v_area_skipped,
    'skipped_item_ids', v_skipped_item_ids,
    'last_entry_mode', p_entry_mode,
    'completed_at', case
      when v_area_checked + v_area_skipped >= v_area_items_total then now()
      else null
    end
  );
  v_area_progress := jsonb_set(v_area_progress, array[v_area.id::text], v_progress, true);

  select count(*)::integer
  into v_items_checked
  from public.stock_updates stock_update
  where stock_update.stock_check_session_id = p_session_id;

  v_items_skipped := greatest(
    0,
    v_session.items_skipped - case when v_was_skipped then 1 else 0 end
  );

  update public.stock_check_sessions
  set
    current_area_id = v_area.id,
    area_progress = v_area_progress,
    entry_mode = p_entry_mode,
    items_checked = v_items_checked,
    items_skipped = v_items_skipped
  where id = p_session_id
  returning * into v_session;

  return jsonb_build_object(
    'stock_update_id', v_update.id,
    'area_item_id', p_area_item_id,
    'quantity', v_quantity,
    'entry_mode', p_entry_mode,
    'status_value', case when p_entry_mode = 'status' then p_status_value else null end,
    'session', to_jsonb(v_session)
  );
end;
$$;

create or replace function public.skip_stock_check_item(
  p_session_id uuid,
  p_area_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.stock_check_sessions%rowtype;
  v_area_item public.area_items%rowtype;
  v_area public.storage_areas%rowtype;
  v_area_items_total integer;
  v_area_checked integer;
  v_area_skipped integer;
  v_progress jsonb;
  v_area_progress jsonb;
  v_skipped_item_ids jsonb;
begin
  select session.*
  into v_session
  from public.stock_check_sessions session
  where session.id = p_session_id;

  if not found then
    raise exception 'Stock-check session not found' using errcode = 'P0001';
  end if;

  if v_user_id is null or (
    v_session.user_id <> v_user_id and not public.current_user_is_manager()
  ) then
    raise exception 'Not authorized to skip this stock-check item' using errcode = 'P0001';
  end if;

  if v_session.status <> 'in_progress' then
    raise exception 'Only an in-progress stock check can skip items' using errcode = 'P0001';
  end if;

  -- Fetched in two steps on purpose: PL/pgSQL rejects a row variable that
  -- shares an INTO list with anything else, so the item and its area cannot
  -- be selected through one join. `found` still reflects the pair: a missing
  -- item skips the second lookup and leaves it false.
  select area_item.*
  into v_area_item
  from public.area_items area_item
  where area_item.id = p_area_item_id
    and area_item.active = true;

  if found then
    select area.*
    into v_area
    from public.storage_areas area
    where area.id = v_area_item.area_id
      and area.active = true;
  end if;

  if not found or v_area.location_id <> v_session.location_id then
    raise exception 'Item is not part of this stock-check location' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.stock_updates stock_update
    where stock_update.stock_check_session_id = p_session_id
      and stock_update.area_item_id = p_area_item_id
  ) then
    raise exception 'A counted item cannot also be skipped' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_area_items_total
  from public.area_items area_item
  where area_item.area_id = v_area.id
    and area_item.active = true;

  v_area_progress := coalesce(v_session.area_progress, '{}'::jsonb);
  v_progress := coalesce(
    v_area_progress -> v_area.id::text,
    jsonb_build_object(
      'items_total', v_area_items_total,
      'items_checked', 0,
      'items_skipped', 0,
      'skipped_item_ids', '[]'::jsonb,
      'completed_at', null
    )
  );
  v_skipped_item_ids := coalesce(v_progress -> 'skipped_item_ids', '[]'::jsonb);

  if v_skipped_item_ids @> jsonb_build_array(p_area_item_id::text) then
    return to_jsonb(v_session);
  end if;

  v_skipped_item_ids := v_skipped_item_ids || jsonb_build_array(p_area_item_id::text);
  select count(*)::integer
  into v_area_checked
  from public.stock_updates stock_update
  join public.area_items area_item on area_item.id = stock_update.area_item_id
  where stock_update.stock_check_session_id = p_session_id
    and area_item.area_id = v_area.id;

  v_area_skipped := coalesce((v_progress ->> 'items_skipped')::integer, 0) + 1;
  v_progress := v_progress || jsonb_build_object(
    'items_total', v_area_items_total,
    'items_checked', v_area_checked,
    'items_skipped', v_area_skipped,
    'skipped_item_ids', v_skipped_item_ids,
    'completed_at', case
      when v_area_checked + v_area_skipped >= v_area_items_total then now()
      else null
    end
  );
  v_area_progress := jsonb_set(v_area_progress, array[v_area.id::text], v_progress, true);

  update public.stock_check_sessions
  set
    current_area_id = v_area.id,
    area_progress = v_area_progress,
    items_skipped = v_session.items_skipped + 1
  where id = p_session_id
  returning * into v_session;

  return to_jsonb(v_session);
end;
$$;

create or replace function public.complete_stock_check(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.stock_check_sessions%rowtype;
begin
  select session.*
  into v_session
  from public.stock_check_sessions session
  where session.id = p_session_id;

  if not found then
    raise exception 'Stock-check session not found' using errcode = 'P0001';
  end if;

  if v_user_id is null or (
    v_session.user_id <> v_user_id and not public.current_user_is_manager()
  ) then
    raise exception 'Not authorized to complete this stock check' using errcode = 'P0001';
  end if;

  if v_session.status = 'abandoned' then
    raise exception 'An abandoned stock check cannot be completed' using errcode = 'P0001';
  end if;

  update public.stock_check_sessions
  set status = 'completed', completed_at = coalesce(completed_at, now())
  where id = p_session_id
  returning * into v_session;

  return to_jsonb(v_session);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ordering integration.
-- ---------------------------------------------------------------------------

create or replace function public.suggest_order_from_check(
  p_session_id uuid
)
returns table (
  area_item_id uuid,
  item_id uuid,
  item_name text,
  suggested_qty numeric,
  unit text,
  counted_qty numeric,
  par_level numeric,
  reorder_point numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1
    from public.stock_check_sessions session
    where session.id = p_session_id
      and (
        session.user_id = v_user_id
        or public.current_user_is_manager()
      )
  ) then
    raise exception 'Not authorized to view stock-check suggestions' using errcode = 'P0001';
  end if;

  return query
  with latest_counts as (
    select
      stock_update.area_item_id,
      stock_update.new_quantity,
      row_number() over (
        partition by stock_update.area_item_id
        order by stock_update.created_at desc, stock_update.id desc
      ) as row_number
    from public.stock_updates stock_update
    where stock_update.stock_check_session_id = p_session_id
  ),
  count_with_pars as (
    select
      area_item.id as area_item_id,
      inventory_item.id as item_id,
      inventory_item.name as item_name,
      latest_counts.new_quantity as counted_qty,
      area_item.par_level,
      coalesce(area_item.reorder_point, area_item.min_quantity) as reorder_point,
      case
        when area_item.conversion_factor is not null
          and area_item.conversion_factor > 0 then area_item.conversion_factor
        else 1
      end as order_unit_size,
      coalesce(
        nullif(trim(area_item.order_unit), ''),
        nullif(trim(area_item.unit_type), ''),
        nullif(trim(inventory_item.default_order_unit), ''),
        nullif(trim(inventory_item.base_unit), ''),
        nullif(trim(inventory_item.pack_unit), ''),
        'each'
      ) as unit,
      storage_area.sort_order as area_sort_order,
      area_item.shelf_sort_order
    from latest_counts
    join public.area_items area_item on area_item.id = latest_counts.area_item_id
    join public.storage_areas storage_area on storage_area.id = area_item.area_id
    join public.inventory_items inventory_item on inventory_item.id = area_item.inventory_item_id
    where latest_counts.row_number = 1
      and area_item.active = true
      and storage_area.active = true
      and inventory_item.active = true
      and area_item.par_level is not null
  ),
  aggregated_items as (
    -- An inventory item can live in more than one physical area. Suggestions
    -- must use its total counted/par/reorder quantities so the checklist gets
    -- one line per item/order-unit configuration rather than duplicate lines.
    select
      min(count_with_pars.area_item_id) as area_item_id,
      count_with_pars.item_id,
      min(count_with_pars.item_name) as item_name,
      count_with_pars.unit,
      count_with_pars.order_unit_size,
      sum(count_with_pars.counted_qty) as counted_qty,
      sum(count_with_pars.par_level) as par_level,
      sum(count_with_pars.reorder_point) as reorder_point,
      min(count_with_pars.area_sort_order) as area_sort_order,
      min(count_with_pars.shelf_sort_order) as shelf_sort_order
    from count_with_pars
    where count_with_pars.reorder_point is not null
    group by
      count_with_pars.item_id,
      count_with_pars.unit,
      count_with_pars.order_unit_size
  )
  select
    aggregated_items.area_item_id,
    aggregated_items.item_id,
    aggregated_items.item_name,
    ceil((aggregated_items.par_level - aggregated_items.counted_qty) / aggregated_items.order_unit_size),
    aggregated_items.unit,
    aggregated_items.counted_qty,
    aggregated_items.par_level,
    aggregated_items.reorder_point
  from aggregated_items
  where aggregated_items.counted_qty < aggregated_items.reorder_point
    and aggregated_items.counted_qty < aggregated_items.par_level
  order by
    aggregated_items.area_sort_order asc,
    aggregated_items.shelf_sort_order asc,
    lower(aggregated_items.item_name) asc,
    aggregated_items.area_item_id asc;
end;
$$;

create or replace function public.create_order_checklist_from_stock_check(
  p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_user_id uuid;
  v_location_id uuid;
  v_session_status text;
  v_location_group text;
  v_checklist_id uuid;
  v_start_sort_order integer;
begin
  select
    session.user_id,
    coalesce(session.location_id, anchor_area.location_id),
    session.status
  into v_session_user_id, v_location_id, v_session_status
  from public.stock_check_sessions session
  left join public.storage_areas anchor_area on anchor_area.id = session.area_id
  where session.id = p_session_id;

  if v_session_user_id is null then
    raise exception 'Stock-check session not found' using errcode = 'P0001';
  end if;

  if v_user_id is null or (
    v_session_user_id <> v_user_id and not public.current_user_is_manager()
  ) then
    raise exception 'Not authorized to create this checklist' using errcode = 'P0001';
  end if;

  if v_session_status <> 'completed' then
    raise exception 'Complete the stock check before starting its order' using errcode = 'P0001';
  end if;

  select case
    when lower(coalesce(location.name, '')) like '%poki%'
      or lower(coalesce(location.name, '')) like '%poke%'
      or lower(coalesce(location.short_code, '')) like 'p%' then 'poki'
    else 'sushi'
  end
  into v_location_group
  from public.locations location
  where location.id = v_location_id;

  if v_location_group is null then
    raise exception 'Stock-check location could not be resolved' using errcode = 'P0001';
  end if;

  insert into public.order_checklists (
    user_id,
    location_group,
    generated_at,
    generation_source
  )
  values (
    v_session_user_id,
    v_location_group,
    now(),
    'stock_check'
  )
  on conflict (user_id, location_group) do update
  set
    generated_at = excluded.generated_at,
    generation_source = 'stock_check',
    updated_at = now()
  returning id into v_checklist_id;

  -- Preserve manual/imported rows while applying the check's selection and
  -- quantity to them. Generated rows are replaced by stock_check rows so the
  -- hand-off stays visibly and audibly attributable to this count.
  with suggestions as (
    select * from public.suggest_order_from_check(p_session_id)
  )
  update public.order_checklist_items checklist_item
  set
    default_checked = true,
    recommended_qty = suggestions.suggested_qty,
    stock_check_session_id = p_session_id,
    updated_at = now()
  from suggestions
  where checklist_item.checklist_id = v_checklist_id
    and checklist_item.item_id = suggestions.item_id
    and checklist_item.item_source in ('manual', 'import');

  delete from public.order_checklist_items checklist_item
  where checklist_item.checklist_id = v_checklist_id
    and checklist_item.item_source = 'stock_check';

  with suggestions as (
    select * from public.suggest_order_from_check(p_session_id)
  )
  delete from public.order_checklist_items checklist_item
  using suggestions
  where checklist_item.checklist_id = v_checklist_id
    and checklist_item.item_source = 'generated'
    and checklist_item.item_id = suggestions.item_id;

  select coalesce(max(checklist_item.sort_order) + 1, 0)
  into v_start_sort_order
  from public.order_checklist_items checklist_item
  where checklist_item.checklist_id = v_checklist_id;

  with suggestions as (
    select * from public.suggest_order_from_check(p_session_id)
  ),
  insertable_suggestions as (
    select
      suggestions.*,
      row_number() over (
        order by suggestions.item_name, suggestions.unit, suggestions.area_item_id
      ) - 1 as sort_offset
    from suggestions
    where not exists (
      select 1
      from public.order_checklist_items preserved
      where preserved.checklist_id = v_checklist_id
        and preserved.item_id = suggestions.item_id
        and preserved.item_source in ('manual', 'import')
    )
  )
  insert into public.order_checklist_items (
    checklist_id,
    item_id,
    item_name,
    unit,
    default_checked,
    recommended_qty,
    typical_qty,
    staleness_bucket,
    sort_order,
    item_source,
    stock_check_session_id
  )
  select
    v_checklist_id,
    suggestions.item_id,
    suggestions.item_name,
    suggestions.unit,
    true,
    suggestions.suggested_qty,
    null,
    'frequent',
    v_start_sort_order + suggestions.sort_offset::integer,
    'stock_check',
    p_session_id
  from insertable_suggestions suggestions;

  return v_checklist_id;
end;
$$;

-- Guided inventory checks are employee work. Reads are broad enough to render
-- the active shelf, while all writes that can change quantities flow through
-- the security-definer RPCs above; manager configuration policies remain.
drop policy if exists storage_areas_stock_check_select_active on public.storage_areas;
create policy storage_areas_stock_check_select_active
on public.storage_areas
for select
to authenticated
using (active = true);

drop policy if exists area_items_stock_check_select_active on public.area_items;
create policy area_items_stock_check_select_active
on public.area_items
for select
to authenticated
using (
  active = true
  and exists (
    select 1
    from public.storage_areas area
    where area.id = area_items.area_id
      and area.active = true
  )
);

drop policy if exists stock_check_sessions_select_owner_or_manager on public.stock_check_sessions;
create policy stock_check_sessions_select_owner_or_manager
on public.stock_check_sessions
for select
to authenticated
using (user_id = auth.uid() or public.current_user_is_manager());

drop policy if exists stock_updates_select_stock_check_owner_or_manager on public.stock_updates;
create policy stock_updates_select_stock_check_owner_or_manager
on public.stock_updates
for select
to authenticated
using (
  updated_by = auth.uid()
  or public.current_user_is_manager()
  or exists (
    select 1
    from public.stock_check_sessions session
    where session.id = stock_updates.stock_check_session_id
      and session.user_id = auth.uid()
  )
);

revoke all on function public.start_or_resume_stock_check(uuid) from public, anon;
revoke all on function public.set_stock_check_current_area(uuid, uuid) from public, anon;
revoke all on function public.record_stock_check_count(uuid, uuid, text, numeric, text) from public, anon;
revoke all on function public.skip_stock_check_item(uuid, uuid) from public, anon;
revoke all on function public.complete_stock_check(uuid) from public, anon;
revoke all on function public.suggest_order_from_check(uuid) from public, anon;
revoke all on function public.create_order_checklist_from_stock_check(uuid) from public, anon;

grant execute on function public.start_or_resume_stock_check(uuid) to authenticated;
grant execute on function public.set_stock_check_current_area(uuid, uuid) to authenticated;
grant execute on function public.record_stock_check_count(uuid, uuid, text, numeric, text) to authenticated;
grant execute on function public.skip_stock_check_item(uuid, uuid) to authenticated;
grant execute on function public.complete_stock_check(uuid) to authenticated;
grant execute on function public.suggest_order_from_check(uuid) to authenticated;
grant execute on function public.create_order_checklist_from_stock_check(uuid) to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
