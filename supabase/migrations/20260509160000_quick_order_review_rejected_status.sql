-- Allow managers to explicitly reject Quick Order reviews.

do $$
begin
  if to_regclass('public.orders') is not null then
    alter table public.orders
      drop constraint if exists orders_manager_review_status_check;

    alter table public.orders
      add constraint orders_manager_review_status_check
      check (
        manager_review_status in (
          'not_required',
          'pending',
          'approved',
          'changes_requested',
          'rejected'
        )
      );
  end if;
end;
$$;

notify pgrst, 'reload schema';

-- Rollback:
-- alter table public.orders drop constraint if exists orders_manager_review_status_check;
-- alter table public.orders
--   add constraint orders_manager_review_status_check
--   check (manager_review_status in ('not_required', 'pending', 'approved', 'changes_requested'));
