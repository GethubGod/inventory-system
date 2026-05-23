import { sanitizeAssistantReply } from '../features/ordering/quickOrderErrors';
import { getQuickOrderEmptyStateLayout } from '../features/ordering/quickOrderEmptyStateLayout';
import { normalizeQuickOrderParseResponse } from '../features/ordering/quickOrderResponse';

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

describe('Quick Order response normalization helpers', () => {
  it('normalizes camelCase assistantMessage and revert actions', () => {
    const normalized = normalizeQuickOrderParseResponse({
      status: 'ok',
      assistantMessage: 'Updated Salmon to 2 cases.',
      mutationId: 'mutation-1',
      assistantActions: [{ type: 'revert', operation: 'restore_previous_order' }],
    });

    expect(normalized.assistantMessage).toBe('Updated Salmon to 2 cases.');
    expect(normalized.mutationId).toBe('mutation-1');
    expect(normalized.actions).toEqual([{
      id: 'revert:mutation-1',
      type: 'revert',
      label: 'Revert',
      operation: 'restore_previous_order',
      mutationId: 'mutation-1',
      disabled: false,
      status: undefined,
      payload: undefined,
    }]);
  });

  it('formats older one-paragraph tutorial replies into readable example lines', () => {
    const normalized = normalizeQuickOrderParseResponse({
      status: 'ok',
      assistant_message: 'I’m Tuna Intelligence. I help create Quick Order drafts from typed orders. You can say: "Salmon 3 cases", "Remove salmon", "We have 2 cases avocado left", "Show my recent orders", "Use last week’s order", "What should I buy if I have 2 cases salmon left?", or "Undo that". I’ll ask if something is unclear.',
    });

    expect(normalized.assistantMessage).toBe([
      'I’m Tuna Intelligence. I help create Quick Order drafts from typed orders.',
      [
        'You can say:',
        '- "Salmon 3 cases"',
        '- "Remove salmon"',
        '- "We have 2 cases avocado left"',
        '- "Show my recent orders"',
        '- "Use last week’s order"',
        '- "What should I buy if I have 2 cases salmon left?"',
        '- "Undo that"',
      ].join('\n'),
      'I’ll ask if something is unclear.',
    ].join('\n\n'));
  });
});
