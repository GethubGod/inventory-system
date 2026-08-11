import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SupplierContactsScreen } from '@/features/settings/SupplierContactsScreen';

export default function ManagerSupplierContactsRoute() {
  return (
    <ErrorBoundary title="Supplier contacts unavailable">
      <SupplierContactsScreen />
    </ErrorBoundary>
  );
}
