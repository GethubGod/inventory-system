-- Phase 6b: manager-reviewed screenshot imports.
--
-- The historical import tables predate screenshot capture and remain the
-- canonical storage for imported order signals.  All changes below are
-- additive so existing CSV/manual history keeps its original semantics.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-screenshots',
  'order-screenshots',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.historical_order_imports
  add column if not exists source text not null default 'historical',
  add column if not exists image_paths jsonb not null default '[]'::jsonb,
  add column if not exists order_date date,
  add column if not exists confidence numeric,
  add column if not exists parse_error text,
  add column if not exists parsed_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_for_user_id uuid references public.users(id) on delete set null,
  add column if not exists merged_location_group text,
  add column if not exists merged_checklist_id uuid references public.order_checklists(id) on delete set null;

update public.historical_order_imports
set
  source = coalesce(nullif(source, ''), 'historical'),
  order_date = coalesce(order_date, placed_at::date)
where source is null
   or source = ''
   or order_date is null;

alter table public.historical_order_imports
  drop constraint if exists historical_order_imports_status_check;

alter table public.historical_order_imports
  add constraint historical_order_imports_status_check
    check (status in ('imported', 'voided', 'uploaded', 'parsed', 'reviewed', 'merged', 'failed')),
  add constraint historical_order_imports_source_check
    check (source in ('historical', 'screenshot')),
  add constraint historical_order_imports_image_paths_array_check
    check (jsonb_typeof(image_paths) = 'array'),
  add constraint historical_order_imports_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add constraint historical_order_imports_merged_location_group_check
    check (merged_location_group is null or merged_location_group in ('sushi', 'poki'));

create index if not exists historical_order_imports_screenshot_merge_idx
  on public.historical_order_imports (merged_for_user_id, merged_location_group, order_date desc)
  where source = 'screenshot' and status = 'merged';

alter table public.historical_order_import_items
  alter column item_id drop not null,
  alter column quantity drop not null,
  alter column unit drop not null,
  add column if not exists raw_name text,
  add column if not exists matched_item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists confidence numeric,
  add column if not exists review_state text not null default 'matched',
  add column if not exists source_image_path text,
  add column if not exists source_line_index integer;

update public.historical_order_import_items
set
  raw_name = coalesce(nullif(raw_name, ''), item_name_snapshot),
  matched_item_id = coalesce(matched_item_id, item_id)
where raw_name is null
   or raw_name = ''
   or matched_item_id is null;

alter table public.historical_order_import_items
  drop constraint if exists historical_order_import_items_quantity_check;

alter table public.historical_order_import_items
  add constraint historical_order_import_items_quantity_check
    check (quantity is null or quantity > 0),
  add constraint historical_order_import_items_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add constraint historical_order_import_items_review_state_check
    check (review_state in ('matched', 'manual', 'skipped', 'pending')),
  add constraint historical_order_import_items_source_line_index_check
    check (source_line_index is null or source_line_index >= 0);

create index if not exists historical_order_import_items_matched_item_idx
  on public.historical_order_import_items (matched_item_id)
  where matched_item_id is not null;

-- Image path + line index is stable across parser retries. NULL legacy values
-- remain distinct under PostgreSQL's normal unique-index semantics.
create unique index if not exists historical_order_import_items_source_line_unique_idx
  on public.historical_order_import_items (import_id, source_image_path, source_line_index);

drop policy if exists order_screenshots_manager_select on storage.objects;
create policy order_screenshots_manager_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-screenshots'
  and public.current_user_is_manager()
);

drop policy if exists order_screenshots_manager_insert on storage.objects;
create policy order_screenshots_manager_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-screenshots'
  and public.current_user_is_manager()
);

drop policy if exists order_screenshots_manager_update on storage.objects;
create policy order_screenshots_manager_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'order-screenshots'
  and public.current_user_is_manager()
)
with check (
  bucket_id = 'order-screenshots'
  and public.current_user_is_manager()
);

drop policy if exists order_screenshots_manager_delete on storage.objects;
create policy order_screenshots_manager_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-screenshots'
  and public.current_user_is_manager()
);

-- Flash is the default. Managers can set the value to "gemini-3.1-pro" in
-- app_config when real screenshots warrant the more capable model.
insert into public.app_config (key, value, description)
values (
  'screenshot_import_model',
  '"gemini-2.5-flash"'::jsonb,
  'Gemini model for screenshot order extraction; set to gemini-3.1-pro to escalate.'
)
on conflict (key) do nothing;

