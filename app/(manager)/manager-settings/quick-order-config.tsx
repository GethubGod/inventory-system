import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { QuickOrderConfigScreen } from '@/features/ordering/QuickOrderConfigScreen';

export default function ManagerQuickOrderConfigRoute() {
  return (
    <ErrorBoundary title="Quick Order settings unavailable">
      <QuickOrderConfigScreen />
    </ErrorBoundary>
  );
}
