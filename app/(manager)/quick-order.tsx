import React from 'react';
import { Redirect } from 'expo-router';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { QuickOrderScreen } from '@/features/ordering/QuickOrderScreen';
import { MANAGER_ORDERING_MODE } from '@/features/ordering/modes';
import { useModuleAccessGuard } from '@/hooks';

export default function ManagerQuickOrderScreen() {
  // Phase 3: the manager Quick Order surface honors the same ordering_advanced
  // module toggle the dashboard exposes for manager rows (managers default
  // all-on, so nothing changes until a manager is explicitly toggled off).
  const guard = useModuleAccessGuard('ordering_advanced', '/(manager)');

  if (guard.isChecking) {
    return null;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return (
    <ErrorBoundary title="Quick Order unavailable">
      <QuickOrderScreen mode={MANAGER_ORDERING_MODE} />
    </ErrorBoundary>
  );
}
