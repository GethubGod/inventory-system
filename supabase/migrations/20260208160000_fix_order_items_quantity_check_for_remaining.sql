-- Allow remaining-mode order items to save with quantity 0 (manager decides later).

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'order_items_quantity_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      drop constraint order_items_quantity_check;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'order_items_quantity_mode_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      drop constraint order_items_quantity_mode_check;
  end if;
end;
$$;

alter table public.order_items
  add constraint order_items_quantity_mode_check
  check (
    (
      coalesce(input_mode, 'quantity') = 'quantity'
      and quantity is not null
      and quantity > 0
    )
    or
    (
      coalesce(input_mode, 'quantity') = 'remaining'
      and quantity is not null
      and quantity >= 0
    )
  );
