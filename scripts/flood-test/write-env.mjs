// Writes web/.env.local (gitignored) with the public Supabase config, exactly
// as SETUP.md instructs for local dev. The publishable anon key is extracted
// from the live site's public JS bundle and NEVER printed to stdout.
import { writeFileSync } from 'node:fs';

const SITE = 'https://tips.babytunasystems.com';
const html = await (await fetch(SITE)).text();
const queue = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
const seen = new Set();
const keyRe = /(eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+)/;
let key = null;
while (queue.length && !key) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);
  let js = '';
  try { js = await (await fetch(`${SITE}${path}`)).text(); } catch { continue; }
  const m = js.match(keyRe);
  if (m) { key = m[1]; break; }
  for (const inner of js.matchAll(/"(\/_next\/static\/[^"]+\.js)"/g)) queue.push(inner[1]);
  if (seen.size > 60) break;
}
if (!key) throw new Error('anon key not found in deployed bundle');
writeFileSync(
  new URL('../../web/.env.local', import.meta.url),
  `NEXT_PUBLIC_SUPABASE_URL=https://whrohvitvmcrmedepurd.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${key}\n`,
  { mode: 0o600 },
);
console.log('web/.env.local written (key redacted, file mode 600)');
