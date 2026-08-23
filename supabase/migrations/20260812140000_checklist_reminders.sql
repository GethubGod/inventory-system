-- Phase 5c: checklist-aware recurring reminders and push delivery outcomes.
--
-- The columns below extend the existing reminder event/rule models so the
-- existing reminder scheduler and delivery screen remain the source of truth.

alter table public.recurring_reminder_rules
  add column if not exists rule_kind text not null default 'standard'
    check (rule_kind in ('standard', 'checklist_order_day'));

alter table public.recurring_reminder_rules
  add column if not exists location_group text
    check (location_group in ('sushi', 'poki'));

alter table public.recurring_reminder_rules
  add constraint recurring_reminder_rules_checklist_context_check
  check (
    (rule_kind = 'standard' and location_group is null)
    or
    (
      rule_kind = 'checklist_order_day'
      and scope = 'employee'
      and employee_id is not null
      and location_id is null
      and location_group is not null
      and condition_type = 'no_order_today'
      and condition_value is null
    )
  );

-- Standard recurring rules remain manager-controlled. Employees may only
-- manage their own checklist order-day rules, with every scope/context field
-- pinned by RLS to prevent them from creating a general reminder rule.
drop policy if exists recurring_rules_self_checklist_select on public.recurring_reminder_rules;
create policy recurring_rules_self_checklist_select
on public.recurring_reminder_rules
for select
to authenticated
using (
  rule_kind = 'checklist_order_day'
  and scope = 'employee'
  and employee_id = (select auth.uid())
  and created_by = (select auth.uid())
);

drop policy if exists recurring_rules_self_checklist_insert on public.recurring_reminder_rules;
create policy recurring_rules_self_checklist_insert
on public.recurring_reminder_rules
for insert
to authenticated
with check (
  rule_kind = 'checklist_order_day'
  and scope = 'employee'
  and employee_id = (select auth.uid())
  and created_by = (select auth.uid())
  and location_id is null
  and location_group in ('sushi', 'poki')
  and condition_type = 'no_order_today'
  and condition_value is null
);

drop policy if exists recurring_rules_self_checklist_update on public.recurring_reminder_rules;
create policy recurring_rules_self_checklist_update
on public.recurring_reminder_rules
for update
to authenticated
using (
  rule_kind = 'checklist_order_day'
  and scope = 'employee'
  and employee_id = (select auth.uid())
  and created_by = (select auth.uid())
)
with check (
  rule_kind = 'checklist_order_day'
  and scope = 'employee'
  and employee_id = (select auth.uid())
  and created_by = (select auth.uid())
  and location_id is null
  and location_group in ('sushi', 'poki')
  and condition_type = 'no_order_today'
  and condition_value is null
);

drop policy if exists recurring_rules_self_checklist_delete on public.recurring_reminder_rules;
create policy recurring_rules_self_checklist_delete
on public.recurring_reminder_rules
for delete
to authenticated
using (
  rule_kind = 'checklist_order_day'
  and scope = 'employee'
  and employee_id = (select auth.uid())
  and created_by = (select auth.uid())
);

alter table public.reminder_events
  add column if not exists push_delivery_status text
    check (push_delivery_status in ('accepted', 'failed'));

alter table public.reminder_events
  add column if not exists expo_push_receipt_ids jsonb not null default '[]'::jsonb;

alter table public.reminder_events
  add column if not exists push_error_detail text;

alter table public.reminder_events
  add constraint reminder_events_expo_push_receipt_ids_array_check
  check (jsonb_typeof(expo_push_receipt_ids) = 'array');

create index if not exists reminder_events_push_delivery_status_idx
  on public.reminder_events(push_delivery_status, sent_at desc)
  where push_delivery_status is not null;

notify pgrst, 'reload schema';
