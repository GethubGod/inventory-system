import React from 'react';
import { Redirect } from 'expo-router';
import { useMyModules, useProtectedAuthGuard } from '@/hooks';
import { getVisibleEmployeeTabs } from '@/store/moduleStore.helpers';

/**
 * Checklist-first restructure: Home is no longer an employee surface. The
 * group's index route forwards to the first visible pill tab (the Order
 * checklist for checklist-only employees) so old links and the post-auth
 * redirect keep working.
 */
export default function HomeRedirect() {
  const guard = useProtectedAuthGuard();
  const { modules } = useMyModules(guard.resolvedRole);

  if (guard.isChecking) {
    return null;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  const firstTab = getVisibleEmployeeTabs(modules)[0] ?? 'settings';
  // Cast: .expo/types/router.d.ts is a stale generated artifact; the route
  // files exist (pattern from SimpleOrderScreen.tsx).
  return <Redirect href={`/(tabs)/${firstTab}` as never} />;
}
