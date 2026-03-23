import React from 'react';
import { HomeScreenView } from './HomeScreenView';
import { MANAGER_HOME_MODE } from './modes';

export function ManagerHomeScreen() {
  return <HomeScreenView mode={MANAGER_HOME_MODE} />;
}
