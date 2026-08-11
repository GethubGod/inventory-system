import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SendAllScreen } from '@/features/fulfillment/sendAll/SendAllScreen';

export default function FulfillmentSendAllRoute() {
  return (
    <ErrorBoundary title="Send All unavailable">
      <SendAllScreen />
    </ErrorBoundary>
  );
}
