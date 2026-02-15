/**
 * Lightweight DEV-only performance instrumentation.
 * All functions no-op in production builds.
 */

const IS_DEV = __DEV__;

const marks = new Map<string, number>();

/** Start a named timing mark. */
export function perfMark(label: string): void {
  if (!IS_DEV) return;
  marks.set(label, Date.now());
}

/** End a named timing mark and log duration. Returns ms elapsed or 0. */
export function perfMeasure(label: string): number {
  if (!IS_DEV) return 0;
  const start = marks.get(label);
  if (start === undefined) return 0;
  marks.delete(label);
  const ms = Date.now() - start;
  console.log(`[Perf] ${label}: ${ms}ms`);
  return ms;
}

/** Wrap an async function with automatic timing. */
export function perfWrap<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!IS_DEV) return fn();
  perfMark(label);
  return fn().finally(() => perfMeasure(label));
}

/** Time a synchronous block. */
export function perfSync<T>(label: string, fn: () => T): T {
  if (!IS_DEV) return fn();
  const start = Date.now();
  const result = fn();
  const ms = Date.now() - start;
  console.log(`[Perf] ${label}: ${ms}ms`);
  return result;
}
