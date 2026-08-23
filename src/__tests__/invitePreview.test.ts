// Live invite preview card derivation — a pure function of the form state,
// driven by the same getVisibleEmployeeTabs logic the employee layout uses.

import { deriveInvitePreview, EMPLOYEE_TAB_META } from '@/features/team/invitePreview';
import { getVisibleEmployeeTabs } from '@/store/moduleStore.helpers';

const ALL_ON = {
  ordering_simple: true,
  ordering_advanced: true,
  stock_check: true,
  tips: true,
};

describe('deriveInvitePreview', () => {
  it('lists the tabs in the same order as the real employee layout', () => {
    const model = deriveInvitePreview('Nate', 'sushi', ALL_ON);
    const expectedKeys = getVisibleEmployeeTabs({ ...ALL_ON, fulfillment: false });
    expect(model.tabLabels).toEqual(expectedKeys.map((key) => EMPLOYEE_TAB_META[key].label));
    expect(model.tabLabels).toContain('Order');
    expect(model.tabLabels).toContain('Advanced');
  });

  it('drops the Order tab from the card when ordering_simple is off', () => {
    const model = deriveInvitePreview('Nate', 'sushi', {
      ...ALL_ON,
      ordering_simple: false,
      ordering_advanced: false,
    });
    expect(model.tabLabels).not.toContain('Order');
    expect(model.tabLabels).not.toContain('Advanced');
  });

  it('warns when no ordering module is enabled', () => {
    const model = deriveInvitePreview('Nate', 'sushi', {
      ordering_simple: false,
      ordering_advanced: false,
      stock_check: true,
      tips: false,
    });
    expect(model.warning).toContain('Nate');
    expect(model.warning).toContain("won't be able to send orders");
  });

  it('clears the warning as soon as either ordering module turns on', () => {
    expect(
      deriveInvitePreview('Nate', 'sushi', { ...ALL_ON, ordering_advanced: false }).warning,
    ).toBeNull();
    expect(
      deriveInvitePreview('Nate', 'sushi', { ...ALL_ON, ordering_simple: false }).warning,
    ).toBeNull();
  });

  it('mentions the works-at list and stock check surface', () => {
    const sushi = deriveInvitePreview('Nate', 'sushi', ALL_ON);
    expect(sushi.opensOn).toContain('Sushi');
    expect(sushi.extras.join(' ')).toContain('Stock check');

    const poki = deriveInvitePreview('Nate', 'poki', ALL_ON);
    expect(poki.opensOn).toContain('Poki & Pho');

    const both = deriveInvitePreview('Nate', 'both', ALL_ON);
    expect(both.opensOn).toContain('both stores');
  });

  it('handles an empty name gracefully', () => {
    const model = deriveInvitePreview('', 'both', {
      ordering_simple: false,
      ordering_advanced: false,
      stock_check: false,
      tips: false,
    });
    expect(model.heading).toBe('Their app');
    expect(model.warning).toContain("They won't be able to send orders");
  });
});
