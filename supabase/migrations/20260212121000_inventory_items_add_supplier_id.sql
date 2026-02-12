-- Align inventory_items with supplier-based fulfillment grouping.

do $$
begin
  alter table public.inventory_items
    add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
exception
  when undefined_table then null;
end;
$$;

do $$
begin
  create index if not exists inventory_items_supplier_id_idx
    on public.inventory_items(supplier_id);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;
