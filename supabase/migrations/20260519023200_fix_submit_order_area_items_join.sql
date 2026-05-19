-- Fix submit_order_rpc location catalog check.
--
-- The audit remediation migration added a server-side item/location check but
-- used ai.storage_area_id. The area_items table stores the storage-area FK as
-- area_id, so real order submissions failed at runtime with SQLSTATE 42703.

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

  if position('ai.storage_area_id' in v_definition) = 0 then
    if position('ai.area_id' in v_definition) > 0 then
      return;
    end if;

    raise exception 'submit_order_rpc area_items join did not contain the expected column reference';
  end if;

  v_fixed_definition := replace(v_definition, 'ai.storage_area_id', 'ai.area_id');
  execute v_fixed_definition;
end;
$$;

revoke all on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
