alter table public.quick_order_voice_parse_events
  add column if not exists latency_breakdown jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
