-- Add per-line notes for employee special requests on order items

alter table public.order_items
  add column if not exists note text;
