const sheetsSync = jest.requireActual('../../scripts/google-sheets-sync.js') as {
  SYNC_CONFIG: Record<string, unknown>[];
  normalizeOptionalSyncRow: (
    row: Record<string, unknown>,
    config: Record<string, unknown>,
    rowNumber: number,
    warnings: string[],
  ) => Record<string, unknown> | null;
  syncSheetUpsertOnly: (ss: { getSheetByName: (name: string) => unknown }, config: Record<string, unknown>) => string;
  syncEmployeeQuickOrderAliases: (ss: { getSheetByName: (name: string) => unknown }, config: Record<string, unknown>) => string;
  syncInventoryReorderRules: (ss: { getSheetByName: (name: string) => unknown }, config: Record<string, unknown>) => string;
  syncInventoryStatusTerms: (ss: { getSheetByName: (name: string) => unknown }, config: Record<string, unknown>) => string;
  resolveEmployeeAliasItem: (itemName: string, refs: Record<string, unknown>) => Record<string, unknown> | null;
  normalizeInventoryStatusPhraseKey: (value: string) => string;
  isOptionalQuickOrderOrphanDeleteEnabled: () => boolean;
};

function configFor(sheet: string): Record<string, unknown> {
  const config = sheetsSync.SYNC_CONFIG.find((entry) => entry.sheet === sheet);
  if (!config) throw new Error(`Missing config for ${sheet}`);
  return config;
}

describe('optional Google Sheets Quick Order sync helpers', () => {
  test('sync succeeds when optional sheets are missing', () => {
    const ss = { getSheetByName: jest.fn(() => null) };

    expect(sheetsSync.syncSheetUpsertOnly(ss, configFor('item_order_limits'))).toBe('Optional sheet missing, skipped');
    expect(sheetsSync.syncSheetUpsertOnly(ss, configFor('item_allowed_units'))).toBe('Optional sheet missing, skipped');
    expect(sheetsSync.syncSheetUpsertOnly(ss, configFor('item_aliases'))).toBe('Optional sheet missing, skipped');
    expect(sheetsSync.syncSheetUpsertOnly(ss, configFor('quick_order_aliases'))).toBe('Optional sheet missing, skipped');
    expect(sheetsSync.syncSheetUpsertOnly(ss, configFor('employee_quick_order_aliases'))).toBe('Optional sheet missing, skipped');
    expect(sheetsSync.syncSheetUpsertOnly(ss, configFor('inventory_reorder_rules'))).toBe('Optional sheet missing, skipped');
    expect(sheetsSync.syncSheetUpsertOnly(ss, configFor('inventory_status_terms'))).toBe('Optional sheet missing, skipped');
  });

  test('blank numeric cells do not break optional limit rows', () => {
    const warnings: string[] = [];
    const row = sheetsSync.normalizeOptionalSyncRow(
      {
        id: null,
        item_id: 'item-id',
        location_id: null,
        supplier_id: null,
        default_order_unit: 'cs',
        typical_min_quantity: null,
        hard_max_quantity: '',
        historical_p95_quantity: '8',
        allow_employee_override: '',
        allow_manager_override: 'true',
      },
      configFor('item_order_limits'),
      2,
      warnings,
    );

    expect(row).toMatchObject({
      item_id: 'item-id',
      default_order_unit: 'cs',
      typical_min_quantity: null,
      hard_max_quantity: null,
      historical_p95_quantity: 8,
      allow_manager_override: true,
    });
    expect(row).not.toHaveProperty('allow_employee_override');
    expect(warnings).toEqual([]);
  });

  test('invalid optional numeric values warn and skip the field', () => {
    const warnings: string[] = [];
    const row = sheetsSync.normalizeOptionalSyncRow(
      {
        id: null,
        item_id: 'item-id',
        default_order_unit: 'cs',
        soft_max_quantity: 'many',
      },
      configFor('item_order_limits'),
      4,
      warnings,
    );

    expect(row).not.toHaveProperty('soft_max_quantity');
    expect(warnings.join('\n')).toContain('invalid optional numeric value');
  });

  test('blank alias rows are skipped', () => {
    const warnings: string[] = [];
    const row = sheetsSync.normalizeOptionalSyncRow(
      { id: null, item_id: 'item-id', alias: '' },
      configFor('item_aliases'),
      5,
      warnings,
    );

    expect(row).toBeNull();
    expect(warnings.join('\n')).toContain('blank alias skipped');
  });

  test('optional orphan deletion is disabled by default', () => {
    expect(sheetsSync.isOptionalQuickOrderOrphanDeleteEnabled()).toBe(false);
  });
});

