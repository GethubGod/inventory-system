-- Migration: Create public.unit_synonyms table for dynamic sheet-driven unit synonyms.

create table if not exists public.unit_synonyms (
  id uuid primary key default gen_random_uuid(),
  from_unit text not null,
  to_unit text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique index to prevent duplicate synonym mappings
create unique index if not exists unit_synonyms_from_unit_unique_idx
  on public.unit_synonyms (lower(trim(from_unit)));

-- Enable RLS
alter table public.unit_synonyms enable row level security;

-- Policies
create policy unit_synonyms_read_authenticated
  on public.unit_synonyms
  for select
  to authenticated
  using (true);

create policy unit_synonyms_all_service_role
  on public.unit_synonyms
  for all
  to service_role
  using (true)
  with check (true);

-- Seed with the existing default box -> case synonym
insert into public.unit_synonyms (from_unit, to_unit) values
  ('box', 'cs')
on conflict (lower(trim(from_unit))) do nothing;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
