-- Employee app checklist-first phase: small additive backend for
--   1. Save checklist as default (employee upsert of their own checklist —
--      RLS only lets managers write order_checklist_items, so this is an RPC).
--   2. Order note: employees attach a free-text note to a checklist send.
--      orders.notes already exists but nothing writes it; set_my_order_meta
--      fills it after submit_order_rpc (which is deliberately left untouched —
--      it has been surgically patched 8 times and re-stating it here would
--      risk drift from production).
--   3. Per-line unit override: order_items.unit_label records the unit the
--      employee actually picked when it is neither the item's base nor pack
--      unit. inventory_items is never mutated.
--   4. Self-service rename: users_update_own RLS allows updating users.name,
--      but the login_identities row (name sign-in) must stay in sync, so the
--      rename goes through one RPC that does both.
--
-- Everything is additive; nothing rewrites existing functions or tables
-- beyond ADD COLUMN IF NOT EXISTS.

-- ---------------------------------------------------------------------------
-- 3. Per-line unit override column.
-- ---------------------------------------------------------------------------
alter table public.order_items add column if not exists unit_label text;

comment on column public.order_items.unit_label is
  'Employee-chosen unit for this line when it differs from the inventory item''s '
  'base/pack unit. Display-only override; quantity math still uses unit_type.';

