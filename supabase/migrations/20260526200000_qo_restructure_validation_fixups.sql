-- Supplemental fix-up migration for the Quick Order restructure
-- (20260526100000_google_sheets_quick_order_restructure.sql).
--
-- Why this exists:
--   1. The original migration WHERE-filtered inventory_reorder_rules to
--      trigger_type in ('below', 'at_or_below', 'equal'), which silently
--      dropped any rows with trigger_type = 'between'. Production had at least
--      one such row (Chili Oil), so it was never migrated to qo_reorder_rules.
--      We reinsert those rows here using trigger_qty_max (or trigger_qty) as
--      the at-or-below threshold so the rule survives in the new schema.
--   2. The original migration copied inventory_status_terms.recommendation_action
--      directly into qo_keywords.action without remapping. Any source row with
--      action in ('ask_quantity','use_existing_recommendation_engine') or
--      status='unknown' would violate the qo_keywords CHECK constraints and
--      abort the entire transaction. Production currently has zero rows there,
--      so the original applied cleanly, but a future sheet entry would brick
--      the migration on a fresh environment. We add a defensive backfill that
--      remaps those values into the new domain.
--
-- This migration is idempotent: every insert uses ON CONFLICT to upsert into
-- the same unique key as the original migration.
--
-- Additional fix-ups beyond the two listed above:
--   3. The original partial unique index
--      current_stock_snapshots_user_item_location_tracking_unit_idx had
--      `where tracking_unit is not null`. That makes Postgres ignore the
--      index for snapshots with NULL tracking_unit (the common case), so an
--      INSERT-only writer accumulates duplicate rows per re-count, and an
--      upsert on that key cannot resolve to a target row. We rebuild the
--      index without the WHERE filter using tracking_unit_key (which has a
--      '__default__' fallback for NULL), and we leave the inserter free to
--      `.upsert()` against this key.
--   4. The original qo_items_inventory_item_id_idx is a partial unique index
--      on inventory_item_id. That blocks per-location qo_items rows for the
--      same inventory item. We rebuild it scoped to (inventory_item_id,
--      location_key) so global + location-specific catalog overrides can
--      coexist.
--   5. fetchQoPersonalization in the parse-order edge function classifies a
--      qo_personalization row as a "custom counting unit" when personal_unit
--      is set and personal_unit_equals is NULL. Migrated employee
--      quick_order_reorder_rules rows wrote personal_unit = counted_unit
--      and left personal_unit_equals NULL, which trips that heuristic and
--      produces bogus tracking_unit / missing-unit-default rules. We
--      backfill personal_unit_equals := personal_unit for migrated reorder
--      rows where the source was a global counted-unit (i.e., not a custom
--      counting unit). Rows that legitimately ARE custom counting units
--      (like Nate's Tamago "order") have order_unit different from
--      personal_unit and remain untouched.
--   6. Custom counting unit defaults that originated as
--      quick_order_unit_rules with from_unit IS NULL and
--      is_default_when_missing = true never made it into qo_personalization
--      because the original mapping wrote personal_unit from from_unit
--      (which was NULL). We re-map those into qo_personalization using
--      to_unit as personal_unit and NULL as personal_unit_equals.

begin;

-- 1. Recover inventory_reorder_rules with trigger_type = 'between' that the
--    original migration silently dropped.
insert into public.qo_reorder_rules (
  item_name, qo_item_id, location_id, trigger_at_or_below, trigger_unit,
  order_qty, order_unit, active, notes, sync_status
)
select
  i.name,
  qi.id,
  r.location_id,
  coalesce(r.trigger_qty_max, r.trigger_qty),
  coalesce(r.trigger_unit, qi.order_unit),
  coalesce(r.order_qty, 0),
  r.order_unit,
  r.active,
  coalesce(
    nullif(r.notes, ''),
    'Migrated from inventory_reorder_rules.trigger_type=between (lower bound used as at_or_below)'
  ),
  'Migrated'
from public.inventory_reorder_rules r
join public.inventory_items i on i.id = r.inventory_item_id
join public.qo_items qi on qi.inventory_item_id = i.id
where r.order_strategy = 'fixed_order_qty'
  and r.trigger_type = 'between'
  and (r.trigger_qty_max is not null or r.trigger_qty is not null)
on conflict (item_name_key, location_key, trigger_unit_key, trigger_at_or_below) do update set
  qo_item_id = excluded.qo_item_id,
  location_id = excluded.location_id,
  order_qty = excluded.order_qty,
  order_unit = excluded.order_unit,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

-- 2. Defensive remap of inventory_status_terms rows that would violate the
--    qo_keywords action / status CHECK constraints.
insert into public.qo_keywords (phrase, meaning_type, status, remaining_qty, action, active, notes, sync_status)
select
  phrase,
  'status_term',
  case status
    when 'unknown' then 'low'  -- nearest neighbor; engine treats as needs-input
    else status
  end,
  remaining_qty,
  case recommendation_action
    when 'ask_quantity' then 'check_reorder_rule'
    when 'use_existing_recommendation_engine' then 'check_reorder_rule'
    else recommendation_action
  end,
  active,
  notes,
  'Migrated (validation fix-up)'
from public.inventory_status_terms
where phrase is not null
  and (
    recommendation_action in ('ask_quantity', 'use_existing_recommendation_engine')
    or status = 'unknown'
  )
on conflict (phrase_key, meaning_type) do update set
  status = excluded.status,
  remaining_qty = excluded.remaining_qty,
  action = excluded.action,
  active = excluded.active,
  notes = excluded.notes,
  sync_status = excluded.sync_status,
  updated_at = now();

-- 3. Replace the partial tracking-unit unique index with a full index so
--    upserts can resolve regardless of NULL tracking_unit.
--
--    First de-duplicate existing rows. The old partial index had
--    `where tracking_unit is not null`, so it never enforced uniqueness for
--    snapshots with NULL tracking_unit (tracking_unit_key = '__default__',
--    the common case). Before the writer switched to upsert, plain inserts
--    accumulated multiple rows per logical key, so the full index cannot be
--    built until those are collapsed (otherwise: could not create unique
--    index ... SQLSTATE 23505). Keep only the most recent snapshot per
--    (employee, item, location, tracking_unit_key) — the newest count is the
--    current stock by the writer's own upsert design. Idempotent: a no-op on
--    databases that have no duplicates.
delete from public.current_stock_snapshots s
using (
  select
    id,
    row_number() over (
      partition by
        coalesce(entered_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
        item_id,
        location_id,
        tracking_unit_key
      order by created_at desc, id desc
    ) as rn
  from public.current_stock_snapshots
) dups
where s.id = dups.id
  and dups.rn > 1;

drop index if exists public.current_stock_snapshots_user_item_location_tracking_unit_idx;
create unique index current_stock_snapshots_user_item_location_tracking_unit_idx
  on public.current_stock_snapshots(
    coalesce(entered_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    item_id,
    location_id,
    tracking_unit_key
  );

-- 4. Replace the global inventory_item_id partial unique index with one
--    scoped to (inventory_item_id, location_key) so location-specific
--    overrides of the same inventory item can coexist.
drop index if exists public.qo_items_inventory_item_id_idx;
create unique index qo_items_inventory_item_id_location_idx
  on public.qo_items(inventory_item_id, location_key)
  where inventory_item_id is not null;

-- 5. Backfill personal_unit_equals for migrated employee reorder rules so
--    fetchQoPersonalization does not misread them as custom counting units.
--    A row is treated as a real custom counting unit only if it has no
--    threshold (personal_unit is the only signal) or the order_unit is set
--    and differs from personal_unit (e.g. Nate's Tamago: order -> pack).
update public.qo_personalization
set personal_unit_equals = personal_unit,
    updated_at = now()
where rule_type = 'item_config'
  and personal_unit is not null
  and personal_unit_equals is null
  and trigger_at_or_below is not null
  and (
    order_unit is null
    or public.normalize_quick_order_alias_text(order_unit)
       = public.normalize_quick_order_alias_text(personal_unit)
  );

-- 6. Recover quick_order_unit_rules rows that represent a missing-unit default
--    for a custom counting unit (from_unit IS NULL, is_default_when_missing
--    true, employee scope). The original migration wrote NULL personal_unit
--    for these rows, which made fetchQoPersonalization skip them entirely.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'quick_order_unit_rules'
  ) then
    insert into public.qo_personalization (
      employee_name, employee_user_id, rule_type, item_name, qo_item_id,
      personal_unit, personal_unit_equals, location_id, active, notes,
      sync_status
    )
    select
      r.employee_name,
      r.employee_user_id,
      'item_config',
      i.name,
      qi.id,
      r.to_unit,
      null,
      r.location_id,
      r.active,
      coalesce(
        nullif(r.notes, ''),
        'Migrated custom counting unit default from quick_order_unit_rules.is_default_when_missing'
      ),
      'Migrated (validation fix-up)'
    from public.quick_order_unit_rules r
    join public.inventory_items i on i.id = r.item_id
    join public.qo_items qi on qi.inventory_item_id = i.id
    where r.scope_type = 'employee'
      and r.is_default_when_missing = true
      and r.from_unit is null
      and r.to_unit is not null
    on conflict (employee_name_key, rule_type, phrase_key, item_name_key, personal_unit_key, location_key) do update set
      employee_user_id = excluded.employee_user_id,
      qo_item_id = excluded.qo_item_id,
      personal_unit_equals = excluded.personal_unit_equals,
      location_id = excluded.location_id,
      active = excluded.active,
      notes = excluded.notes,
      sync_status = excluded.sync_status,
      updated_at = now();
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
