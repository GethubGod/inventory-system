-- Make invited onboarding durable and let account deletion preserve invite
-- audit history without foreign-key failures.

-- A consumed invite remains consumed even if either related account is later
-- deleted. Keeping used_at while clearing used_by prevents reuse and avoids
-- retaining an auth-user foreign key solely for audit history.
alter table public.invites
  drop constraint if exists invites_created_by_fkey,
  drop constraint if exists invites_used_by_fkey,
  drop constraint if exists invites_check,
  alter column created_by drop not null;

alter table public.invites
  add constraint invites_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  add constraint invites_used_by_fkey
    foreign key (used_by) references auth.users(id) on delete set null,
  add constraint invites_used_state_check
    check (used_at is not null or used_by is null);

-- Service-role-only credential creation used by accept-invite. The credential
-- is installed before the invite is consumed, so every consumed onboarding
-- invite leaves behind an account that can sign in even if the response is
-- interrupted before the client receives its first session token.
create or replace function public.set_onboarding_login_credential(
  p_user_id uuid,
  p_kind text,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_display text;
  v_name text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;

  if p_kind not in ('pin', 'password') then
    raise exception 'Credential kind must be pin or password' using errcode = '22023';
  end if;

  if p_kind = 'pin' and (p_secret is null or p_secret !~ '^[0-9]{4}$') then
    raise exception 'PIN must be exactly 4 digits' using errcode = '22023';
  end if;

  if p_kind = 'password' and (
    p_secret is null or length(p_secret) < 8 or length(p_secret) > 256
  ) then
    raise exception 'Password must be between 8 and 256 characters' using errcode = '22023';
  end if;

  select name into v_display
  from public.users
  where id = p_user_id;

  v_name := public.normalize_login_name(v_display);
  if v_name is null then
    raise exception 'No name on file for this account' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.login_identities
    where login_name = v_name or user_id = p_user_id
  ) then
    raise exception 'This name is already used for sign-in. Ask the manager to adjust it.'
      using errcode = '23505';
  end if;

  insert into public.login_identities (
    user_id,
    login_name,
    display_name,
    credential_kind,
    secret_hash,
    updated_by
  )
  values (
    p_user_id,
    v_name,
    btrim(v_display),
    p_kind,
    extensions.crypt(p_secret, extensions.gen_salt('bf')),
    p_user_id
  );
end;
$$;

revoke all on function public.set_onboarding_login_credential(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_onboarding_login_credential(uuid, text, text)
  to service_role;
