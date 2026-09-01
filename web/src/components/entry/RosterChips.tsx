"use client";

// Toggleable name pills for "who's splitting". Selected = filled accent red.
// Selected chips carry a % badge (Tips v3 partial shares): tapping the badge
// cycles 100 → 75 → 50 → 25 → 100 without toggling the person; tapping the
// chip body still toggles selection. The badge is its own hit target (≥36px)
// and reads at chip-text size so it is easy to hit with a thumb.

import type { RosterPerson } from "@/lib/tips/api";

export const WEIGHT_CYCLE = [1, 0.75, 0.5, 0.25] as const;

/** The next weight in the 100 → 75 → 50 → 25 cycle (wraps; unknown → 1). */
export function nextWeight(weight: number): number {
  const index = WEIGHT_CYCLE.indexOf(weight as (typeof WEIGHT_CYCLE)[number]);
  return WEIGHT_CYCLE[(index + 1) % WEIGHT_CYCLE.length];
}

export function RosterChips({
  roster,
  selectedIds,
  onToggle,
  weights,
  onCycleWeight,
}: {
  roster: RosterPerson[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** Share weight per person id; missing means a full share. */
  weights?: Record<string, number>;
  /** Cycle a selected person's share badge. Omit to hide the badges. */
  onCycleWeight?: (id: string) => void;
}) {
  const selected = new Set(selectedIds);
  return (
    <div className="flex flex-wrap gap-2">
      {roster.map((person) => {
        const isSelected = selected.has(person.id);
        const weight = weights?.[person.id] ?? 1;
        return (
          <span key={person.id} className="inline-flex">
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(person.id)}
              className={`rounded-full px-4 py-2.5 font-medium ${
                isSelected
                  ? `bg-accent text-white ${onCycleWeight ? "rounded-r-none pr-2" : ""}`
                  : "bg-well text-ink2"
              }`}
            >
              {person.name}
            </button>
            {isSelected && onCycleWeight && (
              <button
                type="button"
                aria-label={`${person.name} share ${Math.round(weight * 100)}%`}
                onClick={() => onCycleWeight(person.id)}
                className="flex min-h-[40px] min-w-[44px] items-center rounded-full rounded-l-none bg-accent pl-1 pr-2.5 text-white"
              >
                <span className="rounded-full bg-white px-2 py-1 text-[13px] font-extrabold leading-none text-alert">
                  {Math.round(weight * 100)}%
                </span>
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
