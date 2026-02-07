// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';

const ACCESS_CODE_REGEX = /^\d{4}$/;

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');

  let employeeAccessCode = '';
  let managerAccessCode = '';

  try {
    const payload = await req.json();
    employeeAccessCode =
      typeof payload?.employeeAccessCode === 'string'
        ? payload.employeeAccessCode.trim()
        : '';
    managerAccessCode =
      typeof payload?.managerAccessCode === 'string'
        ? payload.managerAccessCode.trim()
        : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (!ACCESS_CODE_REGEX.test(employeeAccessCode) || !ACCESS_CODE_REGEX.test(managerAccessCode)) {
    return jsonResponse({ error: 'Both access codes must be exactly 4 digits' }, 400);
  }

  if (employeeAccessCode === managerAccessCode) {
    return jsonResponse({ error: 'Employee and manager access codes must be different' }, 400);
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError) {
    console.error('Failed to fetch user role', profileError);
    return jsonResponse({ error: 'Unable to verify permissions' }, 500);
  }

  if (profile?.role !== 'manager') {
    return jsonResponse({ error: 'Only managers can update access codes' }, 403);
  }

  const { error: updateError } = await supabaseAdmin.rpc('update_org_access_codes', {
    p_employee_access_code: employeeAccessCode,
    p_manager_access_code: managerAccessCode,
    p_updated_by: user.id,
  });

  if (updateError) {
    console.error('update_org_access_codes failed', updateError);
    return jsonResponse({ error: 'Unable to update access codes' }, 500);
  }

  return jsonResponse({ success: true });
});
