-- Disposable local QA data only. Not a production migration.
-- Prepared but not applied: local test-write approval remains pending.
-- Requires seed-local-mobile-e2e.sql in the isolated production-readiness stack.
\set ON_ERROR_STOP on
begin;

insert into public.suppliers (id, name, active, supplier_category, supplier_key)
values ('4c000000-0000-4000-8000-000000000001', 'Local QA Supplier', true, 'fixture', 'local_qa_supplier')
on conflict (id) do update set name = excluded.name, active = excluded.active,
  supplier_category = excluded.supplier_category, supplier_key = excluded.supplier_key;

-- Intentionally no phone or email destination: tests must not send supplier messages.
update public.inventory_items
set supplier_id = '4c000000-0000-4000-8000-000000000001'
where id in (
  '46000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000002',
  '46000000-0000-4000-8000-000000000003', '46000000-0000-4000-8000-000000000004'
);

insert into public.qo_items (id, inventory_item_id, name, category, aliases, supplier,
  supplier_id, order_unit, target_stock, active)
values
  ('4d000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', 'Fixture Salmon', 'fish', 'salmon', 'Local QA Supplier', '4c000000-0000-4000-8000-000000000001', 'fillet', 8, true),
  ('4d000000-0000-4000-8000-000000000002', '46000000-0000-4000-8000-000000000002', 'Fixture Rice', 'dry', 'rice', 'Local QA Supplier', '4c000000-0000-4000-8000-000000000001', 'bag', 12, true),
  ('4d000000-0000-4000-8000-000000000003', '46000000-0000-4000-8000-000000000003', 'Fixture Nori', 'dry', 'nori', 'Local QA Supplier', '4c000000-0000-4000-8000-000000000001', 'pack', 25, true),
  ('4d000000-0000-4000-8000-000000000004', '46000000-0000-4000-8000-000000000004', 'Fixture Avocado', 'produce', 'avocado', 'Local QA Supplier', '4c000000-0000-4000-8000-000000000001', 'each', 12, true)
on conflict (id) do update set inventory_item_id = excluded.inventory_item_id,
  name = excluded.name, category = excluded.category, aliases = excluded.aliases,
  supplier = excluded.supplier, supplier_id = excluded.supplier_id,
  order_unit = excluded.order_unit, target_stock = excluded.target_stock, active = excluded.active;

commit;
