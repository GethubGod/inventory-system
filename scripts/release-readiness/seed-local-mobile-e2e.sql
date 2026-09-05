-- Disposable local-only fixture for the Smelter iOS simulator pass.
-- Run against the local full-stack container as postgres. Auth users are
-- created by the local GoTrue admin API first; IDs are supplied as psql vars:
--   -v manager_id=<uuid> -v employee_id=<uuid> -v employee2_id=<uuid>
-- This fixture deliberately uses the existing fixture naming convention and
-- never targets a remote Supabase project.

\set ON_ERROR_STOP on

insert into public.locations (id, name, short_code, active, address, phone)
values
  ('45000000-0000-4000-8000-000000000001', 'Fixture Sushi', 'FS', true, 'Local QA kitchen', '555-0101'),
  ('45000000-0000-4000-8000-000000000002', 'Fixture Poki & Pho', 'FP', true, 'Local QA second kitchen', '555-0102')
on conflict (id) do update set
  name = excluded.name,
  short_code = excluded.short_code,
  active = excluded.active,
  address = excluded.address,
  phone = excluded.phone;

insert into public.users (id, email, name, role, default_location_id)
values
  (:'manager_id'::uuid, 'e2e.manager@smelter.test', 'E2E Manager', 'manager'::user_role, null),
  (:'employee_id'::uuid, 'e2e.employee@smelter.test', 'E2E Employee', 'employee'::user_role, '45000000-0000-4000-8000-000000000001'),
  (:'employee2_id'::uuid, 'e2e.employee2@smelter.test', 'E2E Employee Two', 'employee'::user_role, '45000000-0000-4000-8000-000000000002')
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  role = excluded.role,
  default_location_id = excluded.default_location_id;

insert into public.profiles (id, email, full_name, role, provider, profile_completed, notifications_enabled, is_suspended)
values
  (:'manager_id'::uuid, 'e2e.manager@smelter.test', 'E2E Manager', 'manager', 'email', true, true, false),
  (:'employee_id'::uuid, 'e2e.employee@smelter.test', 'E2E Employee', 'employee', 'email', true, true, false),
  (:'employee2_id'::uuid, 'e2e.employee2@smelter.test', 'E2E Employee Two', 'employee', 'email', true, true, false)
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  provider = excluded.provider,
  profile_completed = excluded.profile_completed,
  notifications_enabled = excluded.notifications_enabled,
  is_suspended = excluded.is_suspended;

insert into public.org_settings (org_id, employee_access_code, manager_access_code, updated_by, notes)
values (
  '00000000-0000-0000-0000-000000000001',
  extensions.crypt('2468', extensions.gen_salt('bf')),
  extensions.crypt('9753', extensions.gen_salt('bf')),
  :'manager_id'::uuid,
  'Disposable local E2E access codes'
)
on conflict (org_id) do update set
  employee_access_code = excluded.employee_access_code,
  manager_access_code = excluded.manager_access_code,
  updated_by = excluded.updated_by,
  notes = excluded.notes;

insert into public.user_modules (user_id, module_key, enabled, updated_by)
values
  (:'manager_id'::uuid, 'ordering_simple', true, :'manager_id'::uuid),
  (:'manager_id'::uuid, 'ordering_advanced', true, :'manager_id'::uuid),
  (:'manager_id'::uuid, 'stock_check', true, :'manager_id'::uuid),
  (:'manager_id'::uuid, 'tips', true, :'manager_id'::uuid),
  (:'manager_id'::uuid, 'fulfillment', true, :'manager_id'::uuid),
  (:'employee_id'::uuid, 'ordering_simple', true, :'manager_id'::uuid),
  (:'employee_id'::uuid, 'ordering_advanced', true, :'manager_id'::uuid),
  (:'employee_id'::uuid, 'stock_check', true, :'manager_id'::uuid),
  (:'employee_id'::uuid, 'fulfillment', false, :'manager_id'::uuid),
  (:'employee2_id'::uuid, 'ordering_simple', true, :'manager_id'::uuid),
  (:'employee2_id'::uuid, 'ordering_advanced', false, :'manager_id'::uuid),
  (:'employee2_id'::uuid, 'stock_check', true, :'manager_id'::uuid)
