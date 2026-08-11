-- A tip slot belongs to the QR-scanned entry session that first records it.
-- The RPC below allows that same session to safely retry but prevents another
-- device from replacing the entry in place.

alter table public.tip_entries
  add column entry_session_id uuid references public.tip_entry_sessions(id) on delete set null;

-- The product moved from persistent device sessions (180-day default) to
-- per-scan sessions: revoke everything already minted so every device
-- re-scans after this deploys, and shorten the default expiry to match the
-- 12h the edge function now sets explicitly.
update public.tip_entry_sessions set revoked = true where not revoked;
alter table public.tip_entry_sessions
  alter column expires_at set default (now() + interval '12 hours');

-- CREATE OR REPLACE cannot change an RPC signature. This is the original
-- 12-parameter tip_save_entry definition from the tips foundation migration.
drop function public.tip_save_entry(
  date, uuid, text, numeric, numeric, uuid[], text, text, integer, uuid, boolean, text
);

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
declare
  v_entry_id uuid;
begin
  if array_length(p_people, 1) is null or array_length(p_people, 1) < 1 then
    raise exception 'At least one person must split the entry';
  end if;

  -- The conflict update locks the existing slot before its session identity is
  -- checked, so concurrent saves from different devices cannot race past this
  -- guard. A false WHERE clause returns no row, which maps to the explicit
  -- already-recorded response below.
  insert into public.tip_entries (
    business_date, location_id, meal_period, cash_amount, card_amount,
    split_count, entry_method, voice_variant, corrections_count,
    entered_by, flagged_anomaly, anomaly_reason, entry_session_id
  ) values (
    p_business_date, p_location_id, p_meal_period, p_cash, p_card,
    array_length(p_people, 1), p_entry_method,
    case when p_entry_method = 'voice' then p_voice_variant else null end,
    p_corrections, p_entered_by, p_flagged, p_anomaly_reason, p_session_id
  )
  on conflict (business_date, location_id, meal_period) do update
    set cash_amount = excluded.cash_amount,
        card_amount = excluded.card_amount,
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
  insert into public.tip_entry_people (tip_entry_id, tip_employee_id)
  select v_entry_id, unnest(p_people);

  return v_entry_id;
end;
$$;

revoke all on function public.tip_save_entry(
  date, uuid, text, numeric, numeric, uuid[], text, text, integer, uuid, boolean, text, uuid
) from public, anon, authenticated;

grant execute on function public.tip_save_entry(
  date, uuid, text, numeric, numeric, uuid[], text, text, integer, uuid, boolean, text, uuid
) to service_role;
