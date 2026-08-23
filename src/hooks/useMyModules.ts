// Phase 3 — module access hooks. `useMyModules` powers the tab layouts;
// `useModuleAccessGuard` protects direct deep links to module-gated screens
// the same way role guards do (resolve → <Redirect> home when not allowed).

import { useEffect, useMemo } from 'react';
import type { Href } from 'expo-router';
import { useAuthStore } from '@/store';
import { acquireModuleAccess, useModuleStore } from '@/store/moduleStore';
import {
  resolveEffectiveModules,
  type EffectiveModules,
} from '@/store/moduleStore.helpers';
import type { ModuleKey } from '@/services/userModules';
import type { UserRole } from '@/types';
import { useProtectedAuthGuard } from '@/hooks/useAuthGuard';

export interface MyModulesResult {
  /** Effective module map — server data when available, role defaults otherwise. */
  modules: EffectiveModules;
  /** True once the server answered (or definitively failed and defaults apply). */
  isReady: boolean;
}

export function useMyModules(resolvedRole: UserRole | null): MyModulesResult {
  const sessionUserId = useAuthStore((state) => state.session?.user?.id ?? null);
  const fetched = useModuleStore((state) => state.fetched);
  const status = useModuleStore((state) => state.status);

  useEffect(() => {
    if (!sessionUserId) return;
    return acquireModuleAccess(sessionUserId);
  }, [sessionUserId]);

  return useMemo(
    () => ({
      modules: resolveEffectiveModules(resolvedRole, fetched),
      isReady: status === 'ready' || status === 'error',
    }),
    [fetched, resolvedRole, status],
  );
}

export interface ModuleGuardResult {
  isChecking: boolean;
  redirectTo: Href | null;
}

/**
 * Route-level guard for module-gated screens. Waits for a definitive module
 * answer before deciding (no flash-redirects while the fetch is in flight),
 * then redirects home when the module is disabled. Because the underlying
 * store is subscription-driven, a live toggle flip re-resolves this guard and
 * kicks the user off the screen without re-login.
 */
export function useModuleAccessGuard(
  moduleKey: ModuleKey,
  homeHref: Href = '/(tabs)',
): ModuleGuardResult {
  const guard = useProtectedAuthGuard();
  const { modules, isReady } = useMyModules(guard.resolvedRole);

  if (guard.isChecking || guard.redirectTo) {
    return { isChecking: guard.isChecking, redirectTo: guard.redirectTo };
  }

  if (!isReady) {
    return { isChecking: true, redirectTo: null };
  }

  return {
    isChecking: false,
    redirectTo: modules[moduleKey] ? null : homeHref,
  };
}
