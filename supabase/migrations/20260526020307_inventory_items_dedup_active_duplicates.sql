-- Defensive de-duplication of active inventory_items rows that share the same
-- normalized name. This MUST run before
-- 20260525140000_quick_order_parser_rules_v2, which creates the unique index
-- inventory_items_item_key_unique_idx on the normalized name; that index
-- failed on production because of a long-standing pair of active
-- "Kirin Ichiban Small" rows that the earlier
-- 20260519043100_deactivate_duplicate_kirin_ichiban_small migration could not
-- safely resolve (the lower-ranked row had a referenced order_items row, so
-- its WHERE-NOT-EXISTS clause excluded it from deactivation, leaving both
-- rows active).
--
-- Strategy: for every normalized item_key with more than one active row,
-- keep the row with the most foreign-key references (area_items +
-- order_items + current_stock_snapshots) and deactivate the rest. Tie-break
-- by created_at ASC, then id ASC for determinism. The migration is
-- idempotent and a clean-no-op on databases without duplicates.

create extension if not exists "pgcrypto";

do $$
declare
  v_dups int;
begin
  with ranked as (
    select
      ii.id,
      ii.name,
      public.normalize_quick_order_alias_text(ii.name) as item_key,
      (select count(*) from public.area_items ai where ai.inventory_item_id = ii.id)
      + (select count(*) from public.order_items oi where oi.inventory_item_id = ii.id)
      + (select count(*) from public.current_stock_snapshots s where s.item_id = ii.id)
      as total_refs,
      ii.created_at
    from public.inventory_items ii
    where ii.active = true
  ),
  with_dups as (
    select *
    from ranked
    where item_key in (
      select item_key from ranked group by item_key having count(*) > 1
    )
  ),
  keep_per_key as (
    select distinct on (item_key)
      id, item_key, total_refs, created_at
    from with_dups
    order by item_key, total_refs desc, created_at asc, id asc
  ),
  to_deactivate as (
    select w.id
    from with_dups w
    where w.id not in (select id from keep_per_key)
  )
  update public.inventory_items
  set active = false
  where id in (select id from to_deactivate);

  -- Assert no duplicates remain so subsequent unique-index migrations apply
  -- cleanly. Tie-broken keeps mean we always converge to one active row per
  -- normalized name.
  select count(*)
  into v_dups
  from (
    select public.normalize_quick_order_alias_text(name) as key
    from public.inventory_items
    where active = true
    group by 1
    having count(*) > 1
  ) d;

  if v_dups > 0 then
    raise exception 'Could not safely resolve % duplicate active inventory_items normalized names', v_dups;
  end if;
end $$;
