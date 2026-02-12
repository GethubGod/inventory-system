-- Add explicit fulfillment status tracking and richer order-later linkage.
-- This makes "sent" items reliably disappear from active fulfillment.

-- 1) order_items.status (+ created_at fallback)
do $$
begin
  alter table public.order_items
    add column if not exists status text not null default 'pending';
exception
  when undefined_table then null;
end;
$$;

do $$
begin
  alter table public.order_items
    add column if not exists created_at timestamp with time zone not null default now();
exception
  when undefined_table then null;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'order_items'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'order_items_status_check'
        and conrelid = 'public.order_items'::regclass
    ) then
      alter table public.order_items
        add constraint order_items_status_check
        check (status in ('pending', 'order_later', 'sent', 'cancelled'));
    end if;
  end if;
exception
  when undefined_table then null;
end;
$$;

do $$
begin
  create index if not exists order_items_status_idx
    on public.order_items(status);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;

-- Backfill historical order_items as sent when they are already referenced
-- by existing past_orders payload source-order-item ids.
-- NOTE: do not mutate quantity fields here. Existing schemas enforce
-- mode-specific checks (e.g. quantity_requested > 0 for quantity mode),
-- so zeroing values can violate constraints.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'order_items'
  ) and exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'past_orders'
  ) then
    with consumed as (
      select distinct value as order_item_id_text
      from (
        select jsonb_array_elements_text(coalesce(payload->'sourceOrderItemIds', '[]'::jsonb)) as value
        from public.past_orders
        union all
        select jsonb_array_elements_text(coalesce(payload->'source_order_item_ids', '[]'::jsonb)) as value
        from public.past_orders
      ) t
      where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    update public.order_items oi
    set status = 'sent',
        created_at = coalesce(oi.created_at, now())
    where oi.id in (
      select order_item_id_text::uuid from consumed
    )
      and coalesce(oi.status, 'pending') = 'pending';
  end if;
exception
  when undefined_column then
    -- created_at may not exist on older schemas.
    begin
      with consumed as (
        select distinct value as order_item_id_text
        from (
          select jsonb_array_elements_text(coalesce(payload->'sourceOrderItemIds', '[]'::jsonb)) as value
          from public.past_orders
          union all
          select jsonb_array_elements_text(coalesce(payload->'source_order_item_ids', '[]'::jsonb)) as value
          from public.past_orders
        ) t
        where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      update public.order_items oi
      set status = 'sent'
      where oi.id in (
        select order_item_id_text::uuid from consumed
      )
        and coalesce(oi.status, 'pending') = 'pending';
    exception
      when undefined_table then null;
    end;
  when undefined_table then null;
end;
$$;

-- 2) order_later_items richer context for multi-line moves
do $$
begin
  alter table public.order_later_items
    add column if not exists qty numeric,
    add column if not exists suggested_supplier_id uuid references public.suppliers(id) on delete set null,
    add column if not exists original_order_item_ids uuid[] not null default '{}'::uuid[];
exception
  when undefined_table then null;
end;
$$;

-- Backfill qty from payload.quantity where possible.
do $$
begin
  update public.order_later_items
  set qty = coalesce(
    qty,
    nullif(trim(payload->>'quantity'), '')::numeric,
    1
  )
  where qty is null;
exception
  when undefined_table then null;
  when invalid_text_representation then null;
end;
$$;

do $$
begin
  create index if not exists order_later_items_suggested_supplier_id_idx
    on public.order_later_items(suggested_supplier_id);
exception
  when undefined_table then null;
  when undefined_column then null;
end;
$$;

-- Keep legacy source_order_item_id filled for single-id payloads.
do $$
begin
  update public.order_later_items
  set source_order_item_id = original_order_item_ids[1]
  where source_order_item_id is null
    and cardinality(original_order_item_ids) = 1;
exception
  when undefined_table then null;
end;
$$;
