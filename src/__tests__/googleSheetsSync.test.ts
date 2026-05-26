const sheetsSync = jest.requireActual('../../scripts/google-sheets-sync.js') as {
  SYNC_CONFIG: Record<string, unknown>[];
  syncSheetUpsertOnly: (ss: { getSheetByName: (name: string) => unknown }, config: Record<string, unknown>) => string;
  resolveQoInventoryItem: (name: string, items: { id: string; name: string; aliases?: string[] | null }[]) => {
    ok: boolean;
    reason?: string;
    item?: { id: string; name: string; aliases?: string[] | null };
    via_alias?: boolean;
    candidates?: string[];
  };
  resolveQoItem: (name: string, items: { id: string; name: string; aliases?: string | null }[]) => {
    ok: boolean;
    reason?: string;
    item?: { id: string; name: string; aliases?: string | null };
    via_alias?: boolean;
    candidates?: string[];
  };
  formatQoCatalogResolutionError: (inputName: string, result: { reason?: string; candidates?: string[] }) => string;
};

function configFor(sheet: string): Record<string, unknown> {
  const config = sheetsSync.SYNC_CONFIG.find((entry) => entry.sheet === sheet);
  if (!config) throw new Error(`Missing config for ${sheet}`);
  return config;
}

describe('Google Sheets qo_* sync config', () => {
  test('uses the six-tab Quick Order structure', () => {
    expect(sheetsSync.SYNC_CONFIG.map((entry) => entry.sheet)).toEqual(expect.arrayContaining([
      'items',
      'reorder_rules',
      'personalization',
      'keywords',
      'holiday_overrides',
      'documentation',
    ]));
  });

  test('documentation tab is skipped explicitly', () => {
    expect(sheetsSync.syncSheetUpsertOnly({ getSheetByName: jest.fn() }, configFor('documentation'))).toBe('Skipped by design');
  });
});

describe('Google Sheets qo_* FK alias resolution', () => {
  const inventoryItems = [
    { id: 'ebi-id', name: 'Ebi (Cooked Shrimp)', aliases: ['shrimp', 'ebi'] },
    { id: 'salmon-id', name: 'Salmon', aliases: ['fish'] },
    { id: 'tuna-id', name: 'Tuna', aliases: ['fish'] },
  ];

  test('resolveQoInventoryItem matches inventory_items aliases after exact name miss', () => {
    const result = sheetsSync.resolveQoInventoryItem('shrimp', inventoryItems);
    expect(result).toMatchObject({ ok: true, via_alias: true, item: { id: 'ebi-id', name: 'Ebi (Cooked Shrimp)' } });
  });

  test('formatQoCatalogResolutionError reports unresolved item_name', () => {
    const message = sheetsSync.formatQoCatalogResolutionError('mystery-item', { reason: 'not_found' });
    expect(message).toBe('Could not resolve "mystery-item" to any item or alias.');
  });

  test('formatQoCatalogResolutionError reports ambiguous alias matches', () => {
    const message = sheetsSync.formatQoCatalogResolutionError('fish', {
      reason: 'ambiguous_alias',
      candidates: ['Salmon', 'Tuna'],
    });
    expect(message).toBe('Alias "fish" matches multiple items: Salmon, Tuna. Disambiguate on the sheet.');
  });

  test('resolveQoItem matches qo_items CSV aliases after exact name miss', () => {
    const qoItems = [{ id: 'qo-ebi-id', name: 'Ebi (Cooked Shrimp)', aliases: 'shrimp, ebi' }];
    const result = sheetsSync.resolveQoItem('shrimp', qoItems);
    expect(result).toMatchObject({ ok: true, via_alias: true, item: { id: 'qo-ebi-id' } });
  });
});

describe('Google Sheets qo_* sync alias resolution integration', () => {
  function configFor(sheet: string): Record<string, unknown> {
    const config = sheetsSync.SYNC_CONFIG.find((entry) => entry.sheet === sheet);
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
        if (url.includes('/inventory_items')) {
          return response(200, [{ id: 'ebi-id', name: 'Ebi (Cooked Shrimp)', aliases: ['shrimp'], active: true }]);
        }
        if (url.includes('/qo_items')) {
          return response(200, [{ id: 'qo-ebi-id', name: 'Ebi (Cooked Shrimp)', aliases: 'shrimp', inventory_item_id: 'ebi-id', active: true }]);
        }
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

  test('reorder_rules sync resolves item_name via qo_items alias', () => {
    const sheet = createSheet([
      ['item_name', 'trigger_at_or_below', 'trigger_unit', 'order_qty', 'order_unit', 'location_scope', 'active', 'notes', 'sync_status', 'sync_error'],
      ['shrimp', 2, 'pack', 1, 'pack', '', true, '', '', ''],
    ]);
    expect(sheetsSync.syncSheetUpsertOnly({ getSheetByName: () => sheet }, configFor('reorder_rules'))).toBe('1 rows synced');
    const post = (global as any).UrlFetchApp.fetch.mock.calls.find((call: any[]) => call[1].method === 'post');
    expect(JSON.parse(post[1].payload)[0]).toMatchObject({ item_name: 'Ebi (Cooked Shrimp)', qo_item_id: 'qo-ebi-id' });
  });

  test('reorder_rules sync writes Could not resolve sync_error for unknown item_name', () => {
    const sheet = createSheet([
      ['item_name', 'trigger_at_or_below', 'trigger_unit', 'order_qty', 'order_unit', 'location_scope', 'active', 'notes', 'sync_status', 'sync_error'],
      ['mystery-item', 2, 'pack', 1, 'pack', '', true, '', '', ''],
    ]);
    expect(sheetsSync.syncSheetUpsertOnly({ getSheetByName: () => sheet }, configFor('reorder_rules'))).toBe('0 rows synced, 1 failed');
    expect(sheet.writes.map((write) => String(write.value)).join('\n')).toContain('Could not resolve "mystery-item" to any item or alias.');
  });
});
