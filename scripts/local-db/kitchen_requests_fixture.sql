-- Kitchen requests deterministic backend checks.
-- Run only after scripts/local-db/verify-migrations.sh --keep:
--   docker exec -i <container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < scripts/local-db/kitchen_requests_fixture.sql
-- Expected output: "ok: ..." notices followed by
--   "PASS: kitchen requests fixture assertions all held" and a ROLLBACK.

\set ON_ERROR_STOP on

begin;

-- Fixture identities and locations.
insert into public.locations (id, name, short_code, active) values
  ('bbbbbbbb-1000-4000-8000-000000000001', 'Kitchen Fixture One', 'KF1', true),
  ('bbbbbbbb-1000-4000-8000-000000000002', 'Kitchen Fixture Two', 'KF2', true);

insert into auth.users (id, email) values
  ('aaaaaaaa-1000-4000-8000-000000000001', 'kitchen-manager@example.test'),
  ('aaaaaaaa-1000-4000-8000-000000000002', 'kitchen-chef@example.test'),
  ('aaaaaaaa-1000-4000-8000-000000000003', 'kitchen-display@example.test'),
  ('aaaaaaaa-1000-4000-8000-000000000004', 'kitchen-none@example.test'),
  ('aaaaaaaa-1000-4000-8000-000000000005', 'kitchen-suspended@example.test');

insert into public.users (id, email, name, role, default_location_id) values
  (
    'aaaaaaaa-1000-4000-8000-000000000001',
    'kitchen-manager@example.test',
    'Manager Fixture',
    'manager',
    null
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000002',
    'kitchen-chef@example.test',
    'Chef User Fallback',
    'employee',
    'bbbbbbbb-1000-4000-8000-000000000001'
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000003',
    'kitchen-display@example.test',
    'Display User Fallback',
    'employee',
    'bbbbbbbb-1000-4000-8000-000000000001'
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000004',
    'kitchen-none@example.test',
    'No Module User',
    'employee',
    'bbbbbbbb-1000-4000-8000-000000000001'
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000005',
    'kitchen-suspended@example.test',
    'Suspended Chef',
    'employee',
    'bbbbbbbb-1000-4000-8000-000000000001'
  );

insert into public.profiles (
  id,
  email,
  full_name,
  role,
  provider,
  profile_completed,
  is_suspended
) values
  (
    'aaaaaaaa-1000-4000-8000-000000000001',
    'kitchen-manager@example.test',
    'Manager Fixture',
    'manager',
    'email',
    true,
    false
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000002',
    'kitchen-chef@example.test',
    'Chef Profile Fallback',
    'employee',
    'email',
    true,
    false
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000003',
    'kitchen-display@example.test',
    'Display Fixture',
    'employee',
    'email',
    true,
    false
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000004',
    'kitchen-none@example.test',
    'No Module Fixture',
    'employee',
    'email',
    true,
    false
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000005',
    'kitchen-suspended@example.test',
    'Suspended Chef',
    'employee',
    'email',
    true,
    true
  );

insert into public.login_identities (
  user_id,
  login_name,
  display_name,
  credential_kind,
  secret_hash
) values (
  'aaaaaaaa-1000-4000-8000-000000000002',
  'chef-handle',
  'Chef Login Display',
  'pin',
  'fixture-secret-not-used'
);

insert into public.user_modules (user_id, module_key, enabled, updated_by) values
  (
    'aaaaaaaa-1000-4000-8000-000000000002',
    'kitchen_requests',
    true,
    'aaaaaaaa-1000-4000-8000-000000000001'
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000003',
    'kitchen_display',
    true,
    'aaaaaaaa-1000-4000-8000-000000000001'
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000005',
    'kitchen_requests',
    true,
    'aaaaaaaa-1000-4000-8000-000000000001'
  );

