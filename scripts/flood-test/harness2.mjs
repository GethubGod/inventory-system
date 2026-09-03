// Round 2: WebSocket ticket auth (real WS client) + oversized upload retest.
const SUPA = 'https://whrohvitvmcrmedepurd.supabase.co';
const FN = `${SUPA}/functions/v1`;

async function extractAnonKey() {
  const SITE = 'https://tips.babytunasystems.com';
  const html = await (await fetch(SITE)).text();
  const queue = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  const seen = new Set();
  const keyRe = /(eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)/;
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    let js = '';
    try { js = await (await fetch(`${SITE}${path}`)).text(); } catch { continue; }
    const m = js.match(keyRe);
    if (m) return m[1];
    for (const inner of js.matchAll(/"(\/_next\/static\/[^"]+\.js)"/g)) queue.push(inner[1]);
    if (seen.size > 60) break;
  }
  throw new Error('no key found');
}

const key = await extractAnonKey();
console.log('key acquired (redacted)');

// --- WS tests with real WebSocket client ---
function tryWs(label, ticket) {
  return new Promise((resolve) => {
    const url = `${SUPA.replace('https', 'wss')}/functions/v1/tip-voice-stream${ticket ? `?ticket=${ticket}` : ''}`;
    let settled = false;
    const done = (ok, detail) => { if (!settled) { settled = true; console.log(`[${ok ? 'PASS' : 'FAIL'}] ws :: ${label} — ${detail}`); resolve(); } };
    let ws;
    try {
      ws = new WebSocket(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    } catch (e) { return done(true, `constructor threw (client): ${e.message}`); }
    const timer = setTimeout(() => done(false, 'timed out (no close/error in 10s)'), 10000);
    ws.onopen = () => { clearTimeout(timer); ws.close(); done(false, 'connection OPENED with bad ticket (auth bypass!)'); };
    ws.onerror = () => { /* expected on 401 */ };
    ws.onclose = (ev) => { clearTimeout(timer); done(ev.code === 1006 || ev.code === 1008, `closed code=${ev.code} reason=${ev.reason || '(none)'}`); };
  });
}

await tryWs('no ticket', '');
await tryWs('short ticket', 'x');
await tryWs('garbage ticket (64 chars)', 'z'.repeat(64));
await tryWs('oversized ticket (200 chars)', 'z'.repeat(200));

// --- Oversized upload retest (5.2MB, fresh, alone) ---
const big = new Uint8Array(5 * 1024 * 1024 + 100 * 1024);
const form = new FormData();
form.append('session_token', 'garbage-garbage-garbage-garbage');
form.append('audio', new Blob([big], { type: 'audio/webm' }), 'big.webm');
const t0 = Date.now();
try {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 60000);
  const res = await fetch(`${FN}/tip-voice-parse`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    body: form,
    signal: ctrl.signal,
  });
  const body = await res.text();
  console.log(`[${res.status === 413 ? 'PASS' : 'WARN'}] 5.2MB upload → HTTP ${res.status} in ${Date.now() - t0}ms :: ${body.slice(0, 140)}`);
} catch (e) {
  console.log(`[WARN] 5.2MB upload threw: ${e.message} after ${Date.now() - t0}ms`);
}

// --- Concurrent session-less load on voice-parse (does gateway/function hold up?) ---
const flood = await Promise.allSettled(Array.from({ length: 25 }, () => {
  const f = new FormData();
  f.append('session_token', 'garbage-garbage-garbage-garbage');
  f.append('audio', new Blob([new Uint8Array(64)], { type: 'audio/webm' }), 'a.webm');
  return fetch(`${FN}/tip-voice-parse`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}` }, body: f }).then((r) => r.status);
}));
const codes = flood.map((f) => (f.status === 'fulfilled' ? f.value : 0));
console.log(`[${codes.every((c) => c === 401) ? 'PASS' : 'FAIL'}] voice-parse 25 concurrent bad-session posts → ${JSON.stringify(codes)}`);
