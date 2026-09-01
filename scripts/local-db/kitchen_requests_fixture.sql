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
-- (A real anon caller is stopped earlier by the missing EXECUTE grant; see
-- the anon RPC assertions near the end. This checks the in-function guard.)
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


-- ===========================================================================
-- Boundary assertions added after the adversarial review.
-- ===========================================================================

-- A chef (kitchen_requests only) cannot mark food ready; the display user
-- (kitchen_display only) cannot place orders.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000002', false);
set role authenticated;
do $$
declare
  v_item uuid;
  v_request public.kitchen_requests%rowtype;
begin
  select id into v_item from public.kitchen_items where name = 'Fried Shrimp';
  select * into v_request from public.kitchen_send_request(
    'cccccccc-1000-4000-8000-000000000030', v_item, 2, 'bbbbbbbb-1000-4000-8000-000000000001');
  begin
    perform public.kitchen_update_request(v_request.id, 'ready');
    raise exception 'FAIL: chef must not mark ready';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'not_allowed' then
        raise exception 'FAIL: expected 42501 not_allowed for chef ready, got % %', sqlstate, sqlerrm;
      end if;
  end;
  raise notice 'ok: a chef without kitchen_display cannot mark ready';
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000003', false);
set role authenticated;
do $$
declare
  v_item uuid;
begin
  select id into v_item from public.kitchen_items where name = 'Fried Shrimp';
  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000031', v_item, 1, 'bbbbbbbb-1000-4000-8000-000000000001');
    raise exception 'FAIL: display user must not send';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'kitchen_requests_disabled' then
        raise exception 'FAIL: expected kitchen_requests_disabled for display send, got % %', sqlstate, sqlerrm;
      end if;
  end;
  raise notice 'ok: a display user without kitchen_requests cannot send';
end;
$$;
reset role;

-- Losing the module, or being suspended, blocks cancel/clear on your own request.
update public.user_modules set enabled = false
where user_id = 'aaaaaaaa-1000-4000-8000-000000000002' and module_key = 'kitchen_requests';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000002', false);
set role authenticated;
do $$
declare
  v_id uuid;
  v_count integer;
begin
  select count(*) into v_count from public.kitchen_requests;
  if v_count <> 0 then
    raise exception 'FAIL: module-less ex-chef should read zero rows, got %', v_count;
  end if;
  -- The id is known from earlier (persisted client state); RLS hides it now.
  select id into v_id from public.kitchen_requests where client_key = 'cccccccc-1000-4000-8000-000000000030';
  if v_id is not null then
    raise exception 'FAIL: RLS should hide the row from a module-less user';
  end if;
end;
$$;
reset role;
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.kitchen_requests where client_key = 'cccccccc-1000-4000-8000-000000000030';
  perform set_config('kitchen_fixture.request_id', v_id::text, false);
end;
$$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform public.kitchen_update_request(current_setting('kitchen_fixture.request_id')::uuid, 'cancel');
    raise exception 'FAIL: module-less requester must not cancel';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'not_allowed' then
        raise exception 'FAIL: expected not_allowed for module-less cancel, got % %', sqlstate, sqlerrm;
      end if;
  end;
  raise notice 'ok: a requester whose module was revoked cannot cancel';
end;
$$;
reset role;
update public.user_modules set enabled = true
where user_id = 'aaaaaaaa-1000-4000-8000-000000000002' and module_key = 'kitchen_requests';
-- Suspension changes are allowed only in service contexts (no JWT subject).
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set is_suspended = true where id = 'aaaaaaaa-1000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000002', false);
set role authenticated;
do $$
begin
  begin
    perform public.kitchen_update_request(current_setting('kitchen_fixture.request_id')::uuid, 'cancel');
    raise exception 'FAIL: suspended requester must not cancel';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'not_allowed' then
        raise exception 'FAIL: expected not_allowed for suspended cancel, got % %', sqlstate, sqlerrm;
      end if;
  end;
  raise notice 'ok: a suspended requester cannot cancel or clear';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set is_suspended = false where id = 'aaaaaaaa-1000-4000-8000-000000000002';

-- Direct DML on kitchen_requests is refused for authenticated; anon cannot call the RPCs.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000002', false);
set role authenticated;
do $$
declare
  v_item uuid;
