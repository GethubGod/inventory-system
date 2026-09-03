// Flood-test harness for the Babytuna Tips web app (tips.babytunasystems.com)
// + Supabase edge functions on project whrohvitvmcrmedepurd.
//
// The Supabase anon/publishable key is public-by-design (shipped to every
// browser). This harness extracts it from the deployed JS bundle at runtime
// and keeps it in memory ONLY — it is never printed or written to disk.
//
// Usage: node harness.mjs [--suite <name>]  (default: all)

const SITE = process.env.SITE_URL ?? 'https://tips.babytunasystems.com';
const SUPA = 'https://whrohvitvmcrmedepurd.supabase.co';
const FN = `${SUPA}/functions/v1`;

const results = [];
function record(suite, name, pass, detail = '') {
  results.push({ suite, name, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${suite} :: ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// Key extraction (memory only)
// ---------------------------------------------------------------------------
async function extractAnonKey() {
  const html = await (await fetch(SITE)).text();
  const chunkUrls = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  // Also try the build manifest chunks referenced by the entry page scripts.
  const seen = new Set();
  const queue = [...chunkUrls];
  const keyRe = /(eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)/;
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    let js = '';
    try {
      js = await (await fetch(`${SITE}${path}`)).text();
    } catch { continue; }
    const m = js.match(keyRe);
    if (m && (m[1].includes('.') ? m[1].split('.').length === 3 : true)) {
      // sanity: JWT payload should decode and reference this project
      if (m[1].startsWith('eyJ')) {
        try {
          const payload = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString());
          if (payload.iss && payload.iss.includes('whrohvitvmcrmedepurd')) return m[1];
          if (payload.ref === 'whrohvitvmcrmedepurd') return m[1];
        } catch { /* keep looking */ }
      } else {
        return m[1];
      }
    }
    for (const inner of js.matchAll(/"(\/_next\/static\/[^"]+\.js)"/g)) queue.push(inner[1]);
    if (seen.size > 60) break;
  }
  throw new Error('Could not locate public anon key in deployed bundles');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function call(fn, opts = {}) {
  const res = await fetch(`${FN}/${fn}`, opts);
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 200) }; }
  return { status: res.status, body, headers: res.headers };
}

const post = (fn, body, headers = {}) =>
  call(fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const authH = (key) => ({ Authorization: `Bearer ${key}`, apikey: key });

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------
async function suiteSite() {
  // Route availability + graceful handling
  const routes = ['/', '/e', '/e?t=garbage', '/e?t=', '/join/not-a-real-token',
    '/dashboard', '/manager', '/manager/qr', '/privacy', '/terms', '/entry',
    '/closer', '/definitely-not-a-page-' + Date.now()];
  for (const r of routes) {
    try {
      const res = await fetch(`${SITE}${r}`, { redirect: 'manual' });
      const ok = [200, 302, 307, 308, 404].includes(res.status);
      record('site', `GET ${r}`, ok && res.status < 500, `HTTP ${res.status}`);
    } catch (e) {
      record('site', `GET ${r}`, false, `fetch error: ${e.message}`);
    }
  }

  // Security headers on the app shell
  const res = await fetch(`${SITE}/`);
  const h = res.headers;
  const want = ['content-security-policy', 'x-frame-options', 'referrer-policy',
    'strict-transport-security', 'x-content-type-options'];
  for (const name of want) {
    record('site-headers', name, h.get(name) !== null, h.get(name) ? 'present' : 'MISSING');
  }

  // Method fuzzing on page routes
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await fetch(`${SITE}/`, { method });
    record('site', `${method} /`, r.status < 500, `HTTP ${r.status}`);
  }

  // Flood: 60 concurrent GETs
  const t0 = Date.now();
  const flood = await Promise.allSettled(
    Array.from({ length: 60 }, () => fetch(`${SITE}/`).then((r) => r.status)),
  );
  const statuses = flood.map((f) => (f.status === 'fulfilled' ? f.value : 0));
  const okCount = statuses.filter((s) => s === 200).length;
  const srvErr = statuses.filter((s) => s >= 500).length;
  record('site-flood', '60 concurrent GET /', srvErr === 0 && okCount > 0,
    `${okCount}x200 ${srvErr}x5xx in ${Date.now() - t0}ms`);
}

