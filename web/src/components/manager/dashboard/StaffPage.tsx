"use client";

// Staff & schedule: add-hire form, then one row per employee — works-at
// select, per-location schedule lines (black Sushi / blue Poki chips) with
// 7 day-cells of L/D toggle pills persisting to tip_employee_schedules,
// shifts/week count, Rename and Deactivate/Reactivate. The location segment
// filters rows AND schedule lines.
//
// Deactivate keeps history intact. Delete exists only for someone added by
// mistake: it appears on inactive rows and refuses when any recorded history
// exists (tip_entry_people cascades and entered_by nulls on delete — history
// must keep its names).

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  btn,
  btnPrim,
  ConfirmDialog,
  miniBtn,
  miniBtnDanger,
  ModalShell,
  InfoButton,
  panelWrap,
  sectionH3,
  useToast,
} from "./ui";
import type {
  EmployeeRow,
  LocationInfo,
  PageContext,
  ScheduleRowDb,
} from "./types";
import type { MealPeriod } from "@/types/database";

/** Display order Mon…Sun over stored weekday numbers (0 = Sunday). */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Works = "sushi" | "poki" | "both";

function worksOf(employee: EmployeeRow, locations: LocationInfo[]): Works {
  if (employee.locationId === null) return "both";
  const kind = locations.find((location) => location.id === employee.locationId)?.kind;
  return kind === "poki" ? "poki" : "sushi";
}

const rowGrid = "grid min-w-[860px] grid-cols-[132px_112px_1fr_128px] gap-x-2.5";
const dayGrid = "grid grid-cols-[54px_repeat(7,minmax(52px,1fr))] gap-1.5";

