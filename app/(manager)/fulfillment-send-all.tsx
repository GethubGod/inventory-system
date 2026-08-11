import React from 'react';
import { Redirect } from 'expo-router';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SendAllScreen } from '@/features/fulfillment/sendAll/SendAllScreen';
import { useModuleAccessGuard } from '@/hooks';

export default function FulfillmentSendAllRoute() {
  // Phase 3: same fulfillment-module gate as the parent fulfillment tab —
  // deep links to a disabled module redirect to manager home.
  const guard = useModuleAccessGuard('fulfillment', '/(manager)');

  if (guard.isChecking) {
    return null;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return (
    <ErrorBoundary title="Send All unavailable">
      <SendAllScreen />
    </ErrorBoundary>
  );
}
