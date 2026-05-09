import React from 'react';
import { QuickOrderScreen } from '@/features/ordering/QuickOrderScreen';
import { MANAGER_ORDERING_MODE } from '@/features/ordering/modes';

export default function ManagerQuickOrderScreen() {
  return <QuickOrderScreen mode={MANAGER_ORDERING_MODE} />;
}
