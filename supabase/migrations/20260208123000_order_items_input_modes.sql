-- Add quantity-vs-remaining ordering fields for manager decision workflow

alter table public.order_items
  add column if not exists input_mode text,
  add column if not exists quantity_requested numeric,
  add column if not exists remaining_reported numeric,
  add column if not exists decided_quantity numeric,
  add column if not exists decided_by uuid references public.users(id) on delete set null,
  add column if not exists decided_at timestamp with time zone;

-- Backfill historical rows as quantity-mode.
update public.order_items
set
  input_mode = coalesce(input_mode, 'quantity'),
  quantity_requested = coalesce(quantity_requested, quantity),
  decided_quantity = coalesce(decided_quantity, quantity)
where input_mode is null
   or input_mode = 'quantity';

alter table public.order_items
  alter column input_mode set default 'quantity';

update public.order_items
set input_mode = 'quantity'
where input_mode is null;

alter table public.order_items
  alter column input_mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_input_mode_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_input_mode_check
      check (input_mode in ('quantity', 'remaining'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_mode_fields_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_mode_fields_check
      check (
        (input_mode = 'quantity' and quantity_requested is not null and quantity_requested > 0 and remaining_reported is null)
        or
        (input_mode = 'remaining' and remaining_reported is not null and remaining_reported >= 0 and quantity_requested is null)
      );
  end if;
end;
$$;

create index if not exists order_items_input_mode_idx
  on public.order_items(input_mode);

create index if not exists order_items_decided_by_idx
  on public.order_items(decided_by);
