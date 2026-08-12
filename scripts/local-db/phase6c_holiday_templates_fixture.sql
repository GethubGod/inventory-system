-- Phase 6c holiday-template overlay proof.
-- Run only after scripts/local-db/verify-migrations.sh --keep.
--
-- The date probe at the end deliberately selects one day before the window,
-- one inside it, and one day after it. Stored checklist rows remain unchanged;
-- the extra Nori line exists only in the returned overlay.

begin;

insert into auth.users (id, email)
values
  ('61000000-0000-4000-8000-000000000001', 'phase6c-checklist@example.test'),
  ('71000000-0000-4000-8000-000000000001', 'phase6c-manager@example.test');

insert into public.users (id, email, name, role)
values
  (
    '61000000-0000-4000-8000-000000000001',
    'phase6c-checklist@example.test',
    'Phase 6c Checklist User',
    'employee'
  ),
  (
    '71000000-0000-4000-8000-000000000001',
    'phase6c-manager@example.test',
    'Phase 6c Fixture Manager',
    'manager'
  );

insert into public.profiles (id, email, role, is_suspended)
values
  ('61000000-0000-4000-8000-000000000001', 'phase6c-checklist@example.test', 'employee', false),
  ('71000000-0000-4000-8000-000000000001', 'phase6c-manager@example.test', 'manager', false);

insert into public.inventory_items (
  id, name, base_unit, pack_unit, category, supplier_category
)
values
  ('91000000-0000-4000-8000-000000000001', 'Holiday Fixture Tuna', 'lb', 'case', 'fish', 'fixture'),
  ('91000000-0000-4000-8000-000000000002', 'Holiday Fixture Salmon', 'lb', 'case', 'fish', 'fixture'),
  ('91000000-0000-4000-8000-000000000003', 'Holiday Fixture Nori', 'sheet', 'pack', 'dry goods', 'fixture');

insert into public.past_orders (id, supplier_name, created_by, created_at, message_text)
values (
  'a1000000-0000-4000-8000-000000000001',
  'Phase 6c Fixture Supplier',
  '61000000-0000-4000-8000-000000000001',
  '2026-12-01 09:00:00+00',
  'phase6c-holiday-fixture'
);

insert into public.past_order_items (
  past_order_id, supplier_id, created_by, item_id, item_name, unit, quantity,
  location_group, ordered_at
)
values
  (
    'a1000000-0000-4000-8000-000000000001', 'phase6c-fixture',
    '61000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001', 'Holiday Fixture Tuna', 'case', 4,
    'sushi', '2026-12-01 09:00:00+00'
  ),
  (
    'a1000000-0000-4000-8000-000000000001', 'phase6c-fixture',
    '61000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002', 'Holiday Fixture Salmon', 'case', 2,
    'sushi', '2026-12-01 09:00:00+00'
  );

-- Generate ordinary history rows before the holiday is configured. These are
-- the durable base rows the overlay is forbidden to mutate.
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', false);
set role authenticated;

select public.generate_order_checklist(
  '61000000-0000-4000-8000-000000000001'::uuid,
  'sushi'
);

reset role;

-- A manager defines a three-line holiday: scale an existing line, set another
-- existing line, and add an inventory item that has no durable checklist row.
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', false);
set role authenticated;

insert into public.holiday_templates (id, name, starts_on, ends_on, active)
values (
  'b1000000-0000-4000-8000-000000000001',
  'Fixture New Year',
  '2026-12-24',
  '2026-12-26',
  true
);

insert into public.holiday_template_items (template_id, item_id, adjustment_kind, quantity, note)
values
  (
    'b1000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001', 'scale', 1.5, 'Scale Tuna base quantity'
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002', 'set_qty', 8, 'Set Salmon quantity'
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000003', 'add', 3, 'Additional Nori packs'
  );

reset role;

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', false);
set role authenticated;

do $$
declare
  v_tuna_qty numeric;
  v_nori_stored_count integer;
  v_inside_count integer;
  v_before_count integer;
  v_after_count integer;
  v_active_template uuid;
begin
  select item.recommended_qty
  into v_tuna_qty
  from public.order_checklist_items item
  join public.order_checklists checklist on checklist.id = item.checklist_id
  where checklist.user_id = '61000000-0000-4000-8000-000000000001'::uuid
    and checklist.location_group = 'sushi'
    and item.item_id = '91000000-0000-4000-8000-000000000001'::uuid;

  select count(*)::integer
  into v_nori_stored_count
  from public.order_checklist_items item
  join public.order_checklists checklist on checklist.id = item.checklist_id
  where checklist.user_id = '61000000-0000-4000-8000-000000000001'::uuid
    and checklist.location_group = 'sushi'
    and item.item_id = '91000000-0000-4000-8000-000000000003'::uuid;

  select count(*)::integer
  into v_before_count
  from public.get_checklist_holiday_overlay(
    '61000000-0000-4000-8000-000000000001'::uuid, 'sushi', '2026-12-23'::date
  );

  select count(*)::integer
  into v_inside_count
  from public.get_checklist_holiday_overlay(
    '61000000-0000-4000-8000-000000000001'::uuid, 'sushi', '2026-12-24'::date
  );

  select count(*)::integer
  into v_after_count
  from public.get_checklist_holiday_overlay(
    '61000000-0000-4000-8000-000000000001'::uuid, 'sushi', '2026-12-27'::date
  );

  select public.active_holiday_for('2026-12-24'::date) into v_active_template;

  if v_tuna_qty <> 4
    or v_nori_stored_count <> 0
    or v_before_count <> 0
    or v_inside_count <> 3
    or v_after_count <> 0
    or v_active_template <> 'b1000000-0000-4000-8000-000000000001'::uuid then
    raise exception
      'Phase 6c overlay assertion failed: tuna base %, stored Nori %, before %, inside %, after %, active template %',
      v_tuna_qty, v_nori_stored_count, v_before_count, v_inside_count, v_after_count, v_active_template;
  end if;
end;
$$;

-- Required date-window proof: overlay rows only appear during 24–26 Dec.
select
  dates.fixture_date,
  count(overlay.item_id) as overlay_row_count,
  string_agg(overlay.adjustment_kind || ':' || overlay.item_name, ', ' order by overlay.item_name) as adjustments
from (
  values
    ('2026-12-23'::date),
    ('2026-12-24'::date),
    ('2026-12-27'::date)
) as dates(fixture_date)
left join lateral public.get_checklist_holiday_overlay(
  '61000000-0000-4000-8000-000000000001'::uuid,
  'sushi',
  dates.fixture_date
) overlay on true
group by dates.fixture_date
order by dates.fixture_date;

-- Inside the window, this shows the exact adjustments the client combines
-- with its normal checklist fetch. The durable rows remain as generated.
select
  overlay.item_name,
  overlay.unit,
  overlay.adjustment_kind,
  overlay.quantity,
  overlay.template_name
from public.get_checklist_holiday_overlay(
  '61000000-0000-4000-8000-000000000001'::uuid,
  'sushi',
  '2026-12-24'::date
) overlay
order by overlay.item_name;

rollback;