on conflict (user_id, module_key) do update set
  enabled = excluded.enabled,
  updated_by = excluded.updated_by;

insert into public.inventory_items (
  id, name, base_unit, pack_unit, pack_size, active, category, supplier_category,
  aliases, allowed_units, default_supplier, location_id, item_key
)
values
  ('46000000-0000-4000-8000-000000000001', 'Fixture Salmon', 'fillet', 'case', 10, true, 'fish', 'fixture', '{salmon}', '{fillet,case}', 'Local QA Supplier', null, 'fixture_salmon'),
  ('46000000-0000-4000-8000-000000000002', 'Fixture Rice', 'bag', 'pallet', 20, true, 'dry', 'fixture', '{rice}', '{bag,pallet}', 'Local QA Supplier', null, 'fixture_rice'),
  ('46000000-0000-4000-8000-000000000003', 'Fixture Nori', 'pack', 'case', 50, true, 'dry', 'fixture', '{nori}', '{pack,case}', 'Local QA Supplier', null, 'fixture_nori'),
  ('46000000-0000-4000-8000-000000000004', 'Fixture Avocado', 'each', 'case', 24, true, 'produce', 'fixture', '{avocado}', '{each,case}', 'Local QA Supplier', null, 'fixture_avocado')
on conflict (id) do update set
  name = excluded.name,
  base_unit = excluded.base_unit,
  pack_unit = excluded.pack_unit,
  pack_size = excluded.pack_size,
  active = excluded.active,
  category = excluded.category,
  supplier_category = excluded.supplier_category,
  aliases = excluded.aliases,
  allowed_units = excluded.allowed_units,
  default_supplier = excluded.default_supplier,
  item_key = excluded.item_key;

insert into public.storage_areas (
  id, name, description, location_id, nfc_tag_id, qr_code, check_frequency, icon, sort_order, active
)
values
  ('47000000-0000-4000-8000-000000000001', 'Fixture Freezer', 'Local freezer stock check area', '45000000-0000-4000-8000-000000000001', 'local_qa_freezer', 'local_qa_freezer_qr', 'daily', 'snowflake', 1, true),
  ('47000000-0000-4000-8000-000000000002', 'Fixture Dry Storage', 'Local dry storage stock check area', '45000000-0000-4000-8000-000000000001', 'local_qa_dry', 'local_qa_dry_qr', 'daily', 'archive', 2, true),
  ('47000000-0000-4000-8000-000000000003', 'Fixture Poki Storage', 'Local second location stock check area', '45000000-0000-4000-8000-000000000002', 'local_qa_poki', 'local_qa_poki_qr', 'weekly', 'cube', 1, true)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  location_id = excluded.location_id,
  check_frequency = excluded.check_frequency,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  active = excluded.active;

insert into public.area_items (
  id, area_id, inventory_item_id, min_quantity, max_quantity, par_level,
  current_quantity, unit_type, active, order_unit, conversion_factor,
  reorder_point, shelf_sort_order
)
values
  ('48000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', 0, 10, 8, 3, 'fillet', true, 'case', 10, 4, 1),
  ('48000000-0000-4000-8000-000000000002', '47000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000002', 0, 20, 12, 10, 'bag', true, 'pallet', 20, 5, 2),
  ('48000000-0000-4000-8000-000000000003', '47000000-0000-4000-8000-000000000002', '46000000-0000-4000-8000-000000000003', 0, 50, 25, 20, 'pack', true, 'case', 50, 10, 1),
  ('48000000-0000-4000-8000-000000000004', '47000000-0000-4000-8000-000000000003', '46000000-0000-4000-8000-000000000004', 0, 24, 12, 8, 'each', true, 'case', 24, 6, 1)
