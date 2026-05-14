-- Quick Order shortcut history.
--
-- The "reorder recent", "last week", and "usual order" shortcuts need order
-- history rows, not parser item matches. These RPCs expose that history in the
-- JSON shape consumed by the parse-order Edge Function.

create index if not exists orders_location_user_status_created_idx
  on public.orders(location_id, user_id, status, created_at desc);

create or replace function public.get_recent_orders(
  p_location_id uuid,
  p_limit integer default 10,
  p_user_id uuid default null
)
returns jsonb
language sql
stable
as $$
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
$$;

create or replace function public.get_dow_suggestions(
  p_location_id uuid,
  p_min_frequency numeric default 0.4,
  p_lookback_months integer default 6,
  p_user_id uuid default null
)
returns jsonb
language sql
stable
as $$
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
$$;

create or replace function public.get_usual_order(
  p_location_id uuid,
  p_min_frequency numeric default 0.25,
  p_lookback_months integer default 6,
  p_user_id uuid default null,
  p_limit integer default 12
)
returns jsonb
language sql
stable
as $$
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
$$;

grant execute on function public.get_recent_orders(uuid, integer, uuid) to authenticated;
grant execute on function public.get_dow_suggestions(uuid, numeric, integer, uuid) to authenticated;
grant execute on function public.get_usual_order(uuid, numeric, integer, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
