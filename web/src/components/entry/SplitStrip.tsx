"use client";

// Live per-person split readout. Derived only — never stored.

import { formatMoney } from "@/lib/tips/format";
import { perPersonShare, totalTips } from "@/lib/tips/split";

export function SplitStrip({
  cash,
  card,
  count,
}: {
  cash: number;
  card: number;
  count: number;
}) {
  if (count < 1) {
    return (
      <div className="bg-card rounded-card px-4 py-3 flex items-baseline gap-2">
        <span className="section-label" style={{ color: "var(--color-ink3)" }}>
          Pick who&apos;s splitting
        </span>
      </div>
    );
  }
  return (
    <div className="bg-card rounded-card px-4 py-3 flex items-baseline gap-2">
      <span className="section-label">Split {count} ways</span>
      <span className="font-bold text-xl text-ink">
        {formatMoney(perPersonShare(cash, card, count))} each
      </span>
      <span className="ml-auto text-ink3 text-sm">
        of {formatMoney(totalTips(cash, card))}
      </span>
    </div>
  );
}
