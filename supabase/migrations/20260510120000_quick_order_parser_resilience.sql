-- Backward-compatible parser resilience fields.

alter table public.inventory_items
  add column if not exists allowed_units text[];

alter table public.parser_corrections
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists correction_type text;

create index if not exists parser_corrections_user_location_raw_created_idx
  on public.parser_corrections(user_id, location_id, raw_token, created_at desc);

alter table public.parser_usage_log
  add column if not exists metrics jsonb not null default '{}'::jsonb;

insert into public.parser_examples (raw_text, structured_output, source, is_active) values
  ('Tuna loin 1cs
1pc salmon
1cs tai
Unii 1 oz
Beef brisket 4lb
1 lb escolar',
   '[
      {"item_name":"Tuna Loin","quantity":1,"unit":"cs"},
      {"item_name":"Salmon","quantity":1,"unit":"pc"},
      {"item_name":"Tai","quantity":1,"unit":"cs","needs_clarification":true},
      {"item_name":"Uni","quantity":1,"unit":"oz"},
      {"item_name":"Beef Brisket","quantity":4,"unit":"lb"},
      {"item_name":"Escolar","quantity":1,"unit":"lb"}
    ]'::jsonb,
   'seed',
   true),
  ('Existing: Salmon 4 cs; Input: salmon 2cs',
   '{"expected":"pending conflict asking add vs replace"}'::jsonb,
   'seed',
   true),
  ('Existing: Salmon 4 cs; Input: add salmon 2cs',
   '{"expected":"Salmon 6 cs"}'::jsonb,
   'seed',
   true),
  ('Existing: Salmon 4 cs; Input: change salmon to 2cs',
   '{"expected":"Salmon 2 cs"}'::jsonb,
   'seed',
   true),
  ('Existing: Salmon 4 cs; Input: salmon 4pc',
   '{"expected":"pending conflict asking add separate vs replace"}'::jsonb,
   'seed',
   true),
  ('Existing: Salmon 4 cs; Input: add salmon 4pc',
   '{"expected":"add separate Salmon 4 pc line"}'::jsonb,
   'seed',
   true),
  ('Existing: Salmon 4 cs; Input: actually salmon 4pc',
   '{"expected":"replace Salmon 4 cs with Salmon 4 pc"}'::jsonb,
   'seed',
   true);

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
