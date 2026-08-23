-- Phase 6b screenshot-import generation proof.
-- Run only after scripts/local-db/verify-migrations.sh --keep.
--
-- It verifies that the normal history-only output is unchanged until a
-- reviewed screenshot is merged, then proves that the imported signal changes
-- both the median quantity and a staleness bucket for the chosen user.

begin;

insert into auth.users (id, email)
values
  ('60000000-0000-4000-8000-000000000001', 'phase6b-checklist@example.test'),
  ('70000000-0000-4000-8000-000000000001', 'phase6b-manager@example.test');

insert into public.users (id, email, name, role)
values
  (
    '60000000-0000-4000-8000-000000000001',
    'phase6b-checklist@example.test',
    'Phase 6b Checklist User',
    'employee'
  ),
  (
    '70000000-0000-4000-8000-000000000001',
    'phase6b-manager@example.test',
    'Phase 6b Fixture Manager',
    'manager'
  );

insert into public.profiles (id, email, role, is_suspended)
values
  ('60000000-0000-4000-8000-000000000001', 'phase6b-checklist@example.test', 'employee', false),
  ('70000000-0000-4000-8000-000000000001', 'phase6b-manager@example.test', 'manager', false);

insert into public.locations (id, name, short_code, active)
values ('80000000-0000-4000-8000-000000000001', 'Phase 6b Sushi', 's6b', true);

insert into public.inventory_items (
  id, name, base_unit, pack_unit, category, supplier_category
)
values
  ('90000000-0000-4000-8000-000000000001', 'Fixture Tuna', 'lb', 'case', 'fish', 'fixture'),
  ('90000000-0000-4000-8000-000000000002', 'Fixture Salmon', 'lb', 'case', 'fish', 'fixture');

insert into public.past_orders (id, supplier_name, created_by, created_at, message_text)
select
  ('a0000000-0000-4000-8000-' || lpad(day_number::text, 12, '0'))::uuid,
  'Phase 6b Fixture Supplier',
  '60000000-0000-4000-8000-000000000001'::uuid,
  ('2026-06-01 09:00:00+00'::timestamptz + (day_number - 1) * interval '1 day'),
  'phase6b-screenshot-fixture'
from generate_series(1, 5) as day_number;

-- Five observed days: Tuna's history-only median is 6. Salmon appears on two
-- of five days, so it begins in the frequent bucket (2 / 5 = 0.40).
insert into public.past_order_items (
  past_order_id, supplier_id, created_by, item_id, item_name, unit, quantity,
  location_group, ordered_at
)
select
  ('a0000000-0000-4000-8000-' || lpad(day_number::text, 12, '0'))::uuid,
  'phase6b-fixture',
  '60000000-0000-4000-8000-000000000001'::uuid,
  '90000000-0000-4000-8000-000000000001',
  'Fixture Tuna',
  'case',
  (day_number * 2)::numeric,
  'sushi',
  ('2026-06-01 09:00:00+00'::timestamptz + (day_number - 1) * interval '1 day')
from generate_series(1, 5) as day_number;

insert into public.past_order_items (
  past_order_id, supplier_id, created_by, item_id, item_name, unit, quantity,
  location_group, ordered_at
)
values
  (
    'a0000000-0000-4000-8000-000000000001', 'phase6b-fixture',
    '60000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000002', 'Fixture Salmon', 'case', 3,
    'sushi', '2026-06-01 09:00:00+00'
  ),
  (
    'a0000000-0000-4000-8000-000000000002', 'phase6b-fixture',
    '60000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000002', 'Fixture Salmon', 'case', 3,
    'sushi', '2026-06-02 09:00:00+00'
  );

select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', false);
set role authenticated;

select public.generate_order_checklist(
  '60000000-0000-4000-8000-000000000001'::uuid,
  'sushi'
);

do $$
declare
  v_tuna_qty numeric;
  v_salmon_bucket text;
  v_source text;
