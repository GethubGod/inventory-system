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
const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

if (!supabaseUrl || !anonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (legacy ANON_KEY is also supported).');
  process.exit(2);
}

const payload = {
  p_id: '00000000-0000-4000-8000-000000000001',
  p_org_id: null,
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
      ...(anonKey.startsWith('sb_publishable_') ? {} : { Authorization: `Bearer ${anonKey}` }),
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    body = { message: responseText };
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

  // Only a denial from the resolved function proves this probe reached it.
  // A gateway 401, outage, or unrelated database error proves nothing.
  const expectedDenial = !response.ok && response.status < 500 && (
    (code === '42501' && /permission denied for function submit_order_rpc/i.test(message || '')) ||
    (code === 'P0001' && message === 'Unauthorized')
  );
  if (!expectedDenial) {
    console.error('Unable to verify submit_order_rpc: expected its authorization denial. No passing result was recorded.');
    console.error(JSON.stringify({ status: response.status, code, message }, null, 2));
    process.exit(1);
  }

  console.log('submit_order_rpc 8-parameter contract resolved and rejected the unauthenticated probe. This does not verify order submission.');
  console.log(JSON.stringify({ status: response.status, code, message }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
