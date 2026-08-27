"use client";

// Overview: Trend & people — location-colored daily cash+card lines over the
// range, ranked cash take-home bars per person, then the "Needs attention"
// list. Every attention row navigates to the page that fixes it.

import {
  dailyTrend,
  moneyFromCents,
  rangeTotals,
  takeHomeByPerson,
  wholeDollarsFromCents,
} from "@/lib/tips/dashboardDerive";
import { shortDayLabel, trendDayLabel } from "@/lib/tips/dashboardRange";
import { btn, panelWrap, sectionH3 } from "./ui";
import type { LocationInfo, PageContext } from "./types";

const TREND_W = 600;
const TREND_H = 180;
const TREND_PAD = 10;

function trendColor(location: LocationInfo): string {
  if (location.kind === "poki") return "#2563eb";
  if (location.kind === "sushi") return "#1a1a1a";
  return "#e84d38";
}

function trendAreaFill(location: LocationInfo): string {
  if (location.kind === "poki") return "rgba(37,99,235,.08)";
  if (location.kind === "sushi") return "rgba(26,26,26,.08)";
  return "rgba(232,77,56,.08)";
}

function TrendChart({ ctx }: { ctx: PageContext }) {
  const days = dailyTrend(ctx.entries);
  if (days.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-ink3">
        No records in this range for this filter
      </div>
    );
  }

  const series = ctx.visibleLocations.map((location) => ({
    location,
    days: dailyTrend(ctx.entries.filter((entry) => entry.locationId === location.id)),
  }));
  const max = Math.max(...series.flatMap((item) => item.days.map((day) => day.totalCents)), 1);
  const indexByDate = new Map(days.map((day, index) => [day.businessDate, index]));
  const pointsFor = (seriesDays: typeof days) =>
    seriesDays.map((day) => {
      const index = indexByDate.get(day.businessDate) ?? 0;
      const x =
        days.length > 1
          ? TREND_PAD + (index * (TREND_W - 2 * TREND_PAD)) / (days.length - 1)
          : TREND_W / 2;
      const y = TREND_H - TREND_PAD - (day.totalCents / max) * (TREND_H - 2 * TREND_PAD);
      return [Math.round(x), Math.round(y)] as const;
    });

  // Long ranges would smear the axis; label every nth day instead.
  const labelStep = Math.max(1, Math.ceil(days.length / 10));

  return (
    <>
      <svg
        className="block h-[200px] w-full"
        viewBox={`0 0 ${TREND_W} ${TREND_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          series.length > 1 ? "Daily cash + card totals by location" : "Daily cash + card totals"
        }
      >
        {series.map((item) => {
          const points = pointsFor(item.days);
          const line = points.map((point) => point.join(",")).join(" ");
          const color = trendColor(item.location);
          const area = `0,${TREND_H} ${line} ${TREND_W},${TREND_H}`;
          return (
            <g key={item.location.id}>
              {series.length === 1 && <polygon points={area} fill={trendAreaFill(item.location)} />}
              <polyline
                points={line}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map((point, index) => (
                <circle
                  key={item.days[index].businessDate}
                  cx={point[0]}
                  cy={point[1]}
                  r="3.5"
                  fill={color}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between px-0.5 pb-2.5 pt-1.5 text-[11px] font-semibold text-ink3">
        {days.map((day, index) => (
          <span key={day.businessDate}>
            {index % labelStep === 0 || days.length === 1 ? trendDayLabel(day.businessDate) : ""}
          </span>
        ))}
      </div>
    </>
  );
}

function PeopleBars({ ctx }: { ctx: PageContext }) {
  const people = takeHomeByPerson(ctx.entries).slice(0, 6);
  const max = people.length > 0 ? Math.max(people[0].cents, 1) : 1;

  return (
    <div className="border-t border-line p-4 min-[900px]:border-l min-[900px]:border-t-0">
      <h5 className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.06em] text-ink2">
        Cash take-home by person
      </h5>
      {people.length === 0 && <p className="text-[12.5px] text-ink3">No cash recorded yet.</p>}
      {people.map((person) => (
        <div key={person.id} className="mb-2.5 flex items-center gap-2.5">
          <span className="w-14 flex-none truncate text-[12.5px] font-bold text-ink">
            {person.name}
          </span>
          <span className="h-[18px] flex-1 overflow-hidden rounded-md bg-well">
            <span
              className="block h-full rounded-md bg-ink opacity-85"
              style={{ width: `${Math.max(4, Math.round((person.cents / max) * 100))}%` }}
            />
          </span>
          <span className="w-[74px] flex-none text-right text-[12.5px] font-extrabold tabular-nums text-ink">
            {wholeDollarsFromCents(person.cents)}
            <span className="ml-1 text-[11px] font-normal text-ink3">· {person.shifts}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function OverviewPage({ ctx }: { ctx: PageContext }) {
  const totals = rangeTotals(ctx.entries);
  const showLegend = ctx.visibleLocations.length > 1;
  const neverRotated = ctx.visibleLocations.filter(
    (location) =>
      (ctx.data.access.find((row) => row.locationId === location.id)?.tokenRotatedAt ?? null) ===
      null,
  );

  const flaggedRows = ctx.entries.filter((entry) => entry.flagged);
  const hasAttention = flaggedRows.length > 0 || ctx.missing.length > 0 || neverRotated.length > 0;

  return (
    <section className="mb-8">
      <div className={`${panelWrap} mb-[26px]`}>
        <div className="flex flex-wrap items-center gap-3.5 border-b border-line px-4 py-3.5">
          <b className="text-[14.5px] font-extrabold text-ink">Tips trend — {ctx.rangeLabel}</b>
          {showLegend && (
            <span className="flex items-center gap-3 text-xs text-ink2">
              {ctx.visibleLocations.map((location) => (
                <span key={location.id}>
                  <span
                    className="mr-1.5 inline-block h-[11px] w-[11px] rounded align-[-1px]"
                    style={{ backgroundColor: trendColor(location) }}
                  />
                  {location.label}
                </span>
              ))}
            </span>
          )}
          <span className="ml-auto text-[12.5px] text-ink2">
            Cash <b className="text-[13px] text-ink">{wholeDollarsFromCents(totals.cashCents)}</b> ·
            Card <b className="text-[13px] text-ink">{wholeDollarsFromCents(totals.cardCents)}</b> ·{" "}
            {totals.count} records
          </span>
        </div>
        <div className="grid min-[900px]:grid-cols-[1.7fr_1fr]">
          <div className="min-w-0 px-4 pb-2.5 pt-5">
            <TrendChart ctx={ctx} />
          </div>
          <PeopleBars ctx={ctx} />
        </div>
      </div>

      <div className="mb-2.5 flex items-center gap-2">
        <h3 className={sectionH3}>Needs attention</h3>
      </div>
      <div className={panelWrap}>
        {flaggedRows.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 border-b border-hairline px-4 py-3 text-[13.5px] last:border-b-0"
          >
            <span className="h-2 w-2 flex-none rounded-full bg-accent" aria-hidden />
            <span className="min-w-0 text-ink2">
              <b className="text-ink">
                {shortDayLabel(entry.businessDate)} ·{" "}
                {ctx.locationById.get(entry.locationId)?.label ?? "?"} {entry.meal}
              </b>{" "}
              — cash {moneyFromCents(entry.cashCents)} looks unusually large
            </span>
            <button type="button" className={`${btn} ml-auto`} onClick={() => ctx.navigate("ledger")}>
              Review
            </button>
          </div>
        ))}
        {ctx.missing.map((shift) => (
          <div
            key={`${shift.businessDate}-${shift.locationId}-${shift.meal}`}
            className="flex items-center gap-3 border-b border-hairline px-4 py-3 text-[13.5px] last:border-b-0"
          >
            <span className="h-2 w-2 flex-none rounded-full bg-accent" aria-hidden />
            <span className="min-w-0 text-ink2">
              <b className="text-ink">
                {shortDayLabel(shift.businessDate)} ·{" "}
                {ctx.locationById.get(shift.locationId)?.label ?? "?"} {shift.meal}
              </b>{" "}
              was never logged
            </span>
            <button type="button" className={`${btn} ml-auto`} onClick={() => ctx.navigate("logdev")}>
              See log
            </button>
          </div>
        ))}
        {neverRotated.map((location) => (
          <div
            key={location.id}
            className="flex items-center gap-3 border-b border-hairline px-4 py-3 text-[13.5px] last:border-b-0"
          >
            <span className="h-2 w-2 flex-none rounded-full bg-warnamber" aria-hidden />
            <span className="min-w-0 text-ink2">
              <b className="text-ink">{location.label} QR</b> has never been rotated — mint a
              QR code so closers can scan in
            </span>
            <button type="button" className={`${btn} ml-auto`} onClick={() => ctx.navigate("logdev")}>
              Devices
            </button>
          </div>
        ))}
        {!hasAttention && (
          <div className="flex items-center gap-3 px-4 py-3 text-[13.5px] text-ink2">
            <span className="h-2 w-2 flex-none rounded-full bg-okgreen" aria-hidden />
            Nothing needs attention in this range.
          </div>
        )}
      </div>
    </section>
  );
}
