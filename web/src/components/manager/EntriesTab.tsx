"use client";

// Entries tab: date-range/location filters, grouped-by-date table with daily
// and range totals, XLSX/CSV export.

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { businessDateFor, formatBusinessDate } from "@/lib/tips/businessDate";
import { formatMoney } from "@/lib/tips/format";
import { perPersonShare, totalTips } from "@/lib/tips/split";
import type { EntryMethod, MealPeriod, VoiceVariant } from "@/types/database";
import {
  exportCsvFile,
  exportXlsxFile,
  methodLabel,
  type ExportEntry,
} from "@/components/manager/exportXlsx";
import { fetchAll } from "@/components/manager/fetchAll";

interface LocationRow {
  id: string;
  name: string;
}

/** Raw shape of the tip_entries select with joins (cast — hand-written
 *  Database types carry no relationship metadata for join inference). */
interface RawEntryRow {
  id: string;
  business_date: string;
  location_id: string;
  meal_period: MealPeriod;
  cash_amount: number | string;
  card_amount: number | string;
  split_count: number;
  entry_method: EntryMethod;
  voice_variant: VoiceVariant | null;
  corrections_count: number;
  entered_by: string | null;
  flagged_anomaly: boolean;
  anomaly_reason: string | null;
  created_at: string;
  locations: { name: string } | null;
  tip_entry_people: Array<{ tip_employees: { name: string } | null }>;
}

interface EntriesResult {
  entries?: ExportEntry[];
  error?: string;
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

async function fetchEntries(
  startDate: string,
  endDate: string,
  locationId: string,
): Promise<EntriesResult> {
  const supabase = getSupabase();
  try {
    // Paged past the 1000-row PostgREST cap; the trailing .order("id")
    // tiebreaker keeps page boundaries deterministic.
    const buildEntriesPage = (from: number, to: number) => {
      let query = supabase
        .from("tip_entries")
        .select(
          "id, business_date, location_id, meal_period, cash_amount, card_amount, split_count, entry_method, voice_variant, corrections_count, entered_by, flagged_anomaly, anomaly_reason, created_at, locations(name), tip_entry_people(tip_employees(name))",
        )
        .gte("business_date", startDate)
        .lte("business_date", endDate)
        .order("business_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id");
      if (locationId !== "all") {
        query = query.eq("location_id", locationId);
      }
      return query.range(from, to);
    };
    const [raw, employeeRows] = await Promise.all([
      fetchAll<RawEntryRow>(buildEntriesPage),
      fetchAll<{ id: string; name: string }>((from, to) =>
        supabase
          .from("tip_employees")
          .select("id, name")
          .order("id")
          .range(from, to),
      ),
    ]);

    const employeeName = new Map<string, string>(
      employeeRows.map((e) => [e.id, e.name]),
    );
    const entries: ExportEntry[] = raw.map((row) => ({
      id: row.id,
      business_date: row.business_date,
      locationName: row.locations?.name ?? "Unknown",
      meal_period: row.meal_period,
      cash: Number(row.cash_amount),
      card: Number(row.card_amount),
      split_count: row.split_count,
      peopleNames: row.tip_entry_people
        .map((p) => p.tip_employees?.name)
        .filter((n): n is string => typeof n === "string"),
      enteredByName: row.entered_by
        ? (employeeName.get(row.entered_by) ?? null)
        : null,
      entry_method: row.entry_method,
      voice_variant: row.voice_variant,
      corrections_count: row.corrections_count,
      flagged_anomaly: row.flagged_anomaly,
      anomaly_reason: row.anomaly_reason,
    }));
    return { entries };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to load entries.",
    };
  }
}

