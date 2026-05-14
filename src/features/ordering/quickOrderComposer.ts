export type ClampComposerHeightInput = {
  minHeight: number;
  maxHeight: number;
};

export function isMessageSubmittable(text: string, isSending: boolean): boolean {
  if (isSending) return false;
  return text.trim().length > 0;
}

export function clampComposerContentHeight(
  raw: number,
  { minHeight, maxHeight }: ClampComposerHeightInput,
): number {
  if (!Number.isFinite(raw)) return minHeight;
  const bounded = Math.min(Math.max(raw, minHeight), maxHeight);
  return Math.round(bounded);
}
