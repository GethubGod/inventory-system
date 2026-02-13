import React from 'react';
import { CartScreenView } from '../(tabs)/cart';

export default function ManagerCartScreen() {
  return (
    <CartScreenView
      context="manager"
      quickOrderRoute="/(manager)/quick-order"
      browseRoute="/(manager)"
    />
  );
}