export default function EntriesTab() {
  const today = useMemo(() => businessDateFor(new Date()), []);
  const [startDate, setStartDate] = useState(() => shiftDate(today, -13));
  const [endDate, setEndDate] = useState(today);
  const [locationId, setLocationId] = useState<string>("all");
  const [reload, setReload] = useState(0);

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const key = `${startDate}|${endDate}|${locationId}|${reload}`;
  const [result, setResult] = useState<({ key: string } & EntriesResult) | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .from("locations")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        if (!cancelled && data) setLocations(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchEntries(startDate, endDate, locationId).then((r) => {
      if (!cancelled) setResult({ key, ...r });
    });
    return () => {
      cancelled = true;
    };
  }, [key, startDate, endDate, locationId]);

  const loading = result === null || result.key !== key;
  const error = loading ? null : (result.error ?? null);
  const entries = useMemo(
    () => (loading ? [] : (result.entries ?? [])),
    [loading, result],
  );

  const byDate = useMemo(() => {
    const groups = new Map<string, ExportEntry[]>();
    for (const entry of entries) {
      const list = groups.get(entry.business_date);
      if (list) list.push(entry);
      else groups.set(entry.business_date, [entry]);
    }
    return Array.from(groups.entries());
  }, [entries]);

  const totals = useMemo(() => {
    let cash = 0;
    let card = 0;
    for (const e of entries) {
      cash += e.cash;
      card += e.card;
    }
    return { cash, card, grand: totalTips(cash, card), count: entries.length };
  }, [entries]);

  const filterInput =
    "bg-well rounded-well px-3 py-2 text-sm text-ink outline-none";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card rounded-card p-4">
        <p className="section-label mb-2">Filters</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={filterInput}
            aria-label="Start date"
          />
          <span className="text-ink3 text-sm">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={filterInput}
            aria-label="End date"
          />
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={filterInput}
            aria-label="Location"
          >
            <option value="all">All locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => exportXlsxFile(entries, startDate, endDate)}
              disabled={entries.length === 0}
              className="bg-card border border-hairline rounded-full px-4 py-2 text-sm font-semibold text-ink2 disabled:text-disabled"
            >
              Export XLSX
            </button>
            <button
              type="button"
              onClick={() => exportCsvFile(entries, startDate, endDate)}
              disabled={entries.length === 0}
              className="bg-card border border-hairline rounded-full px-4 py-2 text-sm font-semibold text-ink2 disabled:text-disabled"
            >
              CSV
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-ink3 text-sm">Loading…</p>
      ) : error ? (
        <div className="flex items-center gap-3">
          <p className="text-alert text-sm">{error}</p>
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="bg-card rounded-full px-4 py-2 text-sm font-semibold text-ink2"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-card p-4">
            <p className="section-label mb-2">Range totals</p>
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <p className="text-ink3 text-xs">Cash</p>
                <p className="text-ink font-semibold">
                  {formatMoney(totals.cash)}
                </p>
              </div>
              <div>
                <p className="text-ink3 text-xs">Card</p>
                <p className="text-ink font-semibold">
                  {formatMoney(totals.card)}
                </p>
              </div>
              <div>
                <p className="text-ink3 text-xs">Total</p>
                <p className="text-ink font-bold">
                  {formatMoney(totals.grand)}
                </p>
              </div>
              <div>
                <p className="text-ink3 text-xs">Entries</p>
                <p className="text-ink font-semibold">{totals.count}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-card p-4">
            {entries.length === 0 ? (
              <p className="text-ink3 text-sm">No entries in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-left">
                      {[
                        "Date",
                        "Location",
                        "Meal",
                        "Cash",
                        "Card",
                        "Total",
                        "People",
                        "Per-person",
                        "Method",
                        "Flag",
                      ].map((h) => (
                        <th
                          key={h}
                          className="section-label font-semibold py-2 pr-4"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {byDate.map(([date, dayEntries]) => {
                      let dayCash = 0;
                      let dayCard = 0;
                      for (const e of dayEntries) {
                        dayCash += e.cash;
                        dayCard += e.card;
                      }
                      return [
                        <tr key={`h-${date}`} className="bg-well">
                          <td
                            colSpan={10}
                            className="py-2 px-2 rounded-well font-semibold text-ink"
                          >
                            {formatBusinessDate(date)}
                            <span className="text-ink2 font-normal ml-3">
                              cash {formatMoney(dayCash)} · card{" "}
                              {formatMoney(dayCard)} · total{" "}
                              {formatMoney(totalTips(dayCash, dayCard))}
                            </span>
                          </td>
                        </tr>,
                        ...dayEntries.map((e) => (
                          <tr
                            key={e.id}
                            className="border-b border-hairline last:border-0"
                          >
                            <td className="py-2 pr-4 px-2 text-ink2">
                              {formatBusinessDate(e.business_date)}
                            </td>
                            <td className="py-2 pr-4 text-ink">
                              {e.locationName}
                            </td>
                            <td className="py-2 pr-4 text-ink capitalize">
                              {e.meal_period}
                            </td>
                            <td className="py-2 pr-4 text-ink">
                              {formatMoney(e.cash)}
                            </td>
                            <td className="py-2 pr-4 text-ink">
                              {formatMoney(e.card)}
                            </td>
                            <td className="py-2 pr-4 font-semibold text-ink">
                              {formatMoney(totalTips(e.cash, e.card))}
                            </td>
                            <td className="py-2 pr-4 text-ink2">
                              {e.peopleNames.join(", ")}
                            </td>
                            <td className="py-2 pr-4 text-ink">
                              {formatMoney(
                                perPersonShare(e.cash, e.card, e.split_count),
                              )}
                            </td>
                            <td className="py-2 pr-4 text-ink2">
                              {methodLabel(e)}
                            </td>
                            <td className="py-2">
                              {e.flagged_anomaly ? (
                                <span className="bg-tint text-alert rounded-full px-2 py-0.5 text-xs font-semibold">
                                  flagged
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        )),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
