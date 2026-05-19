import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { QuickOrderReviewQueueScreen } from '@/features/ordering/QuickOrderReviewQueueScreen';

export default function PendingQuickOrderReviewRoute() {
  return (
    <ErrorBoundary title="Review queue unavailable">
      <QuickOrderReviewQueueScreen />
    </ErrorBoundary>
  );
}
