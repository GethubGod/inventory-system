import { supabase } from '@/lib/supabase';

type LocationRow = {
  id: string;
  name: string;
  short_code: string;
  active?: boolean | null;
};

type InventoryRow = {
  id: string;
  name: string;
  category: string;
  base_unit?: string | null;
};

const ALCOHOL_ITEMS = [
  'Sapporo Premium (Small)',
  'Sapporo Premium (Large)',
  'Asahi Super Dry (Small)',
  'Asahi Super Dry (Large)',
  'Kirin Ichiban (Small)',
  'Kirin Ichiban (Large)',
  'House Hot Sake (Large Carafe)',
  'House Hot Sake (Small Carafe)',
  'Nigori Unfiltered Sake (375ml)',
  'Junmai Ginjo (300ml)',
];

const STATIONS = [
  {
    name: 'Alcohol Station',
    description: 'Bar area and fridges',
    check_frequency: 'weekly',
    icon: '🍺',
    sort_order: 6,
  },
  {
    name: 'Freezer Station',
    description: 'Walk-in freezer and chest freezers',
    check_frequency: 'every_2_days',
    icon: '❄️',
    sort_order: 7,
  },
];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const isSushiLocation = (location: LocationRow) => {
  const name = location.name?.toLowerCase() ?? '';
  const short = location.short_code?.toLowerCase() ?? '';
  return name.includes('sushi') || short.startsWith('s');
};

const isPokiLocation = (location: LocationRow) => {
  const name = location.name?.toLowerCase() ?? '';
  const short = location.short_code?.toLowerCase() ?? '';
  return name.includes('poki') || name.includes('poke') || name.includes('pho') || short.startsWith('p');
};

const getMinMax = (item: InventoryRow) => {
  if (item.category === 'fish') {
    if (/salmon|avocado/i.test(item.name)) {
      return { min: 4, max: 12 };
    }
    return { min: 3, max: 8 };
  }

  if (item.category === 'alcohol') {
    return { min: 2, max: 6 };
  }

  return { min: 1, max: 4 };
};

