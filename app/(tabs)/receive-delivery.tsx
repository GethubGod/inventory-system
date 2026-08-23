import React from 'react';
import { Redirect } from 'expo-router';
import { ReceiveDeliveryScreen } from '@/features/simpleOrder/receiving/ReceiveDeliveryScreen';
import { useModuleAccessGuard } from '@/hooks';

export default function ReceiveDeliveryRoute() {
  // Phase 7a: receiving belongs to the simple ordering surface, so it shares
  // that module gate; deep links redirect home.
  const guard = useModuleAccessGuard('ordering_simple');

  if (guard.isChecking) {
    return null;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return <ReceiveDeliveryScreen />;
}
