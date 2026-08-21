-- Employee-app phase fixture: exercises the 20260820130000 RPCs end to end.
-- Run only after scripts/local-db/verify-migrations.sh --keep:
--   psql postgresql://postgres:postgres@127.0.0.1:<port>/postgres \
--     -v ON_ERROR_STOP=1 -f scripts/local-db/employee_app_fixture.sql
-- Everything runs in one rolled-back transaction; PASS prints at the end.

begin;

-- Seed (service context): employee, location, inventory, checklist.
insert into auth.users (id, email)
values
  ('44444444-1111-4111-8111-111111111111', 'employee-app-a@example.test'),
  ('44444444-2222-4111-8111-222222222222', 'employee-app-b@example.test');

insert into public.users (id, email, name, role, default_location_id)
values
  ('44444444-1111-4111-8111-111111111111', 'employee-app-a@example.test', 'Fixture Nate', 'employee', null),
  ('44444444-2222-4111-8111-222222222222', 'employee-app-b@example.test', 'Fixture Blake', 'employee', null);

insert into public.locations (id, name, short_code)
values ('45000000-0000-4000-8000-000000000001', 'Fixture Sushi', 'FS');

insert into public.inventory_items (id, name, base_unit, pack_unit, category, supplier_category)
values
  ('46000000-0000-4000-8000-000000000001', 'Fixture Salmon', 'fillet', 'case', 'fish', 'fixture'),
  ('46000000-0000-4000-8000-000000000002', 'Fixture Rice', 'bag', 'pallet', 'dry', 'fixture'),
  ('46000000-0000-4000-8000-000000000003', 'Fixture Nori', 'pack', 'case', 'dry', 'fixture');

insert into public.order_checklists (id, user_id, location_group, generation_source)
values ('47000000-0000-4000-8000-000000000001', '44444444-1111-4111-8111-111111111111', 'sushi', 'history_v1');

insert into public.order_checklist_items (
  id, checklist_id, item_id, item_name, unit, default_checked,
  recommended_qty, staleness_bucket, sort_order, item_source
)
values
  ('48000000-0000-4000-8000-000000000001', '47000000-0000-4000-8000-000000000001',
   '46000000-0000-4000-8000-000000000001', 'Fixture Salmon', 'fillet', true, 2, 'frequent', 0, 'generated'),
  ('48000000-0000-4000-8000-000000000002', '47000000-0000-4000-8000-000000000001',
   '46000000-0000-4000-8000-000000000002', 'Fixture Rice', 'bag', true, 1, 'frequent', 1, 'generated');

-- ---------------------------------------------------------------------------
-- 1. save_my_checklist_default as the employee.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '44444444-1111-4111-8111-111111111111', false);

-- Save: salmon checked at qty 5 (existing row), nori added by search at 3;
-- rice is left out and must flip to unchecked while keeping its row.
select public.save_my_checklist_default(
  'sushi',
  '[
    {"id": "48000000-0000-4000-8000-000000000001",
     "item_id": "46000000-0000-4000-8000-000000000001",
     "item_name": "Fixture Salmon", "unit": "fillet", "quantity": 5},
    {"item_id": "46000000-0000-4000-8000-000000000003",
     "item_name": "Fixture Nori", "unit": "pack", "quantity": 3}
  ]'::jsonb
);

do $$
declare
  v_qty numeric;
  v_checked boolean;
  v_source text;
  v_rows integer;
begin
  select recommended_qty, default_checked into v_qty, v_checked
  from public.order_checklist_items
  where id = '48000000-0000-4000-8000-000000000001';
  if v_qty <> 5 or v_checked is not true then
    raise exception 'save default: existing row not updated (qty=%, checked=%)', v_qty, v_checked;
  end if;

  select default_checked into v_checked
  from public.order_checklist_items
  where id = '48000000-0000-4000-8000-000000000002';
  if v_checked is not false then
    raise exception 'save default: unreferenced row did not flip unchecked';
  end if;

  select recommended_qty, item_source into v_qty, v_source
  from public.order_checklist_items
  where checklist_id = '47000000-0000-4000-8000-000000000001'
    and item_id = '46000000-0000-4000-8000-000000000003';
  if v_qty <> 3 or v_source <> 'manual' then
    raise exception 'save default: search add not inserted as manual (qty=%, source=%)', v_qty, v_source;
  end if;

  select count(*) into v_rows
  from public.order_checklist_items
  where checklist_id = '47000000-0000-4000-8000-000000000001';
  if v_rows <> 3 then
    raise exception 'save default: expected 3 rows, found %', v_rows;
  end if;
end $$;

-- Saving again with the same nori line must update, not duplicate.
select public.save_my_checklist_default(
  'sushi',
  '[{"item_id": "46000000-0000-4000-8000-000000000003",
     "item_name": "Fixture Nori", "unit": "pack", "quantity": 4}]'::jsonb
);

do $$
declare
  v_rows integer;
  v_qty numeric;
