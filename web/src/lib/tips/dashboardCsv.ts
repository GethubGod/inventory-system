// CSV export of the filtered ledger. Column set, quoting, and the
// cash-only per-person share follow the approved mockup's ledger CSV
// (docs/mockups/tips-dashboard/core/tips-core.js): the year comes from each
// record, the Names field is always quoted with "" escaping, and free-text
// fields are quoted only when they need it.

import { csvDayLabel } from "./dashboardRange";
import { entryFullShareCents, type LedgerEntry } from "./dashboardDerive";

// Existing columns keep their exact positions so old sheets don't break; the
// Tips v3 columns (gratuity, scope, raw figures, note, weights) append after.
const HEADER =
  "Business date,Restaurant,Meal,Cash (split pool),Card (logged only)," +
  "People on split,Names,Per-person share,Flagged,Entered by,Entry method," +
  "Gratuity,Entered scope,Raw cash,Raw card,Note,Weights";

/** Prefix-guard against spreadsheet formula injection (=, +, -, @, tab, CR). */
function formulaSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvField(value: string): string {
  const safe = formulaSafe(value);
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Always-quoted variant (the Names column follows the mockup's format). */
function csvFieldQuoted(value: string): string {
  return `"${formulaSafe(value).replace(/"/g, '""')}"`;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Build the CSV text. Flagged reflects the stored anomaly flag (a verified
 * row still exports "yes" — the export is a permanent ledger, not the
 * attention list).
 */
export function buildLedgerCsv(
  entries: LedgerEntry[],
  locationLabel: (locationId: string) => string,
): string {
  const rows = [HEADER];
  for (const entry of entries) {
    rows.push(
      [
        csvDayLabel(entry.businessDate),
        csvField(locationLabel(entry.locationId)),
        capitalize(entry.meal),
        (entry.cashCents / 100).toFixed(2),
        (entry.cardCents / 100).toFixed(2),
        String(entry.splitCount),
        csvFieldQuoted(entry.peopleNames.join("; ")),
        // The full (weight-1) share — same figure the ledger's Per person
        // column shows. Identical to the old cash/count on all-full splits.
        (entryFullShareCents(entry) / 100).toFixed(2),
        entry.flaggedRaw ? "yes" : "no",
        csvField(entry.enteredByName ?? ""),
        entry.entryMethod,
        (entry.gratuityCents / 100).toFixed(2),
        entry.enteredScope,
        // Raw (as-typed) figures exist only on rows saved since Tips v3.
        entry.rawCashCents === null ? "" : (entry.rawCashCents / 100).toFixed(2),
        entry.rawCardCents === null ? "" : (entry.rawCardCents / 100).toFixed(2),
        csvField(entry.note ?? ""),
        // Percentages positional with Names, e.g. "100; 100; 75".
        `"${entry.peopleIds
          .map((_, index) =>
            String(Math.round((entry.weights[index] ?? 1) * 100)),
          )
          .join("; ")}"`,
      ].join(","),
    );
  }
  return rows.join("\n");
}