-- The migration seeds exactly these six global items when the table is empty.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.kitchen_items;
  if v_count <> 6 then
    raise exception 'FAIL: expected six seeded kitchen items, got %', v_count;
  end if;

  if exists (
    select 1
    from (
      values
        ('Fried Shrimp'::text, 'pieces'::text, 1),
        ('Sushi Rice'::text, 'tubs'::text, 2),
        ('Crab Mix'::text, 'trays'::text, 3),
        ('Unagi'::text, 'portions'::text, 4),
        ('Tempura Batter'::text, 'batches'::text, 5),
        ('Salmon'::text, 'filets'::text, 6)
    ) as expected(name, unit, sort_order)
    left join public.kitchen_items item
      on item.name = expected.name
     and item.unit = expected.unit
     and item.sort_order = expected.sort_order
     and item.location_id is null
     and item.active
    where item.id is null
  ) then
    raise exception 'FAIL: seeded kitchen item values do not match the contract';
  end if;

  raise notice 'ok: six global kitchen items were seeded with the contract values';
end;
$$;

-- Manager defaults are on, employee defaults are off, and order is stable.
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000001',
  false
);
set role authenticated;
do $$
declare
  v_modules jsonb;
  v_keys text[];
begin
  select
    jsonb_object_agg(module_key, enabled),
    array_agg(module_key order by ordinality)
  into v_modules, v_keys
  from public.get_effective_modules('aaaaaaaa-1000-4000-8000-000000000001')
    with ordinality as modules(module_key, enabled, ordinality);

  if v_modules->>'kitchen_requests' is distinct from 'true'
    or v_modules->>'kitchen_display' is distinct from 'true' then
    raise exception 'FAIL: manager kitchen module defaults should be true: %', v_modules;
  end if;

  if array_length(v_keys, 1) is distinct from 7
    or v_keys[6] is distinct from 'kitchen_requests'
    or v_keys[7] is distinct from 'kitchen_display' then
    raise exception 'FAIL: kitchen module order should be 6 and 7: %', v_keys;
  end if;

  raise notice 'ok: manager kitchen module defaults are true at positions 6 and 7';
end;
$$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000004',
  false
);
set role authenticated;
do $$
declare
  v_modules jsonb;
begin
  select jsonb_object_agg(module_key, enabled)
  into v_modules
  from public.get_effective_modules('aaaaaaaa-1000-4000-8000-000000000004');

  if v_modules->>'kitchen_requests' is distinct from 'false'
    or v_modules->>'kitchen_display' is distinct from 'false' then
    raise exception 'FAIL: employee kitchen module defaults should be false: %', v_modules;
  end if;

  raise notice 'ok: employee kitchen module defaults are false';
end;
$$;
reset role;

-- Sending without a user is refused before any request input is read.
select set_config('request.jwt.claim.sub', '', false);
set role authenticated;
do $$
begin
  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000010',
      'dddddddd-1000-4000-8000-000000000010',
      1,
      'bbbbbbbb-1000-4000-8000-000000000001'
    );
    raise exception 'FAIL: signed-out send should be refused';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'not_signed_in' then
        raise exception 'FAIL: expected 42501 not_signed_in, got % %', sqlstate, sqlerrm;
      end if;
  end;

  raise notice 'ok: not_signed_in is returned for a signed-out send';
end;
$$;
reset role;

-- A user without the sender module cannot send.
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000004',
  false
);
set role authenticated;
do $$
begin
  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000011',
      'dddddddd-1000-4000-8000-000000000011',
      1,
      'bbbbbbbb-1000-4000-8000-000000000001'
    );
    raise exception 'FAIL: no-module user should not send';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'kitchen_requests_disabled' then
        raise exception 'FAIL: expected 42501 kitchen_requests_disabled, got % %', sqlstate, sqlerrm;
      end if;
  end;

  raise notice 'ok: kitchen_requests_disabled is returned without the sender module';
end;
$$;
reset role;

-- Sender validation and the first durable request.
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000002',
  false
);
set role authenticated;
do $$
declare
  v_item_id uuid;
  v_first public.kitchen_requests%rowtype;
  v_replay public.kitchen_requests%rowtype;