on conflict (id) do update set
  area_id = excluded.area_id,
  inventory_item_id = excluded.inventory_item_id,
  min_quantity = excluded.min_quantity,
  max_quantity = excluded.max_quantity,
  par_level = excluded.par_level,
  current_quantity = excluded.current_quantity,
  unit_type = excluded.unit_type,
  active = excluded.active,
  order_unit = excluded.order_unit,
  conversion_factor = excluded.conversion_factor,
  reorder_point = excluded.reorder_point,
  shelf_sort_order = excluded.shelf_sort_order;

insert into public.order_checklists (id, user_id, location_group, generation_source)
values
  ('49000000-0000-4000-8000-000000000001', :'employee_id'::uuid, 'sushi', 'history_v1'),
  ('49000000-0000-4000-8000-000000000002', :'employee_id'::uuid, 'poki', 'history_v1')
on conflict (id) do update set
  user_id = excluded.user_id,
  location_group = excluded.location_group,
  generation_source = excluded.generation_source;

insert into public.order_checklist_items (
  id, checklist_id, item_id, item_name, unit, default_checked, recommended_qty,
  staleness_bucket, sort_order, item_source
)
values
  ('4a000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', 'Fixture Salmon', 'fillet', true, 2, 'frequent', 0, 'generated'),
  ('4a000000-0000-4000-8000-000000000002', '49000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000002', 'Fixture Rice', 'bag', true, 1, 'frequent', 1, 'generated'),
  ('4a000000-0000-4000-8000-000000000003', '49000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000003', 'Fixture Nori', 'pack', false, 3, 'occasional', 2, 'manual')
on conflict (id) do update set
  checklist_id = excluded.checklist_id,
  item_id = excluded.item_id,
  item_name = excluded.item_name,
  unit = excluded.unit,
  default_checked = excluded.default_checked,
  recommended_qty = excluded.recommended_qty,
  staleness_bucket = excluded.staleness_bucket,
  sort_order = excluded.sort_order,
  item_source = excluded.item_source;

insert into public.orders (
  id, user_id, location_id, status, notes, order_type, entry_method, manager_review_status
)
values
  ('4b000000-0000-4000-8000-000000000001', :'employee_id'::uuid, '45000000-0000-4000-8000-000000000001', 'submitted', 'Local E2E pending order', 'manual', 'simple_checklist', 'not_required'),
  ('4b000000-0000-4000-8000-000000000002', :'employee2_id'::uuid, '45000000-0000-4000-8000-000000000002', 'fulfilled', 'Local E2E fulfilled order', 'manual', 'manual', 'not_required')
on conflict (id) do update set
  user_id = excluded.user_id,
  location_id = excluded.location_id,
  status = excluded.status,
  notes = excluded.notes,
  order_type = excluded.order_type,
  entry_method = excluded.entry_method,
  manager_review_status = excluded.manager_review_status;

insert into public.order_items (
  id, order_id, inventory_item_id, quantity, unit_type, input_mode,
  quantity_requested, status, note
)
values
  ('4c000000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000001', 3, 'base'::unit_type, 'quantity', 3, 'pending', 'Local E2E pending line'),
  ('4c000000-0000-4000-8000-000000000002', '4b000000-0000-4000-8000-000000000001', '46000000-0000-4000-8000-000000000002', 1, 'pack'::unit_type, 'quantity', 1, 'pending', 'Local E2E pending line'),
  ('4c000000-0000-4000-8000-000000000003', '4b000000-0000-4000-8000-000000000002', '46000000-0000-4000-8000-000000000003', 2, 'base'::unit_type, 'quantity', 2, 'sent', 'Local E2E fulfilled line')
on conflict (id) do update set
  order_id = excluded.order_id,
  inventory_item_id = excluded.inventory_item_id,
  quantity = excluded.quantity,
  unit_type = excluded.unit_type,
  input_mode = excluded.input_mode,
  quantity_requested = excluded.quantity_requested,
  status = excluded.status,
  note = excluded.note;

select 'PASS: local mobile E2E fixture seeded' as result;
