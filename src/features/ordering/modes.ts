import type { OrderingMode } from './types';

export const EMPLOYEE_ORDERING_MODE: OrderingMode = {
  scope: 'employee',
  quickOrderRoute: '/quick-order',
  cartRoute: '/cart',
  browseRoute: '/(tabs)',
  inputAccessoryId: 'quickOrderInput',
  backBehavior: 'back',
  searchAction: 'voice',
  voiceRoute: '/(tabs)/voice',
  requireLocationConfirm: true,
  pastOrdersRoute: '/orders/history',
};

export const MANAGER_ORDERING_MODE: OrderingMode = {
  scope: 'manager',
  quickOrderRoute: '/(manager)/quick-order',
  cartRoute: '/(manager)/cart',
  browseRoute: '/(manager)/browse',
  inputAccessoryId: 'managerQuickOrderInput',
  backBehavior: { replace: '/(manager)' },
  searchAction: 'quick_create',
  voiceRoute: '/(manager)/voice',
  requireLocationConfirm: true,
  showManagerBadges: true,
};
