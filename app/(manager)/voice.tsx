import React from 'react';
import { Redirect } from 'expo-router';
import { SmartOrderScreen } from '@/features/smart/SmartOrderScreen';
import { MANAGER_ORDERING_MODE } from '@/features/ordering/modes';

const SMART_ORDER_ENABLED = false;

export default function ManagerVoiceScreen() {
  if (!SMART_ORDER_ENABLED) {
    return <Redirect href="/(manager)" />;
  }

  return <SmartOrderScreen mode={MANAGER_ORDERING_MODE} />;
}