create or replace function public.confirm_screenshot_import_review(p_import_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can confirm screenshot import review'
      using errcode = 'P0001';
  end if;

  select status
  into v_status
  from public.historical_order_imports
  where id = p_import_id
    and source = 'screenshot'
  for update;

  if not found then
    raise exception 'Screenshot import not found'
      using errcode = 'P0001';
  end if;

  if v_status = 'reviewed' then
    return p_import_id;
  end if;

  if v_status <> 'parsed' then
    raise exception 'Screenshot import must be parsed before review can be confirmed'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.historical_order_import_items
    where import_id = p_import_id
      and review_state = 'pending'
  ) then
    raise exception 'Every parsed screenshot line must be matched manually or skipped before confirmation'
      using errcode = 'P0001';
  end if;

  update public.historical_order_imports
  set
    status = 'reviewed',
    reviewed_at = now(),
    parse_error = null
  where id = p_import_id;

  return p_import_id;
end;
$$;

revoke all on function public.confirm_screenshot_import_review(uuid) from public, anon;
grant execute on function public.confirm_screenshot_import_review(uuid) to authenticated;

create or replace function public.generate_order_checklist(
  p_user_id uuid,
  p_location_group text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checklist_id uuid;
  v_user_order_days integer;
  v_use_location_group_history boolean;
  v_imports_contributed boolean;
begin
  if p_location_group not in ('sushi', 'poki') then
    raise exception 'Invalid location group'
      using errcode = 'P0001';
  end if;

  if auth.uid() is null
    or p_user_id is null
    or (auth.uid() <> p_user_id and not public.current_user_is_manager()) then
    raise exception 'Unauthorized'
      using errcode = 'P0001';
  end if;

  select count(distinct poi.ordered_at::date)::integer
  into v_user_order_days
  from public.past_order_items poi
  where poi.created_by = p_user_id
    and poi.location_group = p_location_group;

  -- With fewer than five personal order days, include the location group's
  -- history (which includes any personal history) to stabilize frequency,
  -- quantity, and cadence estimates.
  v_use_location_group_history := coalesce(v_user_order_days, 0) < 5;

  select exists (
    select 1
    from public.historical_order_import_items hii
    join public.historical_order_imports hi on hi.id = hii.import_id
    where hi.source = 'screenshot'
      and hi.status = 'merged'
      and hi.merged_for_user_id = p_user_id
      and hi.merged_location_group = p_location_group
      and hii.review_state in ('matched', 'manual')
      and coalesce(hii.matched_item_id, hii.item_id) is not null
      and hii.quantity > 0
      and nullif(btrim(hii.unit), '') is not null
  ) into v_imports_contributed;

  insert into public.order_checklists (
    user_id,
    location_group,
    generated_at,
    generation_source
  )
  values (
    p_user_id,
    p_location_group,
    now(),
    case when v_imports_contributed then 'import' else 'history_v1' end
  )
  on conflict (user_id, location_group) do update
  set
    generated_at = excluded.generated_at,
    generation_source = excluded.generation_source,
    updated_at = now()
  returning id into v_checklist_id;

  delete from public.order_checklist_items
  where checklist_id = v_checklist_id
    and item_source = 'generated';

  with history_lines as (
    select
      coalesce(ii.id::text, poi.item_id) as source_item_key,
      ii.id as item_id,
      coalesce(nullif(ii.name, ''), poi.item_name) as item_name,
      poi.unit,
      poi.ordered_at::date as order_day,
      poi.ordered_at,
      poi.quantity
    from public.past_order_items poi
    left join public.inventory_items ii
      on ii.id::text = poi.item_id
    where poi.location_group = p_location_group
      and (poi.created_by = p_user_id or v_use_location_group_history)

    union all

    -- A merged screenshot is a reviewed historical order signal. It is scoped
    -- to the checklist user chosen at merge time, never broadly to the location.
    select
      coalesce(hii.matched_item_id, hii.item_id)::text as source_item_key,
      ii.id as item_id,
      coalesce(nullif(ii.name, ''), nullif(hii.raw_name, ''), hii.item_name_snapshot) as item_name,
      hii.unit,
      hi.order_date as order_day,
      coalesce(hi.order_date::timestamptz, hi.placed_at) as ordered_at,
      hii.quantity
    from public.historical_order_import_items hii
    join public.historical_order_imports hi
      on hi.id = hii.import_id
    join public.inventory_items ii
      on ii.id = coalesce(hii.matched_item_id, hii.item_id)
    where hi.source = 'screenshot'
      and hi.status = 'merged'
      and hi.merged_for_user_id = p_user_id
      and hi.merged_location_group = p_location_group
      and hii.review_state in ('matched', 'manual')
      and hii.quantity > 0
      and nullif(btrim(hii.unit), '') is not null
  ),
  day_item_totals as (
    select
      source_item_key,
      item_id,
      item_name,
      unit,
      order_day,
      sum(quantity) as order_day_qty,
      max(ordered_at) as last_ordered_at
    from history_lines
    where order_day is not null
    group by source_item_key, item_id, item_name, unit, order_day
  ),
  total_order_days as (
    select count(distinct order_day)::numeric as total_days
    from day_item_totals
  ),
  item_days_with_cadence as (
    select
      day_item_totals.*,
      (
        order_day - lag(order_day) over (
          partition by source_item_key, item_id, item_name, unit
          order by order_day
        )
      )::numeric as cadence_days
    from day_item_totals
  ),
  item_stats as (
    select
      source_item_key,
      item_id,
      item_name,
      unit,
      count(*)::numeric as item_order_days,
      percentile_cont(0.5) within group (order by order_day_qty)::numeric as median_qty,
      percentile_cont(0.5) within group (
        order by cadence_days
      ) filter (where cadence_days is not null)::numeric as order_frequency_days,
      max(last_ordered_at) as last_ordered_at
    from item_days_with_cadence
    group by source_item_key, item_id, item_name, unit
  ),
  classified_items as (
    select
      stats.*,
      stats.item_order_days / nullif(days.total_days, 0) as frequency,
      case
        when stats.item_order_days = 1
          or stats.item_order_days / nullif(days.total_days, 0) < 0.10 then 'rare'
        when stats.item_order_days / nullif(days.total_days, 0) >= 0.40 then 'frequent'
        else 'occasional'
      end as staleness_bucket
    from item_stats stats
    cross join total_order_days days
    where days.total_days > 0
  ),
  ordered_items as (
    select
      classified_items.*,
      row_number() over (
        order by
          case staleness_bucket
            when 'frequent' then 1
            when 'occasional' then 2
            else 3
          end,
          frequency desc,
          lower(item_name),
          lower(unit)
      ) - 1 as generated_sort_order
    from classified_items
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
    order_frequency_days,
    last_ordered_at,
    sort_order,
    item_source
  )
  select
    v_checklist_id,
    generated.item_id,
    generated.item_name,
    generated.unit,
    generated.staleness_bucket = 'frequent',
    generated.median_qty,
    generated.median_qty,
    generated.staleness_bucket,
    generated.order_frequency_days,
    generated.last_ordered_at,
    generated.generated_sort_order::integer,
    'generated'
  from ordered_items generated
  where not exists (
    select 1
    from public.order_checklist_items preserved
    where preserved.checklist_id = v_checklist_id
      and preserved.item_source in ('manual', 'import')
      and preserved.item_id is not distinct from generated.item_id
      and lower(preserved.item_name) = lower(generated.item_name)
      and lower(preserved.unit) = lower(generated.unit)
  );

  return v_checklist_id;
end;
$$;

revoke all on function public.generate_order_checklist(uuid, text) from public, anon;
grant execute on function public.generate_order_checklist(uuid, text) to authenticated;

create or replace function public.merge_screenshot_import(
  p_import_id uuid,
  p_user_id uuid,
  p_location_group text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_source text;
  v_merged_for_user_id uuid;
  v_merged_location_group text;
  v_existing_checklist_id uuid;
  v_checklist_id uuid;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can merge screenshot imports'
      using errcode = 'P0001';
  end if;

  if p_user_id is null or p_location_group not in ('sushi', 'poki') then
    raise exception 'A valid checklist user and location group are required'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Checklist user not found'
      using errcode = 'P0001';
  end if;

  select
    status,
    source,
    merged_for_user_id,
    merged_location_group,
    merged_checklist_id
  into
    v_status,
    v_source,
    v_merged_for_user_id,
    v_merged_location_group,
    v_existing_checklist_id
  from public.historical_order_imports
  where id = p_import_id
  for update;

  if not found or v_source <> 'screenshot' then
    raise exception 'Screenshot import not found'
      using errcode = 'P0001';
  end if;

  if v_status = 'merged' then
    if v_merged_for_user_id is distinct from p_user_id
      or v_merged_location_group is distinct from p_location_group then
      raise exception 'Screenshot import was already merged for a different checklist scope'
        using errcode = 'P0001';
    end if;
    return v_existing_checklist_id;
  end if;

  if v_status <> 'reviewed' then
    raise exception 'Screenshot import must be reviewed before it can be merged'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.historical_order_import_items hii
    where hii.import_id = p_import_id
      and hii.review_state in ('matched', 'manual')
      and coalesce(hii.matched_item_id, hii.item_id) is not null
      and hii.quantity > 0
      and nullif(btrim(hii.unit), '') is not null
  ) then
    raise exception 'No reviewed, orderable screenshot lines are available to merge'
      using errcode = 'P0001';
  end if;

  update public.historical_order_imports
  set
    status = 'merged',
    merged_for_user_id = p_user_id,
    merged_location_group = p_location_group,
    merged_at = now(),
    parse_error = null
  where id = p_import_id;

  v_checklist_id := public.generate_order_checklist(p_user_id, p_location_group);

  update public.historical_order_imports
  set merged_checklist_id = v_checklist_id
  where id = p_import_id;

  return v_checklist_id;
end;
$$;

revoke all on function public.merge_screenshot_import(uuid, uuid, text) from public, anon;
grant execute on function public.merge_screenshot_import(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
