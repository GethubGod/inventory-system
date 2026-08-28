-- Atomic manager "Fix" for a recorded tip entry.
--
-- The dashboard's Fix dialog previously did insert-people → update-amounts →
-- delete-people as three separate PostgREST calls. A failure mid-sequence
-- left the entry with a mixed roster / wrong split_count. This RPC performs
-- the whole edit in one transaction, guarded by the same manager check the
-- RLS policies use.

create or replace function public.tip_manager_fix_entry(
  p_entry_id uuid,
  p_cash numeric,
  p_card numeric,
  p_people uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_people uuid[];
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can fix tip entries';
  end if;

  if p_cash is null or p_card is null
     or p_cash < 0 or p_card < 0
     or p_cash >= 100000 or p_card >= 100000 then
    raise exception 'Amounts must be between 0 and 99,999.99';
  end if;

  -- Match the entry API's 30-person cap and collapse duplicate ids so the
  -- stored split_count can never disagree with the join table.
  select array_agg(person.id order by person.id)
  into v_people
  from (select distinct unnest(p_people) as id) as person;

  if cardinality(v_people) is null or cardinality(v_people) < 1 then
    raise exception 'At least one person must split the entry';
  end if;
  if cardinality(v_people) > 30 then
    raise exception 'No more than 30 people can split an entry';
  end if;

  -- Every person must be on the roster (active or not — history may include
  -- deactivated staff who were on the original split).
  if exists (
    select 1
    from unnest(v_people) as person(id)
    left join public.tip_employees e on e.id = person.id
    where e.id is null
  ) then
    raise exception 'Someone selected is not on the roster';
  end if;

  update public.tip_entries
  set cash_amount = p_cash,
      card_amount = p_card,
      split_count = cardinality(v_people)
  where id = p_entry_id;

  if not found then
    raise exception 'Unknown entry';
  end if;

  delete from public.tip_entry_people where tip_entry_id = p_entry_id;
  insert into public.tip_entry_people (tip_entry_id, tip_employee_id)
  select p_entry_id, unnest(v_people);
end;
$$;

revoke all on function public.tip_manager_fix_entry(uuid, numeric, numeric, uuid[]) from public, anon;
grant execute on function public.tip_manager_fix_entry(uuid, numeric, numeric, uuid[]) to authenticated, service_role;