-- ---------------------------------------------------------------------------
-- 1. Save checklist as default.
--
-- p_items: jsonb array of the CHECKED lines, each
--   { "id": "<order_checklist_items.id, optional>",
--     "item_id": "<inventory id or null>",
--     "item_name": "...", "unit": "...", "quantity": 2 }
-- Existing rows are updated in place (default_checked=true, recommended_qty,
-- unit); unknown lines (search adds) are inserted as item_source='manual';
-- every other row on the checklist keeps its row but flips
-- default_checked=false so the next order starts exactly as saved.
-- ---------------------------------------------------------------------------
create or replace function public.save_my_checklist_default(
  p_location_group text,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_checklist_id uuid;
  v_entry jsonb;
  v_row_id uuid;
  v_item_id uuid;
  v_item_name text;
  v_unit text;
  v_qty numeric;
  v_matched_ids uuid[] := '{}';
  v_next_sort integer;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in to save a checklist default' using errcode = '42501';
  end if;

  if p_location_group not in ('sushi', 'poki') then
    raise exception 'Invalid location group' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Checklist items payload must be an array' using errcode = '22023';
  end if;

  select id into v_checklist_id
  from public.order_checklists
  where user_id = v_uid and location_group = p_location_group;

  if v_checklist_id is null then
    insert into public.order_checklists (user_id, location_group, generation_source)
    values (v_uid, p_location_group, 'manual')
    returning id into v_checklist_id;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort
  from public.order_checklist_items
  where checklist_id = v_checklist_id;

  for v_entry in select * from jsonb_array_elements(p_items)
  loop
    v_row_id := nullif(v_entry->>'id', '')::uuid;
    v_item_id := nullif(v_entry->>'item_id', '')::uuid;
    v_item_name := btrim(coalesce(v_entry->>'item_name', ''));
    v_unit := btrim(coalesce(v_entry->>'unit', ''));
    v_qty := nullif(v_entry->>'quantity', '')::numeric;

    if v_item_name = '' or v_unit = '' then
      raise exception 'Checklist line is missing a name or unit' using errcode = '22023';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Checklist line "%" has an invalid quantity', v_item_name
        using errcode = '22023';
    end if;

    -- Prefer the explicit row id; otherwise match search adds against an
    -- existing row (same inventory item, or same name+unit) so repeated
    -- saves never duplicate lines.
    if v_row_id is null then
      select id into v_row_id
      from public.order_checklist_items
      where checklist_id = v_checklist_id
        and (
          (v_item_id is not null and item_id = v_item_id)
          or (lower(item_name) = lower(v_item_name) and lower(unit) = lower(v_unit))
        )
      order by (item_id = v_item_id) desc nulls last
      limit 1;
    end if;

    if v_row_id is not null then
      update public.order_checklist_items
      set default_checked = true,
          recommended_qty = v_qty,
          unit = v_unit,
          updated_at = now()
      where id = v_row_id and checklist_id = v_checklist_id;

      if not found then
        raise exception 'Checklist line "%" does not belong to your checklist', v_item_name
          using errcode = 'P0001';
      end if;
    else
      insert into public.order_checklist_items (
        checklist_id, item_id, item_name, unit,
        default_checked, recommended_qty, sort_order, item_source
      )
      values (
        v_checklist_id, v_item_id, v_item_name, v_unit,
        true, v_qty, v_next_sort, 'manual'
      )
      returning id into v_row_id;
      v_next_sort := v_next_sort + 1;
    end if;

    v_matched_ids := v_matched_ids || v_row_id;
    v_count := v_count + 1;
  end loop;

  -- Rows not in the saved selection keep their row, start unchecked.
  update public.order_checklist_items
  set default_checked = false,
      updated_at = now()
  where checklist_id = v_checklist_id
    and default_checked = true
    and not (id = any (v_matched_ids));

  update public.order_checklists
  set updated_at = now()
  where id = v_checklist_id;

  return v_count;
end;
$$;

revoke all on function public.save_my_checklist_default(text, jsonb) from public, anon;
grant execute on function public.save_my_checklist_default(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2 + 3. Post-submit order metadata: order-level note + per-line unit labels.
-- Called by the sender right after submit_order_rpc succeeds, so RLS on
-- orders/order_items (manager-write) never needs loosening.
-- p_unit_overrides: jsonb array of { "inventory_item_id": "...", "unit_label": "lb" }.
-- ---------------------------------------------------------------------------
create or replace function public.set_my_order_meta(
  p_order_id uuid,
  p_note text default null,
  p_unit_overrides jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_override jsonb;
  v_item_id uuid;
  v_label text;
begin
  if v_uid is null then
    raise exception 'Sign in to update an order' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.orders
    where id = p_order_id
      and user_id = v_uid
      and status = 'submitted'
  ) then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;

  if p_note is not null then
    update public.orders
    set notes = nullif(btrim(p_note), '')
    where id = p_order_id;
  end if;

  if p_unit_overrides is not null then
    if jsonb_typeof(p_unit_overrides) <> 'array' then
      raise exception 'Unit overrides payload must be an array' using errcode = '22023';
    end if;

    for v_override in select * from jsonb_array_elements(p_unit_overrides)
    loop
      v_item_id := nullif(v_override->>'inventory_item_id', '')::uuid;
      v_label := nullif(btrim(coalesce(v_override->>'unit_label', '')), '');
      if v_item_id is null or v_label is null then
        continue;
      end if;

      update public.order_items
      set unit_label = v_label
      where order_id = p_order_id
        and inventory_item_id = v_item_id;
    end loop;
  end if;
end;
$$;

revoke all on function public.set_my_order_meta(uuid, text, jsonb) from public, anon;
grant execute on function public.set_my_order_meta(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-service rename, keeping name sign-in working.
-- ---------------------------------------------------------------------------
create or replace function public.update_my_display_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_display text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_login text;
begin
  if v_uid is null then
    raise exception 'Sign in to change your name' using errcode = '42501';
  end if;

  if v_display = '' or length(v_display) > 80 then
    raise exception 'Enter a name between 1 and 80 characters' using errcode = '22023';
  end if;

  v_login := public.normalize_login_name(v_display);

  if exists (
    select 1 from public.login_identities
    where login_name = v_login and user_id <> v_uid
  ) then
    raise exception 'This name is already used for sign-in. Ask the manager to adjust it.'
      using errcode = '23505';
  end if;

  update public.users
  set name = v_display
  where id = v_uid;

  update public.login_identities
  set login_name = v_login,
      display_name = v_display,
      updated_at = now(),
      updated_by = v_uid
  where user_id = v_uid;
end;
$$;

revoke all on function public.update_my_display_name(text) from public, anon;
grant execute on function public.update_my_display_name(text) to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
