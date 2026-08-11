import { isOrderFulfillmentEligible } from '../services/fulfillmentEligibility';

describe('isOrderFulfillmentEligible', () => {
  test('includes regular non-Quick Order rows', () => {
    expect(isOrderFulfillmentEligible({ entry_method: 'manual' })).toBe(true);
    expect(isOrderFulfillmentEligible({})).toBe(true);
  });

  test('includes Quick Order rows that do not require manager review', () => {
    expect(
      isOrderFulfillmentEligible({
        entry_method: 'quick_order',
        quick_session_id: 'session-001',
        manager_review_status: 'not_required',
      })
    ).toBe(true);
  });

  test('includes approved Quick Order rows', () => {
    expect(
      isOrderFulfillmentEligible({
        entry_method: 'voice_order',
        quick_session_id: 'session-voice',
        manager_review_status: 'approved',
      })
    ).toBe(true);
  });

  test('excludes Quick Order rows still waiting on review', () => {
    expect(
      isOrderFulfillmentEligible({
        entry_method: 'quick_order',
        quick_session_id: 'session-001',
        manager_review_status: 'pending',
      })
    ).toBe(false);
    expect(
      isOrderFulfillmentEligible({
        entry_method: 'quick_order',
        quick_session_id: 'session-001',
        manager_review_status: null,
      })
    ).toBe(false);
  });

  test('excludes rejected or changes-requested Quick Order rows', () => {
    expect(
      isOrderFulfillmentEligible({
        entry_method: 'quick_order',
        quick_session_id: 'session-001',
        manager_review_status: 'rejected',
      })
    ).toBe(false);
    expect(
      isOrderFulfillmentEligible({
        entry_method: 'quick_order',
        quick_session_id: 'session-001',
        manager_review_status: 'changes_requested',
      })
    ).toBe(false);
  });
});