begin
  select id into v_item_id
  from public.kitchen_items
  where name = 'Fried Shrimp' and location_id is null;

  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000012',
      v_item_id,
      1,
      'bbbbbbbb-1000-4000-8000-000000000002'
    );
    raise exception 'FAIL: location-scoped chef should not send to location two';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'location_not_allowed' then
        raise exception 'FAIL: expected 42501 location_not_allowed, got % %', sqlstate, sqlerrm;
      end if;
  end;

  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000013',
      'dddddddd-1000-4000-8000-000000000013',
      1,
      'bbbbbbbb-1000-4000-8000-000000000001'
    );
    raise exception 'FAIL: unknown item should be unavailable';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '22023' or sqlerrm <> 'item_unavailable' then
        raise exception 'FAIL: expected 22023 item_unavailable, got % %', sqlstate, sqlerrm;
      end if;
  end;

  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000014',
      v_item_id,
      0,
      'bbbbbbbb-1000-4000-8000-000000000001'
    );
    raise exception 'FAIL: quantity zero should be rejected';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '22023' or sqlerrm <> 'invalid_quantity' then
        raise exception 'FAIL: expected 22023 invalid_quantity, got % %', sqlstate, sqlerrm;
      end if;
  end;

  select * into v_first
  from public.kitchen_send_request(
    'cccccccc-1000-4000-8000-000000000001',
    v_item_id,
    4,
    'bbbbbbbb-1000-4000-8000-000000000001'
  );

  select * into v_replay
  from public.kitchen_send_request(
    'cccccccc-1000-4000-8000-000000000001',
    v_item_id,
    4,
    'bbbbbbbb-1000-4000-8000-000000000001'
  );

  if v_first.id is distinct from v_replay.id then
    raise exception 'FAIL: replay should return the same request id';
  end if;

  if v_first.requested_by_name <> 'Chef Login Display'
    or v_first.requested_by_tag <> 'chef-handle'
    or v_first.item_name <> 'Fried Shrimp'
    or v_first.unit <> 'pieces'
    or v_first.quantity <> 4
    or v_first.status <> 'queued' then
    raise exception 'FAIL: request snapshot or actor identity is wrong: %', row_to_json(v_first);
  end if;

  raise notice 'ok: sender validation returns location_not_allowed, item_unavailable, and invalid_quantity';
  raise notice 'ok: replay returns one id and stamps the login display name and handle';
end;
$$;
reset role;

-- Explicit enablement does not bypass suspension.
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000005',
  false
);
set role authenticated;
do $$
begin
  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000015',
      'dddddddd-1000-4000-8000-000000000015',
      1,
      'bbbbbbbb-1000-4000-8000-000000000001'
    );
    raise exception 'FAIL: suspended chef should be refused';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'kitchen_requests_disabled' then
        raise exception 'FAIL: expected suspended chef refusal, got % %', sqlstate, sqlerrm;
      end if;
  end;

  raise notice 'ok: a suspended chef is refused despite an enabled override';
end;
$$;
reset role;

-- A manager cannot claim another user's client key and can create at location two.
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000001',
  false
);
set role authenticated;
do $$
declare
  v_item_id uuid;
  v_location_two public.kitchen_requests%rowtype;
begin
  select id into v_item_id
  from public.kitchen_items
  where name = 'Fried Shrimp' and location_id is null;

  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000001',
      v_item_id,
      4,
      'bbbbbbbb-1000-4000-8000-000000000001'
    );
    raise exception 'FAIL: another user should not reuse a client key';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'client_key_conflict' then
        raise exception 'FAIL: expected 42501 client_key_conflict, got % %', sqlstate, sqlerrm;
      end if;
  end;

  select * into v_location_two
  from public.kitchen_send_request(
    'cccccccc-1000-4000-8000-000000000003',
    v_item_id,
    2,
    'bbbbbbbb-1000-4000-8000-000000000002'
  );

  if v_location_two.location_id is distinct from 'bbbbbbbb-1000-4000-8000-000000000002' then
    raise exception 'FAIL: manager location-two request was not stored correctly';
  end if;

  perform set_config(
    'kitchen_fixture.location_two_request_id',
    v_location_two.id::text,
    false
  );

  raise notice 'ok: client_key_conflict protects another requester''s idempotency key';
