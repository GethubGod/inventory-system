import { sanitizeAssistantReply } from '../features/ordering/quickOrderErrors';
import { getQuickOrderEmptyStateLayout } from '../features/ordering/quickOrderEmptyStateLayout';
import { QUICK_ORDER_SHORTCUTS } from '../features/ordering/quickOrderShortcuts';

describe('Quick Order shortcut helpers', () => {
  it('defines the four Pressable shortcut intents shown outside the Order List card', () => {
    expect(QUICK_ORDER_SHORTCUTS.map((shortcut) => shortcut.label)).toEqual([
      'Reorder recent',
      'Last week',
      'Usual order',
      'Get suggestions',
    ]);
    expect(QUICK_ORDER_SHORTCUTS.every((shortcut) => shortcut.intent.length > 0 && shortcut.icon.length > 0)).toBe(true);
  });
});

describe('Quick Order empty-state layout helper', () => {
  it('places shortcut chips outside and keeps the disabled confirm action inside the Order List card when empty', () => {
    expect(getQuickOrderEmptyStateLayout(0)).toEqual({
      isEmpty: true,
      showShortcutChipsOutsideOrderCard: true,
      showConfirmHintOutsideOrderCard: false,
      showConfirmButtonInsideOrderCard: true,
    });
  });

  it('keeps the confirm button inside the populated Order List card', () => {
    expect(getQuickOrderEmptyStateLayout(2)).toEqual({
      isEmpty: false,
      showShortcutChipsOutsideOrderCard: false,
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
