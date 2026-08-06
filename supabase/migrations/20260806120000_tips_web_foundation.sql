-- End-of-day tip entry (web app) foundation.
--
-- Access model:
--   * Employee entry devices NEVER talk to these tables directly. They hold an
--     opaque session token (minted by the tip-entry-auth edge function after a
--     QR/NFC token or PIN was validated server-side) and all reads/writes go
--     through service-role edge functions that scope every query to the
--     session's location. The anon/authenticated roles get no useful access:
--     RLS is enabled everywhere and the only policies are manager-only.
--   * Managers use real Supabase auth; public.current_user_is_manager() gates
--     their policies, matching the rest of the schema.
--   * Entry tokens and PINs are stored hashed (sha256 for high-entropy tokens,
--     bcrypt via pgcrypto crypt() for 4-digit PINs, matching org_settings).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Roster of tip-eligible staff. Deliberately separate from profiles/users:
-- most tip-splitting staff have no app account. location_id null = works at
-- both locations.
-- ---------------------------------------------------------------------------
create table if not exists public.tip_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  location_id uuid references public.locations(id) on delete set null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- One row per (business date, location, meal period). Existing rows are edited
-- in place; the unique constraint is what the save upsert targets.
-- Per-person share is derived as (cash + card) / split_count rounded to cents
-- (round half away from zero); it is intentionally NOT stored.
-- ---------------------------------------------------------------------------
create table if not exists public.tip_entries (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  meal_period text not null check (meal_period in ('lunch', 'dinner')),
  cash_amount numeric(10,2) not null default 0 check (cash_amount >= 0),
  card_amount numeric(10,2) not null default 0 check (card_amount >= 0),
  split_count integer not null default 1 check (split_count >= 1),
  entry_method text not null check (entry_method in ('typed', 'voice')),
  voice_variant text check (voice_variant in ('waveform', 'live_transcript')),
  corrections_count integer not null default 0 check (corrections_count >= 0),
  entered_by uuid references public.tip_employees(id) on delete set null,
  -- Phase 2 anomaly flagging: saved despite an outlier warning.
  flagged_anomaly boolean not null default false,
  anomaly_reason text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (business_date, location_id, meal_period)
);

create index if not exists tip_entries_slot_history_idx
  on public.tip_entries (location_id, meal_period, business_date desc);

create table if not exists public.tip_entry_people (
  tip_entry_id uuid not null references public.tip_entries(id) on delete cascade,
  tip_employee_id uuid not null references public.tip_employees(id) on delete cascade,
  primary key (tip_entry_id, tip_employee_id)
);

create index if not exists tip_entry_people_employee_idx
  on public.tip_entry_people (tip_employee_id);

