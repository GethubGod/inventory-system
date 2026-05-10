-- Quick Order test data seed migration.
--
-- Inserts inventory items with aliases and parser examples so the
-- parse-order edge function has data to work with in mock and live mode.
--
-- This migration is idempotent (uses ON CONFLICT DO NOTHING/UPDATE).

-- Update aliases on any existing items that match by name
UPDATE inventory_items SET aliases = ARRAY['salmon','sake','鲑鱼','salm','atlantic']
WHERE lower(name) LIKE '%salmon%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['tuna','toro','ahi belly','金枪鱼']
WHERE lower(name) LIKE '%tuna%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['hamachi','yellowtail','buri']
WHERE lower(name) LIKE '%yellowtail%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['unagi','eel','鳗鱼']
WHERE lower(name) LIKE '%eel%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['albacore','shiro','white tuna']
WHERE lower(name) LIKE '%albacore%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['cucumber','cuke']
WHERE lower(name) LIKE '%cucumber%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['avocado','avo']
WHERE lower(name) LIKE '%avocado%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['fresh ginger','ginger root']
WHERE lower(name) LIKE '%fresh ginger%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['gari','pickled ginger','pink ginger']
WHERE lower(name) LIKE '%pickled ginger%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['wasabi']
WHERE lower(name) LIKE '%wasabi%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['soy','shoyu','酱油']
WHERE lower(name) LIKE '%soy%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['rice','sushi rice']
WHERE lower(name) LIKE '%rice%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['nori','seaweed','海苔']
WHERE lower(name) LIKE '%nori%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['foil','aluminum']
WHERE lower(name) LIKE '%foil%' AND (aliases IS NULL OR aliases = '{}');

UPDATE inventory_items SET aliases = ARRAY['containers','togo','to go']
WHERE lower(name) LIKE '%container%' AND (aliases IS NULL OR aliases = '{}');

-- Insert parser examples (these don't depend on location)
INSERT INTO parser_examples (raw_text, structured_output, source, is_active) VALUES
  ('salmon 2lb, tuna 3',
   '[{"item_name":"Salmon fillet","quantity":2,"unit":"lb"},{"item_name":"Tuna belly","quantity":3,"unit":"lb"}]'::jsonb,
   'seed', true),
  ('鲑鱼 2',
   '[{"item_name":"Salmon fillet","quantity":2,"unit":"lb"}]'::jsonb,
   'seed', true),
  ('salm 1, toro 2pc',
   '[{"item_name":"Salmon fillet","quantity":1,"unit":"lb"},{"item_name":"Tuna belly","quantity":2,"unit":"pc"}]'::jsonb,
   'seed', true),
  ('ginger',
   '[{"item_name":"ginger","quantity":null,"unit":null,"needs_clarification":true}]'::jsonb,
   'seed', true),
  ('cucumber 2 cases, avocado 1',
   '[{"item_name":"Cucumber","quantity":2,"unit":"case"},{"item_name":"Avocado","quantity":1,"unit":"case"}]'::jsonb,
   'seed', true),
  ('make that 4 not 3',
   '[{"item_name":"(previous item)","quantity":4,"unit":null,"notes":"edit_intent"}]'::jsonb,
   'seed', true),
  ('also 2 lb eel',
   '[{"item_name":"Eel","quantity":2,"unit":"lb"}]'::jsonb,
   'seed', true),
  ('foil 1 case, containers 2',
   '[{"item_name":"Aluminum foil","quantity":1,"unit":"case"},{"item_name":"To-go containers","quantity":2,"unit":"case"}]'::jsonb,
   'seed', true),
  ('海苔 5 pack',
   '[{"item_name":"Nori","quantity":5,"unit":"pack"}]'::jsonb,
   'seed', true),
  ('soy sauce 2 gallons',
   '[{"item_name":"Soy sauce","quantity":2,"unit":"gallon"}]'::jsonb,
   'seed', true)
ON CONFLICT DO NOTHING;

notify pgrst, 'reload schema';
