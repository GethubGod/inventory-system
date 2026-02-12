-- Add optional note snapshot for past fulfillment line items.

do $$
begin
  alter table public.past_order_items
    add column if not exists note text;
exception
  when undefined_table then null;
end;
$$;
