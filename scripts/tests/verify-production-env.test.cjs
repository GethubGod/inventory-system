'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProductionEnvironment } = require('../verify-production-env.cjs');
const valid = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://whrohvitvmcrmedepurd.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_fixture',
};

test('accepts the expected HTTPS host and publishable key format', () => {
  assert.deepEqual(validateProductionEnvironment(valid), []);
});
for (const url of ['http://127.0.0.1:54521', 'http://whrohvitvmcrmedepurd.supabase.co', 'https://another-project.supabase.co', 'https://whrohvitvmcrmedepurd.supabase.co/private', 'https://user:password@whrohvitvmcrmedepurd.supabase.co']) {
  test(`rejects a production build with unsafe or incorrect endpoint ${new URL(url).hostname}`, () => {
    assert.ok(validateProductionEnvironment({ ...valid, EXPO_PUBLIC_SUPABASE_URL: url }).length);
  });
}
test('rejects missing, legacy and server-only keys without including their values', () => {
  for (const key of ['', 'legacy-jwt-fixture', 'sb_secret_private_fixture']) {
    const errors = validateProductionEnvironment({ ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key });
    assert.ok(errors.length);
    if (key) assert.ok(errors.every((error) => !error.includes(key)));
  }
});
test('legacy anon fallback alone does not permit a production build', () => {
  assert.ok(validateProductionEnvironment({ EXPO_PUBLIC_SUPABASE_URL: valid.EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'legacy-jwt-fixture' }).length);
});
