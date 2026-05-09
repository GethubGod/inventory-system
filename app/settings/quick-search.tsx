import React, { useMemo } from 'react';
import { QuickSearchScreenView } from '@/features/ordering/QuickSearchScreenView';
import { EMPLOYEE_ORDERING_MODE, MANAGER_ORDERING_MODE } from '@/features/ordering/modes';
import type { OrderingMode } from '@/features/ordering/types';
import { useSettingsNavigationContext } from '@/hooks/useSettingsBackRoute';

export default function QuickSearchSettingsScreen() {
  const { origin, backTo } = useSettingsNavigationContext('employee');

  const mode = useMemo<OrderingMode>(() => {
    const baseMode = origin === 'manager' ? MANAGER_ORDERING_MODE : EMPLOYEE_ORDERING_MODE;

    return {
      ...baseMode,
      backBehavior: { replace: String(backTo) },
    };
  }, [backTo, origin]);

  return <QuickSearchScreenView mode={mode} />;
}
