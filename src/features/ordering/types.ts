import type { CartScope as StoreCartScope } from '@/store/orderStore';

export type CartScope = StoreCartScope;

export type OrderingMode = {
  scope: CartScope;
  quickOrderRoute: string;
  cartRoute: string;
  browseRoute: string;
  inputAccessoryId: string;
  backBehavior: 'back' | { replace: string };
  searchAction: 'voice' | 'quick_create';
  voiceRoute?: string;
  requireLocationConfirm?: boolean;
  canEditPrice?: boolean;
  canOverrideSupplier?: boolean;
  showManagerBadges?: boolean;
};
