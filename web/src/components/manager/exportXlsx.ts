// XLSX / CSV export helpers for the manager Entries tab. Numbers are written
// as numbers; per-person shares are derived via the canonical split math.

import * as XLSX from "xlsx";
import { perPersonShare, totalTips } from "@/lib/tips/split";
import type { EntryMethod, MealPeriod, VoiceVariant } from "@/types/database";

/** A tip entry flattened for display/export (names already resolved). */
export interface ExportEntry {
  id: string;
  business_date: string;
  locationName: string;
  meal_period: MealPeriod;
  cash: number;
  card: number;
  split_count: number;
  peopleNames: string[];
  enteredByName: string | null;
  entry_method: EntryMethod;
  voice_variant: VoiceVariant | null;
  corrections_count: number;
  flagged_anomaly: boolean;
  anomaly_reason: string | null;
}

export function methodLabel(entry: ExportEntry): string {
  let label: string;
  if (entry.entry_method === "typed") {
    label = "Typed";
  } else {
    const variant =
      entry.voice_variant === "live_transcript"
        ? "live transcript"
        : entry.voice_variant === "waveform"
          ? "waveform"
          : "unknown";
    label = `Voice · ${variant}`;
  }
  if (entry.corrections_count > 0) {
    label += ` (${entry.corrections_count} ${
      entry.corrections_count === 1 ? "fix" : "fixes"
    })`;
  }
  return label;
}

type Cell = string | number;

function entriesSheetRows(entries: ExportEntry[]): Cell[][] {
  const header: Cell[] = [
    "Date",
    "Location",
    "Meal",
    "Cash",
    "Card",
    "Total",
    "Split",
    "Per person",
    "People",
    "Entered by",
    "Method",
    "Voice variant",
    "Corrections",
    "Flagged",
  ];
  const rows: Cell[][] = [header];
  for (const e of entries) {
    rows.push([
      e.business_date,
      e.locationName,
      e.meal_period,
      e.cash,
      e.card,
      totalTips(e.cash, e.card),
      e.split_count,
      perPersonShare(e.cash, e.card, e.split_count),
      e.peopleNames.join(", "),
      e.enteredByName ?? "",
      e.entry_method,
      e.voice_variant ?? "",
      e.corrections_count,
      e.flagged_anomaly ? "yes" : "",
    ]);
  }
  return rows;
}

export function buildWorkbook(entries: ExportEntry[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const entriesSheet = XLSX.utils.aoa_to_sheet(entriesSheetRows(entries));
  XLSX.utils.book_append_sheet(wb, entriesSheet, "Entries");

  const perPersonRows: Cell[][] = [
    ["Date", "Location", "Meal", "Person", "Share"],
  ];
  for (const e of entries) {
    const share = perPersonShare(e.cash, e.card, e.split_count);
    for (const person of e.peopleNames) {
      perPersonRows.push([
        e.business_date,
        e.locationName,
        e.meal_period,
        person,
        share,
      ]);
    }
  }
  const perPersonSheet = XLSX.utils.aoa_to_sheet(perPersonRows);
  XLSX.utils.book_append_sheet(wb, perPersonSheet, "Per person");

  return wb;
}

export function exportXlsxFile(
  entries: ExportEntry[],
  start: string,
  end: string,
): void {
  const wb = buildWorkbook(entries);
  XLSX.writeFile(wb, `babytuna-tips_${start}_${end}.xlsx`);
}

export function exportCsvFile(
  entries: ExportEntry[],
  start: string,
  end: string,
): void {
  const sheet = XLSX.utils.aoa_to_sheet(entriesSheetRows(entries));
  const csv = XLSX.utils.sheet_to_csv(sheet);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `babytuna-tips_${start}_${end}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
