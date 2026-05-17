export type QuickOrderBottomPaddingInput = {
  composerBottomOffset: number;
  composerHeight: number;
  gap: number;
};

export type AutoStickInput = {
  active: boolean;
  contentHeight: number;
  visibleHeight: number;
  offsetY: number;
  threshold?: number;
};

export type BottomScrollOffsetInput = {
  contentHeight: number;
  visibleHeight: number;
};

const DEFAULT_NEAR_BOTTOM_THRESHOLD = 140;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function buildSendSnapDelays(): number[] {
  return [0, 80, 180, 320];
}

export function calculateQuickOrderBottomPadding(input: QuickOrderBottomPaddingInput): number {
  return (
    finiteOrZero(input.composerBottomOffset) +
    finiteOrZero(input.composerHeight) +
    finiteOrZero(input.gap)
  );
}

export function calculateQuickOrderBottomScrollOffset({
  contentHeight,
  visibleHeight,
}: BottomScrollOffsetInput): number {
  const safeContentHeight = finiteOrZero(contentHeight);
  const safeVisibleHeight = finiteOrZero(visibleHeight);

  if (safeContentHeight <= 0 || safeVisibleHeight <= 0) return 0;
  return Math.max(0, safeContentHeight - safeVisibleHeight);
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