describe('Google Sheets inventory recommendation sync', () => {
  let mockFetch: jest.Mock;

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
      getDataRange: () => ({
        getValues: () => values,
      }),
      getRange: (row: number, col: number) => ({
        setValue: (value: unknown) => {
          writes.push({ row, col, value });
        },
      }),
    };
  }

  beforeEach(() => {
    mockFetch = jest.fn((url: string, options: Record<string, unknown>) => {
      if (options.method === 'post') return response(201, [{}]);
      if (url.includes('/inventory_items')) {
        return response(200, [
          { id: 'sriracha-id', name: 'Sriracha', aliases: ['hot sauce'], active: true },
          { id: 'chili-oil-id', name: 'Chili Oil', aliases: [], active: true },
        ]);
      }
      if (url.includes('/locations')) {
        return response(200, [
          { id: 'sushi-location', name: 'Sushi', short_code: 'SUSHI', active: true },
        ]);
      }
      if (url.includes('/item_aliases') || url.includes('/quick_order_aliases')) {
        return response(404, 'PGRST205 table not found');
      }
      return response(200, []);
    });
    (global as any).UrlFetchApp = { fetch: mockFetch } as any;
    (global as any).Logger = { log: jest.fn() } as any;
    (global as any).SUPABASE_URL = 'https://mock.supabase.co';
    (global as any).SUPABASE_KEY = 'mock-key';
  });

  afterEach(() => {
    delete (global as any).UrlFetchApp;
    delete (global as any).Logger;
    delete (global as any).SUPABASE_URL;
    delete (global as any).SUPABASE_KEY;
  });

  test('syncs valid inventory_reorder_rules rows', () => {
    const sheet = createSheet([
      ['active', 'location_name', 'item_name', 'applies_to_mode', 'trigger_type', 'trigger_qty', 'trigger_unit', 'order_strategy', 'order_qty', 'order_unit', 'priority', 'notes'],
      [true, 'Sushi', 'Sriracha', 'inventory_only', 'below', 1, 'case', 'fixed_order_qty', 1, 'case', 100, 'If under 1 case, order 1 case'],
      [true, '', 'hot sauce', 'inventory_only', 'at_or_below', 2, 'bottle', 'no_order', '', '', '', 'Alias lookup works'],
    ]);
    const ss = { getSheetByName: jest.fn(() => sheet) };

    const result = sheetsSync.syncSheetUpsertOnly(ss, configFor('inventory_reorder_rules'));

    expect(result).toBe('2 rows synced');
    const postCalls = mockFetch.mock.calls.filter((call) => call[1].method === 'post');
    expect(postCalls).toHaveLength(2);
    expect(postCalls[0][0]).toContain('on_conflict=inventory_item_id,location_key,trigger_type,trigger_qty_key,trigger_qty_max_key,trigger_unit_key');
    const payload = JSON.parse(postCalls[0][1].payload)[0];
    expect(payload).toMatchObject({
      active: true,
      location_id: 'sushi-location',
      inventory_item_id: 'sriracha-id',
      trigger_type: 'below',
      trigger_qty: 1,
      trigger_unit: 'case',
      order_strategy: 'fixed_order_qty',
      order_qty: 1,
      order_unit: 'case',
      priority: 100,
    });
  });

  test('inventory_reorder_rules writes row errors for invalid rows', () => {
    const sheet = createSheet([
      ['active', 'location_name', 'item_name', 'applies_to_mode', 'trigger_type', 'trigger_qty', 'trigger_unit', 'order_strategy', 'order_qty', 'order_unit', 'priority', 'notes', 'sync_status', 'sync_error'],
      [true, 'Sushi', 'Missing Item', 'inventory_only', 'below', 1, 'case', 'fixed_order_qty', 1, 'case', 100, '', '', ''],
      [true, 'Unknown', 'Sriracha', 'inventory_only', 'below', 1, 'case', 'fixed_order_qty', 1, 'case', 100, '', '', ''],
      [true, 'Sushi', 'Sriracha', 'inventory_only', 'bad_trigger', 1, 'case', 'fixed_order_qty', 1, 'case', 100, '', '', ''],
      [true, 'Sushi', 'Sriracha', 'inventory_only', 'below', 1, 'case', 'fixed_order_qty', '', '', 100, '', '', ''],
    ]);
    const ss = { getSheetByName: jest.fn(() => sheet) };

    const result = sheetsSync.syncSheetUpsertOnly(ss, configFor('inventory_reorder_rules'));

    expect(result).toBe('0 rows synced, 4 failed');
    expect(mockFetch.mock.calls.filter((call) => call[1].method === 'post')).toHaveLength(0);
    const written = sheet.writes.map((write) => String(write.value)).join('\n');
    expect(written).toContain('Could not resolve item_name');
    expect(written).toContain('Could not resolve location_name');
    expect(written).toContain('Invalid trigger_type');
    expect(written).toContain('fixed_order_qty requires order_qty and order_unit');
  });

  test('syncs inventory_status_terms and generates phrase_key', () => {
    const sheet = createSheet([
      ['active', 'phrase', 'phrase_key', 'status', 'remaining_qty', 'remaining_unit_behavior', 'recommendation_action', 'priority', 'notes'],
      [true, ' A   Lot ', '', 'enough', '', 'none', 'no_order', 100, 'Enough stock'],
      [true, 'no more', '', 'zero', 0, 'item_default_unit', 'check_reorder_rule', 10, 'Out'],
    ]);
    const ss = { getSheetByName: jest.fn(() => sheet) };

    const result = sheetsSync.syncSheetUpsertOnly(ss, configFor('inventory_status_terms'));

    expect(result).toBe('2 rows synced');
    expect(sheetsSync.normalizeInventoryStatusPhraseKey(' no   more!!! ')).toBe('no more');
    const payloads = mockFetch.mock.calls
      .filter((call) => call[1].method === 'post')
      .map((call) => JSON.parse(call[1].payload)[0]);
    expect(payloads[0]).toMatchObject({
      phrase: 'A   Lot',
      phrase_key: 'a lot',
      status: 'enough',
      recommendation_action: 'no_order',
    });
    expect(payloads[1]).toMatchObject({
      phrase_key: 'no more',
      remaining_qty: 0,
      remaining_unit_behavior: 'item_default_unit',
    });
  });

  test('inventory_status_terms rejects duplicate phrase_key', () => {
    const sheet = createSheet([
      ['active', 'phrase', 'phrase_key', 'status', 'remaining_qty', 'remaining_unit_behavior', 'recommendation_action', 'priority', 'notes', 'sync_status', 'sync_error'],
      [true, 'a lot', '', 'enough', '', 'none', 'no_order', 100, '', '', ''],
      [true, ' A LOT ', '', 'enough', '', 'none', 'no_order', 100, '', '', ''],
    ]);
    const ss = { getSheetByName: jest.fn(() => sheet) };

    const result = sheetsSync.syncSheetUpsertOnly(ss, configFor('inventory_status_terms'));

    expect(result).toBe('0 rows synced, 2 failed');
    expect(mockFetch.mock.calls.filter((call) => call[1].method === 'post')).toHaveLength(0);
    expect(sheet.writes.map((write) => String(write.value)).join('\n')).toContain('Duplicate phrase_key');
  });
});

