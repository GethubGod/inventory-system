import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SimpleOrderScreen } from '@/features/simpleOrder';

export default function SimpleOrderRoute() {
  return (
    <ErrorBoundary title="Order checklist unavailable">
      <SimpleOrderScreen />
    </ErrorBoundary>
  );
}
