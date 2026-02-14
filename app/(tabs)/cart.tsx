import React from 'react';
import { CartScreenView } from '@/features/cart/CartScreenView';
import { EMPLOYEE_ORDERING_MODE } from '@/features/ordering/modes';

export default function CartScreen() {
  return <CartScreenView mode={EMPLOYEE_ORDERING_MODE} />;
}