end;
$$;
reset role;

-- Update errors cover unknown rows, location scope, actor checks, and status.
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000003',
  false
);
set role authenticated;
do $$
begin
  begin
    perform public.kitchen_update_request(
      'eeeeeeee-1000-4000-8000-000000000001',
      'ready'
    );
    raise exception 'FAIL: unknown request should be rejected';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> 'P0002' or sqlerrm <> 'request_not_found' then
        raise exception 'FAIL: expected P0002 request_not_found, got % %', sqlstate, sqlerrm;
      end if;
  end;

  begin
    perform public.kitchen_update_request(
      (
        select id from public.kitchen_requests
        where client_key = 'cccccccc-1000-4000-8000-000000000001'
      ),
      'cancel'
    );
    raise exception 'FAIL: non-requester display user should not cancel';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'not_allowed' then
        raise exception 'FAIL: expected 42501 not_allowed, got % %', sqlstate, sqlerrm;
      end if;
  end;

  raise notice 'ok: request_not_found and not_allowed protect update actions';
end;
$$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000002',
  false
);
set role authenticated;
do $$
declare
  v_hint text;
begin
  begin
    perform public.kitchen_update_request(
      current_setting('kitchen_fixture.location_two_request_id')::uuid,
      'clear'
    );
    raise exception 'FAIL: chef should not update a request at location two';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'location_not_allowed' then
        raise exception 'FAIL: expected update location_not_allowed, got % %', sqlstate, sqlerrm;
      end if;
  end;

  begin
    perform public.kitchen_update_request(
      (
        select id from public.kitchen_requests
        where client_key = 'cccccccc-1000-4000-8000-000000000001'
      ),
      'clear'
    );
    raise exception 'FAIL: queued request should not clear';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      get stacked diagnostics v_hint = pg_exception_hint;
      if sqlstate <> '22023'
        or sqlerrm <> 'invalid_transition'
        or position('queued' in coalesce(v_hint, '')) = 0 then
        raise exception 'FAIL: expected invalid_transition with queued hint, got % % %',
          sqlstate, sqlerrm, v_hint;
      end if;
  end;

  raise notice 'ok: updates enforce location scope and invalid_transition names the current status';
end;
$$;
reset role;

-- All four transitions, their actors, and their timestamp effects.
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000003',
  false
);
set role authenticated;
do $$
declare
  v_request public.kitchen_requests%rowtype;
  v_ready_at timestamptz;
begin
  select * into v_request
  from public.kitchen_update_request(
    (
      select id from public.kitchen_requests
      where client_key = 'cccccccc-1000-4000-8000-000000000001'
    ),
    'ready'
  );

  if v_request.status <> 'ready'
    or v_request.ready_at is null
    or v_request.ready_by is distinct from 'aaaaaaaa-1000-4000-8000-000000000003'
    or v_request.ready_by_name <> 'Display Fixture'
    or v_request.closed_at is not null then
    raise exception 'FAIL: ready transition fields are wrong: %', row_to_json(v_request);
  end if;
  v_ready_at := v_request.ready_at;

  select * into v_request
  from public.kitchen_update_request(v_request.id, 'ready');
  if v_request.ready_at is distinct from v_ready_at then
    raise exception 'FAIL: ready replay should leave ready_at unchanged';
  end if;

  select * into v_request
  from public.kitchen_update_request(v_request.id, 'undo_ready');
  if v_request.status <> 'queued'
    or v_request.ready_at is not null
    or v_request.ready_by is not null
    or v_request.ready_by_name is not null then
    raise exception 'FAIL: undo_ready should clear all ready fields: %', row_to_json(v_request);
  end if;

  select * into v_request
  from public.kitchen_update_request(v_request.id, 'undo_ready');
  if v_request.status <> 'queued' then
    raise exception 'FAIL: undo_ready replay should remain queued';
  end if;

  select * into v_request
  from public.kitchen_update_request(v_request.id, 'ready');

  raise notice 'ok: ready and undo_ready are idempotent and store the display actor';