export function StaffPage({ ctx }: { ctx: PageContext }) {
  const toast = useToast();
  const supabase = getSupabase();
  const { locations } = ctx.data;
  const byKind = new Map(locations.map((location) => [location.kind, location]));

  // Optimistic schedule display: pills render the server rows overlaid with
  // local overrides (the manager's intent, written to the DB as they tap),
  // so a background refetch that snapshots before the latest tap can never
  // revert a pill. Overrides win for the page's lifetime; a failed write
  // removes its override and refetches.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const slotKey = (employeeId: string, locationId: string, weekday: number, meal: MealPeriod) =>
    `${employeeId}|${locationId}|${weekday}|${meal}`;
  const isScheduled = (
    employeeId: string,
    locationId: string,
    weekday: number,
    meal: MealPeriod,
  ): boolean => {
    const override = overrides.get(slotKey(employeeId, locationId, weekday, meal));
    if (override !== undefined) return override;
    return ctx.data.schedules.some(
      (row: ScheduleRowDb) =>
        row.tipEmployeeId === employeeId &&
        row.locationId === locationId &&
        row.weekday === weekday &&
        row.meal === meal,
    );
  };
  const clearOverridesFor = (employeeId: string) => {
    setOverrides((previous) => {
      const next = new Map(previous);
      for (const key of previous.keys()) {
        if (key.startsWith(`${employeeId}|`)) next.delete(key);
      }
      return next;
    });
  };

  const refetchRef = useRef(ctx.refetch);
  useEffect(() => {
    refetchRef.current = ctx.refetch;
  });
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRefetch = () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      refetchRef.current();
    }, 1500);
  };
  useEffect(
    () => () => {
      // Don't drop a pending reconcile on unmount — the writes are already
      // committed, and other pages derive from ctx.data.schedules.
      if (refetchTimer.current) {
        clearTimeout(refetchTimer.current);
        refetchTimer.current = null;
        refetchRef.current();
      }
    },
    [],
  );

  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<EmployeeRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<EmployeeRow | null>(null);

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const name = (new FormData(form).get("name") as string).trim();
    const works = new FormData(form).get("works") as Works;
    if (!name) return;
    setBusy(true);
    const maxSort = ctx.data.employees.reduce((max, e) => Math.max(max, e.sortOrder), 0);
    const { error } = await supabase.from("tip_employees").insert({
      name,
      location_id: works === "both" ? null : (byKind.get(works)?.id ?? null),
      active: true,
      sort_order: maxSort + 1,
    });
    setBusy(false);
    if (error) {
      toast(`Could not add: ${error.message}`);
      return;
    }
    form.reset();
    toast(`${name} added — tick their shifts so the phone pre-selects them`);
    ctx.refetch();
  }

  async function setWorks(employee: EmployeeRow, works: Works) {
    const locationId = works === "both" ? null : (byKind.get(works)?.id ?? null);
    const { error } = await supabase
      .from("tip_employees")
      .update({ location_id: locationId })
      .eq("id", employee.id);
    if (error) {
      toast(`Could not update: ${error.message}`);
      return;
    }
    // Drop schedule rows for locations they no longer work; derivations
    // ignore stale rows defensively, but don't leave them behind.
    if (works !== "both") {
      const keepId = byKind.get(works)?.id;
      const staleIds = locations
        .filter((location) => location.id !== keepId)
        .map((location) => location.id);
      if (staleIds.length > 0) {
        await supabase
          .from("tip_employee_schedules")
          .delete()
          .eq("tip_employee_id", employee.id)
          .in("location_id", staleIds);
      }
    }
    // Their schedule rows may have changed server-side; local overrides for
    // this employee no longer describe reality.
    clearOverridesFor(employee.id);
    ctx.refetch();
  }

  async function toggleShift(
    employee: EmployeeRow,
    locationId: string,
    weekday: number,
    meal: MealPeriod,
  ) {
    const key = slotKey(employee.id, locationId, weekday, meal);
    const currentlyOn = isScheduled(employee.id, locationId, weekday, meal);
    setOverrides((previous) => new Map(previous).set(key, !currentlyOn));

    const undoOverride = () => {
      setOverrides((previous) => {
        const next = new Map(previous);
        next.delete(key);
        return next;
      });
    };

    if (currentlyOn) {
      const { error } = await supabase
        .from("tip_employee_schedules")
        .delete()
        .eq("tip_employee_id", employee.id)
        .eq("location_id", locationId)
        .eq("weekday", weekday)
        .eq("meal", meal);
      if (error) {
        toast(`Could not save the schedule: ${error.message}`);
        undoOverride();
        ctx.refetch();
        return;
      }
    } else {
      const { error } = await supabase.from("tip_employee_schedules").insert({
        tip_employee_id: employee.id,
        location_id: locationId,
        weekday,
        meal,
      });
      // 23505 = the row already exists (e.g. a re-tap raced a stale
      // snapshot) — the desired state is already true, not an error.
      if (error && error.code !== "23505") {
        toast(`Could not save the schedule: ${error.message}`);
        undoOverride();
        ctx.refetch();
        return;
      }
    }
    queueRefetch();
  }

  async function setActive(employee: EmployeeRow, active: boolean) {
    const { error } = await supabase
      .from("tip_employees")
      .update({ active })
      .eq("id", employee.id);
    if (error) {
      toast(`Could not update: ${error.message}`);
      return;
    }
    toast(active ? `${employee.name} reactivated` : `${employee.name} deactivated — history stays`);
    ctx.refetch();
  }

  async function submitRename() {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    const { error } = await supabase
      .from("tip_employees")
      .update({ name })
      .eq("id", renaming.id);
    if (error) {
      toast(`Could not rename: ${error.message}`);
      return;
    }
    setRenaming(null);
    ctx.refetch();
  }

  async function requestDelete(employee: EmployeeRow) {
    // Delete is only for someone added by mistake — any recorded history
    // makes it a Deactivate case (the FK cascade would eat split rows).
    const [splitRes, enteredRes] = await Promise.all([
      supabase
        .from("tip_entry_people")
        .select("tip_entry_id", { count: "exact", head: true })
        .eq("tip_employee_id", employee.id),
      supabase
        .from("tip_entries")
        .select("id", { count: "exact", head: true })
        .eq("entered_by", employee.id),
    ]);
    if (splitRes.error || enteredRes.error) {
      toast("Could not check their history — try again.");
      return;
    }
    if ((splitRes.count ?? 0) > 0 || (enteredRes.count ?? 0) > 0) {
      toast(`${employee.name} has recorded history — keep them deactivated instead`);
      return;
    }
    setDeleting(employee);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    const { error } = await supabase.from("tip_employees").delete().eq("id", deleting.id);
    setBusy(false);
    if (error) {
      toast(`Could not delete: ${error.message}`);
      return;
    }
    toast(`${deleting.name} removed`);
    setDeleting(null);
    ctx.refetch();
  }

  const visibleKinds = new Set(ctx.visibleLocations.map((location) => location.kind));

  const pill = (pressed: boolean, kind: "sushi" | "poki" | null, disabled: boolean) =>
    `h-6 max-w-[34px] flex-1 rounded-md border text-[11px] font-extrabold leading-none ${
      pressed
        ? kind === "poki"
          ? "border-poki bg-poki text-white"
          : "border-ink bg-ink text-white"
        : "border-line bg-card text-ink3"
    } ${disabled ? "cursor-default opacity-40" : ""}`;

  return (
    <section className="mb-8">
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className={sectionH3}>Staff &amp; schedule</h3>
        <InfoButton label="About staff scheduling">
          Scheduled people come <b>pre-selected</b> on the phone when the closer records that
          day&apos;s shift — they can still add or remove anyone before saving. Unscheduled staff
          sit at the bottom of the picker. People with recorded history can only be deactivated;
          Delete exists for someone added by mistake.
        </InfoButton>
      </div>

      <div className={panelWrap}>
        <form
          className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3"
          onSubmit={(event) => void addEmployee(event)}
        >
          <label className="flex flex-col gap-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink2">
            New hire&apos;s name
            <input
              name="name"
              required
              placeholder="e.g. Dana"
              autoComplete="off"
              className="w-[180px] rounded-well border border-line bg-card px-2.5 py-1.5 text-[13.5px] normal-case tracking-normal text-ink outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink2">
            Works at
            <select
              name="works"
              className="rounded-well border border-line bg-card px-2.5 py-1.5 text-[13.5px] normal-case tracking-normal text-ink outline-none"
            >
              <option value="sushi">Sushi</option>
              <option value="poki">Poki &amp; Pho</option>
              <option value="both">Both</option>
            </select>
          </label>
          <button type="submit" className={btnPrim} disabled={busy}>
            Add
          </button>
          <span className="ml-auto flex items-center gap-3.5 text-xs text-ink2">
            <span>
              <span className="mr-1 inline-block h-[11px] w-[11px] rounded align-[-1px] bg-ink" />
              Sushi
            </span>
            <span>
              <span className="mr-1 inline-block h-[11px] w-[11px] rounded align-[-1px] bg-poki" />
              Poki &amp; Pho
            </span>
            <span className="text-ink3">L = lunch · D = dinner</span>
          </span>
        </form>

        <div className="overflow-x-auto">
          <div
            className={`${rowGrid} items-end border-b border-line px-4 py-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink2`}
          >
            <span>Name</span>
            <span>Works at</span>
            <span className={dayGrid}>
              <span />
              {DAY_LABELS.map((label) => (
                <span key={label} className="text-center">
                  {label}
                </span>
              ))}
            </span>
            <span>Shifts / wk</span>
          </div>

          <div>
            {ctx.data.employees.map((employee) => {
              const works = worksOf(employee, locations);
              const employeeLocations =
                works === "both"
                  ? locations.filter((location) => location.kind !== null)
                  : [byKind.get(works)].filter((x): x is LocationInfo => Boolean(x));
              const shown = employeeLocations.filter((location) =>
                visibleKinds.has(location.kind),
              );
              if (shown.length === 0) return null;

              let shifts = 0;
              for (const location of shown) {
                for (const weekday of DAY_ORDER) {
                  for (const meal of ["lunch", "dinner"] as const) {
                    if (isScheduled(employee.id, location.id, weekday, meal)) shifts += 1;
                  }
                }
              }

              return (
                <div
                  key={employee.id}
                  className={`${rowGrid} items-center border-b border-hairline px-4 py-2.5 last:border-b-0`}
                >
                  <span className={`font-bold text-ink ${employee.active ? "" : "opacity-40"}`}>
                    {employee.name}
                    {!employee.active && (
                      <span className="ml-1.5 inline-block rounded-[5px] bg-well px-1.5 py-px text-[10px] font-extrabold uppercase text-ink3 opacity-100">
                        inactive
                      </span>
                    )}
                  </span>
                  <span>
                    <select
                      value={works}
                      disabled={!employee.active}
                      onChange={(event) => void setWorks(employee, event.target.value as Works)}
                      className="rounded-well border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink outline-none disabled:opacity-40"
                    >
                      <option value="sushi">Sushi</option>
                      <option value="poki">Poki &amp; Pho</option>
                      <option value="both">Both</option>
                    </select>
                  </span>
                  <span className={`flex flex-col gap-[7px] ${employee.active ? "" : "opacity-40"}`}>
                    {shown.map((location) => (
                      <span key={location.id} className={`${dayGrid} items-center`}>
                        <span
                          className={`rounded-md py-[3px] text-center text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-white ${
                            location.kind === "poki" ? "bg-poki" : "bg-ink"
                          }`}
                        >
                          {location.shortLabel}
                        </span>
                        {DAY_ORDER.map((weekday) => {
                          const has = (meal: MealPeriod) =>
                            isScheduled(employee.id, location.id, weekday, meal);
                          return (
                            <span
                              key={weekday}
                              className="flex justify-center gap-1 rounded-lg bg-well p-1"
                            >
                              {(["lunch", "dinner"] as const).map((meal) => (
                                <button
                                  key={meal}
                                  type="button"
                                  aria-pressed={has(meal)}
                                  disabled={!employee.active}
                                  onClick={() =>
                                    void toggleShift(employee, location.id, weekday, meal)
                                  }
                                  className={pill(has(meal), location.kind, !employee.active)}
                                >
                                  {meal === "lunch" ? "L" : "D"}
                                </button>
                              ))}
                            </span>
                          );
                        })}
                      </span>
                    ))}
                  </span>
                  <span className="flex flex-col items-start gap-1.5">
                    <span className="text-xs font-bold text-ink2">{shifts} shifts</span>
                    <span className="flex flex-wrap gap-1.5">
                      {employee.active ? (
                        <>
                          <button
                            type="button"
                            className={miniBtn}
                            onClick={() => {
                              setRenaming(employee);
                              setRenameValue(employee.name);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className={miniBtnDanger}
                            onClick={() => void setActive(employee, false)}
                          >
                            Deactivate
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={miniBtn}
                            onClick={() => void setActive(employee, true)}
                          >
                            Reactivate
                          </button>
                          <button
                            type="button"
                            className={miniBtnDanger}
                            onClick={() => void requestDelete(employee)}
                          >
                            Delete…
                          </button>
                        </>
                      )}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {renaming && (
        <ModalShell title={`Rename ${renaming.name}`} onClose={() => setRenaming(null)}>
          <input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitRename();
            }}
            className="mt-3 w-full rounded-well bg-well px-3.5 py-2.5 text-ink outline-none"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => setRenaming(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrim}
              disabled={renameValue.trim().length === 0}
              onClick={() => void submitRename()}
            >
              Rename
            </button>
          </div>
        </ModalShell>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="They have no recorded history, so this removes them completely. Someone who has worked shifts should be deactivated instead."
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
