"use client";

// The Tip Dashboard shell: collapsible sidebar, "Tip Dashboard" topbar with
// filter-aware KPIs, the shared toolbar (time frame × location × Export
// CSV), and the four pages. Full-width — no content max-width.

import { useCallback, useMemo, useState } from "react";
import { businessDateFor } from "@/lib/tips/businessDate";
import { buildLedgerCsv } from "@/lib/tips/dashboardCsv";
import { moneyFromCents, rangeTotals } from "@/lib/tips/dashboardDerive";
import {
  lastWeek,
  rangeBounds,
  rangeLabel,
  sameRange,
  thisWeek,
  type DashboardRange,
} from "@/lib/tips/dashboardRange";
import { deriveMissingShifts } from "@/lib/tips/schedule";
import { DevicesPage } from "./DevicesPage";
import { LedgerPage } from "./LedgerPage";
import { OverviewPage } from "./OverviewPage";
import { Sidebar } from "./Sidebar";
import { StaffPage } from "./StaffPage";
import { Toolbar } from "./Toolbar";
import { btn, ToastProvider, useToast } from "./ui";
import { useDashboardData } from "./useDashboardData";
import type { LocFilter, NavId, PageContext } from "./types";

const SIDEBAR_KEY = "bt_dash_sidebar";

function rangeNounFor(range: DashboardRange, today: string): string {
  if (sameRange(range, thisWeek(today))) return "this week";
  if (sameRange(range, lastWeek(today))) return "last week";
  if (range.kind === "month") return "this month";
  if (range.kind === "year") return "this year";
  return "this range";
}

function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ShellInner({
  userId,
  profileName,
  profileEmail,
  onSignOut,
}: {
  userId: string;
  profileName: string;
  profileEmail: string;
  onSignOut: () => void;
}) {
  const toast = useToast();
  const [today] = useState(() => businessDateFor(new Date()));
  const [range, setRange] = useState<DashboardRange>(() => thisWeek(today));
  const [loc, setLoc] = useState<LocFilter>("both");
  const [nav, setNav] = useState<NavId>("overview");
  // Safe to read localStorage in the initializer: the shell only mounts
  // client-side, behind ManagerApp's auth gate (never server-rendered).
  // try/catch: blocked storage (private mode, enterprise policy) throws.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        window.localStorage.getItem(SIDEBAR_KEY) === "collapsed"
      );
    } catch {
      return false;
    }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, value ? "open" : "collapsed");
      } catch {
        // Preference simply won't persist.
      }
      return !value;
    });
  }, []);

  const { data, loading, error, refetch } = useDashboardData(range);

  const navigate = useCallback((next: NavId) => {
    setNav(next);
    window.scrollTo(0, 0);
  }, []);

  const ctx = useMemo<PageContext | null>(() => {
    if (!data) return null;
    const visibleLocations = data.locations.filter(
      (location) => loc === "both" || location.kind === loc,
    );
    const visibleIds = new Set(visibleLocations.map((location) => location.id));
    const entries = data.entries.filter((entry) => visibleIds.has(entry.locationId));
    const bounds = rangeBounds(range);
    const missing = deriveMissingShifts({
      schedules: data.schedules,
      employees: data.employees.map((employee) => ({
        id: employee.id,
        active: employee.active,
        locationId: employee.locationId,
      })),
      entries: data.entries,
      locationIds: [...visibleIds],
      firstEntryDates: data.firstEntryDates,
      rangeStart: bounds.start,
      rangeEnd: bounds.end,
      now: new Date(),
    });
    return {
      data,
      entries,
      visibleLocations,
      locationById: new Map(data.locations.map((location) => [location.id, location])),
      missing,
      rangeLabel: rangeLabel(range),
      rangeNoun: rangeNounFor(range, today),
      today,
      userId,
      navigate,
      refetch,
    };
  }, [data, loc, range, today, userId, navigate, refetch]);

  const totals = ctx ? rangeTotals(ctx.entries) : null;
  const attention = Boolean(
    ctx &&
      ((totals?.flaggedCount ?? 0) > 0 ||
        ctx.missing.length > 0 ||
        ctx.visibleLocations.some(
          (location) =>
            (ctx.data.access.find((row) => row.locationId === location.id)?.tokenRotatedAt ??
              null) === null,
        )),
  );

  const exportCsv = useCallback(() => {
    if (!ctx) return;
    const bounds = rangeBounds(range);
    const csv = buildLedgerCsv(
      ctx.entries,
      (locationId) => ctx.locationById.get(locationId)?.label ?? locationId,
    );
    downloadCsv(`smelter-tips_${bounds.start}_${bounds.end}.csv`, csv);
    toast(`CSV exported — ${ctx.entries.length} rows (${ctx.rangeLabel})`);
  }, [ctx, range, toast]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        nav={nav}
        onNav={navigate}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        attention={attention}
        profileName={profileName}
        profileEmail={profileEmail}
        onSignOut={onSignOut}
      />

      <div className="min-w-0 flex-1 px-7 pb-[60px]">
        <header className="flex flex-wrap items-baseline gap-3.5 pb-1 pt-6">
          <h1 className="text-[21px] font-extrabold tracking-[-0.01em] text-ink">Tip Dashboard</h1>
          {totals && (
            <div className="ml-auto flex flex-wrap items-baseline gap-[18px]">
              {totals.flaggedCount > 0 && (
                <span className="rounded-full border border-alert/25 bg-flagtint px-2.5 py-0.5 text-[12.5px] font-bold text-alert">
                  ⚑ {totals.flaggedCount} flagged
                </span>
              )}
              <span className="text-[13px] text-ink2">
                Cash pool{" "}
                <b className="text-[15px] font-extrabold text-ink">
                  {moneyFromCents(totals.cashCents)}
                </b>
              </span>
              <span className="text-[13px] text-ink2">
                Card logged{" "}
                <b className="text-[15px] font-extrabold text-ink">
                  {moneyFromCents(totals.cardCents)}
                </b>
              </span>
              <span className="text-[13px] text-ink2">{totals.count} records</span>
            </div>
          )}
        </header>

        <Toolbar
          range={range}
          onRange={setRange}
          loc={loc}
          onLoc={setLoc}
          locations={data?.locations ?? []}
          today={today}
          onExportCsv={exportCsv}
        />

        {!ctx && loading && <p className="py-16 text-center text-ink3">Loading…</p>}
        {!ctx && !loading && error && (
          <div className="py-16 text-center">
            <p className="text-alert">{error}</p>
            <button type="button" className={`${btn} mt-3`} onClick={refetch}>
              Retry
            </button>
          </div>
        )}
        {ctx && (
          <>
            {error && (
              <p className="mb-3 text-sm text-alert">
                Refresh failed: {error}{" "}
                <button type="button" className="underline" onClick={refetch}>
                  retry
                </button>
              </p>
            )}
            {nav === "overview" && <OverviewPage ctx={ctx} />}
            {nav === "ledger" && <LedgerPage ctx={ctx} />}
            {nav === "staff" && <StaffPage ctx={ctx} />}
            {nav === "logdev" && <DevicesPage ctx={ctx} />}
          </>
        )}
      </div>
    </div>
  );
}

export function DashboardShell(props: {
  userId: string;
  profileName: string;
  profileEmail: string;
  onSignOut: () => void;
}) {
  return (
    <ToastProvider>
      <ShellInner {...props} />
    </ToastProvider>
  );
}
