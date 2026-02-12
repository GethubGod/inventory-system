-- Backfill inventory_items.supplier_id from supplier text/name columns when available.

do $$
declare
  has_supplier_id boolean := false;
  has_supplier_name boolean := false;
  has_supplier_text boolean := false;
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
      and column_name = 'supplier_name'
  ) into has_supplier_name;

  if has_supplier_name then
    execute $sql$
      update public.inventory_items i
      set supplier_id = s.id
      from public.suppliers s
      where i.supplier_id is null
        and i.supplier_name is not null
        and length(trim(i.supplier_name)) > 0
        and lower(trim(i.supplier_name)) = lower(trim(s.name))
    $sql$;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_items'
      and column_name = 'supplier'
  ) into has_supplier_text;

  if has_supplier_text then
    execute $sql$
      update public.inventory_items i
      set supplier_id = s.id
      from public.suppliers s
      where i.supplier_id is null
        and i.supplier is not null
        and length(trim(i.supplier)) > 0
        and lower(trim(i.supplier)) = lower(trim(s.name))
    $sql$;
  end if;
exception
  when undefined_table then null;
end;
$$;
