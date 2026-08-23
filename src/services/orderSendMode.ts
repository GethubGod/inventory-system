import { supabase } from '@/lib/supabase';

export type OrderSendMode = 'direct' | 'review';

type OrderSendModeRow = {
  order_send_mode: unknown;
};

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    throw new Error('User ID is required.');
  }
  return normalized;
}

function normalizeOrderSendMode(value: unknown): OrderSendMode {
  return value === 'direct' ? 'direct' : 'review';
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;

  const userId = data.user?.id;
  if (!userId) {
    throw new Error('You must be signed in to view order send mode.');
  }

  return userId;
}

/** Returns the signed-in employee's configured checklist send mode. */
export async function getMyOrderSendMode(): Promise<OrderSendMode> {
  return getOrderSendMode(await getCurrentUserId());
}

/**
 * Returns one employee's configured checklist send mode. RLS allows the
 * employee to read their own row and managers to read all managed profiles.
 */
export async function getOrderSendMode(userId: string): Promise<OrderSendMode> {
  const { data, error } = await supabase
    .from('profiles')
    .select('order_send_mode')
    .eq('id', normalizeUserId(userId))
    .single();

  if (error) throw error;
  return normalizeOrderSendMode((data as OrderSendModeRow | null)?.order_send_mode);
}

/**
 * Updates an employee's configured checklist send mode. The profile trigger
 * and RLS policy make this a manager-only cross-user update.
 */
export async function setOrderSendMode(userId: string, mode: OrderSendMode): Promise<void> {
  if (mode !== 'direct' && mode !== 'review') {
    throw new Error('Order send mode must be direct or review.');
  }

  const { error } = await supabase
    .from('profiles')
    .update({ order_send_mode: mode })
    .eq('id', normalizeUserId(userId))
    .eq('role', 'employee');

  if (error) throw error;
}
