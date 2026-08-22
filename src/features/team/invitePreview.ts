// Pure derivation for the invite screen's live preview card. The tab list
// comes from getVisibleEmployeeTabs — the SAME function the employee tab
// layout renders from — so the card can never drift from what the app
// actually shows. Re-derived on every toggle flip.

import {
  getVisibleEmployeeTabs,
  type EffectiveModules,
} from '@/store/moduleStore.helpers';
import type { InviteLocationGroup } from '@/services/invites';

/** Display metadata per employee tab route key (mirrors app/(tabs)/_layout.tsx). */
export const EMPLOYEE_TAB_META: Record<string, { label: string; icon: string }> = {
  index: { label: 'Home', icon: 'home-outline' },
  'simple-order': { label: 'Order', icon: 'list-outline' },
  'quick-order': { label: 'Advanced', icon: 'flash-outline' },
  cart: { label: 'Cart', icon: 'bag-handle-outline' },
  settings: { label: 'Settings', icon: 'person-circle-outline' },
};

export const LOCATION_GROUP_LABELS: Record<InviteLocationGroup, string> = {
  sushi: 'Sushi',
  poki: 'Poki & Pho',
  both: 'Both',
};

export interface InvitePreviewModel {
  /** e.g. "Nate's app" */
  heading: string;
  /** Sentence describing where the app opens. */
  opensOn: string;
  /** Tab labels in real display order. */
  tabLabels: string[];
  /** Extra lines for module surfaces without their own tab. */
  extras: string[];
  /** Red warning when no ordering module is enabled. */
  warning: string | null;
}

export function deriveInvitePreview(
  name: string,
  locationGroup: InviteLocationGroup,
  toggles: Record<string, boolean>,
): InvitePreviewModel {
  const displayName = name.trim() || 'Their';
  const possessive = name.trim() ? `${name.trim()}'s` : 'Their';

  const modules: EffectiveModules = {
    ordering_simple: toggles.ordering_simple === true,
    ordering_advanced: toggles.ordering_advanced === true,
    stock_check: toggles.stock_check === true,
    tips: toggles.tips === true,
    fulfillment: false,
  };

  const tabKeys = getVisibleEmployeeTabs(modules);
  const tabLabels = tabKeys.map((key) => EMPLOYEE_TAB_META[key]?.label ?? key);

  const locationBit =
    locationGroup === 'both'
      ? 'both stores'
      : `the ${LOCATION_GROUP_LABELS[locationGroup]} list`;
  const opensOn = modules.ordering_simple
    ? `Opens on Home with ${locationBit} one tap away on the Order tab.`
    : `Opens on Home, set to ${locationBit === 'both stores' ? 'both stores' : locationBit}.`;

  const extras: string[] = [];
  if (modules.stock_check) extras.push('Stock check opens from inside the app.');
  if (modules.tips) extras.push('Tips is on (its in-app screen ships in a later phase).');

  const warning =
    !modules.ordering_simple && !modules.ordering_advanced
      ? `No ordering is on. ${displayName === 'Their' ? 'They' : displayName} won't be able to send orders.`
      : null;

  return {
    heading: `${possessive} app`,
    opensOn,
    tabLabels,
    extras,
    warning,
  };
}
