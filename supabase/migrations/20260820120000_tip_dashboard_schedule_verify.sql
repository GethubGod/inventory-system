-- Tip Dashboard v2 backend: weekly schedules, anomaly verification, and
-- manager visibility into device sessions.
--
-- 1) tip_employee_schedules — the manager-set weekly schedule. One row per
--    (employee, location, weekday, meal); an employee who works both
--    locations has separate rows per location. weekday follows JS
--    Date.getDay() / Postgres extract(dow): 0 = Sunday … 6 = Saturday.
--    Powers entry-phone pre-selection and the dashboard's missing-shift list.
-- 2) tip_entries verification — "Verify" on a flagged row records who
--    checked it and when; verified rows stop counting as flagged in
--    dashboard KPIs and the needs-attention list.
-- 3) Manager read access to tip_entry_sessions (column-limited: token_hash
--    stays service-role-only, mirroring the tip_location_access pattern) so
--    the dashboard's device cards can show scan activity.

create table public.tip_employee_schedules (
  id uuid primary key default gen_random_uuid(),
  tip_employee_id uuid not null references public.tip_employees(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  meal text not null check (meal in ('lunch', 'dinner')),
  created_at timestamptz not null default now(),
  unique (tip_employee_id, location_id, weekday, meal)
);

-- The entry flow looks up "who is scheduled for this location + weekday + meal".
create index tip_employee_schedules_slot_idx
  on public.tip_employee_schedules (location_id, weekday, meal);

alter table public.tip_employee_schedules enable row level security;
revoke all on table public.tip_employee_schedules from anon, authenticated;
grant select, insert, update, delete on table public.tip_employee_schedules to authenticated;
drop policy if exists tip_employee_schedules_manager_all on public.tip_employee_schedules;
create policy tip_employee_schedules_manager_all on public.tip_employee_schedules
  for all to authenticated
  using (public.current_user_is_manager())
  with check (public.current_user_is_manager());

alter table public.tip_entries
  add column flag_verified_at timestamptz null,
  add column flag_verified_by uuid null references auth.users (id) on delete set null;

grant select (id, location_id, closer_id, created_at, last_seen_at, expires_at, revoked)
  on table public.tip_entry_sessions to authenticated;
drop policy if exists tip_entry_sessions_manager_read on public.tip_entry_sessions;
create policy tip_entry_sessions_manager_read on public.tip_entry_sessions
  for select to authenticated
  using (public.current_user_is_manager());
