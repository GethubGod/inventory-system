export type QuickOrderBottomPaddingInput = {
  bottomOffset: number;
  shortcutChipsHeight: number;
  shortcutChipsVisible: boolean;
  safeAreaBottom: number;
  breathingRoom: number;
  composerHeight: number;
};

export type AutoStickInput = {
  active: boolean;
  contentHeight: number;
  visibleHeight: number;
  offsetY: number;
  threshold?: number;
};

const DEFAULT_NEAR_BOTTOM_THRESHOLD = 140;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function buildSendSnapDelays(): number[] {
  return [0, 80, 180, 320];
}

export function calculateQuickOrderBottomPadding(input: QuickOrderBottomPaddingInput): number {
  const shortcutReserve = input.shortcutChipsVisible ? finiteOrZero(input.shortcutChipsHeight) : 0;

  return (
    finiteOrZero(input.bottomOffset) +
    finiteOrZero(input.composerHeight) +
    shortcutReserve +
    finiteOrZero(input.safeAreaBottom) +
    finiteOrZero(input.breathingRoom)
  );
}

export function shouldAutoStickToBottom({
  active,
  contentHeight,
  visibleHeight,
  offsetY,
  threshold = DEFAULT_NEAR_BOTTOM_THRESHOLD,
}: AutoStickInput): boolean {
  if (active) return true;

  const safeContentHeight = finiteOrZero(contentHeight);
  const safeVisibleHeight = finiteOrZero(visibleHeight);
  const safeOffsetY = finiteOrZero(offsetY);

  if (safeContentHeight <= safeVisibleHeight) return true;

  const distanceFromBottom = safeContentHeight - safeVisibleHeight - safeOffsetY;
  return distanceFromBottom <= finiteOrZero(threshold);
}
