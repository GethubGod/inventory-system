const sheetsSync = jest.requireActual('../../scripts/google-sheets-sync.js') as {
  SYNC_CONFIG: Record<string, unknown>[];
  syncSheetUpsertOnly: (ss: { getSheetByName: (name: string) => unknown }, config: Record<string, unknown>) => string;
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
