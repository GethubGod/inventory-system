-- Phase 7a: simple delivery receiving against archived sent orders.
--
-- A receipt begins in_progress, then is finalized as complete or partial.
-- Partial receipts intentionally do not occupy the unique active/completed
-- slot: a later delivery can be received against the same order while the
-- original short/missing-item discrepancy remains in history.

create table if not exists public.order_receipts (
  id uuid primary key default gen_random_uuid(),
  past_order_id uuid not null references public.past_orders(id) on delete cascade,
  received_by uuid not null references public.users(id) on delete restrict,
  received_at timestamp with time zone not null default now(),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'complete', 'partial')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.order_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.order_receipts(id) on delete cascade,
  past_order_item_id uuid not null references public.past_order_items(id) on delete cascade,
  received boolean not null default true,
  received_qty numeric,
  note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint order_receipt_items_received_qty_nonnegative_check
    check (received_qty is null or received_qty >= 0),
  constraint order_receipt_items_receipt_past_order_item_key
    unique (receipt_id, past_order_item_id)
);

create index if not exists order_receipts_past_order_received_at_idx
  on public.order_receipts(past_order_id, received_at desc);

-- One receipt may be actively received or fully completed for an order. A
-- partial receipt does not block a follow-up delivery receipt for a shorted
-- order; the original partial receipt remains the discrepancy audit record.
create unique index if not exists order_receipts_one_active_or_complete_per_order_idx
  on public.order_receipts(past_order_id)
  where status in ('in_progress', 'complete');

create index if not exists order_receipt_items_receipt_id_idx
  on public.order_receipt_items(receipt_id);

create index if not exists order_receipt_items_discrepancy_idx
  on public.order_receipt_items(receipt_id, updated_at desc)
  where received = false or received_qty is not null;

drop trigger if exists set_order_receipts_updated_at on public.order_receipts;
create trigger set_order_receipts_updated_at
before update on public.order_receipts
for each row execute function public.set_updated_at();

drop trigger if exists set_order_receipt_items_updated_at on public.order_receipt_items;
create trigger set_order_receipt_items_updated_at
before update on public.order_receipt_items
for each row execute function public.set_updated_at();

alter table public.order_receipts enable row level security;
alter table public.order_receipt_items enable row level security;

drop policy if exists order_receipts_select_owner_or_manager on public.order_receipts;
create policy order_receipts_select_owner_or_manager
on public.order_receipts
for select
to authenticated
using (
  received_by = (select auth.uid())
  or public.current_user_is_manager()
);

drop policy if exists order_receipts_insert_owner_or_manager on public.order_receipts;
create policy order_receipts_insert_owner_or_manager
on public.order_receipts
for insert
to authenticated
with check (
  received_by = (select auth.uid())
  or public.current_user_is_manager()
);

drop policy if exists order_receipts_update_owner_or_manager on public.order_receipts;
create policy order_receipts_update_owner_or_manager
on public.order_receipts
for update
to authenticated
using (
  received_by = (select auth.uid())
  or public.current_user_is_manager()
)
with check (
  received_by = (select auth.uid())
  or public.current_user_is_manager()
);

drop policy if exists order_receipts_delete_owner_or_manager on public.order_receipts;
create policy order_receipts_delete_owner_or_manager
on public.order_receipts
for delete
to authenticated
using (
  received_by = (select auth.uid())
  or public.current_user_is_manager()
);

drop policy if exists order_receipt_items_select_owner_or_manager on public.order_receipt_items;
create policy order_receipt_items_select_owner_or_manager
on public.order_receipt_items
for select
to authenticated
using (
  exists (
    select 1
    from public.order_receipts receipt
    where receipt.id = receipt_id
      and (
        receipt.received_by = (select auth.uid())
        or public.current_user_is_manager()
      )
  )
);

drop policy if exists order_receipt_items_insert_owner_or_manager on public.order_receipt_items;
create policy order_receipt_items_insert_owner_or_manager
on public.order_receipt_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.order_receipts receipt
    where receipt.id = receipt_id
      and (
        receipt.received_by = (select auth.uid())
        or public.current_user_is_manager()
      )
  )
);

drop policy if exists order_receipt_items_update_owner_or_manager on public.order_receipt_items;
create policy order_receipt_items_update_owner_or_manager
on public.order_receipt_items
for update
to authenticated
using (
  exists (
    select 1
    from public.order_receipts receipt
    where receipt.id = receipt_id
      and (
        receipt.received_by = (select auth.uid())
        or public.current_user_is_manager()
      )
  )
)
with check (
  exists (
    select 1
    from public.order_receipts receipt
    where receipt.id = receipt_id
      and (
        receipt.received_by = (select auth.uid())
        or public.current_user_is_manager()
      )
  )
);

drop policy if exists order_receipt_items_delete_owner_or_manager on public.order_receipt_items;
create policy order_receipt_items_delete_owner_or_manager
on public.order_receipt_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.order_receipts receipt
    where receipt.id = receipt_id
      and (
        receipt.received_by = (select auth.uid())
        or public.current_user_is_manager()
      )
  )
);

grant select, insert, update, delete on public.order_receipts to authenticated;
grant select, insert, update, delete on public.order_receipt_items to authenticated;

notify pgrst, 'reload schema';
