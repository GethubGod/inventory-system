-- Correct function bodies that were already deployed before their source
-- migrations were recovered into main, and remove two PL/pgSQL lint warnings.

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
    select
      (array_agg(count_with_pars.area_item_id order by count_with_pars.area_item_id))[1] as area_item_id,
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

do $lint_fixes$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.record_stock_check_count(uuid,uuid,text,numeric,text)'::regprocedure)
  into v_definition;
  v_definition := replace(v_definition, E'  v_existing_count boolean;\n', '');
  v_definition := replace(
    v_definition,
    E'  select exists (\n    select 1\n    from public.stock_updates stock_update\n    where stock_update.stock_check_session_id = p_session_id\n      and stock_update.area_item_id = p_area_item_id\n  )\n  into v_existing_count;\n\n',
    ''
  );
  execute v_definition;

  select pg_get_functiondef('public.save_my_checklist_default(text,jsonb)'::regprocedure)
  into v_definition;
  v_definition := replace(
    v_definition,
    E'  v_matched_ids uuid[] := ''{}'';\n',
    E'  v_matched_ids uuid[] := array[]::uuid[];\n'
  );
  execute v_definition;
end;
$lint_fixes$;

revoke all on function public.suggest_order_from_check(uuid) from public, anon;
grant execute on function public.suggest_order_from_check(uuid) to authenticated;

notify pgrst, 'reload schema';