describe('Google Sheets inventory_items sync with aliases', () => {
  let mockFetch: jest.Mock;

  beforeAll(() => {
    mockFetch = jest.fn(() => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify([{ id: 'existing-id' }]),
    }));
    (global as any).UrlFetchApp = {
      fetch: mockFetch,
    } as any;
    (global as any).Utilities = {
      getUuid: () => 'generated-uuid-123',
    } as any;
    (global as any).Logger = {
      log: jest.fn(),
    } as any;
    (global as any).SUPABASE_URL = 'https://mock.supabase.co';
    (global as any).SUPABASE_KEY = 'mock-key';
  });

  afterAll(() => {
    delete (global as any).UrlFetchApp;
    delete (global as any).Utilities;
    delete (global as any).Logger;
    delete (global as any).SUPABASE_URL;
    delete (global as any).SUPABASE_KEY;
  });

  test('successfully parses and syncs comma-separated aliases column', () => {
    const mockSheet = {
      getDataRange: () => ({
        getValues: () => [
          ['id', 'name', 'base_unit', 'pack_unit', 'aliases'],
          ['item-1', 'Salmon', 'piece', 'case', 'sake, salmon,  atlantic '],
          ['item-2', 'Masago', 'oz', 'pack', ''],
          ['item-3', 'Tuna', 'lb', 'cs', null],
        ],
      }),
    };
    const ss = {
      getSheetByName: jest.fn((name) => {
        if (name === 'inventory_items') return mockSheet;
        return null;
      }),
    };

    const config = configFor('inventory_items');
    const result = sheetsSync.syncSheetUpsertOnly(ss, config);

    expect(result).toBe('3 rows upserted');
    expect(mockFetch).toHaveBeenCalled();

    // Check payload passed to UrlFetchApp.fetch
    const lastCallArgs = mockFetch.mock.calls[0];
    const fetchOptions = lastCallArgs[1];
    const payload = JSON.parse(fetchOptions.payload);

    expect(payload).toEqual([
      {
        id: 'item-1',
        name: 'Salmon',
        base_unit: 'piece',
        pack_unit: 'case',
        aliases: ['sake', 'salmon', 'atlantic'],
        pack_size: 1,
        emoji: '',
      },
      {
        id: 'item-2',
        name: 'Masago',
        base_unit: 'oz',
        pack_unit: 'pack',
        aliases: [],
        pack_size: 1,
        emoji: '',
      },
      {
        id: 'item-3',
        name: 'Tuna',
        base_unit: 'lb',
        pack_unit: 'cs',
        aliases: [],
        pack_size: 1,
        emoji: '',
      },
    ]);
  });
});

