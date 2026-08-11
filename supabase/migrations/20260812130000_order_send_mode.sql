-- Phase 5b: manager-configured per-employee checklist send mode.
--
-- Profiles are the canonical role/preferences record. public.users remains the
-- legacy identity/default-location record, so this preference deliberately
-- lives on public.profiles.

alter table public.profiles
  add column if not exists order_send_mode text not null default 'review';

alter table public.profiles
  drop constraint if exists profiles_order_send_mode_check;

alter table public.profiles
  add constraint profiles_order_send_mode_check
  check (order_send_mode in ('direct', 'review'));

-- The profile trigger previously allowed cross-user managers to change only
-- suspension fields. Preserve that guard and allow the Phase 5b setting for
-- employee profiles; employees still cannot alter their own send mode.
create or replace function public.enforce_profile_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_manager boolean := public.current_user_is_manager();
  v_old_without_manager_fields jsonb;
  v_new_without_manager_fields jsonb;
begin
  -- Service role/admin contexts are allowed.
  if auth.uid() is null then
    if new.is_suspended then
      new.suspended_at := coalesce(new.suspended_at, now());
      new.suspended_by := coalesce(new.suspended_by, old.suspended_by);
    else
      new.suspended_at := null;
      new.suspended_by := null;
    end if;

    return new;
  end if;

  -- Cross-user updates are manager-only, apply only to employees, and are
  -- limited to suspension state plus the manager-owned send preference.
  if auth.uid() <> old.id then
    if not v_is_manager then
      raise exception 'Not authorized to update this profile';
    end if;

    if old.role is distinct from 'employee' then
      raise exception 'Managers can only change employee profile settings';
    end if;

    v_old_without_manager_fields :=
      to_jsonb(old) - array[
        'is_suspended',
        'suspended_at',
        'suspended_by',
        'order_send_mode',
        'updated_at'
      ];
    v_new_without_manager_fields :=
      to_jsonb(new) - array[
        'is_suspended',
        'suspended_at',
        'suspended_by',
        'order_send_mode',
        'updated_at'
      ];

    if v_old_without_manager_fields is distinct from v_new_without_manager_fields then
      raise exception 'Only suspension and order send mode fields can be updated';
    end if;

    if new.is_suspended then
      new.suspended_at := now();
      new.suspended_by := auth.uid();
    else
      new.suspended_at := null;
      new.suspended_by := null;
    end if;

    return new;
  end if;

  -- Employees may read their own profile, but direct-vs-review is a manager
  -- setting. Existing own-profile policies continue to protect all other
  -- editable profile preferences.
  if new.order_send_mode is distinct from old.order_send_mode then
    raise exception 'Only managers can modify order send mode';
  end if;

  -- Own profile updates cannot alter suspension state.
  if new.is_suspended is distinct from old.is_suspended
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_by is distinct from old.suspended_by then
    raise exception 'Cannot modify suspension state';
  end if;

  -- Own profile role is immutable after onboarding.
  if new.role is distinct from old.role
     and not (old.role is null and old.profile_completed = false) then
    raise exception 'Cannot modify role';
  end if;

  return new;
end;
$$;

-- Keep the existing owner-read/manager-read policy. Rename the manager update
-- policy to reflect its now-authorized scope while retaining its exact RLS
-- predicate: a manager can write employee profiles, and the trigger above
-- limits the writable columns.
drop policy if exists "profiles_update_manager_suspend_employee" on public.profiles;
drop policy if exists "profiles_update_manager_employee_settings" on public.profiles;
create policy "profiles_update_manager_employee_settings"
on public.profiles
for update
to authenticated
using (
  public.current_user_is_manager()
  and id <> auth.uid()
  and role = 'employee'
)
with check (
  public.current_user_is_manager()
  and id <> auth.uid()
  and role = 'employee'
);

grant select, update on public.profiles to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
