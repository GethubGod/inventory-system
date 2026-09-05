const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../verify-submit-order-rpc.js'), 'utf8');

async function probe(status, body, key = 'sb_publishable_fixture') {
  const output = [];
  let request;
  let exitCode = 0;
  const context = {
    require(name) {
      if (name === 'fs') return { existsSync: () => false };
      return require(name);
    },
    process: {
      env: { EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key },
      cwd: () => '/fixture',
      exit(code) { exitCode = code; throw new Error(`exit ${code}`); },
    },
    console: { log: (...args) => output.push(args.join(' ')), error: (...args) => output.push(args.join(' ')) },
    fetch: async (url, options) => {
      request = { url, ...options };
      return { status, ok: status >= 200 && status < 300, text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
    },
  };
  // The CLI's catch exits; turn that final catch into an awaitable test result.
  const execution = source.replace(/main\(\)\.catch\([\s\S]*$/, 'main().catch(() => {});');
  await vm.runInNewContext(execution, context);
  return { exitCode, output: output.join('\n'), request };
}

test('resolves the full contract and sends publishable keys only as apikey', async () => {
  const result = await probe(401, { code: '42501', message: 'permission denied for function submit_order_rpc' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.request.headers.apikey, 'sb_publishable_fixture');
  assert.equal(result.request.headers.Authorization, undefined);
  assert.equal(Object.keys(JSON.parse(result.request.body)).length, 8);
  assert.match(result.output, /does not verify order submission/);
});

test('accepts only the function-specific unauthorized response', async () => {
  assert.equal((await probe(400, { code: 'P0001', message: 'Unauthorized' })).exitCode, 0);
});

for (const [name, status, body] of [
  ['gateway invalid key', 401, { message: 'Invalid API key' }],
  ['missing contract', 404, { code: 'PGRST202', message: 'Could not find the function' }],
  ['database outage', 503, { message: 'Unavailable' }],
  ['non-JSON gateway response', 502, '<html>Bad gateway</html>'],
  ['unexpected successful mutation', 200, { id: 'unexpected' }],
  ['unrelated SQL error', 400, { code: 'P0001', message: 'Unhandled failure' }],
]) {
  test(`fails closed for ${name}`, async () => {
    const result = await probe(status, body);
    assert.equal(result.exitCode, 1);
    assert.doesNotMatch(result.output, /contract resolved/);
  });
}
