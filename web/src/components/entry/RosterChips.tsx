"use client";

// Toggleable name pills for "who's splitting". Selected = filled accent red.

import type { RosterPerson } from "@/lib/tips/api";

export function RosterChips({
  roster,
  selectedIds,
  onToggle,
}: {
  roster: RosterPerson[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const selected = new Set(selectedIds);
  return (
    <div className="flex flex-wrap gap-2">
      {roster.map((person) => {
        const isSelected = selected.has(person.id);
        return (
          <button
            key={person.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(person.id)}
            className={`rounded-full px-4 py-2.5 font-medium ${
              isSelected ? "bg-accent text-white" : "bg-well text-ink2"
            }`}
          >
            {person.name}
          </button>
        );
      })}
    </div>
  );
}
