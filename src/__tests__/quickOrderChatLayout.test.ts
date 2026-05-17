import {
  buildSendSnapDelays,
  calculateQuickOrderBottomScrollOffset,
  calculateQuickOrderBottomPadding,
  shouldAutoStickToBottom,
} from '../features/ordering/quickOrderChatLayout';

describe('calculateQuickOrderBottomPadding', () => {
  it('reserves the composer offset and visual gap', () => {
    expect(calculateQuickOrderBottomPadding({
      composerBottomOffset: 94,
      composerHeight: 0,
      gap: 14,
    })).toBe(108);
  });

  it('adds the composer height to the reserved padding without double-counting the safe area', () => {
    expect(calculateQuickOrderBottomPadding({
      composerBottomOffset: 94,
      composerHeight: 60,
      gap: 14,
    })).toBe(168);
  });

  it('treats a non-finite composer height as zero contribution', () => {
    expect(calculateQuickOrderBottomPadding({
      composerBottomOffset: 94,
      composerHeight: Number.NaN,
      gap: 14,
    })).toBe(108);
  });
});

describe('calculateQuickOrderBottomScrollOffset', () => {
  it('returns the exact offset that aligns content bottom with the viewport bottom', () => {
    expect(calculateQuickOrderBottomScrollOffset({
      contentHeight: 1400,
      visibleHeight: 700,
    })).toBe(700);
  });

  it('returns zero when content fits inside the viewport', () => {
    expect(calculateQuickOrderBottomScrollOffset({
      contentHeight: 640,
      visibleHeight: 700,
    })).toBe(0);
  });

  it('returns zero until both dimensions are known', () => {
    expect(calculateQuickOrderBottomScrollOffset({
      contentHeight: 1400,
      visibleHeight: Number.NaN,
    })).toBe(0);
    expect(calculateQuickOrderBottomScrollOffset({
      contentHeight: Number.NaN,
      visibleHeight: 700,
    })).toBe(0);
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
