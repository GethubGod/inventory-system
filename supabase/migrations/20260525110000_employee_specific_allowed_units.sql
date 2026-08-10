-- Migration: Add employee_names to item_allowed_units table for employee-specific scoping
-- and update the unique constraint index to allow multiple employee-specific options.

alter table public.item_allowed_units add column if not exists employee_names text;

drop index if exists public.item_allowed_units_item_unit_unique_idx;

create unique index if not exists item_allowed_units_item_unit_employee_unique_idx
  on public.item_allowed_units(item_id, lower(trim(unit)), coalesce(lower(trim(employee_names)), 'global'));

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