describe('Google Sheets employee_quick_order_aliases sync', () => {
  let mockFetch: jest.Mock;

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
      getDataRange: () => ({
        getValues: () => values,
      }),
      getRange: (row: number, col: number) => ({
        setValue: (value: unknown) => {
          writes.push({ row, col, value });
        },
      }),
    };
  }

  beforeEach(() => {
    mockFetch = jest.fn((url: string, options: Record<string, unknown>) => {
      if (options.method === 'post') return response(201, [{}]);
      if (url.includes('/inventory_items')) {
        return response(200, [
          { id: 'ebi-id', name: 'Ebi (Cooked Shrimp)', aliases: ['cooked shrimp'], active: true },
          { id: '11111111-1111-4111-8111-111111111111', name: 'Amaebi (Sweet Shrimp)', aliases: [], active: true },
        ]);
      }
      if (url.includes('/locations')) {
        return response(200, [
          { id: 'sushi-location', name: 'Sushi', short_code: 'SUSHI', active: true },
        ]);
      }
      if (url.includes('/item_aliases') || url.includes('/quick_order_aliases')) {
        return response(404, 'PGRST205 table not found');
      }
      return response(200, []);
    });
    (global as any).UrlFetchApp = { fetch: mockFetch } as any;
    (global as any).Logger = { log: jest.fn() } as any;
    (global as any).SUPABASE_URL = 'https://mock.supabase.co';
    (global as any).SUPABASE_KEY = 'mock-key';
  });

  afterEach(() => {
    delete (global as any).UrlFetchApp;
    delete (global as any).Logger;
    delete (global as any).SUPABASE_URL;
    delete (global as any).SUPABASE_KEY;
  });

  test('syncs exact item names, UUID item names, aliases, and blank global locations', () => {
    const sheet = createSheet([
      ['employee_name', 'alias_text', 'item_name', 'location_name', 'active', 'notes'],
      ['Devin', 'shrimp', 'Ebi (Cooked Shrimp)', 'Sushi', true, 'Devin means cooked shrimp'],
      ['Alex', 'shrimp', 'Amaebi (Sweet Shrimp)', '', true, 'global Alex alias'],
      ['Devin', 'cooked shrimp', 'cooked shrimp', 'Sushi', true, 'alias item lookup'],
      ['Alex', 'sweet shrimp', '11111111-1111-4111-8111-111111111111', 'SUSHI', false, 'uuid item lookup'],
    ]);
    const ss = { getSheetByName: jest.fn(() => sheet) };

    const result = sheetsSync.syncSheetUpsertOnly(ss, configFor('employee_quick_order_aliases'));

    expect(result).toBe('4 rows synced');
    const postCalls = mockFetch.mock.calls.filter((call) => call[1].method === 'post');
    expect(postCalls).toHaveLength(4);

    const payloads = postCalls.map((call) => JSON.parse(call[1].payload)[0]);
    expect(payloads[0]).toMatchObject({
      employee_name: 'Devin',
      employee_name_key: 'devin',
      alias_text: 'shrimp',
      alias_key: 'shrimp',
      inventory_item_id: 'ebi-id',
      location_id: 'sushi-location',
      active: true,
    });
    expect(payloads[1]).toMatchObject({
      employee_name: 'Alex',
      inventory_item_id: '11111111-1111-4111-8111-111111111111',
      location_id: null,
    });
    expect(payloads[2]).toMatchObject({ inventory_item_id: 'ebi-id' });
    expect(payloads[3]).toMatchObject({ inventory_item_id: '11111111-1111-4111-8111-111111111111', active: false });
    expect(postCalls[0][0]).toContain('on_conflict=employee_name_key,alias_key,location_key');
    expect(sheet.writes.some((write) => write.value === 'Synced')).toBe(true);
  });

  test('writes row errors for unresolved item and location without upserting', () => {
    const sheet = createSheet([
      ['employee_name', 'alias_text', 'item_name', 'location_name', 'active', 'notes', 'sync_status', 'sync_error'],
      ['Devin', 'shrimp', 'missing shrimp', 'Sushi', true, '', '', ''],
      ['Alex', 'shrimp', 'Amaebi (Sweet Shrimp)', 'Unknown', true, '', '', ''],
    ]);
    const ss = { getSheetByName: jest.fn(() => sheet) };

    const result = sheetsSync.syncSheetUpsertOnly(ss, configFor('employee_quick_order_aliases'));

    expect(result).toBe('0 rows synced, 2 failed');
    expect(mockFetch.mock.calls.filter((call) => call[1].method === 'post')).toHaveLength(0);
    expect(sheet.writes.map((write) => write.value).join('\n')).toContain('Could not resolve item_name');
    expect(sheet.writes.map((write) => write.value).join('\n')).toContain('Could not resolve location_name');
  });

  test('rejects duplicate employee alias rows before upsert', () => {
    const sheet = createSheet([
      ['employee_name', 'alias_text', 'item_name', 'location_name', 'active', 'notes', 'sync_status', 'sync_error'],
      ['Devin', 'shrimp', 'Ebi (Cooked Shrimp)', 'Sushi', true, '', '', ''],
      [' devin ', ' SHRIMP ', 'Amaebi (Sweet Shrimp)', 'SUSHI', true, '', '', ''],
    ]);
    const ss = { getSheetByName: jest.fn(() => sheet) };

    const result = sheetsSync.syncSheetUpsertOnly(ss, configFor('employee_quick_order_aliases'));

    expect(result).toBe('0 rows synced, 2 failed');
    expect(mockFetch.mock.calls.filter((call) => call[1].method === 'post')).toHaveLength(0);
    expect(sheet.writes.map((write) => write.value).join('\n')).toContain('Duplicate alias');
  });
});
