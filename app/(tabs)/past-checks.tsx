import React from 'react';
import { Redirect } from 'expo-router';
import { PastChecksScreen } from '@/features/stock-check';
import { useModuleAccessGuard } from '@/hooks';

export default function PastChecksRoute() {
  // Phase 3: gated by the stock_check module; deep links redirect home.
  const guard = useModuleAccessGuard('stock_check');

  if (guard.isChecking) {
    return null;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return <PastChecksScreen />;
}
