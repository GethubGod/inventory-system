-- Phase 5a: simplified ordering checklists generated from fulfillment history.
--
-- Generated items are deliberately marked separately from future manager/import
-- edits. Regeneration deletes and recreates only generated rows, preserving
-- manual and imported checklist lines for the 5b editor and Phase 6 import work.

create table if not exists public.order_checklists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_group text not null check (location_group in ('sushi', 'poki')),
  generated_at timestamptz not null default now(),
  generation_source text not null default 'history_v1'
    check (generation_source in ('history_v1', 'manual', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, location_group)
);

create table if not exists public.order_checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.order_checklists(id) on delete cascade,
  item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  unit text not null,
  default_checked boolean not null default true,
  recommended_qty numeric,
  typical_qty numeric,
  staleness_bucket text check (staleness_bucket in ('frequent', 'occasional', 'rare')),
  order_frequency_days numeric,
  last_ordered_at timestamptz,
  sort_order integer not null default 0,
  -- This preserves human/imported rows when history generation is refreshed.
  item_source text not null default 'generated'
    check (item_source in ('generated', 'manual', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_checklists_user_location_group_idx
  on public.order_checklists(user_id, location_group);

create index if not exists order_checklist_items_checklist_sort_idx
  on public.order_checklist_items(checklist_id, sort_order, item_name);

drop trigger if exists set_order_checklists_updated_at on public.order_checklists;
create trigger set_order_checklists_updated_at
before update on public.order_checklists
for each row execute function public.set_updated_at();

drop trigger if exists set_order_checklist_items_updated_at on public.order_checklist_items;
create trigger set_order_checklist_items_updated_at
before update on public.order_checklist_items
for each row execute function public.set_updated_at();

alter table public.order_checklists enable row level security;
alter table public.order_checklist_items enable row level security;

drop policy if exists order_checklists_select_owner_or_manager on public.order_checklists;
create policy order_checklists_select_owner_or_manager
on public.order_checklists
for select
to authenticated
using (auth.uid() = user_id or public.current_user_is_manager());

drop policy if exists order_checklists_manage_manager on public.order_checklists;
create policy order_checklists_manage_manager
on public.order_checklists
for all
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists order_checklist_items_select_owner_or_manager on public.order_checklist_items;
create policy order_checklist_items_select_owner_or_manager
on public.order_checklist_items
for select
to authenticated
using (
  public.current_user_is_manager()
  or exists (
    select 1
    from public.order_checklists checklist
    where checklist.id = order_checklist_items.checklist_id
      and checklist.user_id = auth.uid()
  )
);

drop policy if exists order_checklist_items_manage_manager on public.order_checklist_items;
create policy order_checklist_items_manage_manager
on public.order_checklist_items
for all
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

grant select, insert, update, delete on public.order_checklists to authenticated;
grant select, insert, update, delete on public.order_checklist_items to authenticated;

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
    'history_v1'
  )
  on conflict (user_id, location_group) do update
  set
    generated_at = excluded.generated_at,
    generation_source = 'history_v1',
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

-- submit_order_rpc protects non-manual entry metadata behind a Quick Order
-- session. A checklist has its own authenticated, server-generated state, so
-- allow its distinct tag without manufacturing a Quick Order session.
alter table public.orders drop constraint if exists orders_entry_method_check;
alter table public.orders add constraint orders_entry_method_check
  check (entry_method in ('manual', 'quick_order', 'voice_order', 'suggested_order', 'simple_checklist'));

do $$
declare
  v_signature regprocedure := 'public.submit_order_rpc(uuid,uuid,uuid,uuid,text,jsonb,text,uuid)'::regprocedure;
  v_definition text;
  v_fixed_definition text;
  v_old text := $old$
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
$old$;
  v_new text := $new$
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

    if coalesce(p_entry_method, 'manual') in ('manual', 'quick_order', 'voice_order', 'suggested_order', 'simple_checklist') then
      v_entry_method := coalesce(p_entry_method, 'manual');
    else
      v_entry_method := 'manual';
    end if;
  elsif coalesce(p_entry_method, 'manual') = 'simple_checklist' then
    v_entry_method := 'simple_checklist';
  elsif coalesce(p_entry_method, 'manual') <> 'manual' then
    raise exception 'Order entry metadata requires a valid Quick Order session'
      using errcode = 'P0001';
  end if;
$new$;
begin
  select pg_get_functiondef(v_signature)
  into v_definition;

  if v_definition is null then
    raise exception 'submit_order_rpc metadata signature is missing';
  end if;

  if position(v_new in v_definition) > 0 then
    return;
  end if;

  v_fixed_definition := replace(v_definition, v_old, v_new);

  if v_fixed_definition = v_definition then
    raise exception 'submit_order_rpc entry-method block did not match expected definition';
  end if;

  execute v_fixed_definition;
end;
$$;

revoke all on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