begin
  select count(*) into v_rows
  from public.order_checklist_items
  where checklist_id = '47000000-0000-4000-8000-000000000001'
    and item_id = '46000000-0000-4000-8000-000000000003';
  if v_rows <> 1 then
    raise exception 'save default: re-save duplicated the manual row (% rows)', v_rows;
  end if;
  select recommended_qty into v_qty
  from public.order_checklist_items
  where checklist_id = '47000000-0000-4000-8000-000000000001'
    and item_id = '46000000-0000-4000-8000-000000000003';
  if v_qty <> 4 then
    raise exception 'save default: re-save did not update quantity (qty=%)', v_qty;
  end if;
end $$;

-- A user with no checklist for the group gets one created on first save.
select set_config('request.jwt.claim.sub', '44444444-2222-4111-8111-222222222222', false);
select public.save_my_checklist_default(
  'poki',
  '[{"item_id": "46000000-0000-4000-8000-000000000002",
     "item_name": "Fixture Rice", "unit": "bag", "quantity": 2}]'::jsonb
);

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows
  from public.order_checklists c
  join public.order_checklist_items i on i.checklist_id = c.id
  where c.user_id = '44444444-2222-4111-8111-222222222222'
    and c.location_group = 'poki'
    and c.generation_source = 'manual';
  if v_rows <> 1 then
    raise exception 'save default: checklist auto-create failed (% rows)', v_rows;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. set_my_order_meta: note + unit label on own submitted order only.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);  -- service context seeding

insert into public.orders (id, user_id, location_id, status, entry_method)
values ('49000000-0000-4000-8000-000000000001',
        '44444444-1111-4111-8111-111111111111',
        '45000000-0000-4000-8000-000000000001',
        'submitted', 'simple_checklist');

insert into public.order_items (
  id, order_id, inventory_item_id, quantity, unit_type, input_mode, quantity_requested
)
values ('4a000000-0000-4000-8000-000000000001',
        '49000000-0000-4000-8000-000000000001',
        '46000000-0000-4000-8000-000000000001', 3, 'base', 'quantity', 3);

select set_config('request.jwt.claim.sub', '44444444-1111-4111-8111-111111111111', false);

select public.set_my_order_meta(
  '49000000-0000-4000-8000-000000000001',
  '  Walk-in freezer is full, hold extra rice.  ',
  '[{"inventory_item_id": "46000000-0000-4000-8000-000000000001", "unit_label": "lb"}]'::jsonb
);

do $$
declare
  v_notes text;
  v_label text;
begin
  select notes into v_notes from public.orders
  where id = '49000000-0000-4000-8000-000000000001';
  if v_notes <> 'Walk-in freezer is full, hold extra rice.' then
    raise exception 'order meta: note not written/trimmed (notes=%)', v_notes;
  end if;

  select unit_label into v_label from public.order_items
  where id = '4a000000-0000-4000-8000-000000000001';
  if v_label <> 'lb' then
    raise exception 'order meta: unit_label not written (label=%)', v_label;
  end if;
end $$;

-- Another user must not be able to touch the order.
select set_config('request.jwt.claim.sub', '44444444-2222-4111-8111-222222222222', false);
do $$
begin
  begin
    perform public.set_my_order_meta('49000000-0000-4000-8000-000000000001', 'hijack', null);
    raise exception 'order meta: foreign user was allowed to write';
  exception
    when others then
      if sqlerrm not like '%Order not found%' then
        raise;
      end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. update_my_display_name keeps name sign-in in sync.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);

insert into public.login_identities (user_id, login_name, display_name, credential_kind, secret_hash)
values
  ('44444444-1111-4111-8111-111111111111', 'fixture nate', 'Fixture Nate', 'pin', 'x'),
  ('44444444-2222-4111-8111-222222222222', 'fixture blake', 'Fixture Blake', 'pin', 'x');

select set_config('request.jwt.claim.sub', '44444444-1111-4111-8111-111111111111', false);
select public.update_my_display_name('  Fixture   Nathan ');

do $$
declare
  v_name text;
  v_login text;
begin
  select name into v_name from public.users
  where id = '44444444-1111-4111-8111-111111111111';
  if v_name <> 'Fixture Nathan' then
    raise exception 'rename: users.name not updated (name=%)', v_name;
  end if;

  select login_name into v_login from public.login_identities
  where user_id = '44444444-1111-4111-8111-111111111111';
  if v_login <> 'fixture nathan' then
    raise exception 'rename: login_identities not synced (login=%)', v_login;
  end if;
end $$;

-- Renaming onto another person's sign-in name must fail.
do $$
begin
  begin
    perform public.update_my_display_name('Fixture Blake');
    raise exception 'rename: duplicate sign-in name was allowed';
  exception
    when others then
      if sqlerrm not like '%already used for sign-in%' then
        raise;
      end if;
  end;
end $$;

select 'PASS: employee_app_fixture assertions all passed' as result;

rollback;
