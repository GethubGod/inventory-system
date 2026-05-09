import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { StockCheckScreenView } from '@/features/stock-check';

export default function StockCheckListRoute() {
  const { stationId } = useLocalSearchParams<{ stationId?: string }>();
  return <StockCheckScreenView stationId={stationId} />;
}
