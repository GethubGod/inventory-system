-- Quick Order: most recent inventory count list.
--
-- In Inventory mode the "Usual / Recent / Last week" composer pills should load
-- the full list of items the employee counted in their most recent inventory
-- session so they can re-count them. current_stock_snapshots is written only by
-- inventory-mode stock updates, so the latest session present there *is* the
-- latest inventory session (quick_order_sessions has no mode column).

create index if not exists current_stock_snapshots_session_created_idx
  on public.current_stock_snapshots(quick_order_session_id, created_at desc);

create or replace function public.get_last_inventory_session_items(
  p_location_id uuid,
  p_user_id uuid default null
)
returns jsonb
language sql
stable
as $$
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
$$;

grant execute on function public.get_last_inventory_session_items(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
