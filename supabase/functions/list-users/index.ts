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

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role, is_suspended')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    console.error('Failed to fetch requester profile', profileError);
    return { role: null, isSuspended: false };
  }

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
    return jsonResponse({ error: 'Only managers can view users' }, 403);
  }

  const authUsers: any[] = [];
  const perPage = 200;

  for (let page = 1; page < 500; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      console.error('auth.admin.listUsers failed', error);
      return jsonResponse({ error: 'Unable to list users' }, 500);
    }

    const batch = data?.users ?? [];
    authUsers.push(...batch);

    if (batch.length < perPage) break;
  }

  const userIds = authUsers.map((u) => u.id);
  const profileById = new Map<string, any>();
  const legacyUserById = new Map<string, any>();

  for (const chunk of chunkArray(userIds, 500)) {
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, role, is_suspended, last_active_at, last_order_at, created_at')
      .in('id', chunk);

    if (profileError) {
      console.error('Failed loading profiles for list-users', profileError);
      return jsonResponse({ error: 'Unable to list users' }, 500);
    }

    for (const profile of profiles ?? []) {
      profileById.set(profile.id, profile);
    }

    const { data: legacyUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, name, role')
      .in('id', chunk);

    if (usersError) {
      console.error('Failed loading legacy users for list-users', usersError);
      return jsonResponse({ error: 'Unable to list users' }, 500);
    }

    for (const legacyUser of legacyUsers ?? []) {
      legacyUserById.set(legacyUser.id, legacyUser);
    }
  }

  const users = authUsers
    .map((authUser) => {
      const profile = profileById.get(authUser.id);
      const legacyUser = legacyUserById.get(authUser.id);

      const resolvedRole =
        profile?.role === 'manager' || profile?.role === 'employee'
          ? profile.role
          : legacyUser?.role === 'manager'
            ? 'manager'
            : 'employee';

      const metadataName =
        authUser.user_metadata?.full_name ??
        authUser.user_metadata?.name ??
        authUser.raw_user_meta_data?.full_name ??
        authUser.raw_user_meta_data?.name ??
        null;

      return {
        id: authUser.id,
        email: authUser.email ?? '',
        full_name: profile?.full_name ?? legacyUser?.name ?? metadataName,
        role: resolvedRole,
        is_suspended: Boolean(profile?.is_suspended),
        last_active_at: profile?.last_active_at ?? authUser.last_sign_in_at ?? null,
        last_order_at: profile?.last_order_at ?? null,
        created_at: profile?.created_at ?? authUser.created_at ?? null,
      };
    })
    .sort((a, b) => {
      const aName = (a.full_name || a.email || '').toLowerCase();
      const bName = (b.full_name || b.email || '').toLowerCase();
      return aName.localeCompare(bName);
    });

  return jsonResponse({ users });
});
