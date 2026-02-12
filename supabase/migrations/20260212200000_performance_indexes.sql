-- Performance indexes for fulfillment hot paths.
-- All use IF NOT EXISTS + exception handlers to be safe on any schema state.

-- 1) orders: frequently queried by status + created_at (fulfillment loads submitted orders)
do $$
begin
  create index if not exists idx_orders_status_created_at
    on public.orders(status, created_at desc);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;

-- 2) order_items: queried by order_id (the FK join), and filtered by status
do $$
begin
  create index if not exists idx_order_items_order_id_status
    on public.order_items(order_id, status);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;

-- 3) order_items: inventory_item_id used in joins with inventory_items
do $$
begin
  create index if not exists idx_order_items_inventory_item_id
    on public.order_items(inventory_item_id);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;

-- 4) past_orders(created_by, created_at desc) — SKIPPED
-- Already exists as past_orders_created_by_created_at_idx
-- (created in 20260210110000_fulfillment_past_orders_and_order_later.sql)

-- 5) inventory_items: active items queried frequently for browse/search
do $$
begin
  create index if not exists idx_inventory_items_active_name
    on public.inventory_items(active, name);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;

-- 6) order_later_items: queried by status + scheduled_at for fulfillment queue
do $$
begin
  create index if not exists idx_order_later_items_status_scheduled
    on public.order_later_items(status, scheduled_at asc);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;
