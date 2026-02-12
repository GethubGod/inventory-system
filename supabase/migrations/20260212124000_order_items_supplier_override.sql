-- Add supplier_override_id to order_items for per-line supplier reassignment.

do $$
begin
  alter table public.order_items
    add column if not exists supplier_override_id uuid references public.suppliers(id) on delete set null;
exception
  when undefined_table then null;
end;
$$;

do $$
begin
  create index if not exists order_items_supplier_override_id_idx
    on public.order_items(supplier_override_id);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;

-- Also backfill inventory_items.supplier_id from default_supplier text column
-- (the earlier migration only checked supplier_name / supplier columns).
do $$
declare
  has_supplier_id boolean := false;
  has_default_supplier boolean := false;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_items'
      and column_name = 'supplier_id'
  ) into has_supplier_id;

  if not has_supplier_id then
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_items'
      and column_name = 'default_supplier'
  ) into has_default_supplier;

  if has_default_supplier then
    execute $sql$
      update public.inventory_items i
      set supplier_id = s.id
      from public.suppliers s
      where i.supplier_id is null
        and i.default_supplier is not null
        and length(trim(i.default_supplier)) > 0
        and lower(trim(i.default_supplier)) = lower(trim(s.name))
    $sql$;
  end if;
exception
  when undefined_table then null;
end;
$$;
