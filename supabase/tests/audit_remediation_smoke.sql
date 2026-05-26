-- Smoke checks for the audit remediation migration.
-- Intended to run after `supabase db reset` or against a disposable local DB.

do $$
begin
  if to_regprocedure('public.validate_access_code_attempt(text,text,text)') is null then
    raise exception 'validate_access_code_attempt RPC is missing';
  end if;

  if to_regprocedure('public.submit_order_rpc(uuid,uuid,uuid,uuid,text,jsonb,text,uuid)') is null then
    raise exception 'submit_order_rpc metadata signature is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'area_items'
      and column_name = 'area_id'
  ) then
    raise exception 'area_items.area_id column is missing';
  end if;

  if position(
    'ai.storage_area_id'
    in pg_get_functiondef('public.submit_order_rpc(uuid,uuid,uuid,uuid,text,jsonb,text,uuid)'::regprocedure)
  ) > 0 then
    raise exception 'submit_order_rpc still references ai.storage_area_id';
  end if;

  if position(
    'Inventory item is not available for this location'
    in pg_get_functiondef('public.submit_order_rpc(uuid,uuid,uuid,uuid,text,jsonb,text,uuid)'::regprocedure)
  ) > 0 then
    raise exception 'submit_order_rpc still blocks globally available items by location';
  end if;

  if position(
    'v_entry_method := ''quick_order'';'
    in pg_get_functiondef('public.submit_order_rpc(uuid,uuid,uuid,uuid,text,jsonb,text,uuid)'::regprocedure)
  ) > 0 then
    raise exception 'submit_order_rpc still forces every quick session to quick_order';
  end if;

  if position(
    '''voice_order'''
    in pg_get_functiondef('public.submit_order_rpc(uuid,uuid,uuid,uuid,text,jsonb,text,uuid)'::regprocedure)
  ) = 0 then
    raise exception 'submit_order_rpc does not preserve voice_order entry metadata';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'enforce_order_metadata_security'
      and tgrelid = 'public.orders'::regclass
      and not tgisinternal
  ) then
    raise exception 'order metadata anti-spoof trigger is missing';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_items'
      and policyname = 'order_items_select_owner_or_manager'
  ) then
    raise exception 'order_items owner/manager select policy is missing';
  end if;

  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'access_code_rate_limits',
        'access_code_validation_events',
        'access_code_role_grants'
      )
    group by table_schema
    having count(*) = 3
  ) then
    raise exception 'access-code throttling/audit tables are missing';
  end if;
end;
$$;