begin
  select id into v_item from public.kitchen_items where name = 'Fried Shrimp';
  begin
    insert into public.kitchen_requests (client_key, location_id, item_id, item_name, unit, quantity, requested_by_name, requested_by_tag)
    values ('cccccccc-1000-4000-8000-000000000032', 'bbbbbbbb-1000-4000-8000-000000000001', v_item, 'x', 'y', 1, 'n', 't');
    raise exception 'FAIL: direct insert must be refused';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then raise exception 'FAIL: expected 42501 on insert, got % %', sqlstate, sqlerrm; end if;
  end;
  begin
    update public.kitchen_requests set status = 'ready' where client_key = 'cccccccc-1000-4000-8000-000000000030';
    raise exception 'FAIL: direct update must be refused';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then raise exception 'FAIL: expected 42501 on update, got % %', sqlstate, sqlerrm; end if;
  end;
  begin
    delete from public.kitchen_requests where client_key = 'cccccccc-1000-4000-8000-000000000030';
    raise exception 'FAIL: direct delete must be refused';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then raise exception 'FAIL: expected 42501 on delete, got % %', sqlstate, sqlerrm; end if;
  end;
  begin
    truncate public.kitchen_requests;
    raise exception 'FAIL: truncate must be refused';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then raise exception 'FAIL: expected 42501 on truncate, got % %', sqlstate, sqlerrm; end if;
  end;
  raise notice 'ok: authenticated cannot insert, update, delete or truncate kitchen_requests directly';
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
begin
  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000033', 'dddddddd-1000-4000-8000-000000000010', 1,
      'bbbbbbbb-1000-4000-8000-000000000001');
    raise exception 'FAIL: anon must not execute kitchen_send_request';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then raise exception 'FAIL: expected 42501 for anon send, got % %', sqlstate, sqlerrm; end if;
  end;
  begin
    perform public.kitchen_update_request('cccccccc-1000-4000-8000-000000000030', 'cancel');
    raise exception 'FAIL: anon must not execute kitchen_update_request';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then raise exception 'FAIL: expected 42501 for anon update, got % %', sqlstate, sqlerrm; end if;
  end;
  raise notice 'ok: anon cannot execute the kitchen RPCs';
end;
$$;
reset role;

-- A manager may cancel someone else's request; identity is stamped from the
-- login handle when there is one and from the normalised name otherwise.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000001', false);
set role authenticated;
do $$
declare
  v_request public.kitchen_requests%rowtype;
  v_item uuid;
begin
  select * into v_request from public.kitchen_requests
  where client_key = 'cccccccc-1000-4000-8000-000000000030';
  if v_request.requested_by_name <> 'Chef Login Display' or v_request.requested_by_tag <> 'chef-handle' then
    raise exception 'FAIL: chef identity should come from login_identities, got % / %',
      v_request.requested_by_name, v_request.requested_by_tag;
  end if;
  select * into v_request from public.kitchen_update_request(v_request.id, 'cancel');
  if v_request.status <> 'cancelled' then
    raise exception 'FAIL: manager should be able to cancel another user''s request';
  end if;

  select id into v_item from public.kitchen_items where name = 'Sushi Rice';
  select * into v_request from public.kitchen_send_request(
    'cccccccc-1000-4000-8000-000000000034', v_item, 1, 'bbbbbbbb-1000-4000-8000-000000000002');
  if v_request.requested_by_name <> 'Manager Fixture' or v_request.requested_by_tag <> 'manager fixture' then
    raise exception 'FAIL: manager identity should fall back to the normalised name, got % / %',
      v_request.requested_by_name, v_request.requested_by_tag;
  end if;
  raise notice 'ok: managers can cancel others'' requests; identity uses the handle or the normalised name';
end;
$$;
reset role;

-- Replay beats validation: a retry of a stored request succeeds even after the
-- item was deactivated, and a mismatched replay is a conflict, never a second row.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000002', false);
set role authenticated;
do $$
declare
  v_item uuid;
  v_first public.kitchen_requests%rowtype;
begin
  select id into v_item from public.kitchen_items where name = 'Salmon';
  select * into v_first from public.kitchen_send_request(
    'cccccccc-1000-4000-8000-000000000035', v_item, 4, 'bbbbbbbb-1000-4000-8000-000000000001');
  perform set_config('kitchen_fixture.salmon_item', v_item::text, false);
  perform set_config('kitchen_fixture.salmon_request', v_first.id::text, false);
