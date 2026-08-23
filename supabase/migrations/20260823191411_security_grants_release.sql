-- Remove default PUBLIC/anon execution from SECURITY DEFINER helpers. Trigger
-- functions do not need RPC execution privileges; RLS helpers remain available
-- to authenticated users and the service role.
revoke all on function public.enforce_order_metadata_security() from public, anon, authenticated;
revoke all on function public.enforce_profile_security() from public, anon, authenticated;
revoke all on function public.enforce_user_security() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user_profile() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.link_employee_quick_order_aliases_for_profile() from public, anon, authenticated;
revoke all on function public.link_employee_quick_order_aliases_for_user() from public, anon, authenticated;
revoke all on function public.link_historical_imports_for_user() from public, anon, authenticated;
revoke all on function public.resolve_active_reminders_for_employee(uuid, timestamp with time zone, uuid) from public, anon, authenticated;
revoke all on function public.resolve_active_reminders_on_order_insert() from public, anon, authenticated;
revoke all on function public.sync_auth_user_identity() from public, anon, authenticated;
revoke all on function public.sync_profile_email_from_auth_user() from public, anon, authenticated;
revoke all on function public.sync_profile_last_order_at() from public, anon, authenticated;

grant execute on function public.enforce_order_metadata_security() to service_role;
grant execute on function public.enforce_profile_security() to service_role;
grant execute on function public.enforce_user_security() to service_role;
grant execute on function public.handle_new_auth_user_profile() to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.link_employee_quick_order_aliases_for_profile() to service_role;
grant execute on function public.link_employee_quick_order_aliases_for_user() to service_role;
grant execute on function public.link_historical_imports_for_user() to service_role;
grant execute on function public.resolve_active_reminders_for_employee(uuid, timestamp with time zone, uuid) to service_role;
grant execute on function public.resolve_active_reminders_on_order_insert() to service_role;
grant execute on function public.sync_auth_user_identity() to service_role;
grant execute on function public.sync_profile_email_from_auth_user() to service_role;
grant execute on function public.sync_profile_last_order_at() to service_role;

revoke all on function public.has_org_role(uuid, text[]) from public, anon;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.org_has_members(uuid) from public, anon;
grant execute on function public.has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.org_has_members(uuid) to authenticated, service_role;

-- This hydration RPC intentionally retains anon execution. During sign-in the
-- gateway can briefly evaluate a valid session request as anon; the function
-- still rejects the call unless auth.uid() is present and delegates to a
-- service-role-only upsert helper.
revoke all on function public.ensure_current_user_identity() from public;
grant execute on function public.ensure_current_user_identity() to anon, authenticated, service_role;

-- Pin search paths so invoker functions cannot resolve attacker-controlled
-- objects. Public schema CREATE remains restricted to database owners.
alter function public.set_org_settings_updated_at() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.normalize_quick_order_employee_name(text) set search_path = public;
alter function public.normalize_quick_order_alias_text(text) set search_path = public;
alter function public.get_dow_suggestions(uuid, numeric, integer) set search_path = public;
alter function public.get_dow_suggestions(uuid, numeric, integer, uuid) set search_path = public;
alter function public.get_recent_orders(uuid, integer) set search_path = public;
alter function public.get_recent_orders(uuid, integer, uuid) set search_path = public;
alter function public.set_profiles_updated_at() set search_path = public;
alter function public.get_usual_order(uuid, numeric, integer, uuid, integer) set search_path = public;
alter function public.normalize_history_employee_name(text) set search_path = public;
alter function public.get_last_inventory_session_items(uuid, uuid) set search_path = public;

-- Read-only recommendation RPCs are app features, but never anonymous APIs.
revoke all on function public.get_dow_suggestions(uuid, numeric, integer) from public, anon;
revoke all on function public.get_dow_suggestions(uuid, numeric, integer, uuid) from public, anon;
revoke all on function public.get_recent_orders(uuid, integer) from public, anon;
revoke all on function public.get_recent_orders(uuid, integer, uuid) from public, anon;
revoke all on function public.get_usual_order(uuid, numeric, integer, uuid, integer) from public, anon;
revoke all on function public.get_last_inventory_session_items(uuid, uuid) from public, anon;
grant execute on function public.get_dow_suggestions(uuid, numeric, integer) to authenticated, service_role;
grant execute on function public.get_dow_suggestions(uuid, numeric, integer, uuid) to authenticated, service_role;
grant execute on function public.get_recent_orders(uuid, integer) to authenticated, service_role;
grant execute on function public.get_recent_orders(uuid, integer, uuid) to authenticated, service_role;
grant execute on function public.get_usual_order(uuid, numeric, integer, uuid, integer) to authenticated, service_role;
grant execute on function public.get_last_inventory_session_items(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
