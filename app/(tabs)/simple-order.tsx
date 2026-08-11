import React from 'react';
import { Redirect } from 'expo-router';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SimpleOrderScreen } from '@/features/simpleOrder';
import { useModuleAccessGuard } from '@/hooks';

export default function SimpleOrderRoute() {
  // Phase 3: gated by the ordering_simple module; deep links redirect home.
  const guard = useModuleAccessGuard('ordering_simple');

  if (guard.isChecking) {
    return null;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return (
    <ErrorBoundary title="Order checklist unavailable">
      <SimpleOrderScreen />
    </ErrorBoundary>
  );
}
