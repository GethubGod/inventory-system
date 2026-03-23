create or replace function public.get_recent_orders(
  p_location_id uuid,
  p_limit integer default 10
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
$$;