const chunk = <T,>(items: T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

export type SeedStationsResult = {
  createdAreas: number;
  createdItems: number;
  upsertedLinks: number;
  warnings: string[];
};

export async function seedStations(): Promise<SeedStationsResult> {
  const warnings: string[] = [];

  const { data: locations, error: locationsError } = await supabase
    .from('locations')
    .select('id,name,short_code,active');

  if (locationsError) throw locationsError;
  const activeLocations = (locations || []).filter((loc) => loc.active !== false) as LocationRow[];

  const sushiLocation = activeLocations.find(isSushiLocation) ?? null;
  const pokiLocation = activeLocations.find(isPokiLocation) ?? null;

  if (!sushiLocation) warnings.push('Sushi location not found');
  if (!pokiLocation) warnings.push('Poki location not found');

  const targetLocations = [sushiLocation, pokiLocation].filter(Boolean) as LocationRow[];
  if (targetLocations.length === 0) {
    throw new Error('No matching Sushi or Poki locations were found.');
  }

  const locationIds = targetLocations.map((loc) => loc.id);

  const { data: existingAreas, error: areasError } = await supabase
    .from('storage_areas')
    .select('id,name,location_id')
    .in('location_id', locationIds);

  if (areasError) throw areasError;

  const areasToInsert = targetLocations.flatMap((location) => {
    return STATIONS.filter(
      (station) =>
        !(existingAreas || []).some(
          (area) => area.location_id === location.id && area.name === station.name
        )
    ).map((station) => {
      const locationKey = slugify(location.short_code || location.name);
      const stationKey = slugify(station.name);
      return {
        name: station.name,
        description: station.description,
        location_id: location.id,
        nfc_tag_id: `nfc_${locationKey}_${stationKey}`,
        qr_code: `qr_${locationKey}_${stationKey}`,
        check_frequency: station.check_frequency,
        icon: station.icon,
        sort_order: station.sort_order,
        active: true,
      };
    });
  });

  let createdAreas = 0;
  if (areasToInsert.length > 0) {
    const { data: insertedAreas, error: insertAreasError } = await supabase
      .from('storage_areas')
      .insert(areasToInsert)
      .select('id');
    if (insertAreasError) throw insertAreasError;
    createdAreas = insertedAreas?.length ?? 0;
  }

  const { data: alcoholExisting, error: alcoholExistingError } = await supabase
    .from('inventory_items')
    .select('id,name')
    .in('name', ALCOHOL_ITEMS);

  if (alcoholExistingError) throw alcoholExistingError;
  const existingAlcoholNames = new Set((alcoholExisting || []).map((item) => item.name));

  const alcoholToInsert = ALCOHOL_ITEMS.filter((name) => !existingAlcoholNames.has(name)).map(
    (name) => ({
      name,
      category: 'alcohol',
      supplier_category: 'main_distributor',
      base_unit: 'bottle',
      pack_unit: 'case',
      pack_size: 12,
      active: true,
    })
  );

  let createdItems = 0;
  if (alcoholToInsert.length > 0) {
    const { data: insertedItems, error: insertItemsError } = await supabase
      .from('inventory_items')
      .insert(alcoholToInsert)
      .select('id');
    if (insertItemsError) throw insertItemsError;
    createdItems = insertedItems?.length ?? 0;
  }

  const { data: allAreas, error: allAreasError } = await supabase
    .from('storage_areas')
    .select('id,name,location_id')
    .in('location_id', locationIds);

  if (allAreasError) throw allAreasError;

  const { data: fishItems, error: fishError } = await supabase
    .from('inventory_items')
    .select('id,name,category,base_unit')
    .eq('category', 'fish')
    .eq('active', true);

  if (fishError) throw fishError;

  const { data: alcoholItems, error: alcoholItemsError } = await supabase
    .from('inventory_items')
    .select('id,name,category,base_unit')
    .eq('category', 'alcohol')
    .eq('active', true);

  if (alcoholItemsError) throw alcoholItemsError;

  const areaItemsToUpsert: Array<{
    area_id: string;
    inventory_item_id: string;
    min_quantity: number;
    max_quantity: number;
    par_level: number;
    current_quantity: number;
    unit_type: string;
  }> = [];

  for (const location of targetLocations) {
    const freezerArea = (allAreas || []).find(
      (area) => area.location_id === location.id && area.name === 'Freezer Station'
    );
    const alcoholArea = (allAreas || []).find(
      (area) => area.location_id === location.id && area.name === 'Alcohol Station'
    );

    if (freezerArea && fishItems) {
      fishItems.forEach((item: InventoryRow) => {
        const { min, max } = getMinMax(item);
        areaItemsToUpsert.push({
          area_id: freezerArea.id,
          inventory_item_id: item.id,
          min_quantity: min,
          max_quantity: max,
          par_level: (min + max) / 2,
          current_quantity: max,
          unit_type: item.base_unit || 'each',
        });
      });
    }

    if (alcoholArea && alcoholItems) {
      alcoholItems.forEach((item: InventoryRow) => {
        const { min, max } = getMinMax(item);
        areaItemsToUpsert.push({
          area_id: alcoholArea.id,
          inventory_item_id: item.id,
          min_quantity: min,
          max_quantity: max,
          par_level: (min + max) / 2,
          current_quantity: max,
          unit_type: item.base_unit || 'bottle',
        });
      });
    }
  }

  let upsertedLinks = 0;
  if (areaItemsToUpsert.length > 0) {
    const batches = chunk(areaItemsToUpsert, 200);
    for (const batch of batches) {
      const { error: upsertError } = await supabase
        .from('area_items')
        .upsert(batch, { onConflict: 'area_id,inventory_item_id' });
      if (upsertError) throw upsertError;
      upsertedLinks += batch.length;
    }
  }

  return {
    createdAreas,
    createdItems,
    upsertedLinks,
    warnings,
  };
}
