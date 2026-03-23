import React from 'react';
import { SmartOrderScreen } from '@/features/smart/SmartOrderScreen';
import { EMPLOYEE_ORDERING_MODE } from '@/features/ordering/modes';

export default function VoiceScreen() {
  return <SmartOrderScreen mode={EMPLOYEE_ORDERING_MODE} />;
}