async function suiteAuthFn(key) {
  const H = authH(key);

  // Method handling
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const r = await call('tip-entry-auth', { method, headers: H });
    record('entry-auth', `${method} → 405`, r.status === 405, `HTTP ${r.status}`);
  }

  // No apikey/authorization at all → gateway should 401
  const noKey = await post('tip-entry-auth', { action: 'state' });
  record('entry-auth', 'no apikey → 401 gateway', noKey.status === 401, `HTTP ${noKey.status}`);

  // Invalid JSON
  const badJson = await call('tip-entry-auth', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{not json',
  });
  record('entry-auth', 'malformed JSON → 400', badJson.status === 400, `HTTP ${badJson.status} ${JSON.stringify(badJson.body)}`);

  // Unknown / missing action
  for (const body of [{}, { action: 'nope' }, { action: 42 }, { action: null }, []]) {
    const r = await post('tip-entry-auth', body, H);
    record('entry-auth', `action=${JSON.stringify(body)?.slice(0, 40)} → 4xx no crash`,
      r.status >= 400 && r.status < 500, `HTTP ${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`);
  }

  // validate_token garbage shapes (all should be 401 'invalid', never 500)
  const garbageTokens = [
    undefined, null, '', 'x', 'short', 'a'.repeat(15), 'a'.repeat(129),
    'a'.repeat(5000), '../../etc/passwd', "' OR '1'='1", '<script>alert(1)</script>',
    '🇯🇵🍣'.repeat(20), ' spaces ', 0, true, {}, ['x'],
  ];
  for (const token of garbageTokens) {
    const r = await post('tip-entry-auth', { action: 'validate_token', token }, H);
    record('entry-auth', `validate_token garbage (${String(JSON.stringify(token)).slice(0, 30)})`,
      r.status === 401 && r.body?.ok === false, `HTTP ${r.status} code=${r.body?.code}`);
  }

  // Session-gated actions with garbage sessions
  for (const action of ['state', 'voice_ticket', 'set_closer', 'end_session']) {
    const r = await post('tip-entry-auth', { action, sessionToken: 'garbage-session-token-000000', closerId: 'not-a-uuid' }, H);
    record('entry-auth', `${action} bad session → 401`,
      action === 'end_session' ? r.status === 200 : (r.status === 401 && r.body?.code === 'session_invalid'),
      `HTTP ${r.status} code=${r.body?.code ?? 'n/a'}`);
  }
  // end_session must not crash on missing token either
  const es = await post('tip-entry-auth', { action: 'end_session' }, H);
  record('entry-auth', 'end_session no token → ok:true (idempotent)', es.status === 200, `HTTP ${es.status}`);
}

