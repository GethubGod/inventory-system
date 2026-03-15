import { supabase } from '@/lib/supabase';

interface LocationReminderRow {
  id: string;
  message: string | null;
  sender_name: string | null;
  created_at: string;
}

export interface LocationReminderBanner {
  id: string;
  message: string;
  senderName: string | null;
  createdAt: string;
}

export async function fetchActiveLocationReminder(
  locationId: string,
): Promise<LocationReminderBanner | null> {
  const { data, error } = await supabase
    .from('reminders')
    .select('id, message, sender_name, created_at')
    .eq('location_id', locationId)
    .eq('status', 'active')
    .eq('scope', 'location_banner')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = data as unknown as LocationReminderRow | null;
  if (!row?.message) {
    return null;
  }

  return {
    id: row.id,
    message: row.message,
    senderName: row.sender_name,
    createdAt: row.created_at,
  };
}

export async function resolveActiveLocationReminders(
  locationId: string,
): Promise<void> {
  const { error } = await supabase.rpc(
    'resolve_active_location_banners_for_location',
    {
      p_location_id: locationId,
      p_order_created_at: new Date().toISOString(),
      p_order_id: null,
    },
  );

  if (error) {
    throw error;
  }
}
