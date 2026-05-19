import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { QuickOrderScreen } from '@/features/ordering/QuickOrderScreen';
import { MANAGER_ORDERING_MODE } from '@/features/ordering/modes';

export default function ManagerQuickOrderScreen() {
  return (
    <ErrorBoundary title="Quick Order unavailable">
      <QuickOrderScreen mode={MANAGER_ORDERING_MODE} />
    </ErrorBoundary>
  );
}
