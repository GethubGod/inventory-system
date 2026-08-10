-- Fix: inventory-mode stock counts failed to save with the runtime error
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- The parse-order edge function upserts current_stock_snapshots with
--   onConflict: 'entered_by_user_id,item_id,location_id,tracking_unit_key'
-- (bare column names). The previous unique index
-- (current_stock_snapshots_user_item_location_tracking_unit_idx) was built on an
-- EXPRESSION — coalesce(entered_by_user_id, '000…'::uuid) — for its first
-- column. PostgREST/Postgres cannot match a bare-column ON CONFLICT target to an
-- expression index, so every upsert raised the error above and no stock count
-- was persisted (the raw error even leaked into the assistant message).
--
-- Replace the expression index with one on the bare columns so it matches the
-- code's conflict target exactly. entered_by_user_id is always populated by the
-- function (the authenticated user), so dropping the coalesce() has no practical
-- effect on de-duplication.

-- De-duplicate by the bare-column key first so the unique index can be built.
-- Keep the most recent snapshot per logical key.
delete from public.current_stock_snapshots s
using (
  select
    id,
    row_number() over (
      partition by entered_by_user_id, item_id, location_id, tracking_unit_key
      order by created_at desc, id desc
    ) as rn
  from public.current_stock_snapshots
) dups
where s.id = dups.id
  and dups.rn > 1;

drop index if exists public.current_stock_snapshots_user_item_location_tracking_unit_idx;
create unique index current_stock_snapshots_user_item_location_tracking_unit_idx
  on public.current_stock_snapshots(
    entered_by_user_id,
    item_id,
    location_id,
    tracking_unit_key
  );
