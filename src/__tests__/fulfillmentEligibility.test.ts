import { isOrderFulfillmentEligible } from '../services/fulfillmentEligibility';

describe('isOrderFulfillmentEligible', () => {
  test('includes regular non-Quick Order rows', () => {
    expect(isOrderFulfillmentEligible({ entry_method: 'manual' })).toBe(true);
    expect(isOrderFulfillmentEligible({})).toBe(true);
  });

  test('includes approved or review-free Quick Order rows', () => {
    expect(isOrderFulfillmentEligible({
      entry_method: 'quick_order',
      quick_session_id: 'session-001',
      manager_review_status: 'not_required',
    })).toBe(true);
    expect(isOrderFulfillmentEligible({
      entry_method: 'voice_order',
      manager_review_status: 'approved',
    })).toBe(true);
  });

  test('excludes Quick Order rows that are not fulfillment-ready', () => {
    for (const manager_review_status of [null, 'pending', 'rejected', 'changes_requested']) {
      expect(isOrderFulfillmentEligible({
        entry_method: 'quick_order',
        quick_session_id: 'session-001',
        manager_review_status,
      })).toBe(false);
    }
  });
});
