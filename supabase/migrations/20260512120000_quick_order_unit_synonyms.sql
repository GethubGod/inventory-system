-- Data-driven Quick Order unit synonyms.

insert into public.app_config (key, value, description) values
  (
    'quick_order_unit_synonyms',
    '{
      "caja": "box",
      "cajas": "box",
      "bolsa": "bag",
      "bolsas": "bag",
      "paquete": "pack",
      "paquetes": "pack",
      "libra": "lb",
      "libras": "lb",
      "pieza": "pc",
      "piezas": "pc",
      "ケース": "cs",
      "箱": "box",
      "袋": "bag",
      "包": "pack",
      "盒": "box",
      "袋装": "bag"
    }'::jsonb,
    'Additional raw unit word to canonical unit mappings for Quick Order parsing.'
  )
on conflict (key) do nothing;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
