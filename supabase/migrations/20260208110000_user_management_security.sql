-- Manager user-management support: suspension + activity + secure delete prep

alter table public.profiles
  add column if not exists is_suspended boolean not null default false,
  add column if not exists last_active_at timestamp with time zone,
  add column if not exists last_order_at timestamp with time zone;

-- Backfill last_order_at from order history when available.
update public.profiles p
set last_order_at = o.last_order_at
from (
  select user_id, max(created_at) as last_order_at
  from public.orders
  group by user_id
) o
where p.id = o.user_id
  and (p.last_order_at is null or p.last_order_at < o.last_order_at);

-- Backfill last_active_at with the best known timestamp.
update public.profiles
set last_active_at = coalesce(last_active_at, last_order_at, created_at)
where last_active_at is null;

create or replace function public.sync_profile_last_order_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set
    last_order_at = greatest(coalesce(last_order_at, to_timestamp(0)), new.created_at),
    last_active_at = greatest(coalesce(last_active_at, to_timestamp(0)), new.created_at),
    updated_at = now()
  where id = new.user_id;

  return new;
end;
$$;

drop trigger if exists sync_profile_last_order_at_on_order on public.orders;
create trigger sync_profile_last_order_at_on_order
after insert on public.orders
for each row execute function public.sync_profile_last_order_at();

create or replace function public.current_user_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'manager'
  );
$$;

create or replace function public.enforce_profile_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role/admin contexts are allowed.
  if auth.uid() is null then
    return new;
  end if;

  -- Non-managers can only update their own profile.
  if auth.uid() <> old.id and not public.current_user_is_manager() then
    raise exception 'Not authorized to update this profile';
  end if;

  -- Non-managers cannot modify suspension state or role (except first-time onboarding role set).
  if auth.uid() = old.id and not public.current_user_is_manager() then
    if new.is_suspended is distinct from old.is_suspended then
      raise exception 'Cannot modify suspension state';
    end if;

    if new.role is distinct from old.role
       and not (old.role is null and old.profile_completed = false) then
      raise exception 'Cannot modify role';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_profile_security on public.profiles;
create trigger enforce_profile_security
before update on public.profiles
for each row execute function public.enforce_profile_security();

-- Helper used by delete-user edge function. Reassigns historical records before auth deletion.
create or replace function public.admin_prepare_user_delete(
  p_target_user_id uuid,
  p_replacement_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_target_user_id is null or p_replacement_user_id is null then
    raise exception 'Both target and replacement user ids are required';
  end if;

  if p_target_user_id = p_replacement_user_id then
    raise exception 'Target and replacement users must be different';
  end if;

  update public.orders
  set user_id = p_replacement_user_id
  where user_id = p_target_user_id;

  update public.stock_check_sessions
  set user_id = p_replacement_user_id
  where user_id = p_target_user_id;

  update public.stock_updates
  set updated_by = p_replacement_user_id
  where updated_by = p_target_user_id;

  update public.storage_areas
  set last_checked_by = null
  where last_checked_by = p_target_user_id;

  update public.area_items
  set last_updated_by = null
  where last_updated_by = p_target_user_id;

  update public.inventory_items
  set created_by = null
  where created_by = p_target_user_id;

  update public.org_settings
  set updated_by = null
  where updated_by = p_target_user_id;

end;
$$;

revoke all on function public.current_user_is_manager() from public, anon;
grant execute on function public.current_user_is_manager() to authenticated, service_role;

revoke all on function public.admin_prepare_user_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_prepare_user_delete(uuid, uuid) to service_role;
