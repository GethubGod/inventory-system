-- Onboarding/auth phase: name + PIN/password sign-in credentials.
--
-- Design notes:
-- * Secrets are bcrypt-hashed at rest via pgcrypto (extensions.crypt +
--   gen_salt('bf')) — the same hashing the tips PINs use, so a later
--   one-credential-per-person unification is mechanical.
-- * Login names are stored normalized (normalize_login_name) and unique.
-- * Verification is service_role-only (called by the login-with-name edge
--   function) and rate limited per name and per client identifier with the
--   advisory-lock sliding-window pattern from the tips foundation.
--   tip_auth_attempts is scope-CHECK-constrained to its own scopes, so this
--   feature keeps its own small ledger.

-- ---------------------------------------------------------------------------
-- Normalization: case-insensitive, whitespace-collapsed login names.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_login_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))), '');
$$;

revoke all on function public.normalize_login_name(text) from public, anon;
grant execute on function public.normalize_login_name(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Credential storage.
-- ---------------------------------------------------------------------------
create table if not exists public.login_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login_name text not null,
  display_name text not null,
  credential_kind text not null check (credential_kind in ('pin', 'password')),
  secret_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create unique index if not exists login_identities_login_name_key
  on public.login_identities (login_name);

alter table public.login_identities enable row level security;

revoke all on table public.login_identities from anon, authenticated;
-- Metadata is readable (own row, or any row for managers) so the app can show
-- whether someone signs in with a PIN or a password. The hash never leaves SQL.
grant select (user_id, login_name, display_name, credential_kind, updated_at)
  on table public.login_identities to authenticated;

drop policy if exists login_identities_select_own_or_manager on public.login_identities;
create policy login_identities_select_own_or_manager
  on public.login_identities
  for select to authenticated
  using (auth.uid() = user_id or public.current_user_is_manager());

-- ---------------------------------------------------------------------------
-- Attempt ledger + sliding-window rate limit (mirrors tip_auth_attempt_allowed).
-- ---------------------------------------------------------------------------
create table if not exists public.login_auth_attempts (
  id bigint generated always as identity primary key,
  identifier_hash text not null,
  scope text not null check (scope in ('name', 'client')),
  success boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists login_auth_attempts_window_idx
  on public.login_auth_attempts (scope, identifier_hash, attempted_at);

alter table public.login_auth_attempts enable row level security;
revoke all on table public.login_auth_attempts from anon, authenticated;
-- No policies on purpose: only the service role (via the RPC below) touches it.

create or replace function public.login_auth_attempt_allowed(
  p_identifier_hash text,
  p_scope text,
  p_max_failures integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_failures integer;
begin
  -- Serialize concurrent attempts for this identifier so a burst of parallel
  -- requests cannot all read a below-limit count before any failure lands.
  perform pg_advisory_xact_lock(hashtext('login_auth:' || p_scope || ':' || p_identifier_hash));

  -- Opportunistic cleanup keeps the ledger small.
  delete from public.login_auth_attempts where attempted_at < now() - interval '2 days';

  select count(*) into recent_failures
  from public.login_auth_attempts
  where identifier_hash = p_identifier_hash
    and scope = p_scope
    and success = false
    and attempted_at > now() - interval '10 minutes';

  return recent_failures < p_max_failures;
end;
$$;

revoke all on function public.login_auth_attempt_allowed(text, text, integer) from public, anon, authenticated;
grant execute on function public.login_auth_attempt_allowed(text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Verification (service_role only; called by the login-with-name edge fn).
-- The 4-digit PIN space is small, so limits are tight: 6 failures per name
-- and 20 per client identifier in a 10-minute window.
-- ---------------------------------------------------------------------------
create or replace function public.verify_login_credential(
  p_login_name text,
  p_secret text,
  p_client_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text;
  v_name_hash text;
  v_client_hash text;
  v_user_id uuid;
  v_secret_hash text;
  v_email text;
  v_suspended boolean;
  v_ok boolean := false;
begin
  v_name := public.normalize_login_name(p_login_name);
  if v_name is null or p_secret is null or length(p_secret) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  v_name_hash := encode(extensions.digest(v_name, 'sha256'), 'hex');
  v_client_hash := coalesce(nullif(btrim(coalesce(p_client_hash, '')), ''), 'unknown');

  if not public.login_auth_attempt_allowed(v_name_hash, 'name', 6)
    or not public.login_auth_attempt_allowed(v_client_hash, 'client', 20) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  select li.user_id, li.secret_hash, au.email, coalesce(p.is_suspended, false)
    into v_user_id, v_secret_hash, v_email, v_suspended
  from public.login_identities li
  join auth.users au on au.id = li.user_id
  left join public.profiles p on p.id = li.user_id
  where li.login_name = v_name;

  if v_secret_hash is not null then
    v_ok := v_secret_hash = extensions.crypt(p_secret, v_secret_hash);
  end if;

  insert into public.login_auth_attempts (identifier_hash, scope, success)
  values (v_name_hash, 'name', v_ok), (v_client_hash, 'client', v_ok);

  if not v_ok then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  if v_suspended then
    return jsonb_build_object('ok', false, 'code', 'suspended');
  end if;

  if v_email is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  return jsonb_build_object('ok', true, 'user_id', v_user_id, 'email', v_email);
end;
$$;

revoke all on function public.verify_login_credential(text, text, text) from public, anon, authenticated;
grant execute on function public.verify_login_credential(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Self-service credential write (onboarding step 2 stores the PIN/password
-- after accept-invite created the account and a session exists).
-- ---------------------------------------------------------------------------
create or replace function public.set_my_login_credential(
  p_kind text,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_display text;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Sign in before setting a credential' using errcode = '42501';
  end if;

  if p_kind not in ('pin', 'password') then
    raise exception 'Credential kind must be pin or password' using errcode = '22023';
  end if;

  if p_kind = 'pin' and (p_secret is null or p_secret !~ '^[0-9]{4}$') then
    raise exception 'PIN must be exactly 4 digits' using errcode = '22023';
  end if;

  if p_kind = 'password' and (p_secret is null or length(p_secret) < 8) then
    raise exception 'Password must be at least 8 characters' using errcode = '22023';
  end if;

  select name into v_display from public.users where id = v_uid;
  v_name := public.normalize_login_name(v_display);
  if v_name is null then
    raise exception 'No name on file for this account' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.login_identities
    where login_name = v_name and user_id <> v_uid
  ) then
    raise exception 'This name is already used for sign-in. Ask the manager to adjust it.'
      using errcode = '23505';
  end if;

  insert into public.login_identities (
    user_id, login_name, display_name, credential_kind, secret_hash, updated_by
  )
  values (
    v_uid, v_name, btrim(v_display), p_kind,
    extensions.crypt(p_secret, extensions.gen_salt('bf')), v_uid
  )
  on conflict (user_id) do update
  set login_name = excluded.login_name,
      display_name = excluded.display_name,
      credential_kind = excluded.credential_kind,
      secret_hash = excluded.secret_hash,
      updated_at = now(),
      updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.set_my_login_credential(text, text) from public, anon;
grant execute on function public.set_my_login_credential(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Manager reset (the credential-recovery story). Always resets to a PIN.
-- ---------------------------------------------------------------------------
create or replace function public.reset_login_credential(
  p_user_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_display text;
  v_name text;
  v_suspended boolean;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can reset credentials' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits' using errcode = '22023';
  end if;

  select coalesce(p.is_suspended, false) into v_suspended
  from public.profiles p
  where p.id = p_user_id;

  if coalesce(v_suspended, false) then
    raise exception 'Cannot reset a suspended account' using errcode = '22023';
  end if;

  select name into v_display from public.users where id = p_user_id;
  v_name := public.normalize_login_name(v_display);
  if v_name is null then
    raise exception 'No name on file for this account' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.login_identities
    where login_name = v_name and user_id <> p_user_id
  ) then
    raise exception 'This name is already used for sign-in by someone else.'
      using errcode = '23505';
  end if;

  insert into public.login_identities (
    user_id, login_name, display_name, credential_kind, secret_hash, updated_by
  )
  values (
    p_user_id, v_name, btrim(v_display), 'pin',
    extensions.crypt(p_pin, extensions.gen_salt('bf')), auth.uid()
  )
  on conflict (user_id) do update
  set login_name = excluded.login_name,
      display_name = excluded.display_name,
      credential_kind = excluded.credential_kind,
      secret_hash = excluded.secret_hash,
      updated_at = now(),
      updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.reset_login_credential(uuid, text) from public, anon;
grant execute on function public.reset_login_credential(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Manager works-at change. public.users RLS only allows self-updates
-- (users_update_own), so the employee-detail screen goes through this RPC.
-- ---------------------------------------------------------------------------
create or replace function public.set_user_default_location(
  p_user_id uuid,
  p_location_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can change a user''s location' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;

  if p_location_id is not null and not exists (
    select 1 from public.locations where id = p_location_id and active
  ) then
    raise exception 'Unknown location' using errcode = '22023';
  end if;

  update public.users
  set default_location_id = p_location_id
  where id = p_user_id;

  if not found then
    raise exception 'User not found' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_user_default_location(uuid, uuid) from public, anon;
grant execute on function public.set_user_default_location(uuid, uuid) to authenticated, service_role;
