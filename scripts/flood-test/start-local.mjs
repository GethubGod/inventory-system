// Starts the production build of web/ locally with the public Supabase env
// wired in. The publishable anon key is extracted from the live site's public
// JS bundle in memory and passed to the child process env — never printed,
// never written to disk.
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
const child = spawn(process.execPath, [`${webDir}/node_modules/next/dist/bin/next`, 'start', '-p', '3100'], {
  cwd: webDir,
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: 'https://whrohvitvmcrmedepurd.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(d));
child.stderr.on('data', (d) => process.stderr.write(d));
child.on('exit', (code) => process.exit(code ?? 0));
