-- Onboarding/auth phase deterministic checks.
-- Run only after scripts/local-db/verify-migrations.sh --keep:
--   docker exec -i <container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < scripts/local-db/onboarding_auth_fixture.sql
-- Expected output: fourteen "ok: ..." notices followed by
--   "PASS: onboarding auth fixture assertions all held" and a ROLLBACK.
-- Everything runs in one transaction and rolls back — the container stays clean.

\set ON_ERROR_STOP on

begin;

-- ── Seed: one employee, one manager, one second employee sharing a name ──────
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'onboarding-employee@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'onboarding-manager@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'onboarding-dupe@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'onboarding-atomic@example.test'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'onboarding-invite-creator@example.test');

insert into public.users (id, email, name, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'onboarding-employee@example.test', 'Nate Fixture', 'employee'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'onboarding-manager@example.test', 'Manager Fixture', 'manager'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'onboarding-dupe@example.test', '  NATE   fixture ', 'employee'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'onboarding-atomic@example.test', 'Atomic Invitee', 'employee'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'onboarding-invite-creator@example.test', 'Invite Creator', 'manager');

insert into public.profiles (id, email, full_name, role, profile_completed) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'onboarding-employee@example.test', 'Nate Fixture', 'employee', true),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'onboarding-manager@example.test', 'Manager Fixture', 'manager', true),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'onboarding-dupe@example.test', 'Nate Fixture', 'employee', true),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'onboarding-atomic@example.test', 'Atomic Invitee', 'employee', true),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'onboarding-invite-creator@example.test', 'Invite Creator', 'manager', true)
on conflict (id) do update
  set role = excluded.role, profile_completed = excluded.profile_completed;

insert into public.locations (id, name, short_code, active) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Fixture Sushi', 'S9', true),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Fixture Poki', 'P9', true);

-- ── 1. ordering_simple defaults ON for employees (explicit rows still win) ──
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', false);

do $$
declare
  v jsonb;
begin
  select jsonb_object_agg(module_key, enabled) into v
  from public.get_effective_modules('aaaaaaaa-0000-4000-8000-000000000001');

  if v->>'ordering_simple' <> 'true' then
    raise exception 'FAIL: employee ordering_simple default should be true, got %', v;
  end if;
  if v->>'ordering_advanced' <> 'false' or v->>'tips' <> 'false' or v->>'fulfillment' <> 'false' then
    raise exception 'FAIL: other employee defaults changed unexpectedly: %', v;
  end if;
  raise notice 'ok: get_effective_modules employee defaults (ordering_simple now true)';
end;
$$;

-- explicit override still wins over the new default
insert into public.user_modules (user_id, module_key, enabled, updated_by)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'ordering_simple', false,
        'aaaaaaaa-0000-4000-8000-000000000002');

do $$
declare
  v boolean;
begin
  select enabled into v
  from public.get_effective_modules('aaaaaaaa-0000-4000-8000-000000000001')
  where module_key = 'ordering_simple';
  if v then
    raise exception 'FAIL: explicit user_modules row should override the default';
  end if;
  raise notice 'ok: explicit user_modules override still wins';
end;
$$;

delete from public.user_modules
where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- ── 2. set_my_login_credential stores a bcrypt hash, kind pin ────────────────
select public.set_my_login_credential('pin', '4321');

do $$
declare
  r record;
begin
  select * into r from public.login_identities
  where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if r is null then raise exception 'FAIL: login identity row missing'; end if;
  if r.login_name <> 'nate fixture' then
    raise exception 'FAIL: login_name not normalized, got %', r.login_name;
  end if;
  if r.credential_kind <> 'pin' then raise exception 'FAIL: kind should be pin'; end if;
  if r.secret_hash = '4321' or r.secret_hash not like '$2a$%' then
    raise exception 'FAIL: secret not bcrypt-hashed: %', r.secret_hash;
  end if;
  raise notice 'ok: set_my_login_credential normalizes the name and bcrypt-hashes the PIN';
end;
$$;

-- bad inputs are rejected
do $$
begin
  begin
    perform public.set_my_login_credential('pin', '12345');
    raise exception 'FAIL: 5-digit PIN should be rejected';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.set_my_login_credential('password', 'short');
    raise exception 'FAIL: 5-char password should be rejected';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'ok: credential format validation rejects bad PIN/password';
