import { supabase } from '@/lib/supabase';

// Best-effort staleness pre-check shared by the fulfillment confirmation screen
// and the Send All flow: returns the consumed order_item ids that are no longer
// `pending` (i.e. already processed on another device), so callers can abort
// before double-archiving. Throws when the freshness query itself fails — the
// check is best-effort, so callers catch and proceed.
export async function findStaleConsumedOrderItemIds(
  consumedOrderItemIds: string[]
): Promise<string[]> {
  const normalizedIds = Array.from(
    new Set(
      consumedOrderItemIds.filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0
      )
    )
  );
  if (normalizedIds.length === 0) return [];

  const { data, error } = await supabase
    .from('order_items')
    .select('id,status')
    .in('id', normalizedIds);
  if (error) {
    throw error;
  }
  const pendingIds = new Set(
    (Array.isArray(data) ? data : [])
      .filter((row: any) => row?.status === 'pending')
      .map((row: any) => (typeof row?.id === 'string' ? row.id : null))
      .filter((id: string | null): id is string => Boolean(id))
  );
  return normalizedIds.filter((id) => !pendingIds.has(id));
}