end;
$$;
reset role;
update public.kitchen_items set active = false where id = current_setting('kitchen_fixture.salmon_item')::uuid;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000002', false);
set role authenticated;
do $$
declare
  v_item uuid := current_setting('kitchen_fixture.salmon_item')::uuid;
  v_replay public.kitchen_requests%rowtype;
  v_count integer;
begin
  select * into v_replay from public.kitchen_send_request(
    'cccccccc-1000-4000-8000-000000000035', v_item, 4, 'bbbbbbbb-1000-4000-8000-000000000001');
  if v_replay.id <> current_setting('kitchen_fixture.salmon_request')::uuid or v_replay.status <> 'queued' then
    raise exception 'FAIL: replay after item deactivation should return the stored row';
  end if;
  begin
    perform public.kitchen_send_request(
      'cccccccc-1000-4000-8000-000000000035', v_item, 5, 'bbbbbbbb-1000-4000-8000-000000000001');
    raise exception 'FAIL: mismatched replay must be a conflict';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' or sqlerrm <> 'client_key_conflict' then
        raise exception 'FAIL: expected client_key_conflict for mismatched replay, got % %', sqlstate, sqlerrm;
      end if;
  end;
  select count(*) into v_count from public.kitchen_requests
  where client_key = 'cccccccc-1000-4000-8000-000000000035';
  if v_count <> 1 then raise exception 'FAIL: replay produced % rows', v_count; end if;
  begin
    perform public.kitchen_send_request(
      null, v_item, 1, 'bbbbbbbb-1000-4000-8000-000000000001');
    raise exception 'FAIL: null client key must be refused';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '22023' or sqlerrm <> 'invalid_client_key' then
        raise exception 'FAIL: expected invalid_client_key, got % %', sqlstate, sqlerrm;
      end if;
  end;
  begin
    perform public.kitchen_update_request(v_replay.id, 'explode');
    raise exception 'FAIL: unknown action must be refused';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '22023' or sqlerrm <> 'unknown_action' then
        raise exception 'FAIL: expected unknown_action, got % %', sqlstate, sqlerrm;
      end if;
  end;
  raise notice 'ok: replay returns the stored row even after item deactivation; mismatch, null key and unknown action are refused';
end;
$$;
reset role;
update public.kitchen_items set active = true where id = current_setting('kitchen_fixture.salmon_item')::uuid;

-- kitchen_actor_identity is not a directory: only self, or a manager.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000002', false);
set role authenticated;
do $$
declare
  v_name text;
  v_tag text;
begin
  select display_name, tag into v_name, v_tag
  from public.kitchen_actor_identity('aaaaaaaa-1000-4000-8000-000000000002');
  if v_name <> 'Chef Login Display' or v_tag <> 'chef-handle' then
    raise exception 'FAIL: self identity wrong: % / %', v_name, v_tag;
  end if;
  begin
    perform public.kitchen_actor_identity('aaaaaaaa-1000-4000-8000-000000000001');
    raise exception 'FAIL: chef must not read another user''s identity';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlstate <> '42501' then raise exception 'FAIL: expected 42501 reading another identity, got % %', sqlstate, sqlerrm; end if;
  end;
  raise notice 'ok: kitchen_actor_identity refuses other users for non-managers';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000001', false);
set role authenticated;
do $$
declare
  v_name text;
begin
  select display_name into v_name from public.kitchen_actor_identity('aaaaaaaa-1000-4000-8000-000000000002');
  if v_name <> 'Chef Login Display' then raise exception 'FAIL: manager identity read wrong: %', v_name; end if;
  raise notice 'ok: managers may read any identity';
end;
$$;
reset role;

-- Items scoped to another location are hidden from non-managers.
insert into public.kitchen_items (name, unit, sort_order, location_id)
values ('Location Two Special', 'trays', 99, 'bbbbbbbb-1000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000003', false);
set role authenticated;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.kitchen_items where name = 'Location Two Special';
  if v_count <> 0 then raise exception 'FAIL: location-one display saw a location-two item'; end if;
  raise notice 'ok: item RLS hides other locations'' items from non-managers';
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1000-4000-8000-000000000001', false);
set role authenticated;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.kitchen_items where name = 'Location Two Special';
  if v_count <> 1 then raise exception 'FAIL: manager should see the location-two item'; end if;
  raise notice 'ok: managers see every location''s items';
end;
$$;
reset role;

do $$ begin raise notice 'PASS: kitchen requests fixture assertions all held'; end $$;

rollback;
