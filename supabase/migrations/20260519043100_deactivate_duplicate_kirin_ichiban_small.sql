-- Global Quick Order uses active inventory_items as the parser catalog.
-- Keep exact-name matching deterministic by deactivating the duplicate
-- unreferenced Kirin Ichiban Small row.

do $$
declare
  v_remaining integer;
begin
  update public.inventory_items ii
  set active = false
  where ii.id in (
    select ranked.id
    from (
      select
        id,
        row_number() over (order by created_at nulls last, id) as duplicate_rank
      from public.inventory_items
      where active = true
        and regexp_replace(
          trim(regexp_replace(lower(regexp_replace(replace(name, '&', ' and '), '[()\[\]{}\/,\-_]+', ' ', 'g')), '[^[:alnum:][:space:]'']+', ' ', 'g')),
          '\s+',
          ' ',
          'g'
        ) = 'kirin ichiban small'
    ) as ranked
    where ranked.duplicate_rank > 1
  )
    and not exists (
      select 1
      from public.area_items ai
      where ai.inventory_item_id = ii.id
    )
    and not exists (
      select 1
      from public.order_items oi
      where oi.inventory_item_id = ii.id
    );

  select count(*)
  into v_remaining
  from public.inventory_items
  where active = true
    and regexp_replace(
      trim(regexp_replace(lower(regexp_replace(replace(name, '&', ' and '), '[()\[\]{}\/,\-_]+', ' ', 'g')), '[^[:alnum:][:space:]'']+', ' ', 'g')),
      '\s+',
      ' ',
      'g'
    ) = 'kirin ichiban small';

  if v_remaining > 1 then
    raise exception 'Could not safely resolve duplicate active Kirin Ichiban Small inventory rows';
  end if;
end;
$$;
