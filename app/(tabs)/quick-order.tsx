import React from 'react';
import { QuickOrderScreenView } from '@/features/ordering/QuickOrderScreenView';
import { EMPLOYEE_ORDERING_MODE } from '@/features/ordering/modes';

export default function QuickOrderScreen() {
  return <QuickOrderScreenView mode={EMPLOYEE_ORDERING_MODE} />;
}
