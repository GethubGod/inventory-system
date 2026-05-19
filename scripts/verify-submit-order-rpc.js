#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const inheritedEnv = new Set(Object.keys(process.env));

function loadEnvFile(filename) {
  const envPath = path.join(process.cwd(), filename);
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!inheritedEnv.has(key)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !anonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(2);
}

const payload = {
  p_id: '00000000-0000-4000-8000-000000000001',
  p_location_id: '00000000-0000-4000-8000-000000000002',
  p_user_id: '00000000-0000-4000-8000-000000000003',
  p_status: 'submitted',
  p_items: [],
  p_entry_method: 'manual',
  p_quick_session_id: null,
};

async function main() {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/submit_order_rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(payload),
  });

  let body = {};
  try {
    body = await response.json();
  } catch {
    body = { message: await response.text().catch(() => '') };
  }

  const code = typeof body === 'object' && body !== null ? body.code : undefined;
  const message = typeof body === 'object' && body !== null ? body.message : String(body);
  const hint = typeof body === 'object' && body !== null ? body.hint : undefined;
  const combined = [message, hint].filter(Boolean).join(' ');

  if (code === 'PGRST202' || combined.includes('p_entry_method') || combined.includes('p_quick_session_id')) {
    console.error('submit_order_rpc is not visible with the audit-hardened 8-parameter contract.');
    console.error(JSON.stringify({ status: response.status, code, message, hint }, null, 2));
    process.exit(1);
  }

  console.log('submit_order_rpc 8-parameter contract is visible to PostgREST.');
  console.log(JSON.stringify({ status: response.status, code, message }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
