-- Delete-account diagnostics
-- Run in Supabase SQL editor on the same project your app is using.

-- 1) Required tables for delete account flow.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'users',
    'profiles',
    'orders',
    'stock_updates',
    'stock_check_sessions',
    'storage_areas',
    'area_items',
    'inventory_items',
    'org_settings',
    'notifications',
    'device_push_tokens',
    'past_orders',
    'past_order_items',
    'order_later_items'
  )
order by table_name;

-- 2) Required function used by manager delete flow.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'admin_prepare_user_delete';

-- 3) FK rules that impact user deletion behavior.
select
  tc.table_name,
  kcu.column_name,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.constraint_schema = kcu.constraint_schema
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
 and tc.constraint_schema = rc.constraint_schema
join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name
 and tc.constraint_schema = ccu.constraint_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and (
    (ccu.table_schema = 'public' and ccu.table_name = 'users')
    or
    (ccu.table_schema = 'auth' and ccu.table_name = 'users')
  )
order by tc.table_name, kcu.column_name;

-- 4) Stock updates column behavior (self-delete currently deletes these rows).
select
  table_name,
  column_name,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'stock_updates'
  and column_name = 'updated_by';

-- 5) Auth triggers that should keep public.users/profiles in sync.
select
  t.tgname as trigger_name,
  n.nspname as trigger_schema,
  c.relname as table_name,
  p.proname as function_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and n.nspname = 'auth'
  and c.relname = 'users'
order by t.tgname;
