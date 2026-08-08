-- Post-E2E cleanup. Run against the live database after an E2E run
-- (Supabase MCP execute_sql, `psql`, or the dashboard SQL editor).
--
-- Removes everything a suite run creates:
--   * tip_entries / tip_entry_people rows the specs saved (today's slots)
--   * every minted entry session (device localStorage sessions die with the
--     browser context; David's phone re-mints on his next scan)
--   * ws tickets + the auth-attempt ledger (incl. the rate-limit spec's
--     deliberate failures)
--
-- It does NOT touch the deliberate fixtures: tip_location_access rows
-- (tokens/PINs) and the tip_employees placeholder roster.

begin;
delete from public.tip_entry_people;
delete from public.tip_entries;
delete from public.tip_ws_tickets;
delete from public.tip_entry_sessions;
delete from public.tip_auth_attempts;
commit;

-- Fixture sanity check: expect 2 access rows and 5 roster placeholders.
select
  (select count(*) from public.tip_location_access) as access_rows,
  (select count(*) from public.tip_employees)       as roster_rows,
  (select count(*) from public.tip_entries)         as entries_left,
  (select count(*) from public.tip_entry_sessions)  as sessions_left,
  (select count(*) from public.tip_auth_attempts)   as attempts_left;
