// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const supabaseAuth = createClient(supabaseUrl, anonKey, {
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

async function verifyManagerPassword(email: string, password: string, expectedUserId: string) {
  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email,
    password,
  });

  // Best-effort cleanup for this server-side auth session.
  await supabaseAuth.auth.signOut();

  if (error || !data?.user) {
    return false;
  }

  return data.user.id === expectedUserId;
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
    return jsonResponse({ error: 'Only managers can delete users' }, 403);
  }

  let userId = '';
  let managerPassword = '';
  let confirmText = '';

  try {
    const payload = await req.json();
    userId = typeof payload?.userId === 'string' ? payload.userId.trim() : '';
    managerPassword =
      typeof payload?.managerPassword === 'string' ? payload.managerPassword : '';
    confirmText = typeof payload?.confirmText === 'string' ? payload.confirmText.trim() : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (!userId) {
    return jsonResponse({ error: 'userId is required' }, 400);
  }

  if (confirmText !== 'DELETE') {
    return jsonResponse({ error: 'Confirmation text must be DELETE' }, 400);
  }

  if (!managerPassword) {
    return jsonResponse({ error: 'Manager password is required' }, 400);
  }

  if (userId === requesterResult.user.id) {
    return jsonResponse({ error: 'You cannot delete your own account' }, 400);
  }

  const requesterEmail = requesterResult.user.email ?? '';
  if (!requesterEmail) {
    return jsonResponse({ error: 'Unable to verify manager credentials' }, 400);
  }

  const isPasswordValid = await verifyManagerPassword(
    requesterEmail,
    managerPassword,
    requesterResult.user.id
  );

  if (!isPasswordValid) {
    return jsonResponse({ error: 'Incorrect password' }, 401);
  }

  const { data: targetAuth, error: targetAuthError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (targetAuthError || !targetAuth?.user) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  const { error: reassignError } = await supabaseAdmin.rpc('admin_prepare_user_delete', {
    p_target_user_id: userId,
    p_replacement_user_id: requesterResult.user.id,
  });

  if (reassignError) {
    console.error('admin_prepare_user_delete failed', reassignError);
    return jsonResponse({ error: 'Unable to prepare account deletion' }, 500);
  }

  const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteAuthError) {
    console.error('auth.admin.deleteUser failed', deleteAuthError);
    return jsonResponse({ error: 'Unable to delete account' }, 500);
  }

  // Cleanup rows in case auth->public cascades are not configured in this environment.
  const { error: profileDeleteError } = await supabaseAdmin
    .from('profiles')
    .delete()
    .eq('id', userId);

  if (profileDeleteError) {
    console.error('Post-delete profile cleanup failed', profileDeleteError);
  }

  const { error: userDeleteError } = await supabaseAdmin
    .from('users')
    .delete()
    .eq('id', userId);

  if (userDeleteError) {
    console.error('Post-delete users cleanup failed', userDeleteError);
  }

  return jsonResponse({ success: true, userId });
});
