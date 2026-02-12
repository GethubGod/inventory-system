import { supabase } from '@/lib/supabase';

export type ManagedUserRole = 'employee' | 'manager';

export interface ManagedUser {
  id: string;
  email: string;
  full_name: string | null;
  role: ManagedUserRole;
  is_suspended: boolean;
  last_active_at: string | null;
  last_order_at: string | null;
  created_at: string | null;
}

interface ListUsersResponse {
  users: ManagedUser[];
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

export async function listManagedUsers(): Promise<ManagedUser[]> {
  const { data, error } = await supabase.functions.invoke('list-users', {
    body: {},
  });
  const typedData = data as ListUsersResponse | null;

  if (error) {
    const message = (await getFunctionErrorMessage(error)) || 'Unable to load users.';
    throw new Error(message);
  }

  return typedData?.users ?? [];
}

export async function setManagedUserSuspended(params: {
  userId: string;
  isSuspended: boolean;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke('set-user-suspended', {
    body: params,
  });
  const typedData = data as { success?: boolean; error?: string } | null;

  if (error || typedData?.success !== true) {
    const message =
      (await getFunctionErrorMessage(error)) ||
      typedData?.error ||
      'Unable to update suspension state.';
    throw new Error(message);
  }
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
