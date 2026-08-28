"use client";

// One fetch for everything the dashboard shows in a given time frame.
// Location filtering happens client-side (two locations, a handful of rows
// per day) so the Both/Sushi/Poki segment is instant. Same staleness guard
// as v1: results carry the key they were fetched for.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { businessDateFor } from "@/lib/tips/businessDate";
import { addDays, rangeBounds, type DashboardRange } from "@/lib/tips/dashboardRange";
import type { LedgerEntry } from "@/lib/tips/dashboardDerive";
import { fetchAll } from "../fetchAll";
import {
  toLocationInfo,
  type DashboardData,
  type DeviceSessionRow,
  type EmployeeRow,
  type ScheduleRowDb,
} from "./types";
import type { EntryMethod, MealPeriod } from "@/types/database";

interface RawEntryRow {
  id: string;
  business_date: string;
  location_id: string;
  meal_period: string;
  cash_amount: number | string; // Postgres numeric can arrive as a string
  card_amount: number | string;
  split_count: number;
  entry_method: string;
  entered_by: string | null;
  flagged_anomaly: boolean;
  anomaly_reason: string | null;
  flag_verified_at: string | null;
  created_at: string;
  tip_entry_people: Array<{ tip_employee_id: string }>;
}

interface RawSessionRow {
  id: string;
  location_id: string;
  closer_id: string | null;
  created_at: string;
}

export interface DashboardDataState {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDashboardData(range: DashboardRange): DashboardDataState {
  const [result, setResult] = useState<{
    key: string;
    rangeKey: string;
    data: DashboardData;
  } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);

  const { start, end } = rangeBounds(range);
  const rangeKey = `${start}|${end}`;
  const key = `${rangeKey}|${reload}`;

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();

