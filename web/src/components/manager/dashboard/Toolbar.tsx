"use client";

// Shared toolbar on every page: time-frame button (This week / Last week /
// This month / This year, ‹ › step weeks), the Both/Sushi/Poki location
// segment, and Export CSV. Sticky under the page top.

import { useEffect, useRef, useState } from "react";
import {
  canStepBack,
  canStepForward,
  rangeLabel,
  rangePresets,
  sameRange,
  stepWeek,
  type DashboardRange,
} from "@/lib/tips/dashboardRange";
import { btn } from "./ui";
import type { LocationInfo, LocFilter } from "./types";

export function Toolbar({
  range,
  onRange,
  loc,
  onLoc,
  locations,
  today,
  onExportCsv,
}: {
  range: DashboardRange;
  onRange: (range: DashboardRange) => void;
  loc: LocFilter;
  onLoc: (loc: LocFilter) => void;
  locations: LocationInfo[];
  today: string;
  onExportCsv: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: MouseEvent) => {
      if (pickerAreaRef.current?.contains(event.target as Node)) return;
      setPickerOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  const arrow =
    "h-7 w-7 rounded-full bg-well font-bold text-ink2 disabled:cursor-default disabled:opacity-30";
  const segButton = (pressed: boolean) =>
    `rounded-full px-3.5 py-[5px] text-[13px] font-semibold ${
      pressed ? "bg-card text-ink" : "text-ink2"
    }`;

  const locSegments: Array<{ value: LocFilter; label: string }> = [
    { value: "both", label: "Both" },
    ...locations
      .filter((location) => location.kind !== null)
      .map((location) => ({ value: location.kind as LocFilter, label: location.label })),
  ];

  return (
    <div className="sticky top-0 z-40 my-3 mb-5 flex flex-wrap items-center gap-3 rounded-card border border-line bg-card px-3.5 py-2.5">
      <div className="relative flex items-center gap-1.5" ref={pickerAreaRef}>
        <button
          type="button"
          aria-label="Previous week"
          className={arrow}
          disabled={!canStepBack(range)}
          onClick={() => onRange(stepWeek(range, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={pickerOpen}
          className="flex items-center gap-2 rounded-full bg-well px-[13px] py-1.5 text-[13.5px] font-bold text-ink"
          onClick={() => setPickerOpen((open) => !open)}
        >
          <span>{rangeLabel(range)}</span>
          <span className="text-[10px] text-ink3">▼</span>
        </button>
        <button
          type="button"
          aria-label="Next week"
          className={arrow}
          disabled={!canStepForward(range, today)}
          onClick={() => onRange(stepWeek(range, 1))}
        >
          ›
        </button>

        {pickerOpen && (
          <div
            role="dialog"
            className="absolute left-0 top-full z-[80] mt-2 w-[300px] rounded-[14px] border border-line bg-card px-3.5 py-3 shadow-[0_6px_24px_rgba(16,20,28,0.16)]"
          >
            <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-ink3">
              Time frame
            </div>
            {rangePresets(today).map((preset) => {
              const pressed = sameRange(preset.range, range);
              return (
                <button
                  key={preset.key}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => {
                    onRange(preset.range);
                    setPickerOpen(false);
                  }}
                  className={`flex w-full items-baseline gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13.5px] font-semibold text-ink hover:bg-well ${
                    pressed ? "bg-well shadow-[inset_3px_0_0_var(--color-accent)]" : ""
                  }`}
                >
                  <span className="flex-none">{preset.pick}</span>
                  <span className="ml-auto text-xs font-medium text-ink3">{preset.dates}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-0.5 rounded-full bg-well p-[3px]">
        {locSegments.map((segment) => (
          <button
            key={segment.value}
            type="button"
            aria-pressed={loc === segment.value}
            className={segButton(loc === segment.value)}
            onClick={() => onLoc(segment.value)}
          >
            {segment.label}
          </button>
        ))}
      </div>

      <span className="ml-auto" />
      <button type="button" className={btn} onClick={onExportCsv}>
        Export CSV
      </button>
    </div>
  );
}
