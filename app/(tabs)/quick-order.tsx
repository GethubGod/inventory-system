import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { QuickOrderScreen as QuickOrderChatScreen } from '@/features/ordering/QuickOrderScreen';
import { EMPLOYEE_ORDERING_MODE } from '@/features/ordering/modes';

export default function QuickOrderScreen() {
  return (
    <ErrorBoundary title="Quick Order unavailable">
      <QuickOrderChatScreen mode={EMPLOYEE_ORDERING_MODE} />
    </ErrorBoundary>
  );
}
