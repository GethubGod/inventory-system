"use client";

// Live per-person split readout. Derived only — never stored.
//
// Tips v3: the strip reads on the CASH pool only (card rides payroll and
// weights never touch it). "Split N ways · $X each" when every share is
// full; "Full share · $X" when any share is reduced. The right side is
// always "of $Y cash".

import { moneyFromCents } from "@/lib/tips/dashboardDerive";
import { fullShareCents } from "@/lib/tips/split";

export function SplitStrip({
  poolCents,
  weights,
}: {
  /** The cash pool being split, in cents (already net of lunch on day scope). */
  poolCents: number;
  /** Share weights of the selected people, positional. */
  weights: number[];
}) {
  if (weights.length < 1) {
    return (
      <div className="bg-card rounded-card px-4 py-3 flex items-baseline gap-2">
        <span className="section-label" style={{ color: "var(--color-ink3)" }}>
          Pick who&apos;s splitting
        </span>
      </div>
    );
  }
  const uneven = weights.some((weight) => weight < 1);
  return (
    <div className="bg-card rounded-card px-4 py-3 flex items-baseline gap-2">
      <span className="section-label">
        {uneven ? "Full share" : `Split ${weights.length} ways`}
      </span>
      <span className="font-bold text-xl text-ink tabular-nums">
        {moneyFromCents(fullShareCents(poolCents, weights))}
        {uneven ? "" : " each"}
      </span>
      <span className="ml-auto text-ink3 text-sm">
        of {moneyFromCents(Math.max(0, poolCents))} cash
      </span>
    </div>
  );
}
