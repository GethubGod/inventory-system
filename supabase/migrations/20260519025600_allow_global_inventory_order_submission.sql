-- Treat inventory_items as the global orderable catalog.
--
-- The audit hardening added a per-location area_items check in submit_order_rpc.
-- That does not match the app's ordering model: every active inventory item can
-- be submitted for either location. Keep the active inventory validation, but
-- remove the location-specific area_items gate.

do $$
declare
  v_signature regprocedure := 'public.submit_order_rpc(uuid,uuid,uuid,uuid,text,jsonb,text,uuid)'::regprocedure;
  v_definition text;
  v_fixed_definition text;
begin
  select pg_get_functiondef(v_signature)
  into v_definition;

  if v_definition is null then
    raise exception 'submit_order_rpc metadata signature is missing';
  end if;

  v_fixed_definition := regexp_replace(
    v_definition,
    E'[[:space:]]+if not exists \\([[:space:]]+select 1[[:space:]]+from public\\.area_items ai[[:space:]]+join public\\.storage_areas sa on sa\\.id = ai\\.area_id[[:space:]]+where ai\\.inventory_item_id = v_inventory_item_id[[:space:]]+and sa\\.location_id = p_location_id[[:space:]]+and coalesce\\(ai\\.active, true\\)[[:space:]]+and coalesce\\(sa\\.active, true\\)[[:space:]]+\\) then[[:space:]]+raise exception ''Inventory item is not available for this location''[[:space:]]+using errcode = ''P0001'';[[:space:]]+end if;',
    '',
    'n'
  );

  if v_fixed_definition = v_definition then
    if position('Inventory item is not available for this location' in v_definition) > 0 then
      raise exception 'submit_order_rpc still contains the location-specific availability check';
    end if;

    return;
  end if;

  execute v_fixed_definition;
end;
$$;

revoke all on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
