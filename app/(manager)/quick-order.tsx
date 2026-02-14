import React from 'react';
import { QuickOrderScreenView } from '@/features/ordering/QuickOrderScreenView';
import { MANAGER_ORDERING_MODE } from '@/features/ordering/modes';

export default function ManagerQuickOrderScreen() {
  return <QuickOrderScreenView mode={MANAGER_ORDERING_MODE} />;
}
