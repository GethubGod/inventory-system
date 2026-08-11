"use client";

// White pill-track segmented control (Lunch | Dinner). `compact` renders the
// smaller inline variant used inside the voice sheet checklist.
// `disabledValues` grays out individual options (an already-recorded shift
// can't be picked again).

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
  wellTrack = false,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T | null;
  onChange: (next: T) => void;
  compact?: boolean;
  disabled?: boolean;
  /** Individual options that can't be selected (e.g. recorded shifts). */
  disabledValues?: ReadonlyArray<T>;
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
        const optionDisabled = disabled || disabledValues.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={optionDisabled}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-full text-center font-semibold ${
              compact ? "py-1.5 text-sm" : "py-2.5"
            } ${
              selected
                ? "bg-accent text-white"
                : optionDisabled
                  ? "text-disabled line-through"
                  : "text-ink2"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
