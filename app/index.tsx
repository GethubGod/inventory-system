import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store';
import { AuthLoadingScreen } from '@/components';
import { getAuthenticatedHomeHref, useProtectedAuthGuard } from '@/hooks/useAuthGuard';

export default function Index() {
  const viewMode = useAuthStore((state) => state.viewMode);
  const guard = useProtectedAuthGuard();

  if (guard.isChecking) {
    return <AuthLoadingScreen />;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return <Redirect href={getAuthenticatedHomeHref(guard.resolvedRole, viewMode)} />;
}
