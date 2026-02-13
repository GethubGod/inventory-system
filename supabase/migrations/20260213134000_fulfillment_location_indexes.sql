-- Extra fulfillment indexes for location-scoped manager views.

do $$
begin
  create index if not exists idx_orders_location_status_created_at
    on public.orders(location_id, status, created_at desc);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;
