"use client";

// "What each person takes" (Tips v3) — renders ONLY when at least one share
// is under 100%. One row per selected person; reduced shares carry an
// "NN% share" caption; dollars are right-aligned and tabular. The dollars
// come from the canonical largest-remainder allocation, so the rows always
// sum to the cash pool exactly.

import { moneyFromCents } from "@/lib/tips/dashboardDerive";

export interface PayoutPerson {
  id: string;
  name: string;
  /** Share weight in (0,1]. */
  weight: number;
  /** Allocated cents from allocatePoolCents, positional with the split. */
  cents: number;
}

export function PayoutList({ people }: { people: PayoutPerson[] }) {
  if (people.length === 0 || people.every((person) => person.weight >= 1)) {
    return null;
  }
  return (
    <div className="bg-card rounded-card px-4 py-3">
      <div className="section-label">What each person takes</div>
      <div className="mt-2.5 grid gap-2">
        {people.map((person) => (
          <div
            key={person.id}
            className="flex items-center gap-2.5 rounded-well bg-well px-3 py-2.5"
          >
            <span className="text-sm font-semibold text-ink">{person.name}</span>
            {person.weight < 1 && (
              <span className="text-[11px] text-ink3">
                {Math.round(person.weight * 100)}% share
              </span>
            )}
            <span className="ml-auto font-extrabold tabular-nums text-ink">
              {moneyFromCents(person.cents)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
