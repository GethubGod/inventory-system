import { useMemo } from 'react';
import { type Href, useLocalSearchParams } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '@/store';
import {
  getSettingsRootPath,
  isSettingsOrigin,
  type SettingsOrigin,
} from '@/lib/settingsNavigation';

export function useSettingsNavigationContext(defaultOrigin?: SettingsOrigin) {
  const { user, profile, session, viewMode } = useAuthStore(
    useShallow((state) => ({
      user: state.user,
      profile: state.profile,
      session: state.session,
      viewMode: state.viewMode,
    }))
  );
  const params = useLocalSearchParams<{
    origin?: string | string[];
    backTo?: string | string[];
  }>();
  const metadataRole =
    typeof session?.user?.user_metadata?.role === 'string'
      ? session.user.user_metadata.role
      : typeof session?.user?.app_metadata?.role === 'string'
        ? session.user.app_metadata.role
        : null;
  const isManager = (user?.role ?? profile?.role ?? metadataRole) === 'manager';

  return useMemo(() => {
    const originParam = Array.isArray(params.origin)
      ? params.origin[0]
      : params.origin;
    const backToParam = Array.isArray(params.backTo)
      ? params.backTo[0]
      : params.backTo;

    const origin =
      (isSettingsOrigin(originParam) ? originParam : undefined) ??
      defaultOrigin ??
      (isManager && viewMode === 'manager' ? 'manager' : 'employee');

    const backTo = (
      typeof backToParam === 'string' && backToParam.length > 0
        ? backToParam
        : getSettingsRootPath(origin)
    ) as Href;

    return {
      origin,
      backTo,
      hasExplicitBackTo:
        typeof backToParam === 'string' && backToParam.length > 0,
    };
  }, [defaultOrigin, isManager, params.backTo, params.origin, viewMode]);
}

export function useSettingsBackRoute(): Href {
  const { backTo } = useSettingsNavigationContext();
  return backTo as Href;
}
