"use client";

// White pill-track segmented control (Lunch | Dinner). `compact` renders the
// smaller inline variant used inside the voice sheet checklist.

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
  wellTrack = false,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T | null;
  onChange: (next: T) => void;
  compact?: boolean;
  disabled?: boolean;
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
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-full text-center font-semibold ${
              compact ? "py-1.5 text-sm" : "py-2.5"
            } ${selected ? "bg-accent text-white" : "text-ink2"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
