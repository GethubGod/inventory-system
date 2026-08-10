-- Privacy-safe Quick Order voice parse diagnostics.
--
-- Raw audio is intentionally not stored. This table keeps only the text/model
-- metadata needed to debug voice quality and user outcomes.

create table if not exists public.quick_order_voice_parse_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  session_id uuid references public.quick_order_sessions(id) on delete set null,
  raw_transcript text,
  normalized_text text,
  parsed_actions jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_code text,
  model_used text,
  fallback_used boolean not null default false,
  latency_ms int,
  confidence numeric(4,3),
  outcome text not null default 'shown'
    check (outcome in ('shown', 'accepted', 'edited', 'rejected', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quick_order_voice_parse_events_user_created_idx
  on public.quick_order_voice_parse_events(user_id, created_at desc);

create index if not exists quick_order_voice_parse_events_location_created_idx
  on public.quick_order_voice_parse_events(location_id, created_at desc);

create index if not exists quick_order_voice_parse_events_session_created_idx
  on public.quick_order_voice_parse_events(session_id, created_at desc);

drop trigger if exists set_quick_order_voice_parse_events_updated_at
  on public.quick_order_voice_parse_events;
create trigger set_quick_order_voice_parse_events_updated_at
before update on public.quick_order_voice_parse_events
for each row execute function public.set_updated_at();

alter table public.quick_order_voice_parse_events enable row level security;

drop policy if exists quick_order_voice_parse_events_select_owner_or_manager
  on public.quick_order_voice_parse_events;
create policy quick_order_voice_parse_events_select_owner_or_manager
  on public.quick_order_voice_parse_events
  for select
  to authenticated
  using (user_id = auth.uid() or public.current_user_is_manager());

grant select on public.quick_order_voice_parse_events to authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