async function suiteRateLimit(key) {
  const H = authH(key);
  // Burn 20 failures from a stable spoofed identifier → expect 429 by #21.
  // NOTE: pollutes tip_auth_attempts with ~24 rows keyed to a random hash;
  // the ledger auto-deletes rows older than 2 days.
  const ident = `floodtest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const headers = { ...H, 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 250) + 1}`, 'user-agent': ident };
  let first429 = -1;
  for (let i = 1; i <= 24; i += 1) {
    const r = await post('tip-entry-auth', { action: 'validate_token', token: `wrong-token-${i}-abcdefghij` }, headers);
    if (r.status === 429 && first429 === -1) first429 = i;
    if (r.status >= 500) record('ratelimit', `attempt ${i} server error`, false, `HTTP ${r.status}`);
  }
  record('ratelimit', '429 after ≤20 bad token tries (10-min window)', first429 > 0 && first429 <= 22,
    first429 === -1 ? 'never limited!' : `first 429 at attempt #${first429}`);

  // XFF spoofing bypass: fresh IP+UA should be allowed again even though the
  // previous identifier is rate-limited.
  const bypass = await post('tip-entry-auth',
    { action: 'validate_token', token: 'wrong-token-again-abcdefghij' },
    { ...H, 'x-forwarded-for': '198.51.100.77', 'user-agent': 'different-agent' });
  record('ratelimit', 'XFF spoof bypasses rate limit (expected vuln)', bypass.status === 401,
    `HTTP ${bypass.status} (401 = bypass works, 429 = limit held)`);

  // Concurrent burst: 30 parallel bad validations from one identifier — the
  // advisory lock should serialize; count 5xx.
  const burstHeaders = { ...H, 'x-forwarded-for': '192.0.2.55', 'user-agent': 'burst-test' };
  const burst = await Promise.allSettled(Array.from({ length: 30 }, (_, i) =>
    post('tip-entry-auth', { action: 'validate_token', token: `burst-${i}-abcdefghijklm` }, burstHeaders)));
  const codes = burst.map((b) => (b.status === 'fulfilled' ? b.value.status : 0));
  const errs = codes.filter((c) => c >= 500 || c === 0).length;
  record('ratelimit', '30 concurrent bad tokens → no 5xx', errs === 0,
    `statuses: ${JSON.stringify(codes.reduce((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {}))}`);
}

