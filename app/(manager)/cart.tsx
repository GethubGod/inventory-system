import React from 'react';
import { CartScreenView } from '@/features/cart/CartScreenView';
import { MANAGER_ORDERING_MODE } from '@/features/ordering/modes';

export default function ManagerCartScreen() {
  return <CartScreenView mode={MANAGER_ORDERING_MODE} />;
}
