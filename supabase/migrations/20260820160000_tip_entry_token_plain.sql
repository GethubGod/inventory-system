-- Manager-viewable copy of each location's entry token, so the dashboard can
-- render and reprint the QR sticker at any time (accepted usability tradeoff
-- over hash-only storage, per David 2026-08-20). Entry devices still validate
-- against the hash; the plaintext column is reachable only through the
-- manager-read RLS policy plus this column grant.

alter table public.tip_location_access
  add column if not exists entry_token_plain text;

grant select (entry_token_plain) on table public.tip_location_access to authenticated;

create or replace function public.tip_rotate_entry_token(p_location_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  if not public.current_user_is_manager() then
    raise exception 'Only managers can rotate entry tokens';
  end if;
  if not exists (select 1 from public.locations where id = p_location_id) then
    raise exception 'Unknown location';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');

  insert into public.tip_location_access (location_id, entry_token_hash, entry_token_plain, token_rotated_at, updated_by)
  values (p_location_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_token, now(), auth.uid())
  on conflict (location_id) do update
    set entry_token_hash = excluded.entry_token_hash,
        entry_token_plain = excluded.entry_token_plain,
        token_rotated_at = excluded.token_rotated_at,
        updated_by = excluded.updated_by;

  return v_token;
end;
$$;
