// Display helpers for the kitchen screens. Pure; unit tested.

/** A queued request older than this is shown in the alert colour. */
export const OLD_REQUEST_MS = 180_000;

/** How long the kitchen display keeps a just-marked row with an Undo. */
export const UNDO_WINDOW_MS = 6_000;

/** "m:ss" age, never negative (clock skew between devices clamps to 0:00). */
export function formatAge(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function isOldRequest(elapsedMs: number): boolean {
  return elapsedMs > OLD_REQUEST_MS;
}

/** Whole seconds left in an undo window, floored at 0. */
export function undoSecondsLeft(undoUntil: number, now: number): number {
  return Math.max(0, Math.ceil((undoUntil - now) / 1000));
}

/** "2 fried shrimp" for buttons and toasts. */
export function describeRequest(quantity: number, itemName: string): string {
  return `${quantity} ${itemName.toLowerCase()}`;
}

/** "@minh" style tag for the log; the tag is stored without the @. */
export function formatTag(tag: string): string {
  return tag.startsWith("@") ? tag : `@${tag}`;
}
