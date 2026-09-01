-- Kitchen requests: per-user module access, manager-managed items, and a
-- location-scoped request queue with server-owned status transitions.

-- ---------------------------------------------------------------------------
-- Module keys and role defaults.
-- ---------------------------------------------------------------------------
alter table public.user_modules
  drop constraint if exists user_modules_module_key_check;

alter table public.user_modules
  add constraint user_modules_module_key_check check (
    module_key in (
      'ordering_simple',
      'ordering_advanced',
      'stock_check',
      'tips',
      'fulfillment',
      'kitchen_requests',
      'kitchen_display'
    )
  );

create or replace function public.get_effective_modules(p_user_id uuid)
returns table(module_key text, enabled boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_is_manager boolean;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;

  -- This function reads through RLS as its owner, so authorize the caller
  -- explicitly before exposing another user's effective module set.
  if auth.uid() is distinct from p_user_id
    and not public.current_user_is_manager() then
    raise exception 'not authorized to read these modules' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role = 'manager'
  )
  into target_is_manager;

  return query
  select defaults.module_key, coalesce(overrides.enabled, defaults.enabled)
  from (
    values
      ('ordering_simple'::text, true),
      ('ordering_advanced'::text, target_is_manager),
      ('stock_check'::text, true),
      ('tips'::text, target_is_manager),
      ('fulfillment'::text, target_is_manager),
      ('kitchen_requests'::text, target_is_manager),
      ('kitchen_display'::text, target_is_manager)
  ) as defaults(module_key, enabled)
  left join public.user_modules as overrides
    on overrides.user_id = p_user_id
   and overrides.module_key = defaults.module_key
  order by case defaults.module_key
    when 'ordering_simple' then 1
    when 'ordering_advanced' then 2
    when 'stock_check' then 3
    when 'tips' then 4
    when 'fulfillment' then 5
    when 'kitchen_requests' then 6
    when 'kitchen_display' then 7
  end;
end;
$$;

