-- Post-E2E cleanup. Run against the live database after an E2E run
-- (Supabase MCP execute_sql, `psql`, or the dashboard SQL editor).
--
-- ⚠ PRE-LAUNCH TOOL. The entry deletes are scoped to what the harness can
-- have written (TODAY's business date at the two seeded locations), but the
-- session/ticket/ledger deletes are full wipes: every entry device gets
-- signed out and all rate-limit history resets. Before real staff use the
-- app that is exactly what you want after a test run; afterwards, prefer
-- Admin → "Sign out all devices" and let the 2-day ledger retention handle
-- tip_auth_attempts.
--
-- It does NOT touch the deliberate fixtures: tip_location_access rows
-- (tokens/PINs) and the tip_employees placeholder roster.

begin;

with today as (
  -- Same 4am-LA rollover the app uses (web/src/lib/tips/businessDate.ts).
  select ((now() at time zone 'America/Los_Angeles') - interval '4 hours')::date as d
),
harness_entries as (
  select e.id
  from public.tip_entries e, today
  where e.business_date = today.d
    and e.location_id in (
      '03c25829-a34d-4df6-aa5e-5cf7612ecd21',  -- Babytuna Sushi
      '48aa6345-d32e-4599-aae5-866d14c9e9b3'   -- Babytuna Poki & Pho
    )
)
delete from public.tip_entry_people
where tip_entry_id in (select id from harness_entries);

delete from public.tip_entries e
using (
  select ((now() at time zone 'America/Los_Angeles') - interval '4 hours')::date as d
) today
where e.business_date = today.d
  and e.location_id in (
    '03c25829-a34d-4df6-aa5e-5cf7612ecd21',
    '48aa6345-d32e-4599-aae5-866d14c9e9b3'
  );

delete from public.tip_ws_tickets;      -- 60s TTL anyway
delete from public.tip_entry_sessions;  -- signs out every device (see header)
delete from public.tip_auth_attempts;   -- resets rate limits (see header)

commit;

-- Fixture sanity check: expect 2 access rows and 5 roster placeholders.
select
  (select count(*) from public.tip_location_access) as access_rows,
  (select count(*) from public.tip_employees)       as roster_rows,
  (select count(*) from public.tip_entries)         as entries_left,
  (select count(*) from public.tip_entry_sessions)  as sessions_left,
  (select count(*) from public.tip_auth_attempts)   as attempts_left;
