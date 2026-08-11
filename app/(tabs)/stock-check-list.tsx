import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { StockCheckScreenView } from '@/features/stock-check';
import { useModuleAccessGuard } from '@/hooks';

export default function StockCheckListRoute() {
  // Phase 3: gated by the stock_check module; deep links redirect home.
  const guard = useModuleAccessGuard('stock_check');
  const { stationId } = useLocalSearchParams<{ stationId?: string }>();

  if (guard.isChecking) {
    return null;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return <StockCheckScreenView stationId={stationId} />;
}