revoke all on function public.get_effective_modules(uuid) from public, anon;
grant execute on function public.get_effective_modules(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Items and requests.
-- ---------------------------------------------------------------------------
create table if not exists public.kitchen_items (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  unit text not null check (length(btrim(unit)) between 1 and 24),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists kitchen_items_active_name_scope_key
  on public.kitchen_items (
    lower(btrim(name)),
    coalesce(location_id, '00000000-0000-0000-0000-000000000000')
  )
  where active;

create table if not exists public.kitchen_requests (
  id uuid primary key default gen_random_uuid(),
  client_key uuid not null unique,
  location_id uuid not null references public.locations(id),
  item_id uuid not null references public.kitchen_items(id) on delete restrict,
  item_name text not null,
  unit text not null,
  quantity integer not null check (quantity between 1 and 999),
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_name text not null,
  requested_by_tag text not null,
  status text not null default 'queued'
    check (status in ('queued', 'ready', 'cleared', 'cancelled')),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  ready_by uuid references auth.users(id) on delete set null,
  ready_by_name text,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists kitchen_requests_location_open_idx
  on public.kitchen_requests (location_id, status, created_at);

create index if not exists kitchen_requests_requester_idx
  on public.kitchen_requests (requested_by, created_at desc);

alter table public.kitchen_requests replica identity full;

drop trigger if exists set_kitchen_items_updated_at on public.kitchen_items;
create trigger set_kitchen_items_updated_at
before update on public.kitchen_items
for each row execute function public.set_updated_at();

drop trigger if exists set_kitchen_requests_updated_at on public.kitchen_requests;
create trigger set_kitchen_requests_updated_at
before update on public.kitchen_requests
for each row execute function public.set_updated_at();

insert into public.kitchen_items (name, unit, sort_order)
select seed.name, seed.unit, seed.sort_order
from (
  values
    ('Fried Shrimp'::text, 'pieces'::text, 1),
    ('Sushi Rice'::text, 'tubs'::text, 2),
    ('Crab Mix'::text, 'trays'::text, 3),
    ('Unagi'::text, 'portions'::text, 4),
    ('Tempura Batter'::text, 'batches'::text, 5),
    ('Salmon'::text, 'filets'::text, 6)
) as seed(name, unit, sort_order)
where not exists (select 1 from public.kitchen_items);

-- ---------------------------------------------------------------------------
-- Access and identity helpers.
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_module_enabled(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_enabled boolean;
begin
  if v_uid is null or exists (
    select 1
    from public.profiles p
    where p.id = v_uid
      and coalesce(p.is_suspended, false)
  ) then
    return false;
  end if;

  select modules.enabled
  into v_enabled
  from public.get_effective_modules(v_uid) as modules
  where modules.module_key = p_key;

  return coalesce(v_enabled, false);
end;
$$;

create or replace function public.kitchen_user_location_ok(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.locations l on l.id = p_location_id
    where u.id = auth.uid()
      and l.active
      and (u.default_location_id is null or u.default_location_id = p_location_id)
  );
$$;

create or replace function public.kitchen_actor_identity(
  p_user_id uuid,
  out display_name text,
  out tag text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      nullif(btrim(li.display_name), ''),
      nullif(btrim(p.full_name), ''),
      nullif(btrim(u.name), ''),
      nullif(btrim(split_part(au.email, '@', 1)), ''),
      'Unknown'
    ),
    coalesce(
      li.login_name,
      public.normalize_login_name(u.name),
      public.normalize_login_name(p.full_name),
      split_part(lower(au.email), '@', 1),
      'unknown'
    )
  from (values (1)) as singleton(n)
  left join auth.users au on au.id = p_user_id
  left join public.login_identities li on li.user_id = p_user_id
  left join public.profiles p on p.id = p_user_id
  left join public.users u on u.id = p_user_id;
$$;

revoke all on function public.kitchen_module_enabled(text) from public, anon;
grant execute on function public.kitchen_module_enabled(text) to authenticated, service_role;

revoke all on function public.kitchen_user_location_ok(uuid) from public, anon;
grant execute on function public.kitchen_user_location_ok(uuid) to authenticated, service_role;

revoke all on function public.kitchen_actor_identity(uuid) from public, anon;
grant execute on function public.kitchen_actor_identity(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Request RPCs.
-- ---------------------------------------------------------------------------
create or replace function public.kitchen_send_request(
  p_client_key uuid,
  p_item_id uuid,
  p_quantity integer,
  p_location_id uuid
)
returns public.kitchen_requests
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.kitchen_items%rowtype;
  v_request public.kitchen_requests%rowtype;
  v_actor record;
begin
  if v_uid is null then
    raise exception '%', 'not_signed_in'
      using errcode = '42501', hint = 'Sign in before sending a kitchen request.';
  end if;

  if not public.kitchen_module_enabled('kitchen_requests') then
    raise exception '%', 'kitchen_requests_disabled'
      using errcode = '42501', hint = 'Kitchen requests are not enabled for this user.';
  end if;

  if not public.kitchen_user_location_ok(p_location_id) then
    raise exception '%', 'location_not_allowed'
      using errcode = '42501', hint = 'This user cannot access the selected location.';
  end if;

  select *
  into v_item
  from public.kitchen_items
  where id = p_item_id
    and active
    and (location_id is null or location_id = p_location_id);

  if not found then
    raise exception '%', 'item_unavailable'
      using errcode = '22023', hint = 'The selected kitchen item is unavailable at this location.';
  end if;

  if p_quantity is null or p_quantity not between 1 and 999 then
    raise exception '%', 'invalid_quantity'
      using errcode = '22023', hint = 'Quantity must be between 1 and 999.';
  end if;

  select *
  into v_request
  from public.kitchen_requests
  where client_key = p_client_key;

  if found then
    if v_request.requested_by = v_uid then
      return v_request;
    end if;

    raise exception '%', 'client_key_conflict'
      using errcode = '42501', hint = 'This client key belongs to another user.';
  end if;

  select * into v_actor from public.kitchen_actor_identity(v_uid);

  begin
    insert into public.kitchen_requests (
      client_key,
      location_id,
      item_id,
      item_name,
      unit,
      quantity,
      requested_by,
      requested_by_name,
      requested_by_tag
    )
    values (
      p_client_key,
      p_location_id,
      v_item.id,
      v_item.name,
      v_item.unit,
      p_quantity,
      v_uid,
      v_actor.display_name,
      v_actor.tag
    )
    returning * into v_request;
  exception
    when unique_violation then
      select *
      into v_request
      from public.kitchen_requests
      where client_key = p_client_key;

      if not found then
        raise;
      end if;

      if v_request.requested_by = v_uid then
        return v_request;
      end if;

      raise exception '%', 'client_key_conflict'
        using errcode = '42501', hint = 'This client key belongs to another user.';
  end;

  return v_request;
end;
$$;

create or replace function public.kitchen_update_request(
  p_request_id uuid,
  p_action text
)
returns public.kitchen_requests
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.kitchen_requests%rowtype;
  v_actor record;
begin
  select *
  into v_request
  from public.kitchen_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception '%', 'request_not_found'
      using errcode = 'P0002', hint = 'The kitchen request was not found.';
  end if;

  if not public.kitchen_user_location_ok(v_request.location_id) then
    raise exception '%', 'location_not_allowed'
      using errcode = '42501', hint = 'This user cannot access the request location.';
  end if;

  if p_action = 'ready' then
    if not public.kitchen_module_enabled('kitchen_display') then
      raise exception '%', 'not_allowed'
        using errcode = '42501', hint = 'Kitchen display access is required for this action.';
    end if;

    if v_request.status = 'ready' then
      return v_request;
    end if;

    if v_request.status <> 'queued' then
      raise exception '%', 'invalid_transition'
        using errcode = '22023', hint = format('The request is currently %s.', v_request.status);
    end if;

    select * into v_actor from public.kitchen_actor_identity(v_uid);

    update public.kitchen_requests
    set status = 'ready',
        ready_at = now(),
        ready_by = v_uid,
        ready_by_name = v_actor.display_name
    where id = v_request.id
    returning * into v_request;

    return v_request;
  end if;

  if p_action = 'undo_ready' then
    if not public.kitchen_module_enabled('kitchen_display') then
      raise exception '%', 'not_allowed'
        using errcode = '42501', hint = 'Kitchen display access is required for this action.';
    end if;

    if v_request.status = 'queued' then
      return v_request;
    end if;

    if v_request.status <> 'ready' then
      raise exception '%', 'invalid_transition'
        using errcode = '22023', hint = format('The request is currently %s.', v_request.status);
    end if;

    update public.kitchen_requests
    set status = 'queued',
        ready_at = null,
        ready_by = null,
        ready_by_name = null
    where id = v_request.id
    returning * into v_request;

    return v_request;
  end if;

  if p_action = 'cancel' then
    if v_request.requested_by is distinct from v_uid
      and not public.current_user_is_manager() then
      raise exception '%', 'not_allowed'
        using errcode = '42501', hint = 'Only the requester or a manager can cancel this request.';
    end if;

    if v_request.status = 'cancelled' then
      return v_request;
    end if;

    if v_request.status <> 'queued' then
      raise exception '%', 'invalid_transition'
        using errcode = '22023', hint = format('The request is currently %s.', v_request.status);
    end if;

    update public.kitchen_requests
    set status = 'cancelled',
        closed_at = now()
    where id = v_request.id
    returning * into v_request;

    return v_request;
  end if;

  if p_action = 'clear' then
    if v_request.requested_by is distinct from v_uid
      and not public.current_user_is_manager() then
      raise exception '%', 'not_allowed'
        using errcode = '42501', hint = 'Only the requester or a manager can clear this request.';
    end if;

    if v_request.status = 'cleared' then
      return v_request;
    end if;

    if v_request.status <> 'ready' then
      raise exception '%', 'invalid_transition'
        using errcode = '22023', hint = format('The request is currently %s.', v_request.status);
    end if;

    update public.kitchen_requests
    set status = 'cleared',
        closed_at = now()
    where id = v_request.id
    returning * into v_request;

    return v_request;
  end if;

  raise exception '%', 'invalid_transition'
    using errcode = '22023', hint = format('The request is currently %s.', v_request.status);
end;
$$;

revoke all on function public.kitchen_send_request(uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.kitchen_send_request(uuid, uuid, integer, uuid)
  to authenticated, service_role;

revoke all on function public.kitchen_update_request(uuid, text)
  from public, anon;
grant execute on function public.kitchen_update_request(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row-level access and table grants.
-- ---------------------------------------------------------------------------
alter table public.kitchen_items enable row level security;
alter table public.kitchen_requests enable row level security;

drop policy if exists kitchen_items_select_enabled on public.kitchen_items;
create policy kitchen_items_select_enabled
on public.kitchen_items
for select
to authenticated
using (
  public.kitchen_module_enabled('kitchen_requests')
  or public.kitchen_module_enabled('kitchen_display')
  or public.current_user_is_manager()
);

drop policy if exists kitchen_items_insert_manager on public.kitchen_items;
create policy kitchen_items_insert_manager
on public.kitchen_items
for insert
to authenticated
with check (public.current_user_is_manager());

drop policy if exists kitchen_items_update_manager on public.kitchen_items;
create policy kitchen_items_update_manager
on public.kitchen_items
for update
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists kitchen_items_delete_manager on public.kitchen_items;
create policy kitchen_items_delete_manager
on public.kitchen_items
for delete
to authenticated
using (public.current_user_is_manager());

drop policy if exists kitchen_requests_select_enabled_location on public.kitchen_requests;
create policy kitchen_requests_select_enabled_location
on public.kitchen_requests
for select
to authenticated
using (
  (
    public.kitchen_module_enabled('kitchen_requests')
    or public.kitchen_module_enabled('kitchen_display')
    or public.current_user_is_manager()
  )
  and public.kitchen_user_location_ok(location_id)
);

revoke all on table public.kitchen_items from anon;
revoke all on table public.kitchen_requests from anon;

grant select, insert, update, delete on table public.kitchen_items to authenticated;
grant select on table public.kitchen_requests to authenticated;
revoke insert, update, delete on table public.kitchen_requests from authenticated;
-- Edge functions and admin tooling use the service role; say so explicitly
-- instead of relying on default privileges.
grant all on table public.kitchen_items to service_role;
grant all on table public.kitchen_requests to service_role;

-- ---------------------------------------------------------------------------
-- Realtime publication. The harness does not provide the publication, so
-- missing publication/table errors are intentionally ignored.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.kitchen_requests;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.kitchen_items;
  exception
    when duplicate_object then null;
    when undefined_object then null;
    when undefined_table then null;
  end;
end;
$$;
