"use client";

// White pill-track segmented control (Lunch | Dinner). `compact` renders the
// smaller inline variant used inside the voice sheet checklist.
// `disabledValues` grays out individual options (an already-recorded shift
// can't be picked again); `disabledHints` puts the reason behind an "i" on
// that option instead of a line of text under the control.

import type { ReactNode } from "react";
import { InfoButton } from "@/components/InfoButton";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  compact = false,
  disabled = false,
  disabledValues = [],
  disabledHints,
  wellTrack = false,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T | null;
  onChange: (next: T) => void;
  compact?: boolean;
  disabled?: boolean;
  /** Individual options that can't be selected (e.g. recorded shifts). */
  disabledValues?: ReadonlyArray<T>;
  /** Why an option is disabled, shown in a popover from an "i" on the option. */
  disabledHints?: Partial<Record<T, ReactNode>>;
  /** Cream track for use inside white cards (voice sheet inline editor). */
  wellTrack?: boolean;
}) {
  return (
    <div
      role="tablist"
      className={`flex rounded-full p-1 ${wellTrack ? "bg-well" : "bg-card"} ${
        disabled ? "opacity-60" : ""
      }`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        // Locked = this option can't be picked today (a recorded shift). A
        // global `disabled` (a slot fetch in flight) only dims the control.
        const locked = disabledValues.includes(option.value);
        const hint = locked ? disabledHints?.[option.value] : undefined;
        const tab = (
          <button
            key={hint ? undefined : option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled || locked}
            onClick={() => onChange(option.value)}
            className={`${hint ? "" : "flex-1"} rounded-full text-center font-semibold ${
              compact ? "py-1.5 text-sm" : "py-2.5"
            } ${
              selected
                ? "bg-accent text-white"
                : locked
                  ? "text-disabled line-through"
                  : "text-ink2"
            }`}
          >
            {option.label}
          </button>
        );
        if (!hint) return tab;
        // The "i" cannot live inside the tab button, so it sits beside it in
        // the same flex cell; the pair keeps the cell's height and centring.
        return (
          <span key={option.value} className="flex flex-1 items-center justify-center gap-1.5">
            {tab}
            <InfoButton label={`About ${option.label}`}>{hint}</InfoButton>
          </span>
        );
      })}
    </div>
  );
}
