export type QuickOrderBottomPaddingInput = {
  composerHeight: number;
  keyboardVisible: boolean;
  keyboardHeight: number;
  closedComposerOffset: number;
  shortcutChipsHeight: number;
  shortcutChipsVisible: boolean;
  safeAreaBottom: number;
  keyboardGap: number;
  breathingRoom: number;
};

export type ComposerInputMaxHeightInput = {
  screenHeight: number;
  keyboardVisible: boolean;
  keyboardHeight: number;
  closedComposerOffset: number;
  topReservedHeight: number;
  safeAreaTop: number;
  safeAreaBottom: number;
  minHeight: number;
  breathingRoom: number;
};

export type AutoStickInput = {
  active: boolean;
  contentHeight: number;
  visibleHeight: number;
  offsetY: number;
  threshold?: number;
};

export type QuickOrderSendDraft =
  | { canSend: true; text: string; trimmedText: string }
  | { canSend: false; text: ''; trimmedText: '' };

const DEFAULT_NEAR_BOTTOM_THRESHOLD = 140;
const COMPOSER_HEIGHT_SCREEN_RATIO = 0.42;
const KEYBOARD_COMPOSER_HEIGHT_SCREEN_RATIO = 0.34;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function clampSnapDelays(delays: number[]): number[] {
  return delays.map((delay) => finiteOrZero(delay));
}

export function buildKeyboardShowSnapDelays(duration: number): number[] {
  const safeDuration = finiteOrZero(duration);
  return clampSnapDelays([0, 80, safeDuration - 40, safeDuration + 80, safeDuration + 220]);
}

export function buildKeyboardHideSnapDelays(duration: number): number[] {
  const safeDuration = finiteOrZero(duration);
  return clampSnapDelays([0, 80, safeDuration + 80, safeDuration + 220]);
}

export function buildSendSnapDelays(): number[] {
  return [0, 80, 180, 320];
}

export function calculateQuickOrderBottomPadding(input: QuickOrderBottomPaddingInput): number {
  const keyboardGap = input.keyboardVisible ? finiteOrZero(input.keyboardGap) : 0;
  const activeBottomOffset = input.keyboardVisible
    ? finiteOrZero(input.keyboardHeight) + keyboardGap
    : finiteOrZero(input.closedComposerOffset);
  const shortcutReserve = input.shortcutChipsVisible ? finiteOrZero(input.shortcutChipsHeight) : 0;

  return (
    finiteOrZero(input.composerHeight) +
    activeBottomOffset +
    shortcutReserve +
    finiteOrZero(input.safeAreaBottom) +
    finiteOrZero(input.breathingRoom)
  );
}

export function calculateComposerInputMaxHeight(input: ComposerInputMaxHeightInput): number {
  const screenHeight = Math.max(1, finiteOrZero(input.screenHeight));
  const lowerChrome = input.keyboardVisible
    ? finiteOrZero(input.keyboardHeight)
    : finiteOrZero(input.closedComposerOffset);
  const availableHeight =
    screenHeight -
    lowerChrome -
    finiteOrZero(input.topReservedHeight) -
    finiteOrZero(input.safeAreaTop) -
    finiteOrZero(input.safeAreaBottom) -
    finiteOrZero(input.breathingRoom);
  const ratioCap =
    screenHeight *
    (input.keyboardVisible ? KEYBOARD_COMPOSER_HEIGHT_SCREEN_RATIO : COMPOSER_HEIGHT_SCREEN_RATIO);
  const maxHeight = Math.min(availableHeight, ratioCap);

  return Math.max(finiteOrZero(input.minHeight), Math.floor(maxHeight));
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

export function prepareQuickOrderSendDraft(value: string): QuickOrderSendDraft {
  const text = value;
  const trimmedText = text.trim();

  if (!trimmedText) {
    return { canSend: false, text: '', trimmedText: '' };
  }

  return { canSend: true, text, trimmedText };
}
