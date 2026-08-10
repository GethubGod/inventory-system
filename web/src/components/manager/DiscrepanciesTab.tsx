"use client";

// Discrepancies tab: confirmed anomaly flags in range + missing
// date/location/meal slots (from each location's first-ever entry onward).

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { fetchAll } from "@/components/manager/fetchAll";
import { businessDateFor, formatBusinessDate } from "@/lib/tips/businessDate";
import { formatMoney } from "@/lib/tips/format";
import type { MealPeriod } from "@/types/database";

interface LocationRow {
  id: string;
  name: string;
}

interface FlaggedEntry {
  id: string;
  business_date: string;
  location_id: string;
  meal_period: MealPeriod;
  cash: number;
  card: number;
  anomaly_reason: string | null;
}

interface MissingSlot {
  date: string;
  locationId: string;
  meal: MealPeriod;
  isToday: boolean;
}

interface RawRangeEntry {
  id: string;
  business_date: string;
  location_id: string;
  meal_period: MealPeriod;
  cash_amount: number | string;
  card_amount: number | string;
  flagged_anomaly: boolean;
  anomaly_reason: string | null;
}

interface DiscrepanciesResult {
  locations?: LocationRow[];
  flagged?: FlaggedEntry[];
  missing?: MissingSlot[];
  error?: string;
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  // Hard cap keeps a bad range from looping forever.
  for (let i = 0; i < 400 && cursor <= end; i++) {
    out.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return out;
}

async function fetchDiscrepancies(
  startDate: string,
  endDate: string,
  locationId: string,
  today: string,
): Promise<DiscrepanciesResult> {
  const supabase = getSupabase();
  try {
    const locationsRes = await supabase
      .from("locations")
      .select("id, name")
      .order("name");
    if (locationsRes.error) throw new Error(locationsRes.error.message);
    const allLocations = locationsRes.data ?? [];

    const activeLocations =
      locationId === "all"
        ? allLocations
        : allLocations.filter((l) => l.id === locationId);

    // Paged past the 1000-row PostgREST cap; the .order("id") tiebreaker
    // keeps page boundaries deterministic.
    const buildEntriesPage = (from: number, to: number) => {
      let entryQuery = supabase
        .from("tip_entries")
        .select(
          "id, business_date, location_id, meal_period, cash_amount, card_amount, flagged_anomaly, anomaly_reason",
        )
        .gte("business_date", startDate)
        .lte("business_date", endDate)
        .order("business_date", { ascending: false })
        .order("id");
      if (locationId !== "all") {
        entryQuery = entryQuery.eq("location_id", locationId);
      }
      return entryQuery.range(from, to);
    };

    const [rangeEntries, firstEntryResults] = await Promise.all([
      fetchAll<RawRangeEntry>(buildEntriesPage),
      Promise.all(
        activeLocations.map((loc) =>
          supabase
            .from("tip_entries")
            .select("business_date")
            .eq("location_id", loc.id)
            .order("business_date", { ascending: true })
            .limit(1),
        ),
      ),
    ]);

    const flagged = rangeEntries
      .filter((e) => e.flagged_anomaly)
      .sort((a, b) => b.business_date.localeCompare(a.business_date))
      .map((e) => ({
        id: e.id,
        business_date: e.business_date,
        location_id: e.location_id,
        meal_period: e.meal_period,
        cash: Number(e.cash_amount),
        card: Number(e.card_amount),
        anomaly_reason: e.anomaly_reason,
      }));

    // First-ever entry date per location; locations without any entries skip
    // missing-slot checks entirely.
    const firstDate = new Map<string, string>();
    activeLocations.forEach((loc, i) => {
      const res = firstEntryResults[i];
      const first = res?.data?.[0]?.business_date;
      if (!res?.error && typeof first === "string") {
        firstDate.set(loc.id, first);
      }
    });

    const present = new Set(
      rangeEntries.map(
        (e) => `${e.business_date}|${e.location_id}|${e.meal_period}`,
      ),
    );
    const effectiveEnd = endDate < today ? endDate : today;
    const missing: MissingSlot[] = [];
    for (const date of datesBetween(startDate, effectiveEnd)) {
      for (const loc of activeLocations) {
        const first = firstDate.get(loc.id);
        if (!first || date < first) continue;
        for (const meal of ["lunch", "dinner"] as const) {
          if (!present.has(`${date}|${loc.id}|${meal}`)) {
            missing.push({
              date,
              locationId: loc.id,
              meal,
              isToday: date === today,
            });
          }
        }
      }
    }
    missing.sort((a, b) => b.date.localeCompare(a.date));

    return { locations: allLocations, flagged, missing };
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Failed to load discrepancies.",
    };
  }
}

export default function DiscrepanciesTab() {
  const today = useMemo(() => businessDateFor(new Date()), []);
  const [startDate, setStartDate] = useState(() => shiftDate(today, -13));
  const [endDate, setEndDate] = useState(today);
  const [locationId, setLocationId] = useState<string>("all");
  const [reload, setReload] = useState(0);

  const key = `${startDate}|${endDate}|${locationId}|${reload}`;
  const [result, setResult] = useState<
    ({ key: string } & DiscrepanciesResult) | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDiscrepancies(startDate, endDate, locationId, today).then(
      (r) => {
        if (!cancelled) setResult({ key, ...r });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, startDate, endDate, locationId, today]);

  const loading = result === null || result.key !== key;
  const error = loading ? null : (result.error ?? null);
  const locations = useMemo(
    () => (loading ? [] : (result?.locations ?? [])),
    [loading, result],
  );
  const flagged = (!loading && result?.flagged) || [];
  const missing = (!loading && result?.missing) || [];

  const locationName = useMemo(() => {
    const map = new Map(locations.map((l) => [l.id, l.name]));
    return (id: string) => map.get(id) ?? "Unknown";
  }, [locations]);

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
            <p className="section-label mb-3">Flagged and confirmed</p>
            {flagged.length === 0 ? (
              <p className="text-ink3 text-sm">
                No flagged entries in this range.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {flagged.map((e) => (
                  <li
                    key={e.id}
                    className="border-b border-hairline last:border-0 pb-3 last:pb-0"
                  >
                    <p className="text-sm text-ink font-semibold">
                      {formatBusinessDate(e.business_date)} ·{" "}
                      {locationName(e.location_id)} ·{" "}
                      <span className="capitalize">{e.meal_period}</span>
                      <span className="font-normal text-ink2 ml-2">
                        cash {formatMoney(e.cash)} · card {formatMoney(e.card)}
                      </span>
                    </p>
                    {e.anomaly_reason ? (
                      <p className="text-sm text-ink2 mt-1">
                        {e.anomaly_reason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-card rounded-card p-4">
            <p className="section-label mb-3">Missing slots</p>
            {missing.length === 0 ? (
              <p className="text-ink3 text-sm">
                No missing slots in this range.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {missing.map((slot) => (
                  <li
                    key={`${slot.date}|${slot.locationId}|${slot.meal}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span
                      className="w-2 h-2 rounded-full bg-tint border border-alert shrink-0"
                      aria-hidden
                    />
                    <span className="text-ink">
                      {formatBusinessDate(slot.date)} ·{" "}
                      {locationName(slot.locationId)} ·{" "}
                      <span className="capitalize">{slot.meal}</span>
                    </span>
                    {slot.isToday ? (
                      <span className="text-ink3">(so far today)</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