-- ---------------------------------------------------------------------------
-- Per-location entry credentials. entry_token_hash backs the QR/NFC URL
-- (?t=<token>), pin_hash backs the keypad fallback. Rotation timestamps let
-- the dashboard show when each was last rotated.
-- ---------------------------------------------------------------------------
create table if not exists public.tip_location_access (
  location_id uuid primary key references public.locations(id) on delete cascade,
  entry_token_hash text,
  token_rotated_at timestamp with time zone,
  pin_hash text,
  pin_rotated_at timestamp with time zone,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- Long-lived device sessions for tip entry. token_hash is sha256 of the
-- opaque token held by the device (localStorage). closer_id is attribution
-- only ("Who's closing?"), never a security boundary.
-- ---------------------------------------------------------------------------
create table if not exists public.tip_entry_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  location_id uuid not null references public.locations(id) on delete cascade,
  closer_id uuid references public.tip_employees(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default now() + interval '180 days',
  revoked boolean not null default false
);

-- Rate limiting ledger for token/PIN validation attempts.
create table if not exists public.tip_auth_attempts (
  id bigint generated always as identity primary key,
  identifier_hash text not null,
  scope text not null default 'token' check (scope in ('token', 'pin')),
  location_id uuid,
  success boolean not null default false,
  attempted_at timestamp with time zone not null default now()
);

create index if not exists tip_auth_attempts_ident_idx
  on public.tip_auth_attempts (identifier_hash, attempted_at desc);
create index if not exists tip_auth_attempts_location_idx
  on public.tip_auth_attempts (location_id, attempted_at desc);

-- updated_at maintenance
create or replace function public.tip_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tip_employees_set_updated_at on public.tip_employees;
create trigger tip_employees_set_updated_at
before update on public.tip_employees
for each row execute function public.tip_set_updated_at();

drop trigger if exists tip_entries_set_updated_at on public.tip_entries;
create trigger tip_entries_set_updated_at
before update on public.tip_entries
for each row execute function public.tip_set_updated_at();

drop trigger if exists tip_location_access_set_updated_at on public.tip_location_access;
create trigger tip_location_access_set_updated_at
before update on public.tip_location_access
for each row execute function public.tip_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: managers only. Entry devices go through service-role edge functions.
-- ---------------------------------------------------------------------------
alter table public.tip_employees enable row level security;
alter table public.tip_entries enable row level security;
alter table public.tip_entry_people enable row level security;
alter table public.tip_location_access enable row level security;
alter table public.tip_entry_sessions enable row level security;
alter table public.tip_auth_attempts enable row level security;

revoke all on table public.tip_employees from anon, authenticated;
revoke all on table public.tip_entries from anon, authenticated;
revoke all on table public.tip_entry_people from anon, authenticated;
revoke all on table public.tip_location_access from anon, authenticated;
revoke all on table public.tip_entry_sessions from anon, authenticated;
revoke all on table public.tip_auth_attempts from anon, authenticated;

grant select, insert, update, delete on table public.tip_employees to authenticated;
grant select, insert, update, delete on table public.tip_entries to authenticated;
grant select, insert, update, delete on table public.tip_entry_people to authenticated;
-- Managers may see rotation metadata but never the stored hashes.
grant select (location_id, token_rotated_at, pin_rotated_at, updated_at)
  on table public.tip_location_access to authenticated;

drop policy if exists tip_employees_manager_all on public.tip_employees;
create policy tip_employees_manager_all on public.tip_employees
  for all to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

drop policy if exists tip_entries_manager_all on public.tip_entries;
create policy tip_entries_manager_all on public.tip_entries
  for all to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

drop policy if exists tip_entry_people_manager_all on public.tip_entry_people;
create policy tip_entry_people_manager_all on public.tip_entry_people
  for all to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

drop policy if exists tip_location_access_manager_read on public.tip_location_access;
create policy tip_location_access_manager_read on public.tip_location_access
  for select to authenticated
  using (public.current_user_is_manager());

-- tip_entry_sessions / tip_auth_attempts: no policies on purpose.
-- Only the service role (edge functions) touches them.

-- ---------------------------------------------------------------------------
-- Validation RPCs (service_role only; called by edge functions).
-- ---------------------------------------------------------------------------

-- Sliding-window rate limit helper. Returns true when the caller is allowed
-- to attempt right now.
create or replace function public.tip_auth_attempt_allowed(
  p_identifier_hash text,
  p_scope text,
  p_location_id uuid,
  p_max_per_identifier integer,
  p_max_per_location integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  identifier_failures integer;
  location_failures integer;
begin
  -- Opportunistic cleanup keeps the ledger small.
  delete from public.tip_auth_attempts where attempted_at < now() - interval '2 days';

  select count(*) into identifier_failures
  from public.tip_auth_attempts
  where identifier_hash = p_identifier_hash
    and scope = p_scope
    and success = false
    and attempted_at > now() - interval '10 minutes';

  if identifier_failures >= p_max_per_identifier then
    return false;
  end if;

  if p_location_id is not null then
    select count(*) into location_failures
    from public.tip_auth_attempts
    where location_id = p_location_id
      and scope = p_scope
      and success = false
      and attempted_at > now() - interval '10 minutes';
    if location_failures >= p_max_per_location then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- Validate a QR/NFC entry token. Rate limited per caller identifier.
create or replace function public.tip_validate_entry_token(
  p_token text,
  p_identifier_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_location_id uuid;
  v_location_name text;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if not public.tip_auth_attempt_allowed(p_identifier_hash, 'token', null, 20, 0) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select a.location_id, l.name
    into v_location_id, v_location_name
  from public.tip_location_access a
  join public.locations l on l.id = a.location_id
  where a.entry_token_hash = v_hash;

  insert into public.tip_auth_attempts (identifier_hash, scope, location_id, success)
  values (p_identifier_hash, 'token', v_location_id, v_location_id is not null);

  if v_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  return jsonb_build_object(
    'ok', true,
    'location_id', v_location_id,
    'location_name', v_location_name
  );
end;
$$;

-- Validate a per-location PIN. Tighter limits: 4-digit space is small.
create or replace function public.tip_validate_entry_pin(
  p_location_id uuid,
  p_pin text,
  p_identifier_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pin_hash text;
  v_location_name text;
  v_ok boolean := false;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or p_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if not public.tip_auth_attempt_allowed(p_identifier_hash, 'pin', p_location_id, 6, 30) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  select a.pin_hash, l.name
    into v_pin_hash, v_location_name
  from public.tip_location_access a
  join public.locations l on l.id = a.location_id
  where a.location_id = p_location_id;

  if v_pin_hash is not null then
    v_ok := v_pin_hash = extensions.crypt(p_pin, v_pin_hash);
  end if;

  insert into public.tip_auth_attempts (identifier_hash, scope, location_id, success)
  values (p_identifier_hash, 'pin', p_location_id, v_ok);

  if not v_ok then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  return jsonb_build_object(
    'ok', true,
    'location_id', p_location_id,
    'location_name', v_location_name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Manager rotation RPCs. Callable with a manager's authenticated session;
-- each returns the new plaintext exactly once (only the hash is stored).
-- ---------------------------------------------------------------------------
create or replace function public.tip_rotate_entry_token(p_location_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can rotate entry tokens';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id) then
    raise exception 'Unknown location';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');

  insert into public.tip_location_access (location_id, entry_token_hash, token_rotated_at, updated_by)
  values (p_location_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now(), auth.uid())
  on conflict (location_id) do update
    set entry_token_hash = excluded.entry_token_hash,
        token_rotated_at = excluded.token_rotated_at,
        updated_by = excluded.updated_by;

  return v_token;
end;
$$;

create or replace function public.tip_rotate_entry_pin(
  p_location_id uuid,
  p_pin text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pin text;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can rotate entry PINs';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id) then
    raise exception 'Unknown location';
  end if;

  if p_pin is not null then
    if p_pin !~ '^[0-9]{4}$' then
      raise exception 'PIN must be exactly 4 digits';
    end if;
    v_pin := p_pin;
  else
    v_pin := lpad(floor(random() * 10000)::int::text, 4, '0');
  end if;

  insert into public.tip_location_access (location_id, pin_hash, pin_rotated_at, updated_by)
  values (p_location_id, extensions.crypt(v_pin, extensions.gen_salt('bf')), now(), auth.uid())
  on conflict (location_id) do update
    set pin_hash = excluded.pin_hash,
        pin_rotated_at = excluded.pin_rotated_at,
        updated_by = excluded.updated_by;

  return v_pin;
end;
$$;

revoke all on function public.tip_auth_attempt_allowed(text, text, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.tip_validate_entry_token(text, text) from public, anon, authenticated;
revoke all on function public.tip_validate_entry_pin(uuid, text, text) from public, anon, authenticated;
revoke all on function public.tip_rotate_entry_token(uuid) from public, anon;
revoke all on function public.tip_rotate_entry_pin(uuid, text) from public, anon;

grant execute on function public.tip_validate_entry_token(text, text) to service_role;
grant execute on function public.tip_validate_entry_pin(uuid, text, text) to service_role;
grant execute on function public.tip_rotate_entry_token(uuid) to authenticated, service_role;
grant execute on function public.tip_rotate_entry_pin(uuid, text) to authenticated, service_role;
