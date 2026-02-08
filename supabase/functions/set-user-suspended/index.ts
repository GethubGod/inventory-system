// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';

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

async function getRequester(token: string) {
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return { error: 'Unauthorized', user: null };
  }

  return { error: null, user };
}

async function getRequesterPermission(userId: string) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, is_suspended')
    .eq('id', userId)
    .maybeSingle();

  if (profile?.role) {
    return {
      role: profile.role,
      isSuspended: Boolean(profile.is_suspended),
    };
  }

  const { data: legacyUser } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  return {
    role: legacyUser?.role ?? null,
    isSuspended: Boolean(profile?.is_suspended),
  };
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

  const token = authHeader.replace('Bearer ', '').trim();
  const requesterResult = await getRequester(token);

  if (requesterResult.error || !requesterResult.user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const requesterPermission = await getRequesterPermission(requesterResult.user.id);
  if (requesterPermission.isSuspended) {
    return jsonResponse({ error: 'Suspended accounts cannot perform this action' }, 403);
  }

  if (requesterPermission.role !== 'manager') {
    return jsonResponse({ error: 'Only managers can suspend users' }, 403);
  }

  let userId = '';
  let isSuspended = false;

  try {
    const payload = await req.json();
    userId = typeof payload?.userId === 'string' ? payload.userId.trim() : '';
    isSuspended = Boolean(payload?.isSuspended);
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (!userId) {
    return jsonResponse({ error: 'userId is required' }, 400);
  }

  if (userId === requesterResult.user.id) {
    return jsonResponse({ error: 'You cannot suspend your own account' }, 400);
  }

  const { data: targetAuth, error: targetAuthError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (targetAuthError || !targetAuth?.user) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  const { error: upsertError } = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id: userId,
        is_suspended: isSuspended,
      },
      { onConflict: 'id' }
    );

  if (upsertError) {
    console.error('Failed to update user suspension state', upsertError);
    return jsonResponse({ error: 'Unable to update suspension state' }, 500);
  }

  return jsonResponse({
    success: true,
    userId,
    isSuspended,
  });
});
