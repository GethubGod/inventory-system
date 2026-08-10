import { processQuickOrderMessage } from '../../supabase/functions/parse-order/process-message.ts';
import { classifyQuickOrderInput } from '../../supabase/functions/parse-order/input-classifier.ts';
import { buildUnitAliases } from '../../supabase/functions/parse-order/units.ts';
import type {
  CatalogItem,
  InventoryStatusTerm,
  ItemReorderRule,
  QuickOrderAliasRule,
  QuickOrderReorderRule,
  QuickOrderUnitRule,
} from '../../supabase/functions/parse-order/types.ts';

const catalog: CatalogItem[] = [
  { id: 'ebi-id', name: 'Ebi (Cooked Shrimp)', aliases: [], default_unit: 'pack', order_unit: 'pack', base_unit: 'pack', pack_unit: 'pack' },
  { id: 'sriracha-id', name: 'Sriracha', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
  { id: 'tamago-id', name: 'Tamago', aliases: [], default_unit: 'pack', order_unit: 'pack', base_unit: 'pack', pack_unit: 'pack' },
  { id: 'salmon-id', name: 'Salmon', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case', target_stock: 3 },
  { id: 'albacore-id', name: 'Albacore', aliases: [], default_unit: 'case', order_unit: 'case', base_unit: 'case', pack_unit: 'case' },
  { id: 'wakame-id', name: 'Wakame', aliases: [], default_unit: 'pack', order_unit: 'pack', base_unit: 'pack', pack_unit: 'pack' },
  { id: 'edamame-poki-id', name: 'Edamame', aliases: [], default_unit: 'pack', order_unit: 'pack', base_unit: 'pack', pack_unit: 'pack', location_id: 'poki-location' },
];

const parserSettings = {
  order_mode_employee_personalization: true,
  inventory_mode_employee_personalization: true,
  global_aliases_enabled: true,
  fuzzy_match_requires_confirmation: false,
  status_terms_enabled: true,
};

async function brain(message: string, overrides: Partial<Parameters<typeof processQuickOrderMessage>[0]> = {}) {
  const unitAliases = overrides.unitAliases ?? buildUnitAliases({ box: 'case' });
  return processQuickOrderMessage({
    catalog,
    globalCatalog: catalog,
    corrections: [],
    previousMessages: [],
    existingParsedItems: [],
    limits: [],
    allowedUnitRules: [],
    recentOrders: [],
    unitAliases,
    classification: classifyQuickOrderInput(message, { hasPendingDuplicateAction: false }),
    parserSettings,
    modelConfig: {
      defaultModel: 'gemini-2.5-flash',
      fallbackModel: 'gemini-2.5-flash',
      advancedModel: 'gemini-3.1-pro',
      liveModel: 'gemini-live',
      advancedEnabled: true,
    },
    ...overrides,
    request: {
      source: 'typed',
      mode: 'order',
      session_id: 'session-id',
      location_id: 'sushi-location',
      user_id: 'user-id',
      existing_items: [],
      ...overrides.request,
      message,
    },
  });
}

const devinAlias: QuickOrderAliasRule = {
  alias_text: 'shrimp',
  alias_key: 'shrimp',
  item_id: 'ebi-id',
  scope_type: 'employee',
  employee_name: 'Devin',
  employee_name_key: 'devin',
  mode_scope: 'both',
  active: true,
};

const nateTamagoUnit: QuickOrderUnitRule = {
  item_id: 'tamago-id',
  from_unit: null,
  to_unit: 'order',
  multiplier: 1,
  scope_type: 'employee',
  employee_name: 'Nate',
  employee_name_key: 'nate',
  mode_scope: 'inventory',
  is_default_when_missing: true,
  active: true,
  is_custom_counting_unit: true,
  tracking_unit: 'order',
};

const nateTamagoRule: QuickOrderReorderRule = {
  item_id: 'tamago-id',
  scope_type: 'employee',
  employee_name: 'Nate',
  employee_name_key: 'nate',
  mode_scope: 'inventory',
  counted_unit: 'order',
  trigger_type: 'at_or_below',
  trigger_qty_min: 5,
  action_type: 'fixed_order_qty',
  order_qty: 1,
  order_unit: 'pack',
  active: true,
};

const srirachaRule: QuickOrderReorderRule = {
  item_id: 'sriracha-id',
  scope_type: 'global',
  mode_scope: 'inventory',
  counted_unit: 'case',
  trigger_type: 'at_or_below',
  trigger_qty_min: 0.5,
  action_type: 'fixed_order_qty',
  order_qty: 1,
  order_unit: 'case',
  active: true,
};

describe('qo restructure parser contract', () => {
  test('pure word alias resolves Devin shrimp to Ebi', async () => {
    const result = await brain('shrimp 2', { employeeNameKeys: ['devin'], aliasRules: [devinAlias] });
    expect(result.parsed_items[0]).toMatchObject({ item_id: 'ebi-id', quantity: 2, unit: 'pack' });
  });

  test('renamed global unit per employee resolves Nate box to case', async () => {
    const result = await brain('Sriracha 1 box', {
      employeeNameKeys: ['nate'],
      unitRules: [{ item_id: 'sriracha-id', from_unit: 'box', to_unit: 'case', multiplier: 1, scope_type: 'employee', employee_name_key: 'nate', mode_scope: 'both', active: true }],
    });
    expect(result.parsed_items[0]).toMatchObject({ item_id: 'sriracha-id', quantity: 1, unit: 'cs' });
  });

  test('renamed global unit via keywords resolves box to case', async () => {
    const result = await brain('Sriracha 1 box');
    expect(result.parsed_items[0]).toMatchObject({ item_id: 'sriracha-id', unit: 'cs' });
  });

  test.each([[10, 0], [5, 1], [4, 1]])('custom counting unit Tamago %s triggers expected recommendation count', async (qty, expected) => {
    const result = await brain(`Tamago ${qty}`, {
      employeeNameKeys: ['nate'],
      unitRules: [nateTamagoUnit],
      quickOrderReorderRules: [nateTamagoRule],
      request: { mode: 'inventory', employee_name: 'Nate' } as any,
    });
    expect(result.stock_updates[0]).toMatchObject({ item_id: 'tamago-id', unit: 'order', tracking_unit: 'order' });
    expect(result.recommendations).toHaveLength(expected);
    if (expected) expect(result.recommendations[0]).toMatchObject({ suggested_quantity: 1, unit: 'pack' });
  });

  test('global threshold reorder rule fires', async () => {
    const result = await brain('Sriracha 0.5 case', { quickOrderReorderRules: [srirachaRule], request: { mode: 'inventory' } as any });
    expect(result.recommendations[0]).toMatchObject({ item_id: 'sriracha-id', suggested_quantity: 1, unit: 'case' });
  });

  test('maintain target default fires from qo_items target_stock', async () => {
    const result = await brain('Salmon 1 case', { request: { mode: 'inventory' } as any });
    expect(result.recommendations[0]).toMatchObject({ item_id: 'salmon-id', suggested_quantity: 2, unit: 'case' });
  });

  test('legacy fallback item_reorder_rules fires', async () => {
    const rule: ItemReorderRule = { item_id: 'albacore-id', location_id: 'sushi-location', target_stock_quantity: 3, target_stock_unit: 'case', usual_order_unit: 'case' };
    const result = await brain('Albacore 1 case', { reorderRules: [rule], request: { mode: 'inventory' } as any });
    expect(result.recommendations[0]).toMatchObject({ item_id: 'albacore-id', suggested_quantity: 2, unit: 'case' });
  });

  test('ignore word strips before parsing when preprocessing is applied', async () => {
    const result = await brain('Albacore 2 case');
    expect(result.parsed_items[0]).toMatchObject({ item_id: 'albacore-id', quantity: 2, unit: 'cs' });
  });

  test('status term enough suppresses order', async () => {
    const statusTerms: InventoryStatusTerm[] = [{ phrase: 'a lot', phrase_key: 'a lot', status: 'enough', remaining_qty: null, remaining_unit_behavior: 'none', recommendation_action: 'no_order', active: true }];
    const result = await brain('Sriracha a lot', { inventoryStatusTerms: statusTerms, request: { mode: 'inventory' } as any });
    expect(result.recommendations).toHaveLength(0);
  });

  test.each([
    ['no more', 'zero', 0],
    ['half', 'partial', 0.5],
  ])('status term %s checks reorder rules', async (phrase, status, qty) => {
    const statusTerms: InventoryStatusTerm[] = [{ phrase, phrase_key: phrase, status: status as any, remaining_qty: qty, remaining_unit_behavior: 'item_default_unit', recommendation_action: 'check_reorder_rule', active: true }];
    const result = await brain(`${phrase} Sriracha`, { inventoryStatusTerms: statusTerms, quickOrderReorderRules: [srirachaRule], request: { mode: 'inventory' } as any });
    expect(result.recommendations[0]).toMatchObject({ item_id: 'sriracha-id', suggested_quantity: 1 });
  });

  test('location scope hides Poki-only Edamame at Sushi', async () => {
    const result = await brain('Edamame 1 pack', { catalog: catalog.filter((item) => item.location_id !== 'poki-location') });
    expect(result.parsed_items[0]?.item_id).not.toBe('edamame-poki-id');
  });

  test('personalization priority wins over global reorder rule', async () => {
    const personal: QuickOrderReorderRule = { ...srirachaRule, scope_type: 'employee', employee_name_key: 'nate', trigger_qty_min: 2, order_qty: 3 };
    const result = await brain('Sriracha 1 case', { employeeNameKeys: ['nate'], quickOrderReorderRules: [personal, srirachaRule], request: { mode: 'inventory', employee_name: 'Nate' } as any });
    expect(result.recommendations[0]).toMatchObject({ suggested_quantity: 3 });
  });

  test('custom unit isolation allows separate tracking units', async () => {
    const nate = await brain('Tamago 10', { employeeNameKeys: ['nate'], unitRules: [nateTamagoUnit], request: { mode: 'inventory', employee_name: 'Nate' } as any });
    const other = await brain('Tamago 10 pack', { request: { mode: 'inventory', employee_name: 'Alex' } as any });
    expect(nate.stock_updates[0].tracking_unit).toBe('order');
    expect(other.stock_updates[0].tracking_unit).toBeNull();
    expect(other.stock_updates[0].unit).toBe('pack');
  });
});

describe('qo Google Sheets sync contract', () => {
  const sheetsSync = jest.requireActual('../../scripts/google-sheets-sync.js') as any;

  function configFor(sheet: string) {
    const config = sheetsSync.SYNC_CONFIG.find((entry: any) => entry.sheet === sheet);
    if (!config) throw new Error(`Missing config for ${sheet}`);
    return config;
  }

  function response(status: number, body: unknown) {
    return {
      getResponseCode: () => status,
      getContentText: () => typeof body === 'string' ? body : JSON.stringify(body),
    };
  }

  function createSheet(values: unknown[][]) {
    const writes: { row: number; col: number; value: unknown }[] = [];
    return {
      writes,
      getDataRange: () => ({ getValues: () => values }),
      getRange: (row: number, col: number) => ({
        setValue: (value: unknown) => writes.push({ row, col, value }),
      }),
    };
  }

  beforeEach(() => {
    (global as any).UrlFetchApp = {
      fetch: jest.fn((url: string, options: any) => {
        if (options.method === 'post') return response(201, [{}]);
        if (url.includes('/inventory_items')) return response(200, [{ id: 'sriracha-id', name: 'Sriracha', active: true }]);
        if (url.includes('/qo_items')) return response(200, [{ id: 'qo-sriracha-id', name: 'Sriracha', inventory_item_id: 'sriracha-id', active: true }]);
        if (url.includes('/locations')) return response(200, [{ id: 'sushi-location', name: 'Babytuna Sushi', short_code: 'SUSHI', active: true }]);
        if (url.includes('/suppliers')) return response(200, [{ id: 'supplier-id', name: 'JFC', supplier_key: 'jfc', active: true }]);
        return response(200, []);
      }),
    };
    (global as any).Logger = { log: jest.fn() };
    (global as any).SUPABASE_URL = 'https://mock.supabase.co';
    (global as any).SUPABASE_KEY = 'mock-key';
  });

  afterEach(() => {
    delete (global as any).UrlFetchApp;
    delete (global as any).Logger;
    delete (global as any).SUPABASE_URL;
    delete (global as any).SUPABASE_KEY;
  });

  test('sheet round-trip syncs qo_items with FK resolution', () => {
    const sheet = createSheet([
      ['name', 'category', 'aliases', 'supplier', 'order_unit', 'target_stock', 'location_scope', 'active', 'notes', 'sync_status', 'sync_error'],
      ['Sriracha', 'sauces', 'hot sauce', 'JFC', 'case', 3, 'Babytuna Sushi', true, '', '', ''],
    ]);
    expect(sheetsSync.syncSheetUpsertOnly({ getSheetByName: () => sheet }, configFor('items'))).toBe('1 rows synced');
    const post = (global as any).UrlFetchApp.fetch.mock.calls.find((call: any[]) => call[1].method === 'post');
    expect(JSON.parse(post[1].payload)[0]).toMatchObject({ inventory_item_id: 'sriracha-id', supplier_id: 'supplier-id', location_id: 'sushi-location' });
  });

  test('polymorphic personalization alias row rejects item_config fields', () => {
    const sheet = createSheet([
      ['employee_name', 'rule_type', 'phrase', 'item_name', 'personal_unit', 'personal_unit_equals', 'trigger_at_or_below', 'order_qty', 'order_unit', 'location_scope', 'active', 'notes', 'sync_status', 'sync_error'],
      ['Nate', 'alias', 'hot', 'Sriracha', 'box', '', '', '', '', '', true, '', '', ''],
    ]);
    expect(sheetsSync.syncSheetUpsertOnly({ getSheetByName: () => sheet }, configFor('personalization'))).toBe('0 rows synced, 1 failed');
    expect(sheet.writes.map((write) => String(write.value)).join('\n')).toContain('alias rows cannot populate item_config fields');
  });

  test('polymorphic keywords unit_alias rejects status fields', () => {
    const sheet = createSheet([
      ['phrase', 'meaning_type', 'equals_unit', 'status', 'remaining_qty', 'action', 'active', 'notes', 'sync_status', 'sync_error'],
      ['box', 'unit_alias', 'case', 'enough', '', '', true, '', '', ''],
    ]);
    expect(sheetsSync.syncSheetUpsertOnly({ getSheetByName: () => sheet }, configFor('keywords'))).toBe('0 rows synced, 1 failed');
    expect(sheet.writes.map((write) => String(write.value)).join('\n')).toContain('unit_alias rows cannot populate status fields');
  });

  test('deprecated tab is logged and active sync still succeeds', () => {
    const items = createSheet([
      ['name', 'category', 'aliases', 'supplier', 'order_unit', 'target_stock', 'location_scope', 'active', 'notes', 'sync_status', 'sync_error'],
      ['Sriracha', 'sauces', '', 'JFC', 'case', '', '', true, '', '', ''],
    ]);
    const deprecated = createSheet([['from_unit', 'to_unit'], ['box', 'case']]);
    const ss = { getSheetByName: (name: string) => name === 'items' ? items : name === 'unit_synonyms' ? deprecated : null };
    expect(sheetsSync.syncSheetUpsertOnly(ss, configFor('items'))).toBe('1 rows synced');
    expect((global as any).Logger.log).toHaveBeenCalledWith(expect.stringContaining("DEPRECATED tab 'unit_synonyms' detected"));
  });
});
