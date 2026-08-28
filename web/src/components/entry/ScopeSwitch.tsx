"use client";

// Whole-day vs dinner-only scope for the amounts card (Tips v3). Dinner only —
// lunch has no switch and always records what was typed. No label above it.

import type { EnteredScope } from "@/lib/tips/dayScope";
import { Segmented } from "./Segmented";

const SCOPE_OPTIONS = [
  { value: "day", label: "Whole day (Square)" },
  { value: "shift", label: "Dinner only" },
] as const;

export function ScopeSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: EnteredScope;
  onChange: (next: EnteredScope) => void;
  disabled?: boolean;
}) {
  return (
    <Segmented
      options={SCOPE_OPTIONS}
      value={value}
      onChange={onChange}
      compact
      wellTrack
      disabled={disabled}
    />
  );
}
