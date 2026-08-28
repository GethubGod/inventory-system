alter table public.tip_entries
  add column gratuity_amount   numeric(10,2) not null default 0,
  add column entered_scope      text not null default 'shift'
      check (entered_scope in ('shift','day')),
  add column raw_cash_amount    numeric(10,2),
  add column raw_card_amount    numeric(10,2),
  add column raw_gratuity_amount numeric(10,2),
  add column note               text,
  add column note_at            timestamptz;

alter table public.tip_entry_people
  add column share_weight numeric(4,3) not null default 1
      check (share_weight > 0 and share_weight <= 1);

alter table public.tip_entries
  add constraint tip_entries_gratuity_amount_check
    check (gratuity_amount >= 0),
  add constraint tip_entries_note_check
    check (
      note is null
      or (note = btrim(note) and char_length(note) between 1 and 280)
    );

-- Replace the session-guarded save RPC with the Tips v3 signature. The
-- 13-argument signature is recreated below as a deploy-window wrapper.
drop function public.tip_save_entry(
  date, uuid, text, numeric, numeric, uuid[], text, text, integer, uuid, boolean, text, uuid
);

create function public.tip_save_entry(
  p_business_date date,
  p_location_id uuid,
  p_meal_period text,
  p_cash numeric,
  p_card numeric,
  p_gratuity numeric,
  p_entered_scope text,
  p_raw_cash numeric,
  p_raw_card numeric,
  p_raw_gratuity numeric,
  p_people uuid[],
  p_weights numeric[],
  p_note text,
  p_entry_method text,
  p_voice_variant text,
  p_corrections integer,
  p_entered_by uuid,
  p_flagged boolean,
  p_anomaly_reason text,
  p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
begin
  if array_length(p_people, 1) is null or array_length(p_people, 1) < 1 then
    raise exception 'At least one person must split the entry';
  end if;

  if coalesce(array_length(p_weights, 1), 0) <> array_length(p_people, 1) then
    raise exception using errcode = '22023', message = 'Weights must match people';
  end if;

  -- The conflict update locks the existing slot before its session identity is
  -- checked, so concurrent saves from different devices cannot race past this
  -- guard. A false WHERE clause returns no row, which maps to the explicit
  -- already-recorded response below.
  insert into public.tip_entries (
    business_date, location_id, meal_period, cash_amount, card_amount,
    gratuity_amount, entered_scope, raw_cash_amount, raw_card_amount,
    raw_gratuity_amount, note, note_at, split_count, entry_method,
    voice_variant, corrections_count, entered_by, flagged_anomaly,
    anomaly_reason, entry_session_id
  ) values (
    p_business_date, p_location_id, p_meal_period, p_cash, p_card,
    p_gratuity, p_entered_scope, p_raw_cash, p_raw_card, p_raw_gratuity,
    p_note, case when p_note is null then null else now() end,
    array_length(p_people, 1), p_entry_method,
    case when p_entry_method = 'voice' then p_voice_variant else null end,
    p_corrections, p_entered_by, p_flagged, p_anomaly_reason, p_session_id
  )
  on conflict (business_date, location_id, meal_period) do update
    set cash_amount = excluded.cash_amount,
        card_amount = excluded.card_amount,
        gratuity_amount = excluded.gratuity_amount,
        entered_scope = excluded.entered_scope,
        raw_cash_amount = excluded.raw_cash_amount,
        raw_card_amount = excluded.raw_card_amount,
        raw_gratuity_amount = excluded.raw_gratuity_amount,
        note_at = case
          when public.tip_entries.note is distinct from excluded.note then now()
          else public.tip_entries.note_at
        end,
        note = excluded.note,
        split_count = excluded.split_count,
        entry_method = excluded.entry_method,
        voice_variant = coalesce(excluded.voice_variant, public.tip_entries.voice_variant),
        corrections_count = case
          when excluded.entry_method = 'voice' then excluded.corrections_count
          else public.tip_entries.corrections_count
        end,
        entered_by = excluded.entered_by,
        flagged_anomaly = excluded.flagged_anomaly,
        anomaly_reason = excluded.anomaly_reason,
        entry_session_id = excluded.entry_session_id
    where public.tip_entries.entry_session_id is not distinct from p_session_id
  returning id into v_entry_id;

  if v_entry_id is null then
    raise exception using errcode = 'P0001', message = 'already_recorded';
  end if;

  delete from public.tip_entry_people where tip_entry_id = v_entry_id;
  insert into public.tip_entry_people (tip_entry_id, tip_employee_id, share_weight)
  select v_entry_id, person.person_id, p_weights[person.position::integer]
  from unnest(p_people) with ordinality as person(person_id, position);

  return v_entry_id;
end;
$$;

comment on function public.tip_save_entry(
  date, uuid, text, numeric, numeric, numeric, text, numeric, numeric, numeric,
  uuid[], numeric[], text, text, text, integer, uuid, boolean, text, uuid
) is
  'Tips v3 save: p_cash/p_card/p_gratuity are server-derived shift amounts; p_raw_cash/p_raw_card/p_raw_gratuity are the closer-typed amounts. Day-scope derivation lives in the edge function, not SQL.';

-- Compatibility signature for the old deployed edge function. Its inputs
-- already represent shift-only amounts, so raw values match derived values.
create function public.tip_save_entry(
  p_business_date date,
  p_location_id uuid,
  p_meal_period text,
  p_cash numeric,
  p_card numeric,
  p_people uuid[],
  p_entry_method text,
  p_voice_variant text,
  p_corrections integer,
  p_entered_by uuid,
  p_flagged boolean,
  p_anomaly_reason text,
  p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.tip_save_entry(
    p_business_date,
    p_location_id,
    p_meal_period,
    p_cash,
    p_card,
    0,
    'shift',
    p_cash,
    p_card,
    0,
    p_people,
    array_fill(1::numeric, array[coalesce(array_length(p_people, 1), 0)]),
    null,
    p_entry_method,
    p_voice_variant,
    p_corrections,
    p_entered_by,
    p_flagged,
    p_anomaly_reason,
    p_session_id
  );
end;
$$;

revoke all on function public.tip_save_entry(
  date, uuid, text, numeric, numeric, numeric, text, numeric, numeric, numeric,
  uuid[], numeric[], text, text, text, integer, uuid, boolean, text, uuid
) from public, anon, authenticated;

grant execute on function public.tip_save_entry(
  date, uuid, text, numeric, numeric, numeric, text, numeric, numeric, numeric,
  uuid[], numeric[], text, text, text, integer, uuid, boolean, text, uuid
) to service_role;

revoke all on function public.tip_save_entry(
  date, uuid, text, numeric, numeric, uuid[], text, text, integer, uuid, boolean, text, uuid
) from public, anon, authenticated;

grant execute on function public.tip_save_entry(
  date, uuid, text, numeric, numeric, uuid[], text, text, integer, uuid, boolean, text, uuid
) to service_role;

-- PR #17 made manager corrections atomic. Replace that pre-v3 signature so
-- gratuity, scope, raw figures, note, people, and weights remain one change.
drop function public.tip_manager_fix_entry(uuid, numeric, numeric, uuid[]);

create function public.tip_manager_fix_entry(
  p_entry_id uuid,
  p_cash numeric,
  p_card numeric,
  p_gratuity numeric,
  p_entered_scope text,
  p_raw_cash numeric,
  p_raw_card numeric,
  p_raw_gratuity numeric,
  p_people uuid[],
  p_weights numeric[],
  p_note text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can fix tip entries';
  end if;

  if p_cash is null or p_card is null or p_gratuity is null
     or p_cash < 0 or p_card < 0 or p_gratuity < 0
     or p_cash >= 100000 or p_card >= 100000 or p_gratuity >= 100000 then
    raise exception 'Amounts must be between 0 and 99,999.99';
  end if;

  if p_entered_scope is null or p_entered_scope not in ('shift', 'day') then
    raise exception 'Entered scope must be shift or day';
  end if;

  if p_raw_cash is null or p_raw_card is null or p_raw_gratuity is null
     or p_raw_cash < 0 or p_raw_card < 0 or p_raw_gratuity < 0
     or p_raw_cash >= 100000 or p_raw_card >= 100000 or p_raw_gratuity >= 100000 then
    raise exception 'Raw amounts must be between 0 and 99,999.99';
  end if;

  if p_note is not null
     and (p_note <> btrim(p_note) or char_length(p_note) not between 1 and 280) then
    raise exception 'Note must be trimmed and no more than 280 characters';
  end if;

  if cardinality(p_people) is null or cardinality(p_people) < 1 then
    raise exception 'At least one person must split the entry';
  end if;
  if cardinality(p_people) > 30 then
    raise exception 'No more than 30 people can split an entry';
  end if;
  if cardinality(p_weights) is distinct from cardinality(p_people) then
    raise exception 'Weights must match people';
  end if;
  if exists (
    select 1
    from unnest(p_weights) as weight(value)
    where value is null or value <= 0 or value > 1
  ) then
    raise exception 'Weights must be greater than zero and no more than one';
  end if;
  if (select count(distinct person.id) from unnest(p_people) as person(id))
     <> cardinality(p_people) then
    raise exception 'People must not contain duplicates';
  end if;

  -- Every person must be on the roster (active or not — history may include
  -- deactivated staff who were on the original split).
  if exists (
    select 1
    from unnest(p_people) as person(id)
    left join public.tip_employees as employee on employee.id = person.id
    where employee.id is null
  ) then
    raise exception 'Someone selected is not on the roster';
  end if;

  update public.tip_entries as entry
  set cash_amount = p_cash,
      card_amount = p_card,
      gratuity_amount = p_gratuity,
      entered_scope = p_entered_scope,
      raw_cash_amount = p_raw_cash,
      raw_card_amount = p_raw_card,
      raw_gratuity_amount = p_raw_gratuity,
      note_at = case
        when entry.note is distinct from p_note
          then case when p_note is null then null else now() end
        else entry.note_at
      end,
      note = p_note,
      split_count = cardinality(p_people)
  where entry.id = p_entry_id;

  if not found then
    raise exception 'Unknown entry';
  end if;

  delete from public.tip_entry_people where tip_entry_id = p_entry_id;
  insert into public.tip_entry_people (tip_entry_id, tip_employee_id, share_weight)
  select p_entry_id, person.person_id, p_weights[person.position::integer]
  from unnest(p_people) with ordinality as person(person_id, position);
end;
$$;

revoke all on function public.tip_manager_fix_entry(
  uuid, numeric, numeric, numeric, text, numeric, numeric, numeric, uuid[], numeric[], text
) from public, anon;

grant execute on function public.tip_manager_fix_entry(
  uuid, numeric, numeric, numeric, text, numeric, numeric, numeric, uuid[], numeric[], text
) to authenticated, service_role;
