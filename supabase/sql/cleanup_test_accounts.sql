-- Cleanup test accounts while keeping specific users.
-- Run in Supabase SQL Editor (project role: postgres/service role).
-- IMPORTANT: update the keeper emails before running the DELETE block.

-- 1) Define accounts to KEEP.
drop table if exists _keep_user_emails;
create temporary table _keep_user_emails (
  email text primary key
);

-- Add one or more keeper emails here.
insert into _keep_user_emails (email)
values
  ('david@gmail.com');

-- 2) Materialize users to delete.
drop table if exists _to_delete_users;
create temporary table _to_delete_users as
select
  au.id,
  lower(au.email) as email
from auth.users au
where lower(au.email) not in (select lower(email) from _keep_user_emails);

-- Preview users that will be deleted.
select
  td.id,
  td.email,
  pu.role
from _to_delete_users td
left join public.users pu on pu.id = td.id
order by td.email;

-- 3) Delete non-keeper users with FK-safe ordering.
-- This is the destructive step.
begin;

-- Remove restrictive references to public.users before deleting rows.
delete from public.orders o
using _to_delete_users td
where o.user_id = td.id;

delete from public.stock_check_sessions scs
using _to_delete_users td
where scs.user_id = td.id;

delete from public.stock_updates su
using _to_delete_users td
where su.updated_by = td.id;

update public.storage_areas
set last_checked_by = null
where last_checked_by in (select id from _to_delete_users);

update public.area_items
set last_updated_by = null
where last_updated_by in (select id from _to_delete_users);

update public.inventory_items
set created_by = null
where created_by in (select id from _to_delete_users);

-- If org_settings.updated_by points to auth.users, clear it before auth delete.
update public.org_settings
set updated_by = null
where updated_by in (select id from _to_delete_users);

-- Delete from public tables first (child side), then auth.users.
delete from public.profiles p
using _to_delete_users td
where p.id = td.id;

delete from public.users u
using _to_delete_users td
where u.id = td.id;

delete from auth.users au
using _to_delete_users td
where au.id = td.id;

commit;

-- 4) Optional: full reminder reset (uncomment if you want a clean slate).
-- truncate table public.reminder_events restart identity cascade;
-- truncate table public.reminders restart identity cascade;
-- truncate table public.recurring_reminder_rules restart identity cascade;
-- truncate table public.notifications restart identity cascade;
-- truncate table public.device_push_tokens restart identity cascade;

-- 5) Verify remaining users.
select id, email
from auth.users
order by email;
