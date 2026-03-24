-- Harden identity repair RPC permissions for mobile auth hydration.
-- The client can call ensure_current_user_identity() immediately after sign-in,
-- and some environments evaluate the request under anon before JWT role
-- resolution fully settles. The function already checks auth.uid(), so granting
-- execute to anon is safe and avoids a 42501 permission failure.

grant usage on schema public to anon, authenticated, service_role;

do $$
begin
  if to_regprocedure('public.upsert_identity_from_auth_user(uuid)') is not null then
    execute 'alter function public.upsert_identity_from_auth_user(uuid) owner to postgres';
  end if;

  if to_regprocedure('public.ensure_current_user_identity()') is not null then
    execute 'alter function public.ensure_current_user_identity() owner to postgres';
  end if;

  if to_regprocedure('public.sync_auth_user_identity()') is not null then
    execute 'alter function public.sync_auth_user_identity() owner to postgres';
  end if;
end
$$;

revoke all on function public.upsert_identity_from_auth_user(uuid) from public, anon, authenticated;
grant execute on function public.upsert_identity_from_auth_user(uuid) to service_role;

revoke all on function public.ensure_current_user_identity() from public;
grant execute on function public.ensure_current_user_identity() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
