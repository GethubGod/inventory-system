const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  {
    ignores: [
      '.expo/**',
      '.claude/**',
      'supabase/.temp/**',
      'docs/mockups/**',
      'scripts/google-sheets-sync.js',
      'scripts/scratch_query.ts',
      'web/**',
      'marketing/**',
    ],
  },
  expoConfig,
  {
    files: ['supabase/functions/**/*.ts'],
    rules: {
      'import/no-unresolved': 'off',
    },
  },
]);
