import {
  buildKeyboardHideSnapDelays,
  buildKeyboardShowSnapDelays,
  buildSendSnapDelays,
  calculateComposerInputMaxHeight,
  calculateQuickOrderBottomPadding,
  prepareQuickOrderSendDraft,
  shouldAutoStickToBottom,
} from '../features/ordering/quickOrderChatLayout';

describe('calculateQuickOrderBottomPadding', () => {
  it('reserves composer, closed tab offset, shortcut chips, safe area, and breathing room when keyboard is closed', () => {
    expect(calculateQuickOrderBottomPadding({
      composerHeight: 72,
      keyboardVisible: false,
      keyboardHeight: 0,
      closedComposerOffset: 94,
      shortcutChipsHeight: 40,
      shortcutChipsVisible: true,
      safeAreaBottom: 34,
      keyboardGap: 8,
      breathingRoom: 28,
    })).toBe(268);
  });

  it('reserves the real keyboard height and gap when keyboard is open', () => {
    expect(calculateQuickOrderBottomPadding({
      composerHeight: 88,
      keyboardVisible: true,
      keyboardHeight: 302,
      closedComposerOffset: 94,
      shortcutChipsHeight: 0,
      shortcutChipsVisible: false,
      safeAreaBottom: 34,
      keyboardGap: 8,
      breathingRoom: 28,
    })).toBe(460);
  });
});

describe('calculateComposerInputMaxHeight', () => {
  const base = {
    screenHeight: 844,
    keyboardHeight: 0,
    closedComposerOffset: 108,
    topReservedHeight: 240,
    safeAreaTop: 47,
    safeAreaBottom: 34,
    minHeight: 44,
    breathingRoom: 32,
  };

  it('uses a larger cap when the keyboard is closed', () => {
    expect(calculateComposerInputMaxHeight({
      ...base,
      keyboardVisible: false,
    })).toBe(354);
  });

  it('uses available screen space when the keyboard is open', () => {
    expect(calculateComposerInputMaxHeight({
      ...base,
      keyboardVisible: true,
      keyboardHeight: 336,
    })).toBe(155);
  });
});

describe('shouldAutoStickToBottom', () => {
  it('is true near the bottom', () => {
    expect(shouldAutoStickToBottom({
      active: false,
      contentHeight: 1400,
      visibleHeight: 700,
      offsetY: 590,
      threshold: 140,
    })).toBe(true);
  });

  it('is false when the user is far above the bottom', () => {
    expect(shouldAutoStickToBottom({
      active: false,
      contentHeight: 1400,
      visibleHeight: 700,
      offsetY: 320,
      threshold: 140,
    })).toBe(false);
  });

  it('allows active compose and send events to force a snap', () => {
    expect(shouldAutoStickToBottom({
      active: true,
      contentHeight: 1400,
      visibleHeight: 700,
      offsetY: 0,
      threshold: 140,
    })).toBe(true);
  });
});

describe('snap delay builders', () => {
  it('clamps keyboard show delays', () => {
    expect(buildKeyboardShowSnapDelays(30)).toEqual([0, 80, 0, 110, 250]);
  });

  it('builds keyboard hide delays', () => {
    expect(buildKeyboardHideSnapDelays(220)).toEqual([0, 80, 300, 440]);
  });

  it('builds repeated send/response delays', () => {
    expect(buildSendSnapDelays()).toEqual([0, 80, 180, 320]);
  });
});

describe('prepareQuickOrderSendDraft', () => {
  it('preserves full raw message text while exposing trimmed text for checks', () => {
    const raw = '  salmon 2cs\nhamachi 1 lb  ';
    expect(prepareQuickOrderSendDraft(raw)).toEqual({
      canSend: true,
      text: raw,
      trimmedText: 'salmon 2cs\nhamachi 1 lb',
    });
  });

  it('rejects whitespace-only input', () => {
    expect(prepareQuickOrderSendDraft(' \n\t ')).toEqual({
      canSend: false,
      text: '',
      trimmedText: '',
    });
  });
});
