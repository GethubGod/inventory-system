-- Quick Order seed data for testing.
--
-- Run against the target Supabase database after the Quick Order
-- foundation migration (20260509134000) has been applied.
--
-- This script:
--   1. Finds the first active location.
--   2. Inserts 15 inventory items with aliases (or updates aliases on existing items).
--   3. Inserts storage areas and area_items so the parse-order catalog query finds them.
--   4. Inserts 10 parser examples.

-- Step 1: Resolve the target location.
-- If no active location exists, nothing will be inserted.

DO $$
DECLARE
  v_location_id uuid;
  v_area_id uuid;
  v_item_ids uuid[];
  v_item record;
  v_idx int;
BEGIN
  -- Find the first active location
  SELECT id INTO v_location_id
  FROM locations
  WHERE active = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RAISE NOTICE 'No active location found. Skipping seed data.';
    RETURN;
  END IF;

  RAISE NOTICE 'Using location: %', v_location_id;

  -- Step 2: Upsert inventory items with aliases
  -- We use a temp table to track inserted IDs by name
  CREATE TEMP TABLE IF NOT EXISTS _seed_items (
    idx int,
    item_id uuid,
    name text,
    category text,
    base_unit text
  ) ON COMMIT DROP;

  -- Insert or update items
  WITH items_to_seed (idx, name, aliases, base_unit, category) AS (
    VALUES
      (1,  'Salmon fillet',   ARRAY['salmon','sake','鲑鱼','salm','atlantic'], 'lb', 'fish'),
      (2,  'Tuna belly',      ARRAY['tuna','toro','ahi belly','金枪鱼'], 'lb', 'fish'),
      (3,  'Yellowtail',      ARRAY['hamachi','yellowtail','buri'], 'lb', 'fish'),
      (4,  'Eel',             ARRAY['unagi','eel','鳗鱼'], 'lb', 'fish'),
      (5,  'Albacore loin',   ARRAY['albacore','shiro','white tuna'], 'lb', 'fish'),
      (6,  'Cucumber',        ARRAY['cucumber','cuke'], 'case', 'produce'),
      (7,  'Avocado',         ARRAY['avocado','avo'], 'case', 'produce'),
      (8,  'Fresh ginger',    ARRAY['fresh ginger','ginger root'], 'lb', 'produce'),
      (9,  'Pickled ginger',  ARRAY['gari','pickled ginger','pink ginger'], 'lb', 'condiment'),
      (10, 'Wasabi paste',    ARRAY['wasabi'], 'tube', 'condiment'),
      (11, 'Soy sauce',       ARRAY['soy','shoyu','酱油'], 'gallon', 'condiment'),
      (12, 'Sushi rice',      ARRAY['rice','sushi rice'], 'bag', 'dry'),
      (13, 'Nori',            ARRAY['nori','seaweed','海苔'], 'pack', 'dry'),
      (14, 'Aluminum foil',   ARRAY['foil','aluminum'], 'case', 'packaging'),
      (15, 'To-go containers',ARRAY['containers','togo','to go'], 'case', 'packaging')
  )
  INSERT INTO _seed_items (idx, item_id, name, category, base_unit)
  SELECT
    its.idx,
    COALESCE(existing.id, gen_random_uuid()),
    its.name,
    its.category,
    its.base_unit
  FROM items_to_seed its
  LEFT JOIN inventory_items existing ON lower(existing.name) = lower(its.name)
  ON CONFLICT DO NOTHING;

  -- Insert new inventory items or update aliases on existing ones
  FOR v_item IN
    SELECT si.idx, si.item_id, si.name, si.category, si.base_unit,
           its.aliases
    FROM _seed_items si
    JOIN (
      VALUES
        (1,  ARRAY['salmon','sake','鲑鱼','salm','atlantic']),
        (2,  ARRAY['tuna','toro','ahi belly','金枪鱼']),
        (3,  ARRAY['hamachi','yellowtail','buri']),
        (4,  ARRAY['unagi','eel','鳗鱼']),
        (5,  ARRAY['albacore','shiro','white tuna']),
        (6,  ARRAY['cucumber','cuke']),
        (7,  ARRAY['avocado','avo']),
        (8,  ARRAY['fresh ginger','ginger root']),
        (9,  ARRAY['gari','pickled ginger','pink ginger']),
        (10, ARRAY['wasabi']),
        (11, ARRAY['soy','shoyu','酱油']),
        (12, ARRAY['rice','sushi rice']),
        (13, ARRAY['nori','seaweed','海苔']),
        (14, ARRAY['foil','aluminum']),
        (15, ARRAY['containers','togo','to go'])
    ) AS its(idx, aliases) ON si.idx = its.idx
  LOOP
    INSERT INTO inventory_items (id, name, aliases, base_unit, category, active)
    VALUES (v_item.item_id, v_item.name, v_item.aliases, v_item.base_unit, v_item.category, true)
    ON CONFLICT (id) DO UPDATE SET
      aliases = EXCLUDED.aliases,
      base_unit = EXCLUDED.base_unit;

    -- Also handle case where item exists by name but different id
    UPDATE inventory_items
    SET aliases = v_item.aliases
    WHERE lower(name) = lower(v_item.name) AND id != v_item.item_id;
  END LOOP;

  RAISE NOTICE 'Inserted/updated 15 inventory items with aliases.';

  -- Step 3: Ensure a storage area exists for the location and link items
  SELECT id INTO v_area_id
  FROM storage_areas
  WHERE location_id = v_location_id AND active = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_area_id IS NULL THEN
    INSERT INTO storage_areas (id, location_id, name, active)
    VALUES (gen_random_uuid(), v_location_id, 'Main Storage', true)
    RETURNING id INTO v_area_id;
    RAISE NOTICE 'Created storage area: %', v_area_id;
  END IF;

  -- Link all seed items to the storage area via area_items
  FOR v_item IN SELECT item_id, base_unit FROM _seed_items
  LOOP
    INSERT INTO area_items (area_id, inventory_item_id, unit_type, active)
    VALUES (v_area_id, v_item.item_id, v_item.base_unit, true)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Linked items to storage area %', v_area_id;

  -- Step 4: Insert parser examples
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

  RAISE NOTICE 'Inserted parser examples.';
  RAISE NOTICE 'Quick Order seed data complete for location %', v_location_id;
END $$;
