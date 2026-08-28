// CSV export of the filtered ledger. Column set, quoting, and the
// cash-only per-person share follow the approved mockup's ledger CSV
// (docs/mockups/tips-dashboard/core/tips-core.js): the year comes from each
// record, the Names field is always quoted with "" escaping, and free-text
// fields are quoted only when they need it.

import { csvDayLabel } from "./dashboardRange";
import { cashShareCents, type LedgerEntry } from "./dashboardDerive";

const HEADER =
  "Business date,Restaurant,Meal,Cash (split pool),Card (logged only)," +
  "People on split,Names,Per-person share,Flagged,Entered by,Entry method";

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
        (cashShareCents(entry.cashCents, entry.splitCount) / 100).toFixed(2),
        entry.flaggedRaw ? "yes" : "no",
        csvField(entry.enteredByName ?? ""),
        entry.entryMethod,
      ].join(","),
    );
  }
  return rows.join("\n");
}
