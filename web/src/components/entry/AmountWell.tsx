"use client";

// Cream inner well with a $ prefix and a sanitized decimal input. Used in the
// entry form amounts grid and (via the same styling) the voice sheet's inline
// cash/card editors.

import type { ReactNode } from "react";
import { InfoButton } from "@/components/InfoButton";

/**
 * Sanitize raw keyboard input to digits + one dot + max two decimals,
 * clamped to 99999.99. Empty string means "not yet entered".
 */
export function sanitizeAmount(raw: string): string {
  let cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    const whole = cleaned.slice(0, firstDot);
    const rest = cleaned.slice(firstDot + 1).replace(/\./g, "");
    cleaned = `${whole}.${rest.slice(0, 2)}`;
  }
  if (cleaned !== "" && cleaned !== ".") {
    const num = Number(cleaned);
    if (Number.isFinite(num) && num > 99999.99) return "99999.99";
  }
  return cleaned;
}

/** True when the string is a complete, legal amount ($0 is legal). */
export function isValidAmount(value: string): boolean {
  if (value === "" || value === ".") return false;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 && num <= 99999.99;
}

export function AmountWell({
  label,
  value,
  onChange,
  autoFocus = false,
  onCommit,
  compact = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  /** Called on blur / Enter with the current (sanitized) value. */
  onCommit?: (value: string) => void;
  /** Smaller type for the three-up Cash·Card·Gratuity grid. */
  compact?: boolean;
  /** Guidance for this amount, kept behind an "i" next to the label. */
  hint?: ReactNode;
}) {
  return (
    <div className={`bg-well rounded-well ${compact ? "p-2.5" : "p-4"}`}>
      <div className="flex items-center gap-1.5">
        <div className="section-label">{label}</div>
        {hint && <InfoButton label={`About ${label.toLowerCase()}`}>{hint}</InfoButton>}
      </div>
      {/* The bottom rule is the only cue that the amount is typeable — it is
          not decoration. Read-only wells (the saved screen) render their own
          markup without it. */}
      <div className="mt-1 flex items-baseline gap-1 border-b-[1.5px] border-disabled pb-1 focus-within:border-accent">
        <span className={`text-ink2 font-bold ${compact ? "text-sm" : "text-2xl"}`}>$</span>
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          autoFocus={autoFocus}
          value={value}
          placeholder="0.00"
          aria-label={`${label} amount`}
          className={`w-full bg-transparent font-bold text-ink caret-accent placeholder:text-ink3 outline-none tabular-nums ${
            compact ? "text-base" : "text-2xl"
          }`}
          onChange={(event) => onChange(sanitizeAmount(event.target.value))}
          onBlur={() => onCommit?.(value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
}
