-- Phase 6c: manager-configured holiday ordering templates.
--
-- qo_holiday_overrides remains the Google Sheets / Quick Order source table.
-- Its item-name/multiplier-only model cannot represent inventory-backed,
-- named template rows or additive/fixed checklist adjustments, so this phase
-- deliberately keeps it intact and introduces a checklist-specific model.

create table if not exists public.holiday_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holiday_templates_name_not_blank check (length(btrim(name)) > 0),
  constraint holiday_templates_date_range_check check (ends_on >= starts_on)
);

create table if not exists public.holiday_template_items (
  template_id uuid not null references public.holiday_templates(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  adjustment_kind text not null check (adjustment_kind in ('add', 'scale', 'set_qty')),
  quantity numeric not null check (quantity >= 0),
  note text,
  primary key (template_id, item_id)
);

create index if not exists holiday_templates_active_window_idx
  on public.holiday_templates(active, starts_on, ends_on);

create index if not exists holiday_template_items_item_idx
  on public.holiday_template_items(item_id);

drop trigger if exists set_holiday_templates_updated_at on public.holiday_templates;
create trigger set_holiday_templates_updated_at
before update on public.holiday_templates
for each row execute function public.set_updated_at();

alter table public.holiday_templates enable row level security;
alter table public.holiday_template_items enable row level security;

drop policy if exists holiday_templates_select_authenticated on public.holiday_templates;
create policy holiday_templates_select_authenticated
on public.holiday_templates
for select
to authenticated
using (true);

drop policy if exists holiday_templates_manage_manager on public.holiday_templates;
create policy holiday_templates_manage_manager
on public.holiday_templates
for all
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

drop policy if exists holiday_template_items_select_authenticated on public.holiday_template_items;
create policy holiday_template_items_select_authenticated
on public.holiday_template_items
for select
to authenticated
using (true);

drop policy if exists holiday_template_items_manage_manager on public.holiday_template_items;
create policy holiday_template_items_manage_manager
on public.holiday_template_items
for all
to authenticated
using (public.current_user_is_manager())
with check (public.current_user_is_manager());

grant select, insert, update, delete on public.holiday_templates to authenticated;
grant select, insert, update, delete on public.holiday_template_items to authenticated;
grant all on public.holiday_templates, public.holiday_template_items to service_role;

-- A single template is selected for a date. Overlapping windows are resolved
-- deterministically in favour of the most recently starting template, then
-- the most recently created one. This avoids stacking adjustments silently.
create or replace function public.active_holiday_for(p_date date)
returns uuid
language sql
stable
set search_path = public
as $$
  select template.id
  from public.holiday_templates template
  where template.active = true
    and p_date between template.starts_on and template.ends_on
  order by template.starts_on desc, template.created_at desc, template.id desc
  limit 1;
$$;

revoke all on function public.active_holiday_for(date) from public, anon;
grant execute on function public.active_holiday_for(date) to authenticated;

-- This is intentionally an overlay, not a checklist mutation. The generated,
-- manually maintained, and screenshot-imported rows in order_checklist_items
-- keep their stored quantities and default_checked values. Clients combine an
-- active row with a base checklist line as follows:
--   add     => base quantity + quantity (or an overlay-only pre-checked line)
--   scale   => base quantity * quantity
--   set_qty => quantity (or an overlay-only pre-checked line)
-- An add row for an item missing from the checklist is returned so the app can
-- render it without inserting a durable checklist row.
create or replace function public.get_checklist_holiday_overlay(
  p_user_id uuid,
  p_location_group text,
  p_date date
)
returns table (
  item_id uuid,
  item_name text,
  unit text,
  adjustment_kind text,
  quantity numeric,
  template_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_location_group not in ('sushi', 'poki') then
    raise exception 'Invalid location group'
      using errcode = 'P0001';
  end if;

  if auth.uid() is null
    or p_user_id is null
    or (auth.uid() <> p_user_id and not public.current_user_is_manager()) then
    raise exception 'Unauthorized'
      using errcode = 'P0001';
  end if;

  return query
  with active_template as (
    select template.id, template.name
    from public.holiday_templates template
    where template.id = public.active_holiday_for(p_date)
  )
  select
    template_item.item_id,
    coalesce(checklist_item.item_name, inventory_item.name) as item_name,
    coalesce(
      nullif(checklist_item.unit, ''),
      nullif(inventory_item.default_order_unit, ''),
      nullif(inventory_item.pack_unit, ''),
      nullif(inventory_item.base_unit, ''),
      ''
    ) as unit,
    template_item.adjustment_kind,
    template_item.quantity,
    template.name as template_name
  from active_template template
  join public.holiday_template_items template_item
    on template_item.template_id = template.id
  join public.inventory_items inventory_item
    on inventory_item.id = template_item.item_id
  left join lateral (
    select checklist_line.item_name, checklist_line.unit
    from public.order_checklists checklist
    join public.order_checklist_items checklist_line
      on checklist_line.checklist_id = checklist.id
    where checklist.user_id = p_user_id
      and checklist.location_group = p_location_group
      and checklist_line.item_id = template_item.item_id
    order by checklist_line.sort_order, checklist_line.id
    limit 1
  ) checklist_item on true
  order by lower(coalesce(checklist_item.item_name, inventory_item.name)), template_item.item_id;
end;
$$;

revoke all on function public.get_checklist_holiday_overlay(uuid, text, date) from public, anon;
grant execute on function public.get_checklist_holiday_overlay(uuid, text, date) to authenticated;
