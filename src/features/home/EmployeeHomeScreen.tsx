import React from 'react';
import { HomeScreenView } from './HomeScreenView';
import { EMPLOYEE_HOME_MODE } from './modes';

export function EmployeeHomeScreen() {
  return <HomeScreenView mode={EMPLOYEE_HOME_MODE} />;
}
