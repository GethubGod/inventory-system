-- Onboarding/auth phase: invites carry a works-at location group.
-- 'sushi'/'poki' resolve to that location's id at accept time (accept-invite
-- writes users.default_location_id); 'both' resolves to null (all locations).
-- Additive: existing invites keep working via the 'both' default.

alter table public.invites
  add column if not exists location_group text not null default 'both';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invites_location_group_check'
      and conrelid = 'public.invites'::regclass
  ) then
    alter table public.invites
      add constraint invites_location_group_check
      check (location_group in ('sushi', 'poki', 'both'));
  end if;
end;
$$;

comment on column public.invites.location_group is
  'Works-at group chosen by the inviting manager. Resolved to users.default_location_id by accept-invite (sushi/poki -> that location, both -> null).';
