-- Migration to make base_unit required and pack_unit optional on inventory_items.
-- 1. For any items where base_unit is empty/null but pack_unit is set, copy pack_unit to base_unit.
update public.inventory_items
set base_unit = pack_unit
where (base_unit is null or trim(base_unit) = '')
  and (pack_unit is not null and trim(pack_unit) != '');

-- 2. Add check constraint to ensure base_unit is not empty
alter table public.inventory_items
  drop constraint if exists inventory_items_base_unit_not_empty;

alter table public.inventory_items
  add constraint inventory_items_base_unit_not_empty check (length(trim(base_unit)) > 0);
