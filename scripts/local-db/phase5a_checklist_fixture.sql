-- Phase 5a deterministic generation check.
-- Run only after scripts/local-db/verify-migrations.sh --keep.

begin;

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'phase5a-checklist@example.test');

insert into public.users (id, email, name, role)
values (
  '11111111-1111-4111-8111-111111111111',
  'phase5a-checklist@example.test',
  'Phase 5a Checklist Fixture',
  'employee'
);

insert into public.inventory_items (
  id, name, base_unit, pack_unit, category, supplier_category
)
values
  ('20000000-0000-4000-8000-000000000001', 'Frequent Tuna', 'lb', 'case', 'fish', 'fixture'),
  ('20000000-0000-4000-8000-000000000002', 'Occasional Salmon', 'lb', 'case', 'fish', 'fixture'),
  ('20000000-0000-4000-8000-000000000003', 'Rare Nori', 'pack', 'case', 'dry goods', 'fixture');

insert into public.past_orders (
  id, supplier_name, created_by, created_at, message_text
)
select
  ('30000000-0000-4000-8000-' || lpad(day_number::text, 12, '0'))::uuid,
  'Phase 5a Fixture Supplier',
  '11111111-1111-4111-8111-111111111111'::uuid,
  ('2026-01-01 09:00:00+00'::timestamptz + (day_number - 1) * interval '1 day'),
  'phase5a-checklist-fixture'
from generate_series(1, 10) as day_number;

-- Six of nine observed item-order days. Quantities sort to 2, 3, 4, 5, 6, 7,
-- so median = 4.5.
insert into public.past_order_items (
  past_order_id, supplier_id, created_by, item_id, item_name, unit, quantity,
  location_group, ordered_at
)
select
  ('30000000-0000-4000-8000-' || lpad(day_number::text, 12, '0'))::uuid,
  'phase5a-fixture',
  '11111111-1111-4111-8111-111111111111'::uuid,
  '20000000-0000-4000-8000-000000000001',
  'Frequent Tuna',
  'case',
  (day_number + 1)::numeric,
  'sushi',
  ('2026-01-01 09:00:00+00'::timestamptz + (day_number - 1) * interval '1 day')
from generate_series(1, 6) as day_number;

-- Two of nine observed item-order days, giving an occasional frequency and median = 10.
insert into public.past_order_items (
  past_order_id, supplier_id, created_by, item_id, item_name, unit, quantity,
  location_group, ordered_at
)
values
  (
    '30000000-0000-4000-8000-000000000007', 'phase5a-fixture',
    '11111111-1111-4111-8111-111111111111',
    '20000000-0000-4000-8000-000000000002', 'Occasional Salmon', 'case', 8,
    'sushi', '2026-01-07 09:00:00+00'
  ),
  (
    '30000000-0000-4000-8000-000000000009', 'phase5a-fixture',
    '11111111-1111-4111-8111-111111111111',
    '20000000-0000-4000-8000-000000000002', 'Occasional Salmon', 'case', 12,
    'sushi', '2026-01-09 09:00:00+00'
  );

-- One occurrence: rare even though its observed-day ratio is above 10%.
insert into public.past_order_items (
  past_order_id, supplier_id, created_by, item_id, item_name, unit, quantity,
  location_group, ordered_at
)
values (
  '30000000-0000-4000-8000-000000000010', 'phase5a-fixture',
  '11111111-1111-4111-8111-111111111111',
  '20000000-0000-4000-8000-000000000003', 'Rare Nori', 'pack', 1,
  'sushi', '2026-01-10 09:00:00+00'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;

select public.generate_order_checklist(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'sushi'
);

select
  item.item_name,
  item.staleness_bucket,
  item.recommended_qty,
  item.order_frequency_days,
  item.sort_order
from public.order_checklist_items item
join public.order_checklists checklist on checklist.id = item.checklist_id
where checklist.user_id = '11111111-1111-4111-8111-111111111111'::uuid
  and checklist.location_group = 'sushi'
order by item.sort_order;

rollback;