end;
$$;

-- duplicate normalized name is refused for the second user
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000003', false);
do $$
begin
  begin
    perform public.set_my_login_credential('pin', '1111');
    raise exception 'FAIL: duplicate normalized login name should be refused';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'ok: case/whitespace-insensitive duplicate login name refused';
end;
$$;

-- ── 3. verify_login_credential: success, failure, rate limit, suspension ────
select set_config('request.jwt.claim.sub', '', false);  -- service context

do $$
declare
  v jsonb;
  i integer;
begin
  v := public.verify_login_credential('  NATE   Fixture ', '4321', 'client-a');
  if v->>'ok' <> 'true'
     or v->>'user_id' <> 'aaaaaaaa-0000-4000-8000-000000000001'
     or v->>'email' <> 'onboarding-employee@example.test' then
    raise exception 'FAIL: correct PIN should verify, got %', v;
  end if;

  v := public.verify_login_credential('Nate Fixture', '0000', 'client-a');
  if v->>'ok' <> 'false' or v->>'code' <> 'invalid' then
    raise exception 'FAIL: wrong PIN should be invalid, got %', v;
  end if;

  v := public.verify_login_credential('No Such Person', '4321', 'client-a');
  if v->>'ok' <> 'false' or v->>'code' <> 'invalid' then
    raise exception 'FAIL: unknown name should be invalid (indistinguishable), got %', v;
  end if;

  -- five more failures against the same name → sixth failure trips the 6/10min lock
  for i in 1..5 loop
    v := public.verify_login_credential('Nate Fixture', '9990', 'client-b');
  end loop;
  v := public.verify_login_credential('Nate Fixture', '4321', 'client-b');
  if v->>'ok' <> 'false' or v->>'code' <> 'rate_limited' then
    raise exception 'FAIL: 6 failures should rate-limit even a correct PIN, got %', v;
  end if;
  raise notice 'ok: verify_login_credential success/invalid/rate-limit behavior';
end;
$$;

-- clear the ledger, then suspension refuses even a correct credential
delete from public.login_auth_attempts;
update public.profiles set is_suspended = true
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

do $$
declare
  v jsonb;
begin
  v := public.verify_login_credential('Nate Fixture', '4321', 'client-a');
  if v->>'ok' <> 'false' or v->>'code' <> 'suspended' then
    raise exception 'FAIL: suspended account should be refused, got %', v;
  end if;
  raise notice 'ok: suspended accounts cannot sign in with a valid credential';
end;
$$;

update public.profiles set is_suspended = false
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- ── 4. reset_login_credential: manager-only, suspended refused, PIN rotates ─
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', false);
do $$
begin
  begin
    perform public.reset_login_credential('aaaaaaaa-0000-4000-8000-000000000001', '9999');
    raise exception 'FAIL: non-manager reset should be refused';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'ok: reset_login_credential refuses non-managers';
end;
$$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', false);
select public.reset_login_credential('aaaaaaaa-0000-4000-8000-000000000001', '9999');

update public.profiles set is_suspended = true
where id = 'aaaaaaaa-0000-4000-8000-000000000003';

do $$
declare
  v jsonb;
begin
  begin
    perform public.reset_login_credential('aaaaaaaa-0000-4000-8000-000000000003', '2222');
    raise exception 'FAIL: reset for a suspended user should be refused';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '', false);
  v := public.verify_login_credential('Nate Fixture', '9999', 'client-c');
  if v->>'ok' <> 'true' then
    raise exception 'FAIL: reset PIN should verify, got %', v;
  end if;
  v := public.verify_login_credential('Nate Fixture', '4321', 'client-c');
  if v->>'ok' <> 'false' then
    raise exception 'FAIL: old PIN should stop working after reset, got %', v;
  end if;
  raise notice 'ok: manager reset rotates the PIN and refuses suspended targets';
end;
$$;

-- ── 5. employee invite defaults row + manager-gated writes ──────────────────
do $$
declare
  v jsonb;
begin
  select value into v from public.app_config where key = 'employee_invite_module_defaults';
  if v is null or v->>'ordering_simple' <> 'true' then
    raise exception 'FAIL: seeded defaults row missing or wrong: %', v;
  end if;
  raise notice 'ok: employee_invite_module_defaults seeded with ordering_simple true';
