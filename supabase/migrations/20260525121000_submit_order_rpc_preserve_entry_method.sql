-- Preserve validated Quick Order entry methods instead of forcing every
-- quick_session_id submission to quick_order. The quick session validation
-- remains the gate for voice_order and suggested_order metadata.

do $$
declare
  v_signature regprocedure := 'public.submit_order_rpc(uuid,uuid,uuid,uuid,text,jsonb,text,uuid)'::regprocedure;
  v_definition text;
  v_fixed_definition text;
  v_old text := $old$
  if p_quick_session_id is not null then
    if not exists (
      select 1
      from public.quick_order_sessions qos
      where qos.id = p_quick_session_id
        and qos.user_id = v_user_id
        and (qos.location_id is null or qos.location_id = p_location_id)
    ) then
      raise exception 'Invalid Quick Order session'
        using errcode = 'P0001';
    end if;
    v_entry_method := 'quick_order';
  elsif coalesce(p_entry_method, 'manual') <> 'manual' then
    raise exception 'Order entry metadata requires a valid Quick Order session'
      using errcode = 'P0001';
  end if;
$old$;
  v_new text := $new$
  if p_quick_session_id is not null then
    if not exists (
      select 1
      from public.quick_order_sessions qos
      where qos.id = p_quick_session_id
        and qos.user_id = v_user_id
        and (qos.location_id is null or qos.location_id = p_location_id)
    ) then
      raise exception 'Invalid Quick Order session'
        using errcode = 'P0001';
    end if;

    if coalesce(p_entry_method, 'manual') in ('manual', 'quick_order', 'voice_order', 'suggested_order') then
      v_entry_method := coalesce(p_entry_method, 'manual');
    else
      v_entry_method := 'manual';
    end if;
  elsif coalesce(p_entry_method, 'manual') <> 'manual' then
    raise exception 'Order entry metadata requires a valid Quick Order session'
      using errcode = 'P0001';
  end if;
$new$;
begin
  select pg_get_functiondef(v_signature)
  into v_definition;

  if v_definition is null then
    raise exception 'submit_order_rpc metadata signature is missing';
  end if;

  if position(v_new in v_definition) > 0 then
    return;
  end if;

  v_fixed_definition := replace(v_definition, v_old, v_new);

  if v_fixed_definition = v_definition then
    raise exception 'submit_order_rpc entry-method block did not match expected definition';
  end if;

  execute v_fixed_definition;
end;
$$;

revoke all on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.submit_order_rpc(uuid, uuid, uuid, uuid, text, jsonb, text, uuid) to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
