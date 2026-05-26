-- Migration: Add max_quantity, order_quantity, and order_unit columns to item_allowed_units
-- to support threshold overrides and unit translations under the "Employee order" sheet.

alter table public.item_allowed_units add column if not exists max_quantity numeric;
alter table public.item_allowed_units add column if not exists order_quantity numeric;
alter table public.item_allowed_units add column if not exists order_unit text;

-- Add nonnegative checks if not already covered
alter table public.item_allowed_units drop constraint if exists item_allowed_units_thresholds_check;
alter table public.item_allowed_units add constraint item_allowed_units_thresholds_check check (
  coalesce(max_quantity, 0) >= 0
  and coalesce(order_quantity, 0) >= 0
);

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
