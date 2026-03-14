import { supabase } from '@/lib/supabase';
import { listUsers, setUserSuspended } from '@/lib/api/client';

export type ManagedUserRole = 'employee' | 'manager';

export interface ManagedUser {
  id: string;
  email: string;
  full_name: string | null;
  role: ManagedUserRole;
  is_suspended: boolean;
  suspended_at: string | null;
  suspended_by: string | null;
  last_active_at: string | null;
  last_order_at: string | null;
  created_at: string | null;
}

const BASE_PROFILE_COLUMNS = [
  'id',
  'full_name',
  'role',
  'is_suspended',
  'last_active_at',
  'last_order_at',
  'created_at',
] as const;

const OPTIONAL_PROFILE_COLUMNS = ['email', 'suspended_at', 'suspended_by'] as const;

function isMissingColumnError(error: unknown, column: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : null;
  const message = 'message' in error ? (error as { message?: unknown }).message : null;

  if (code !== 'PGRST204' || typeof message !== 'string') return false;
  return message.includes(column) && message.toLowerCase().includes('schema cache');
}

function normalizeRole(role: unknown): ManagedUserRole {
  return role === 'manager' ? 'manager' : 'employee';
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      if (message.toLowerCase().includes('row-level security')) {
        return 'Managers only';
      }
      return message;
    }
  }

  return fallback;
}

async function selectManagedProfiles() {
  let columns = [...BASE_PROFILE_COLUMNS, ...OPTIONAL_PROFILE_COLUMNS] as string[];

  while (true) {
    const { data, error } = await supabase
      .from('profiles')
      .select(columns.join(', '))
      .in('role', ['employee', 'manager'])
      .order('full_name', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (!error) {
      return (data ?? []) as any[];
    }

    const missingColumn = OPTIONAL_PROFILE_COLUMNS.find(
      (column) => columns.includes(column) && isMissingColumnError(error, column)
    );

    if (!missingColumn) {
      throw error;
    }

    columns = columns.filter((column) => column !== missingColumn);
  }
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const result = await listUsers();
  if (result.error) {
    throw new Error(result.error);
  }
  return result.data ?? [];
}

async function updateSuspensionWithFallback(
  userId: string,
  payload: Record<string, unknown>
): Promise<{ id: string } | null> {
  const nextPayload = { ...payload };

  while (true) {
    const { data, error } = await supabase
      .from('profiles')
      .update(nextPayload)
      .eq('id', userId)
      .eq('role', 'employee')
      .select('id')
      .maybeSingle();

    if (!error) {
      return (data as { id: string } | null) ?? null;
    }

    const missingColumn = OPTIONAL_PROFILE_COLUMNS.find(
      (column) => column in nextPayload && isMissingColumnError(error, column)
    );

    if (!missingColumn) {
      throw error;
    }

    delete nextPayload[missingColumn];
  }
}

export async function setManagedUserSuspended(params: {
  userId: string;
  isSuspended: boolean;
}): Promise<void> {
  const userId = params.userId?.trim();
  if (!userId) {
    throw new Error('User ID is required.');
  }

  const result = await setUserSuspended({
    userId,
    isSuspended: params.isSuspended,
  });

  if (result.error) {
    throw new Error(result.error);
  }
}

async function getFunctionErrorMessage(error: unknown): Promise<string | null> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: any }).context;

    if (context) {
      if (
        typeof context === 'object' &&
        !(context instanceof Response) &&
        typeof context.error === 'string'
      ) {
        return context.error;
      }

      if (typeof context.json === 'function') {
        try {
          const payload = await context.json();
          if (typeof payload?.error === 'string') {
            return payload.error;
          }
        } catch {
          // Ignore JSON parse errors for already-consumed/non-JSON bodies.
        }
      }
    }
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (
      typeof message === 'string' &&
      !message.toLowerCase().includes('edge function returned a non-2xx')
    ) {
      return message;
    }
  }

  return null;
}

export async function deleteManagedUserAccount(params: {
  userId: string;
  managerPassword: string;
  confirmText: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-user', {
    body: params,
  });
  const typedData = data as { success?: boolean; error?: string } | null;

  if (error || typedData?.success !== true) {
    const message =
      (await getFunctionErrorMessage(error)) || typedData?.error || 'Unable to delete account.';
    throw new Error(message);
  }
}
