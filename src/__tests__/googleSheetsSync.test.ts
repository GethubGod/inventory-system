const sheetsSync = jest.requireActual('../../scripts/google-sheets-sync.js') as {
  SYNC_CONFIG: Array<Record<string, unknown>>;
  normalizeOptionalSyncRow: (
    row: Record<string, unknown>,
    config: Record<string, unknown>,
    rowNumber: number,
    warnings: string[],
  ) => Record<string, unknown> | null;
  syncSheetUpsertOnly: (ss: { getSheetByName: (name: string) => unknown }, config: Record<string, unknown>) => string;
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