    async function load(): Promise<DashboardData> {
      // Sessions: overfetch by UTC timestamp, then keep the ones whose scan
      // falls on a business date inside the range (4am LA rollover), so the
      // count follows the same calendar as every other number.
      const sessionsFloor = `${start}T00:00:00Z`;
      const sessionsCeil = `${addDays(end, 2)}T00:00:00Z`;

      const [locationRows, employeeRows, scheduleRows, accessRows, entryRows, sessionRows] =
        await Promise.all([
          // PostgREST applies this embedded order + limit per location, so
          // one locations request also gets each missing-shift floor.
          supabase
            .from("locations")
            .select("id, name, tip_entries(business_date)")
            .order("name")
            .order("business_date", { ascending: true, referencedTable: "tip_entries" })
            .limit(1, { referencedTable: "tip_entries" })
            .then((r) => {
              if (r.error) throw new Error(r.error.message);
              return r.data ?? [];
            }),
          supabase
            .from("tip_employees")
            .select("id, name, location_id, active, sort_order")
            .order("active", { ascending: false })
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true })
            .then((r) => {
              if (r.error) throw new Error(r.error.message);
              return r.data ?? [];
            }),
          supabase
            .from("tip_employee_schedules")
            .select("id, tip_employee_id, location_id, weekday, meal, created_at")
            .order("id")
            .then((r) => {
              if (r.error) throw new Error(r.error.message);
              return r.data ?? [];
            }),
          supabase
            .from("tip_location_access")
            .select("location_id, token_rotated_at, entry_token_plain")
            .then((r) => {
              if (r.error) throw new Error(r.error.message);
              return r.data ?? [];
            }),
          fetchAll<RawEntryRow>((from, to) =>
            supabase
              .from("tip_entries")
              .select(
                "id, business_date, location_id, meal_period, cash_amount, card_amount, split_count, entry_method, entered_by, flagged_anomaly, anomaly_reason, flag_verified_at, created_at, tip_entry_people(tip_employee_id)",
              )
              .gte("business_date", start)
              .lte("business_date", end)
              .order("business_date", { ascending: false })
              .order("created_at", { ascending: false })
              .order("id")
              .range(from, to),
          ),
          fetchAll<RawSessionRow>((from, to) =>
            supabase
              .from("tip_entry_sessions")
              .select("id, location_id, closer_id, created_at")
              .gte("created_at", sessionsFloor)
              .lt("created_at", sessionsCeil)
              .order("created_at", { ascending: false })
              .order("id")
              .range(from, to),
          ),
        ]);

      const employees: EmployeeRow[] = employeeRows.map((row) => ({
        id: row.id,
        name: row.name,
        locationId: row.location_id,
        active: row.active,
        sortOrder: row.sort_order,
      }));

      // Roster-order names on splits: sort_order then name, active or not.
      const rosterRank = new Map(
        [...employees]
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((employee, index) => [employee.id, index]),
      );
      const nameById = new Map(employees.map((employee) => [employee.id, employee.name]));

      const entries: LedgerEntry[] = entryRows.map((row) => {
        const peopleIds = (row.tip_entry_people ?? [])
          .map((person) => person.tip_employee_id)
          .sort((a, b) => (rosterRank.get(a) ?? 999) - (rosterRank.get(b) ?? 999));
        return {
          id: row.id,
          businessDate: row.business_date,
          locationId: row.location_id,
          meal: row.meal_period as MealPeriod,
          // A malformed numeric from the DB must not turn the whole money
          // column into $NaN — fall back to 0 and keep rendering.
          cashCents: Number.isFinite(Number(row.cash_amount))
            ? Math.round(Number(row.cash_amount) * 100)
            : 0,
          cardCents: Number.isFinite(Number(row.card_amount))
            ? Math.round(Number(row.card_amount) * 100)
            : 0,
          splitCount: row.split_count,
          peopleIds,
          peopleNames: peopleIds.map((id) => nameById.get(id) ?? "?"),
          enteredById: row.entered_by,
          enteredByName: row.entered_by ? (nameById.get(row.entered_by) ?? null) : null,
          entryMethod: (row.entry_method === "voice" ? "voice" : "typed") as EntryMethod,
          flagged: row.flagged_anomaly && row.flag_verified_at === null,
          flaggedRaw: row.flagged_anomaly,
          anomalyReason: row.anomaly_reason,
          createdAt: row.created_at,
        };
      });

      const sessions: DeviceSessionRow[] = sessionRows
        .filter((row) => {
          const scanDate = businessDateFor(new Date(row.created_at));
          return scanDate >= start && scanDate <= end;
        })
        .map((row) => ({
          id: row.id,
          locationId: row.location_id,
          closerId: row.closer_id,
          createdAt: row.created_at,
        }));

      const schedules: ScheduleRowDb[] = scheduleRows.map((row) => ({
        id: row.id,
        tipEmployeeId: row.tip_employee_id,
        locationId: row.location_id,
        weekday: row.weekday,
        meal: row.meal as MealPeriod,
        createdAt: row.created_at,
      }));

      // Each location's first-ever entry date floors the missing-shift scan —
      // same rule the v1 discrepancies tab used.
      const firstEntryDates: Record<string, string | undefined> = {};
      for (const location of locationRows) {
        firstEntryDates[location.id] = location.tip_entries[0]?.business_date;
      }

      const locations = locationRows.map(toLocationInfo).sort((a, b) => {
        // Sushi card/segment first, matching the mockup.
        const rank = (kind: string | null) => (kind === "sushi" ? 0 : kind === "poki" ? 1 : 2);
        return rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name);
      });

      return {
        locations,
        employees,
        schedules,
        entries,
        sessions,
        access: accessRows.map((row) => ({
          locationId: row.location_id,
          tokenRotatedAt: row.token_rotated_at,
          entryToken: row.entry_token_plain ?? null,
        })),
        firstEntryDates,
      };
    }

    load()
      .then((data) => {
        if (cancelled) return;
        setResult({ key, rangeKey, data });
        setFailure(null);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setFailure({
          key,
          message: loadError instanceof Error ? loadError.message : "Could not load data.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [key, rangeKey, start, end]);

  const refetch = useCallback(() => setReload((n) => n + 1), []);

  return useMemo(() => {
    // Data from another range must never render under this range's label —
    // stale-while-revalidate applies only to same-range refetches (so
    // mutations don't flicker the page).
    const data = result && result.rangeKey === rangeKey ? result.data : null;
    const error = failure && failure.key === key ? failure.message : null;
    return {
      data,
      // A failed fetch for the CURRENT key is a settled state — show the
      // error + Retry, not an eternal spinner.
      loading: (result === null || result.key !== key) && error === null,
      error,
      refetch,
    };
  }, [result, key, rangeKey, failure, refetch]);
}
