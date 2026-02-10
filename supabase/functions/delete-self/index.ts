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

function getErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  return 'code' in error ? (error as { code?: string }).code : undefined;
}

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  return 'message' in error && typeof (error as { message?: string }).message === 'string'
    ? (error as { message?: string }).message ?? ''
    : '';
}

function isMissingRelationError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

async function deleteRowsByUser(table: string, column: string, userId: string) {
  const { error } = await supabaseAdmin.from(table).delete().eq(column, userId);
  if (error && !isMissingRelationError(error)) {
    throw new Error(`Failed deleting ${table}.${column}: ${getErrorMessage(error) || 'unknown error'}`);
  }
}

async function nullUserReference(table: string, column: string, userId: string) {
  const { error } = await supabaseAdmin.from(table).update({ [column]: null }).eq(column, userId);
  if (error && !isMissingRelationError(error)) {
    throw new Error(`Failed nulling ${table}.${column}: ${getErrorMessage(error) || 'unknown error'}`);
  }
}

async function cleanupUserData(userId: string) {
  const cleanupTargets = [
    { table: 'device_push_tokens', column: 'user_id' },
    { table: 'notifications', column: 'user_id' },
    { table: 'order_later_items', column: 'created_by' },
    { table: 'past_order_items', column: 'created_by' },
    { table: 'past_orders', column: 'created_by' },
    { table: 'profiles', column: 'id' },
    { table: 'users', column: 'id' },
  ] as const;

  for (const target of cleanupTargets) {
    const { error } = await supabaseAdmin.from(target.table).delete().eq(target.column, userId);
    if (error && !isMissingRelationError(error)) {
      console.error(`Cleanup failed for ${target.table}`, error);
    }
  }
}

async function prepareSelfDelete(userId: string) {
  // These updates mirror admin_prepare_user_delete behavior for self-delete,
  // but remove the user's own ownership rows instead of reassigning them.
  await deleteRowsByUser('orders', 'user_id', userId);
  await deleteRowsByUser('stock_check_sessions', 'user_id', userId);

  await nullUserReference('stock_updates', 'updated_by', userId);
  await nullUserReference('storage_areas', 'last_checked_by', userId);
  await nullUserReference('area_items', 'last_updated_by', userId);
  await nullUserReference('inventory_items', 'created_by', userId);
  await nullUserReference('org_settings', 'updated_by', userId);
}

Deno.serve(async (req) => {
  try {
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
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let confirm = '';
    let requestedUserId = '';
    try {
      const payload = await req.json();
      confirm = typeof payload?.confirm === 'string' ? payload.confirm.trim() : '';
      requestedUserId = typeof payload?.userId === 'string' ? payload.userId.trim() : '';
    } catch {
      return jsonResponse({ error: 'Invalid request body' }, 400);
    }

    if (confirm !== 'DELETE') {
      return jsonResponse({ error: 'Confirmation text must be DELETE' }, 400);
    }

    if (requestedUserId && requestedUserId !== user.id) {
      return jsonResponse({ error: 'You can only delete your own account' }, 403);
    }

    try {
      await prepareSelfDelete(user.id);
    } catch (error) {
      console.error('Unable to clear auth-linked references before self-delete', error);
      return jsonResponse(
        {
          error: 'Unable to prepare account deletion',
          details: getErrorMessage(error) || 'Unknown preparation error',
        },
        500
      );
    }

    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteAuthError) {
      console.error('auth.admin.deleteUser failed', deleteAuthError);
      return jsonResponse(
        {
          error: 'Unable to delete account',
          details: deleteAuthError.message ?? 'Unknown auth deletion error',
        },
        500
      );
    }

    await cleanupUserData(user.id);

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error('Unhandled delete-self error', error);
    return jsonResponse(
      {
        error: 'Unable to delete account',
        details: getErrorMessage(error) || 'Unexpected runtime error',
      },
      500
    );
  }
});
