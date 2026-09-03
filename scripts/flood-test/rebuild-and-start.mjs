// Rebuilds web/ with the public Supabase env inlined (NEXT_PUBLIC_* vars are
// baked at BUILD time) and starts the production server on :3100. The
// publishable anon key is extracted from the live site's public JS bundle in
// memory and passed via child env — never printed, never written to disk.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
if (!key) throw new Error('anon key not found');

const webDir = fileURLToPath(new URL('../../web', import.meta.url));
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: 'https://whrohvitvmcrmedepurd.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
};
const nextBin = `${webDir}/node_modules/next/dist/bin/next`;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, ...args], { cwd: webDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`next ${args[0]} exited ${code}`))));
  });
}

console.log('Building with public env inlined...');
await run(['build']);
console.log('Build done. Starting on :3100...');
await run(['start', '-p', '3100']);
