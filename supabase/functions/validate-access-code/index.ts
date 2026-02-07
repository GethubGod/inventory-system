// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';

type Role = 'employee' | 'manager';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ACCESS_CODE_REGEX = /^\d{4}$/;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let accessCode = '';

  try {
    const payload = await req.json();
    accessCode =
      typeof payload?.accessCode === 'string'
        ? payload.accessCode.trim()
        : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (!ACCESS_CODE_REGEX.test(accessCode)) {
    return jsonResponse({ error: 'Access code must be exactly 4 digits' }, 400);
  }

  const { data, error } = await supabaseAdmin.rpc('get_access_code_role', {
    p_access_code: accessCode,
  });

  if (error) {
    console.error('get_access_code_role failed', error);
    return jsonResponse({ error: 'Unable to validate access code' }, 500);
  }

  if (data !== 'employee' && data !== 'manager') {
    return jsonResponse({ error: 'Invalid access code' }, 400);
  }

  return jsonResponse({ role: data as Role });
});
