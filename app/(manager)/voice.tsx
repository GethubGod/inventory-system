import React from 'react';
import { SmartOrderScreen } from '@/features/smart/SmartOrderScreen';
import { MANAGER_ORDERING_MODE } from '@/features/ordering/modes';

export default function ManagerVoiceScreen() {
  return (
    <SmartOrderScreen
      mode={MANAGER_ORDERING_MODE}
      identity="Manager"
    />
  );
}
