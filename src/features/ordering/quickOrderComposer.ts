export type ClampComposerHeightInput = {
  minHeight: number;
  maxHeight: number;
};

export type ComposerMode = 'order' | 'inventory';

export function getComposerPlaceholder(mode: ComposerMode): string {
  return mode === 'inventory' ? 'Enter remaining inventory...' : 'Add to order...';
}

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