end;
$$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', false);
select public.set_employee_invite_defaults(
  '{"ordering_simple": true, "ordering_advanced": true, "stock_check": false, "tips": false}'::jsonb
);

do $$
declare
  v jsonb;
begin
  select value into v from public.app_config where key = 'employee_invite_module_defaults';
  if v->>'ordering_advanced' <> 'true' or v->>'stock_check' <> 'false' then
    raise exception 'FAIL: defaults write did not land: %', v;
  end if;

  begin
    perform public.set_employee_invite_defaults('{"fulfillment": true}'::jsonb);
    raise exception 'FAIL: fulfillment is not an employee-manageable default';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.set_employee_invite_defaults('{"ordering_simple": "yes"}'::jsonb);
    raise exception 'FAIL: non-boolean default value should be rejected';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', false);
  begin
    perform public.set_employee_invite_defaults('{"ordering_simple": true}'::jsonb);
    raise exception 'FAIL: employees must not write invite defaults';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'ok: set_employee_invite_defaults validates payload and requires manager';
end;
$$;

-- ── 6. set_user_default_location: manager-gated works-at change ─────────────
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', false);
select public.set_user_default_location(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000001'
);

do $$
declare
  v uuid;
begin
  select default_location_id into v from public.users
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if v is distinct from 'bbbbbbbb-0000-4000-8000-000000000001' then
    raise exception 'FAIL: works-at write did not land, got %', v;
  end if;

  -- 'both' → null
  perform public.set_user_default_location('aaaaaaaa-0000-4000-8000-000000000001', null);
  select default_location_id into v from public.users
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
  if v is not null then
    raise exception 'FAIL: null location (both) should clear the column';
  end if;

  begin
    perform public.set_user_default_location(
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-00000000dead'
    );
    raise exception 'FAIL: unknown location should be rejected';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', false);
  begin
    perform public.set_user_default_location(
      'aaaaaaaa-0000-4000-8000-000000000003',
      'bbbbbbbb-0000-4000-8000-000000000002'
    );
    raise exception 'FAIL: employees must not change works-at';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'ok: set_user_default_location manager gate, both->null, unknown location';
end;
$$;

-- ── 7. onboarding credential is installed before invite consumption ────────
select set_config('request.jwt.claim.sub', '', false);
select public.set_onboarding_login_credential(
  'aaaaaaaa-0000-4000-8000-000000000004',
  'password',
  'durable-password'
);

do $$
declare
  r record;
begin
  select * into r from public.login_identities
  where user_id = 'aaaaaaaa-0000-4000-8000-000000000004';
  if r.login_name <> 'atomic invitee' or r.credential_kind <> 'password' then
    raise exception 'FAIL: onboarding credential metadata is wrong: %', r;
  end if;
  if r.secret_hash = 'durable-password'
     or r.secret_hash <> extensions.crypt('durable-password', r.secret_hash) then
    raise exception 'FAIL: onboarding password was not hashed correctly';
  end if;
  raise notice 'ok: service-only onboarding credential is durable and bcrypt-hashed';
end;
$$;

-- ── 8. invite audit rows do not block account deletion ─────────────────────
insert into public.invites (
  token, invited_name, role, expires_at, created_by, used_at, used_by
) values (
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'Atomic Invitee',
  'employee',
  now() + interval '1 day',
  'aaaaaaaa-0000-4000-8000-000000000005',
  now(),
  'aaaaaaaa-0000-4000-8000-000000000004'
);

delete from auth.users
where id in (
  'aaaaaaaa-0000-4000-8000-000000000004',
  'aaaaaaaa-0000-4000-8000-000000000005'
);

do $$
declare
  r record;
begin
  select used_at, used_by, created_by into r
  from public.invites
  where token = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  if r.used_at is null or r.used_by is not null or r.created_by is not null then
    raise exception 'FAIL: invite audit row did not detach deleted users: %', r;
  end if;
  raise notice 'ok: account deletion preserves consumed state and clears invite user references';
end;
$$;

do $$ begin raise notice 'PASS: onboarding auth fixture assertions all held'; end $$;

rollback;
