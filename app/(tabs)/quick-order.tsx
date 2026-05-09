import React from 'react';
import { QuickOrderScreen as QuickOrderChatScreen } from '@/features/ordering/QuickOrderScreen';
import { EMPLOYEE_ORDERING_MODE } from '@/features/ordering/modes';

export default function QuickOrderScreen() {
  return <QuickOrderChatScreen mode={EMPLOYEE_ORDERING_MODE} />;
}
