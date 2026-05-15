import { sanitizeAssistantReply } from '../features/ordering/quickOrderErrors';
import { getQuickOrderEmptyStateLayout } from '../features/ordering/quickOrderEmptyStateLayout';

describe('Quick Order empty-state layout helper', () => {
  it('keeps the disabled confirm action inside the Order List card when empty', () => {
    expect(getQuickOrderEmptyStateLayout(0)).toEqual({
      isEmpty: true,
      showConfirmHintOutsideOrderCard: false,
      showConfirmButtonInsideOrderCard: true,
    });
  });

  it('keeps the confirm button inside the populated Order List card', () => {
    expect(getQuickOrderEmptyStateLayout(2)).toEqual({
      isEmpty: false,
      showConfirmHintOutsideOrderCard: false,
      showConfirmButtonInsideOrderCard: true,
    });
  });
});

describe('Quick Order assistant copy sanitization', () => {
  it('replaces unfinished placeholder responses with employee-safe copy', () => {
    expect(sanitizeAssistantReply('Suggestions are not available in Quick Order yet.')).toBe(
      'I don’t have enough order history to suggest a usual order yet.',
    );
    expect(sanitizeAssistantReply('Past order lookup is not available in Quick Order yet.')).toBe(
      'I couldn’t find a recent order for this location yet.',
    );
  });
});
