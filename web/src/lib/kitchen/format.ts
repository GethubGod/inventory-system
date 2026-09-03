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

/**
 * Whole seconds left in an undo window, clamped to [0, window]. The clock
 * that drives the display ticks once a second, so right after a tap `now`
 * can lag the window start; the cap keeps the label from reading 7s.
 */
export function undoSecondsLeft(
  undoUntil: number,
  now: number,
  windowMs: number = UNDO_WINDOW_MS,
): number {
  const seconds = Math.ceil((undoUntil - now) / 1000);
  return Math.min(Math.ceil(windowMs / 1000), Math.max(0, seconds));
}

/** "2 fried shrimp" for buttons and toasts. */
export function describeRequest(quantity: number, itemName: string): string {
  return `${quantity} ${itemName.toLowerCase()}`;
}

/** "@minh" style tag for the log; the tag is stored without the @. */
export function formatTag(tag: string): string {
  return tag.startsWith("@") ? tag : `@${tag}`;
}
