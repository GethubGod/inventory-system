-- Convert item_category and supplier_category from Postgres enums to plain text.
-- This allows new categories to be added freely (e.g. from Google Sheets sync)
-- without requiring a database migration each time.
--
-- Strategy:
--   1. Add a temporary text column
--   2. Copy the cast values over
--   3. Drop the old enum column
--   4. Rename the temp column to the original name
--   5. Re-add any indexes
--   6. Drop the enum types
--
-- Wrapped in a DO block so we can detect whether the column is already text
-- (idempotent — safe to run twice).

-- ============================================================
-- 1. inventory_items.category  (enum item_category → text)
-- ============================================================
do $$
declare
  col_type text;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'inventory_items'
    and column_name = 'category';

  if col_type is null then
    raise notice 'inventory_items.category does not exist — skipping';
    return;
  end if;

  if col_type = 'text' or col_type = 'character varying' then
    raise notice 'inventory_items.category is already text — skipping';
    return;
  end if;

  -- Add temp text column, copy data, swap
  alter table public.inventory_items add column category_text text;
  update public.inventory_items set category_text = category::text;
  alter table public.inventory_items drop column category;
  alter table public.inventory_items rename column category_text to category;
  alter table public.inventory_items alter column category set not null;

  raise notice 'Converted inventory_items.category to text';
end;
$$;

-- ============================================================
-- 2. inventory_items.supplier_category  (enum → text)
-- ============================================================
do $$
declare
  col_type text;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'inventory_items'
    and column_name = 'supplier_category';

  if col_type is null then
    raise notice 'inventory_items.supplier_category does not exist — skipping';
    return;
  end if;

  if col_type = 'text' or col_type = 'character varying' then
    raise notice 'inventory_items.supplier_category is already text — skipping';
    return;
  end if;

  alter table public.inventory_items add column supplier_category_text text;
  update public.inventory_items set supplier_category_text = supplier_category::text;
  alter table public.inventory_items drop column supplier_category;
  alter table public.inventory_items rename column supplier_category_text to supplier_category;
  alter table public.inventory_items alter column supplier_category set not null;

  raise notice 'Converted inventory_items.supplier_category to text';
end;
$$;

-- ============================================================
-- 3. suppliers.supplier_type  (enum → text, nullable)
-- ============================================================
do $$
declare
  col_type text;
begin
  select data_type into col_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'suppliers'
    and column_name = 'supplier_type';

  if col_type is null then
    raise notice 'suppliers.supplier_type does not exist — skipping';
    return;
  end if;

  if col_type = 'text' or col_type = 'character varying' then
    raise notice 'suppliers.supplier_type is already text — skipping';
    return;
  end if;

  alter table public.suppliers add column supplier_type_text text;
  update public.suppliers set supplier_type_text = supplier_type::text;
  alter table public.suppliers drop column supplier_type;
  alter table public.suppliers rename column supplier_type_text to supplier_type;

  raise notice 'Converted suppliers.supplier_type to text';
end;
$$;

-- ============================================================
-- 4. Drop the old enum types if they exist
-- ============================================================
drop type if exists public.item_category cascade;
drop type if exists public.supplier_category cascade;

-- ============================================================
-- 5. Re-create the composite active+name index that may have
--    been dropped by the column swap
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'inventory_items'
      and indexname = 'idx_inventory_items_active_name'
  ) then
    create index idx_inventory_items_active_name
      on public.inventory_items(active, name);
  end if;
end;
$$;

-- ============================================================
-- 6. Reload PostgREST schema cache
-- ============================================================
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
