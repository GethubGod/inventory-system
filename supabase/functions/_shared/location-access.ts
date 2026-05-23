import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

/**
 * Returns true when the user may read/write data for the given location.
 * Employees are limited to users.default_location_id; managers may access any active location.
 */
export async function userCanAccessLocation(
  supabaseAdmin: SupabaseClient,
  userId: string,
  locationId: string,
): Promise<{ allowed: boolean; status: number; error?: string }> {
  const [{ data: userRow }, { data: profile }, { data: location }] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('default_location_id')
      .eq('id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('profiles')
      .select('role, is_suspended')
      .eq('id', userId)
      .maybeSingle(),
    supabaseAdmin
      .from('locations')
      .select('id, active')
      .eq('id', locationId)
      .maybeSingle(),
  ]);

  if (!location?.id || location.active === false) {
    return { allowed: false, status: 403, error: 'Invalid or inactive location' };
  }

  if (profile?.is_suspended === true) {
    return { allowed: false, status: 403, error: 'Suspended accounts cannot access locations' };
  }

  if (profile?.role === 'manager' && profile?.is_suspended !== true) {
    return { allowed: true, status: 200 };
  }

  if (userRow?.default_location_id === locationId) {
    return { allowed: true, status: 200 };
  }

  // If the employee has no default location assigned yet in the DB, allow access.
  // The client will sync the active location on render.
  if (!userRow?.default_location_id) {
    return { allowed: true, status: 200 };
  }

  return { allowed: false, status: 403, error: 'You do not have access to this location' };
}
