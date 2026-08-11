// Phone display helpers for the dashboard suppliers editor.
//
// Storage policy (Phase 2 contract): store the number as the manager typed it
// (trimmed) — the app's Send All flow handles its own normalization. Display
// formatting is purely cosmetic and only applied when the value is clearly a
// US 10-digit number.

/** Prepare a typed phone value for storage: trim only, empty → null. */
export function phoneForStore(input: string): string | null {
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pretty display for stored phone values. US-style numbers (10 digits,
 * optionally with a 1 / +1 prefix) render as "(408) 555-0133"; anything
 * else is shown exactly as stored.
 */
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const compact = value.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return value;

  let bare = compact;
  if (bare.startsWith("+1")) bare = bare.slice(2);
  else if (bare.startsWith("1") && bare.length === 11) bare = bare.slice(1);

  if (/^\d{10}$/.test(bare)) {
    return `(${bare.slice(0, 3)}) ${bare.slice(3, 6)}-${bare.slice(6)}`;
  }
  return value;
}
