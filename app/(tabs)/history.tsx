import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { HistoryScreen } from '@/features/simpleOrder/HistoryScreen';

export default function HistoryRoute() {
  return (
    <ErrorBoundary title="Order history unavailable">
      <HistoryScreen />
    </ErrorBoundary>
  );
}