async function suiteEntries(key) {
  const H = authH(key);
  for (const method of ['GET', 'PUT']) {
    const r = await call('tip-entries', { method, headers: H });
    record('entries', `${method} → 405`, r.status === 405, `HTTP ${r.status}`);
  }
  const badJson = await call('tip-entries', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{{{' });
  record('entries', 'malformed JSON → 400', badJson.status === 400, `HTTP ${badJson.status}`);

  // Everything requires a session; garbage session must 401 before any work.
  const payloads = [
    { action: 'get_slot', meal: 'lunch', sessionToken: 'x'.repeat(40) },
    { action: 'get_slot', meal: 'brunch', sessionToken: 'x'.repeat(40) },
    { action: 'save', meal: 'dinner', cash: 100, card: 200, peopleIds: ['00000000-0000-4000-8000-000000000000'], sessionToken: 'x'.repeat(40) },
    { action: 'save', meal: 'dinner', cash: -50, card: 1e12, peopleIds: [], sessionToken: 'x'.repeat(40) },
    { action: 'save', meal: 'dinner', cash: 'abc', card: null, sessionToken: 'x'.repeat(40) },
    { action: 'save', sessionToken: 'x'.repeat(40) },
    { sessionToken: 'x'.repeat(40) },
    { action: 'get_slot' }, // no session at all
  ];
  for (const p of payloads) {
    const r = await post('tip-entries', p, H);
    record('entries', `${p.action ?? '(no action)'} bad session → 401`,
      r.status === 401 && r.body?.code === 'session_invalid',
      `HTTP ${r.status} ${JSON.stringify(r.body)?.slice(0, 100)}`);
  }
}

async function suiteVoiceParse(key) {
  const H = authH(key);
  for (const method of ['GET', 'PUT']) {
    const r = await call('tip-voice-parse', { method, headers: H });
    record('voice-parse', `${method} → 405`, r.status === 405, `HTTP ${r.status}`);
  }
  // No multipart at all
  const noForm = await post('tip-voice-parse', { hello: 'world' }, H);
  record('voice-parse', 'JSON body (not multipart) → 4xx no crash', noForm.status >= 400 && noForm.status < 500, `HTTP ${noForm.status}`);

  // Multipart with garbage session
  const form1 = new FormData();
  form1.append('session_token', 'garbage-garbage-garbage-garbage');
  form1.append('audio', new Blob([new Uint8Array(100)], { type: 'audio/webm' }), 'a.webm');
  const r1 = await call('tip-voice-parse', { method: 'POST', headers: H, body: form1 });
  record('voice-parse', 'bad session → 401', r1.status === 401, `HTTP ${r1.status}`);

  // Multipart with no audio + bad session (session checked first → 401)
  const form2 = new FormData();
  form2.append('session_token', 'garbage-garbage-garbage-garbage');
  const r2 = await call('tip-voice-parse', { method: 'POST', headers: H, body: form2 });
  record('voice-parse', 'no audio + bad session → 401', r2.status === 401, `HTTP ${r2.status}`);

  // Oversized body → 413 (6MB of zeros, still bad session — content-length guard fires first)
  const big = new Uint8Array(6 * 1024 * 1024);
  const form3 = new FormData();
  form3.append('session_token', 'garbage-garbage-garbage-garbage');
  form3.append('audio', new Blob([big], { type: 'audio/webm' }), 'big.webm');
  const r3 = await call('tip-voice-parse', { method: 'POST', headers: H, body: form3 });
  record('voice-parse', '6MB upload → 413 before parse', r3.status === 413, `HTTP ${r3.status}`);
}

async function suiteVoiceStream(key) {
  const H = authH(key);
  // Non-WS request
  const r1 = await call('tip-voice-stream', { headers: H });
  record('voice-stream', 'plain HTTP → 400', r1.status === 400, `HTTP ${r1.status}`);

  // WS upgrade with no/garbage ticket via raw headers (undici supports ws? use http upgrade check)
  for (const q of ['', '?ticket=x', '?ticket=' + 'z'.repeat(200)]) {
    const r = await fetch(`${FN}/tip-voice-stream${q}`, {
      headers: { ...H, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' },
    });
    const ok = r.status === 401 || r.status === 400;
    record('voice-stream', `WS ${q || '(no ticket)'} → 401/400`, ok, `HTTP ${r.status}`);
  }
}

async function suiteGatewayAuth(key) {
  // Wrong/garbage apikey should be rejected at the gateway for verify_jwt functions
  for (const fn of ['tip-entry-auth', 'tip-entries', 'tip-voice-parse']) {
    const r = await post(fn, { action: 'state' }, { Authorization: 'Bearer garbage', apikey: 'garbage' });
    record('gateway', `${fn} garbage apikey → 401`, r.status === 401, `HTTP ${r.status}`);
  }
  // And sanity: real key passes the gateway (gets to function logic → 400 unknown action)
  const okR = await post('tip-entry-auth', { action: 'state' }, authH(key));
  record('gateway', 'real anon key passes gateway', okR.status !== 401 || okR.body?.code === 'session_invalid', `HTTP ${okR.status}`);
}

// ---------------------------------------------------------------------------
const suites = {
  site: suiteSite,
  gateway: suiteGatewayAuth,
  auth: suiteAuthFn,
  ratelimit: suiteRateLimit,
  entries: suiteEntries,
  voiceparse: suiteVoiceParse,
  voicestream: suiteVoiceStream,
};

const only = process.argv.find((a) => a.startsWith('--suite='))?.split('=')[1];

console.log('Extracting public anon key from deployed bundle (memory only)...');
const key = await extractAnonKey();
console.log('Key acquired (redacted). Starting flood tests against', SITE, 'and', FN);
console.log('');

for (const [name, fn] of Object.entries(suites)) {
  if (only && name !== only) continue;
  console.log(`--- suite: ${name} ---`);
  try {
    await fn(key);
  } catch (e) {
    record(name, 'suite crashed', false, e.message);
  }
  console.log('');
}

const fails = results.filter((r) => !r.pass);
console.log(`=== SUMMARY: ${results.length - fails.length}/${results.length} passed, ${fails.length} FAILED ===`);
for (const f of fails) console.log(`  FAIL: ${f.suite} :: ${f.name} — ${f.detail}`);
