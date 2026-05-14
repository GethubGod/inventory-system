import {
  buildSendSnapDelays,
  calculateQuickOrderBottomPadding,
  shouldAutoStickToBottom,
} from '../features/ordering/quickOrderChatLayout';

describe('calculateQuickOrderBottomPadding', () => {
  it('reserves the bottom offset, shortcut chips, safe area, and breathing room', () => {
    expect(calculateQuickOrderBottomPadding({
      bottomOffset: 94,
      shortcutChipsHeight: 40,
      shortcutChipsVisible: true,
      safeAreaBottom: 34,
      breathingRoom: 28,
      composerHeight: 0,
    })).toBe(196);
  });

  it('drops the shortcut chip reserve when chips are hidden', () => {
    expect(calculateQuickOrderBottomPadding({
      bottomOffset: 94,
      shortcutChipsHeight: 40,
      shortcutChipsVisible: false,
      safeAreaBottom: 34,
      breathingRoom: 28,
      composerHeight: 0,
    })).toBe(156);
  });

  it('adds the composer height to the reserved padding', () => {
    expect(calculateQuickOrderBottomPadding({
      bottomOffset: 94,
      shortcutChipsHeight: 40,
      shortcutChipsVisible: true,
      safeAreaBottom: 34,
      breathingRoom: 28,
      composerHeight: 60,
    })).toBe(256);
  });

  it('treats a non-finite composer height as zero contribution', () => {
    expect(calculateQuickOrderBottomPadding({
      bottomOffset: 94,
      shortcutChipsHeight: 40,
      shortcutChipsVisible: false,
      safeAreaBottom: 34,
      breathingRoom: 28,
      composerHeight: Number.NaN,
    })).toBe(156);
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

describe('buildSendSnapDelays', () => {
  it('builds repeated send/response delays', () => {
    expect(buildSendSnapDelays()).toEqual([0, 80, 180, 320]);
  });
});
