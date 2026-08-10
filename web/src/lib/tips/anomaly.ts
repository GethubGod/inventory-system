// Anomaly rule for tip amounts. CANONICAL implementation — the tip-entries
// edge function carries a mirror in supabase/functions/_shared/tips.ts; keep
// both in sync. The check runs server-side at save; this copy exists so the
// rule is unit-tested and the dashboard can explain flags.
//
// Rule (deliberately simple and transparent): with at least 14 historical
// entries for the same location + meal period, a field (cash or card) is a
// strong outlier when it BOTH exceeds the largest amount ever recorded for
// that slot AND is more than 3x the historical median. Requiring both keeps
// ordinary record-setting nights (a busy holiday slightly above the old max)
// from nagging, while catching typo-scale values ($3,000 vs a $150-$350
// slot). A flag never blocks the save — the UI asks "Save anyway?" and the
// confirmation is recorded on the entry.

export interface AnomalyFieldFlag {
  field: "cash" | "card";
  value: number;
  typicalLow: number;
  typicalHigh: number;
  maxEver: number;
}

export interface AnomalyResult {
  flagged: boolean;
  sampleSize: number;
  fields: AnomalyFieldFlag[];
}

export const ANOMALY_MIN_HISTORY = 14;

function percentile(sortedAsc: number[], fraction: number): number {
  if (sortedAsc.length === 0) return 0;
  const index = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.round(fraction * (sortedAsc.length - 1))),
  );
  return sortedAsc[index];
}

export function checkAnomaly(
  history: Array<{ cash: number; card: number }>,
  cash: number,
  card: number,
): AnomalyResult {
  const result: AnomalyResult = {
    flagged: false,
    sampleSize: history.length,
    fields: [],
  };
  if (history.length < ANOMALY_MIN_HISTORY) return result;

  for (const field of ["cash", "card"] as const) {
    const values = history
      .map((h) => (field === "cash" ? h.cash : h.card))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (values.length < ANOMALY_MIN_HISTORY) continue;
    const value = field === "cash" ? cash : card;
    const maxEver = values[values.length - 1];
    const median = percentile(values, 0.5);
    const beyondMax = value > maxEver;
    const beyondMedian =
      median > 0 ? value > 3 * median : value > Math.max(maxEver, 50);
    if (beyondMax && beyondMedian) {
      result.flagged = true;
      result.fields.push({
        field,
        value,
        typicalLow: Math.round(percentile(values, 0.25)),
        typicalHigh: Math.round(percentile(values, 0.75)),
        maxEver,
      });
    }
  }
  return result;
}

/** "Card tips of $3,000 is far above the usual $150–$350 for Sushi dinner." */
export function anomalyMessage(
  result: AnomalyResult,
  locationName: string,
  meal: "lunch" | "dinner",
): string {
  const money = (n: number) => `$${n.toLocaleString("en-US")}`;
  return result.fields
    .map(
      (f) =>
        `${f.field === "cash" ? "Cash" : "Card"} tips of ${money(f.value)} is far above the usual ${money(f.typicalLow)}–${money(f.typicalHigh)} for ${locationName} ${meal}.`,
    )
    .join(" ");
}
