-- Add hard_cap, soft_cap, safety_stock, target_stock, and default_order_unit columns to inventory_items
alter table public.inventory_items 
  add column if not exists hard_cap numeric,
  add column if not exists soft_cap numeric,
  add column if not exists safety_stock numeric,
  add column if not exists target_stock numeric,
  add column if not exists default_order_unit text;

-- Add check constraints to ensure caps and stocks are non-negative
alter table public.inventory_items
  drop constraint if exists inventory_items_hard_cap_nonnegative,
  drop constraint if exists inventory_items_soft_cap_nonnegative,
  drop constraint if exists inventory_items_safety_stock_nonnegative,
  drop constraint if exists inventory_items_target_stock_nonnegative;

alter table public.inventory_items
  add constraint inventory_items_hard_cap_nonnegative check (hard_cap >= 0),
  add constraint inventory_items_soft_cap_nonnegative check (soft_cap >= 0),
  add constraint inventory_items_safety_stock_nonnegative check (safety_stock >= 0),
  add constraint inventory_items_target_stock_nonnegative check (target_stock >= 0);