end;
$$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000002',
  false
);
set role authenticated;
do $$
declare
  v_item_id uuid;
  v_request public.kitchen_requests%rowtype;
  v_closed_at timestamptz;
begin
  select * into v_request
  from public.kitchen_update_request(
    (
      select id from public.kitchen_requests
      where client_key = 'cccccccc-1000-4000-8000-000000000001'
    ),
    'clear'
  );

  if v_request.status <> 'cleared'
    or v_request.closed_at is null
    or v_request.ready_at is null
    or v_request.ready_by is distinct from 'aaaaaaaa-1000-4000-8000-000000000003'
    or v_request.ready_by_name <> 'Display Fixture' then
    raise exception 'FAIL: clear transition fields are wrong: %', row_to_json(v_request);
  end if;
  v_closed_at := v_request.closed_at;

  select * into v_request
  from public.kitchen_update_request(v_request.id, 'clear');
  if v_request.closed_at is distinct from v_closed_at then
    raise exception 'FAIL: clear replay should leave closed_at unchanged';
  end if;

  select id into v_item_id
  from public.kitchen_items
  where name = 'Sushi Rice' and location_id is null;

  select * into v_request
  from public.kitchen_send_request(
    'cccccccc-1000-4000-8000-000000000002',
    v_item_id,
    3,
    'bbbbbbbb-1000-4000-8000-000000000001'
  );

  select * into v_request
  from public.kitchen_update_request(v_request.id, 'cancel');
  if v_request.status <> 'cancelled'
    or v_request.closed_at is null
    or v_request.ready_at is not null
    or v_request.ready_by is not null
    or v_request.ready_by_name is not null then
    raise exception 'FAIL: cancel transition fields are wrong: %', row_to_json(v_request);
  end if;
  v_closed_at := v_request.closed_at;

  select * into v_request
  from public.kitchen_update_request(v_request.id, 'cancel');
  if v_request.closed_at is distinct from v_closed_at then
    raise exception 'FAIL: cancel replay should leave closed_at unchanged';
  end if;

  raise notice 'ok: requester clear and cancel transitions set closed_at and preserve ready fields correctly';
end;
$$;
reset role;

-- RLS restricts request rows by location and both tables by module access.
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000003',
  false
);
set role authenticated;
do $$
declare
  v_request_count integer;
  v_item_count integer;
begin
  select count(*) into v_request_count from public.kitchen_requests;
  if v_request_count <> 2 or exists (
    select 1
    from public.kitchen_requests
    where location_id <> 'bbbbbbbb-1000-4000-8000-000000000001'
  ) then
    raise exception 'FAIL: display user should see only two location-one requests, got %',
      v_request_count;
  end if;

  select count(*) into v_item_count from public.kitchen_items;
  if v_item_count <> 6 then
    raise exception 'FAIL: display user should see six global items, got %', v_item_count;
  end if;

  raise notice 'ok: display RLS exposes only its location requests and the global items';
end;
$$;
reset role;

select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-1000-4000-8000-000000000004',
  false
);
set role authenticated;
do $$
declare
  v_request_count integer;
  v_item_count integer;
begin
  select count(*) into v_request_count from public.kitchen_requests;
  select count(*) into v_item_count from public.kitchen_items;

  if v_request_count <> 0 or v_item_count <> 0 then
    raise exception 'FAIL: no-module user should see no requests/items, got %/%',
      v_request_count, v_item_count;
  end if;

  raise notice 'ok: no-module RLS returns zero requests and zero items';
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
declare
  v_count integer;
begin
  begin
    select count(*) into v_count from public.kitchen_requests;
    if v_count <> 0 then
      raise exception 'FAIL: anon saw % kitchen requests', v_count;
    end if;
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    select count(*) into v_count from public.kitchen_items;
    if v_count <> 0 then
      raise exception 'FAIL: anon saw % kitchen items', v_count;
    end if;
  exception
    when insufficient_privilege then
      null;
  end;

  raise notice 'ok: anon selects fail for both kitchen tables or return zero rows';
end;
$$;
reset role;

do $$ begin raise notice 'PASS: kitchen requests fixture assertions all held'; end $$;

rollback;
