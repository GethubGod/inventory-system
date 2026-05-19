#!/usr/bin/env node

const { spawnSync } = require('child_process');

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(process.execPath, [
  jestBin,
  '--runInBand',
  '--watchman=false',
  'src/__tests__/quickOrderInventoryAudit.test.ts',
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    RUN_QUICK_ORDER_INVENTORY_AUDIT: '1',
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