begin
  select item.recommended_qty, checklist.generation_source
  into v_tuna_qty, v_source
  from public.order_checklist_items item
  join public.order_checklists checklist on checklist.id = item.checklist_id
  where checklist.user_id = '60000000-0000-4000-8000-000000000001'::uuid
    and checklist.location_group = 'sushi'
    and item.item_id = '90000000-0000-4000-8000-000000000001'::uuid;

  select item.staleness_bucket
  into v_salmon_bucket
  from public.order_checklist_items item
  join public.order_checklists checklist on checklist.id = item.checklist_id
  where checklist.user_id = '60000000-0000-4000-8000-000000000001'::uuid
    and checklist.location_group = 'sushi'
    and item.item_id = '90000000-0000-4000-8000-000000000002'::uuid;

  if v_tuna_qty <> 6 or v_salmon_bucket <> 'frequent' or v_source <> 'history_v1' then
    raise exception 'Phase 6b baseline checklist assertion failed: qty %, bucket %, source %',
      v_tuna_qty, v_salmon_bucket, v_source;
  end if;
end;
$$;

reset role;

insert into public.historical_order_imports (
  id, imported_by, location_id, placed_at, order_date, original_text, source,
  status, image_paths
)
values (
  'b0000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  '2026-06-06 12:00:00+00',
  '2026-06-06',
  'phase6b imported screenshot',
  'screenshot',
  'reviewed',
  '[{"path":"imports/fixture/001.png","mime_type":"image/png"}]'::jsonb
);

insert into public.historical_order_import_items (
  import_id, item_id, matched_item_id, item_name_snapshot, raw_name, quantity,
  unit, confidence, review_state, source_image_path, source_line_index
)
values (
  'b0000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  'Fixture Tuna',
  'Fixture Tuna',
  12,
  'case',
  0.95,
  'matched',
  'imports/fixture/001.png',
  0
);

select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', false);
set role authenticated;

select public.merge_screenshot_import(
  'b0000000-0000-4000-8000-000000000001'::uuid,
  '60000000-0000-4000-8000-000000000001'::uuid,
  'sushi'
);

do $$
declare
  v_tuna_qty numeric;
  v_salmon_bucket text;
  v_source text;
  v_import_status text;
begin
  select item.recommended_qty, checklist.generation_source
  into v_tuna_qty, v_source
  from public.order_checklist_items item
  join public.order_checklists checklist on checklist.id = item.checklist_id
  where checklist.user_id = '60000000-0000-4000-8000-000000000001'::uuid
    and checklist.location_group = 'sushi'
    and item.item_id = '90000000-0000-4000-8000-000000000001'::uuid;

  select item.staleness_bucket
  into v_salmon_bucket
  from public.order_checklist_items item
  join public.order_checklists checklist on checklist.id = item.checklist_id
  where checklist.user_id = '60000000-0000-4000-8000-000000000001'::uuid
    and checklist.location_group = 'sushi'
    and item.item_id = '90000000-0000-4000-8000-000000000002'::uuid;

  select status into v_import_status
  from public.historical_order_imports
  where id = 'b0000000-0000-4000-8000-000000000001'::uuid;

  -- The sixth imported order day makes Tuna's median 7 (2,4,6,8,10,12)
  -- and moves Salmon from 2/5 frequent to 2/6 occasional.
  if v_tuna_qty <> 7
    or v_salmon_bucket <> 'occasional'
    or v_source <> 'import'
    or v_import_status <> 'merged' then
    raise exception 'Phase 6b imported-signal assertion failed: qty %, bucket %, source %, status %',
      v_tuna_qty, v_salmon_bucket, v_source, v_import_status;
  end if;
end;
$$;

select
  item.item_name,
  item.staleness_bucket,
  item.recommended_qty,
  checklist.generation_source
from public.order_checklist_items item
join public.order_checklists checklist on checklist.id = item.checklist_id
where checklist.user_id = '60000000-0000-4000-8000-000000000001'::uuid
  and checklist.location_group = 'sushi'
order by item.sort_order;

rollback;
