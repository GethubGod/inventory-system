import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { matchCatalogItem } from '../../supabase/functions/parse-order/catalog-matcher.ts';
import { normalizeCatalogText } from '../../supabase/functions/parse-order/catalog-search-index.ts';
import type { CatalogItem, MatchType } from '../../supabase/functions/parse-order/types.ts';

type InventoryRow = {
  id: string;
  name: string;
  aliases: string[] | null;
  base_unit: string | null;
  pack_unit: string | null;
  allowed_units: string[] | null;
};

type ProbeFailure = {
  item_id: string;
  item_name: string;
  probe: string;
  text: string;
  matched_item_id: string | null;
  matched_item_name: string | null;
  match_type: MatchType | null | undefined;
  confidence: number | null | undefined;
};

const AUDIT_ENABLED = process.env.RUN_QUICK_ORDER_INVENTORY_AUDIT === '1';
const PAGE_SIZE = 1000;

function loadEnvFile(filename: string): void {
  const envPath = path.join(process.cwd(), filename);
  if (!fs.existsSync(envPath)) return;

  const inheritedEnv = new Set(Object.keys(process.env));
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!inheritedEnv.has(key)) process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  loadEnvFile('.env');
  loadEnvFile('.env.local');
}

function toCatalogItem(row: InventoryRow): CatalogItem {
  return {
    id: row.id,
    name: row.name.trim(),
    aliases: Array.isArray(row.aliases)
      ? row.aliases.filter((alias): alias is string => typeof alias === 'string')
      : [],
    default_unit: row.base_unit ?? row.pack_unit ?? null,
    base_unit: row.base_unit,
    pack_unit: row.pack_unit,
    allowed_units: Array.isArray(row.allowed_units)
      ? row.allowed_units.filter((unit): unit is string => typeof unit === 'string')
      : null,
  };
}

function pluralizeNormalizedName(itemName: string): string {
  const normalized = normalizeCatalogText(itemName);
  return normalized.replace(/(\S+)$/, '$1s');
}

async function fetchActiveInventory(): Promise<{ catalog: CatalogItem[]; usedServiceRoleKey: boolean }> {
  loadLocalEnv();

  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const fallbackKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  const supabaseKey = (serviceRoleKey || fallbackKey).trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase URL/key. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const rows: InventoryRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id,name,aliases,base_unit,pack_unit,allowed_units')
      .eq('active', true)
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Unable to load active inventory items: ${error.message}`);
    rows.push(...((data ?? []) as InventoryRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return { catalog: rows.map(toCatalogItem), usedServiceRoleKey: serviceRoleKey.length > 0 };
}

(AUDIT_ENABLED ? describe : describe.skip)('quick order active inventory recognition audit', () => {
  jest.setTimeout(30_000);

  test('recognizes every active inventory item by exact name and simple variants', async () => {
    const { catalog, usedServiceRoleKey } = await fetchActiveInventory();
    if (catalog.length === 0 && !usedServiceRoleKey) {
      console.warn('No inventory rows were visible with the public Supabase key. Set SUPABASE_SERVICE_ROLE_KEY to run the live recognition audit locally.');
      return;
    }

    expect(catalog.length).toBeGreaterThan(0);

    const duplicateNames = new Map<string, CatalogItem[]>();
    for (const item of catalog) {
      const key = normalizeCatalogText(item.name);
      duplicateNames.set(key, [...(duplicateNames.get(key) ?? []), item]);
    }
    const duplicateFailures = [...duplicateNames.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([normalized, items]) => ({
        normalized,
        items: items.map((item) => ({ id: item.id, name: item.name })),
      }));

    if (duplicateFailures.length > 0) {
      throw new Error(`Duplicate normalized active inventory names:\n${JSON.stringify(duplicateFailures, null, 2)}`);
    }

    const failures: ProbeFailure[] = [];
    for (const item of catalog) {
      const probes = [
        { probe: 'exact_name', text: item.name },
        { probe: 'lowercase_name', text: normalizeCatalogText(item.name) },
        { probe: 'simple_plural', text: pluralizeNormalizedName(item.name) },
      ];

      for (const { probe, text } of probes) {
        const match = matchCatalogItem(text, catalog);
        if (match.item_id !== item.id) {
          failures.push({
            item_id: item.id,
            item_name: item.name,
            probe,
            text,
            matched_item_id: match.item_id,
            matched_item_name: match.item_name,
            match_type: match.match_type,
            confidence: match.confidence,
          });
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`Inventory recognition failures (${failures.length}):\n${JSON.stringify(failures.slice(0, 50), null, 2)}`);
    }
  });
});
