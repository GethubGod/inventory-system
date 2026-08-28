"use client";

// Recorded tips — the dense ledger. Rows newest-first grouped by day with
// day-total rows; tinted cash/card column groups; flagged rows get a red
// tint, a "⚑ check" chip, and a Verify button. Fix opens a manager edit
// dialog that updates the entry + its people directly under RLS (manager
// edits do not go through tip_save_entry).

import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  cashShareCents,
  moneyFromCents,
  type LedgerEntry,
} from "@/lib/tips/dashboardDerive";
import { shortDayLabel } from "@/lib/tips/dashboardRange";
import {
  btn,
  btnPrim,
  InfoButton,
  LocationChip,
  miniBtn,
  miniBtnDanger,
  ModalShell,
  panelWrap,
  sectionH3,
  td,
  th,
  useToast,
} from "./ui";
import type { EmployeeRow, PageContext } from "./types";

function methodLabel(entry: LedgerEntry): string {
  return entry.entryMethod === "voice" ? "dictated" : "typed";
}

function mealLabel(meal: string): string {
  return meal.charAt(0).toUpperCase() + meal.slice(1);
}

/** $ amount field value → cents, or null when invalid (0 .. $99,999.99). */
function parseAmountToCents(value: string): number | null {
  const stripped = value.replace(/[$,\s]/g, "");
  if (stripped === "") return null; // Number("") is 0 — a cleared field is invalid, not $0
  const num = Number(stripped);
  if (!Number.isFinite(num) || num < 0 || num >= 100000) return null;
  return Math.round(num * 100);
}

interface FixEntryState {
  cashCents: number;
  cardCents: number;
  splitCount: number;
  peopleIds: string[];
}

function fixEntryState(entry: LedgerEntry): FixEntryState {
  return {
    cashCents: entry.cashCents,
    cardCents: entry.cardCents,
    splitCount: entry.splitCount,
    peopleIds: [...entry.peopleIds],
  };
}

function samePeople(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return rightIds.size === right.length && left.every((id) => rightIds.has(id));
}

function sameFixEntryState(left: FixEntryState, right: FixEntryState): boolean {
  return (
    left.cashCents === right.cashCents &&
    left.cardCents === right.cardCents &&
    left.splitCount === right.splitCount &&
    samePeople(left.peopleIds, right.peopleIds)
  );
}

async function readFixEntryState(
  supabase: ReturnType<typeof getSupabase>,
  entryId: string,
): Promise<FixEntryState> {
  const { data, error } = await supabase
    .from("tip_entries")
    .select("cash_amount, card_amount, split_count, tip_entry_people(tip_employee_id)")
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This entry no longer exists.");
  return {
    cashCents: Math.round(Number(data.cash_amount) * 100),
    cardCents: Math.round(Number(data.card_amount) * 100),
    splitCount: data.split_count,
    peopleIds: (data.tip_entry_people ?? []).map((person) => person.tip_employee_id),
  };
}

function fixEntryStateSummary(state: FixEntryState, namesById: Map<string, string>): string {
  const people =
    state.peopleIds.length > 0
      ? state.peopleIds.map((id) => namesById.get(id) ?? id).join(", ")
      : "none";
  return `Cash ${moneyFromCents(state.cashCents)}; card ${moneyFromCents(state.cardCents)}; split count ${state.splitCount}; people: ${people}.`;
}

function FixDialog({
  entry,
  ctx,
  onClose,
}: {
  entry: LedgerEntry;
  ctx: PageContext;
  onClose: () => void;
}) {
  const toast = useToast();
  const [cash, setCash] = useState((entry.cashCents / 100).toFixed(2));
  const [card, setCard] = useState((entry.cardCents / 100).toFixed(2));
  const [peopleIds, setPeopleIds] = useState<string[]>(entry.peopleIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);

  // Choosable people: active staff working this entry's location (or both),
  // plus anyone already on the split (so history never disappears mid-edit).
  const choosable = useMemo(() => {
    const onSplit = new Set(entry.peopleIds);
    return ctx.data.employees.filter(
      (employee: EmployeeRow) =>
        onSplit.has(employee.id) ||
        (employee.active &&
          (employee.locationId === null || employee.locationId === entry.locationId)),
    );
  }, [ctx.data.employees, entry]);

  const cashCents = parseAmountToCents(cash);
  const cardCents = parseAmountToCents(card);
  const valid = cashCents !== null && cardCents !== null && peopleIds.length >= 1;

  async function save() {
    if (!valid || busy || needsReload || cashCents === null || cardCents === null) return;
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    // The transactional tip_save_entry RPC is service-role-only. Keep the
    // client sequence reversible: add people, update the entry, remove people;
    // on failure, reverse completed steps and read back the actual state.
    const original = fixEntryState(entry);
    const desired: FixEntryState = {
      cashCents,
      cardCents,
      splitCount: peopleIds.length,
      peopleIds: [...peopleIds],
    };
    const before = new Set(entry.peopleIds);
    const after = new Set(peopleIds);
    const added = peopleIds.filter((id) => !before.has(id));
    const removed = entry.peopleIds.filter((id) => !after.has(id));
    const updateNeeded =
      cashCents !== entry.cashCents ||
      cardCents !== entry.cardCents ||
      peopleIds.length !== entry.splitCount;
    let addedPeople = false;
    let updatedEntry = false;
    let removedPeople = false;
    let failedAt = "saving the entry";

    try {
      if (added.length > 0) {
        failedAt = "adding the new people";
        const { error: insertError } = await supabase.from("tip_entry_people").insert(
          added.map((personId) => ({ tip_entry_id: entry.id, tip_employee_id: personId })),
        );
        if (insertError) throw new Error(insertError.message);
        addedPeople = true;
      }

      if (updateNeeded) {
        failedAt = "updating the amounts and split count";
        const { error: updateError } = await supabase
          .from("tip_entries")
          .update({
            cash_amount: cashCents / 100,
            card_amount: cardCents / 100,
            split_count: peopleIds.length,
          })
          .eq("id", entry.id);
        if (updateError) throw new Error(updateError.message);
        updatedEntry = true;
      }

      if (removed.length > 0) {
        failedAt = "removing the previous people";
        const { error: deleteError } = await supabase
          .from("tip_entry_people")
          .delete()
          .eq("tip_entry_id", entry.id)
          .in("tip_employee_id", removed);
        if (deleteError) throw new Error(deleteError.message);
        removedPeople = true;
      }

      // PostgREST mutations do not return affected-row counts by default, so
      // a zero-row UPDATE/DELETE can have no error. Verify before reporting
      // success; the catch path will roll back any steps that did land.
      failedAt = "verifying the saved entry";
      const saved = await readFixEntryState(supabase, entry.id);
      if (!sameFixEntryState(saved, desired)) {
        throw new Error("The saved entry did not match the requested values.");
      }

      toast("Entry updated");
      ctx.refetch();
      onClose();
    } catch (saveError) {
      const rollbackErrors: string[] = [];
      const rollback = async (
        label: string,
        action: () => PromiseLike<{ error: { message: string } | null }>,
      ) => {
        try {
          const { error: rollbackError } = await action();
          if (rollbackError) rollbackErrors.push(`${label}: ${rollbackError.message}`);
        } catch (rollbackError) {
          rollbackErrors.push(
            `${label}: ${rollbackError instanceof Error ? rollbackError.message : "request failed"}`,
          );
        }
      };

      // Reverse in dependency order. Restoring removed people first guarantees
      // that even the rollback path never leaves the entry with no people.
      if (removedPeople) {
        await rollback("could not restore removed people", () =>
          supabase.from("tip_entry_people").insert(
            removed.map((personId) => ({ tip_entry_id: entry.id, tip_employee_id: personId })),
          ),
        );
      }
      if (updatedEntry) {
        await rollback("could not restore amounts and split count", () =>
          supabase
            .from("tip_entries")
            .update({
              cash_amount: original.cashCents / 100,
              card_amount: original.cardCents / 100,
              split_count: original.splitCount,
            })
            .eq("id", entry.id),
        );
      }
      if (addedPeople) {
        await rollback("could not remove newly added people", () =>
          supabase
            .from("tip_entry_people")
            .delete()
            .eq("tip_entry_id", entry.id)
            .in("tip_employee_id", added),
        );
      }

      const reason = saveError instanceof Error ? saveError.message : "Could not save the fix.";
      const namesById = new Map(ctx.data.employees.map((employee) => [employee.id, employee.name]));
      try {
        const current = await readFixEntryState(supabase, entry.id);
        if (sameFixEntryState(current, desired)) {
          toast("Entry updated");
          ctx.refetch();
          onClose();
          return;
        }

        const restored = sameFixEntryState(current, original);
        const recovery = restored
          ? "The entry was restored to its original state."
          : rollbackErrors.length === 0
            ? "Rollback finished, but the entry no longer matches the state from when this dialog opened."
            : `Rollback did not fully complete (${rollbackErrors.join("; ")}).`;
        if (!restored) setNeedsReload(true);
        setError(
          `Save failed while ${failedAt}: ${reason} ${recovery} Current entry state: ${fixEntryStateSummary(current, namesById)}${restored ? "" : " Close this dialog and review the refreshed ledger before making another change."}`,
        );
      } catch (readError) {
        setNeedsReload(true);
        const recovery =
          rollbackErrors.length === 0
            ? `No rollback error was reported, but the result could not be verified. The last known original state was: ${fixEntryStateSummary(original, namesById)}`
            : `Rollback did not fully complete (${rollbackErrors.join("; ")}).`;
        setError(
          `Save failed while ${failedAt}: ${reason} ${recovery} Could not read it back (${readError instanceof Error ? readError.message : "request failed"}); reload the ledger before trying again.`,
        );
      }
      ctx.refetch();
      setBusy(false);
    }
  }

  const location = ctx.locationById.get(entry.locationId);

  return (
    <ModalShell
      wide
      title={`Fix — ${shortDayLabel(entry.businessDate)} · ${location?.label ?? "?"} ${entry.meal}`}
      onClose={busy ? () => {} : onClose}
    >
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="section-label">Cash (split pool)</span>
          <input
            value={cash}
            onChange={(event) => setCash(event.target.value)}
            inputMode="decimal"
            disabled={busy || needsReload}
            className="rounded-well bg-well px-3.5 py-2.5 text-ink outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">Card (→ payroll)</span>
          <input
            value={card}
            onChange={(event) => setCard(event.target.value)}
            inputMode="decimal"
            disabled={busy || needsReload}
            className="rounded-well bg-well px-3.5 py-2.5 text-ink outline-none"
          />
        </label>
      </div>

      <div className="mt-4">
        <span className="section-label">Splitting the cash · {peopleIds.length}</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {choosable.map((employee) => {
            const selected = peopleIds.includes(employee.id);
            return (
              <button
                key={employee.id}
                type="button"
                aria-pressed={selected}
                disabled={busy || needsReload}
                onClick={() =>
                  setPeopleIds((previous) =>
                    selected
                      ? previous.filter((id) => id !== employee.id)
                      : [...previous, employee.id],
                  )
                }
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
                  selected ? "bg-accent text-white" : "bg-well text-ink2"
                }`}
              >
                {employee.name}
                {!employee.active && " (inactive)"}
              </button>
            );
          })}
        </div>
      </div>

      {cashCents !== null && peopleIds.length > 0 && (
        <p className="mt-3 text-[12.5px] text-ink2">
          {moneyFromCents(cashShareCents(cashCents, peopleIds.length))} cash each
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btn} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={btnPrim}
          onClick={() => void save()}
          disabled={!valid || busy || needsReload}
        >
          {busy ? "Saving…" : "Save fix"}
        </button>
      </div>
    </ModalShell>
  );
}

export function LedgerPage({ ctx }: { ctx: PageContext }) {
  const toast = useToast();
  const [fixing, setFixing] = useState<LedgerEntry | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);

  async function verify(entry: LedgerEntry) {
    if (verifying) return;
    setVerifying(entry.id);
    const { error } = await getSupabase()
      .from("tip_entries")
      .update({
        flag_verified_at: new Date().toISOString(),
        flag_verified_by: ctx.userId,
      })
      .eq("id", entry.id);
    setVerifying(null);
    if (error) {
      toast(`Could not verify: ${error.message}`);
      return;
    }
    toast("Entry verified — flag cleared");
    ctx.refetch();
  }

  // Rows are already newest-first; insert a day-total row after each group.
  const rows: Array<
    | { kind: "entry"; entry: LedgerEntry }
    | { kind: "total"; day: string; cashCents: number; cardCents: number }
  > = [];
  let day: string | null = null;
  let dayCash = 0;
  let dayCard = 0;
  const flushDay = () => {
    if (day !== null) rows.push({ kind: "total", day, cashCents: dayCash, cardCents: dayCard });
  };
  for (const entry of ctx.entries) {
    if (entry.businessDate !== day) {
      flushDay();
      day = entry.businessDate;
      dayCash = 0;
      dayCard = 0;
    }
    dayCash += entry.cashCents;
    dayCard += entry.cardCents;
    rows.push({ kind: "entry", entry });
  }
  flushDay();

  return (
    <section className="mb-8">
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className={sectionH3}>Recorded tips</h3>
        <span className="text-[12.5px] font-semibold text-ink3">{ctx.entries.length} records</span>
        <InfoButton label="About recorded tips">
          <b>Cash</b> is pooled and handed out nightly — the per-person column is what each name
          takes home. <b>Card</b> tips ride payroll. A flagged row is unusually large against the
          4-week history: check the drawer count, then Verify. Fix reopens a recorded shift for
          correction.
        </InfoButton>
      </div>
      <div className={`${panelWrap} overflow-x-auto`}>
        <table className="w-full min-w-[740px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Business date</th>
              <th className={th}>Restaurant</th>
              <th className={th}>Meal</th>
              <th className={`${th} text-right`}>Cash</th>
              <th className={th}>Split between</th>
              <th className={`${th} text-right`}>Per person</th>
              <th className={`${th} text-right`}>Card → payroll</th>
              <th className={th}>Entered by</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === "total") {
                return (
                  <tr key={`total-${row.day}`} className="bg-well text-[12.5px] font-extrabold">
                    <td colSpan={3} className={`${td} border-b-line py-1.5 font-bold text-ink2`}>
                      {shortDayLabel(row.day)} — day total
                    </td>
                    <td className={`${td} border-b-line bg-cashcol py-1.5 text-right tabular-nums`}>
                      {moneyFromCents(row.cashCents)}
                    </td>
                    <td className={`${td} border-b-line bg-cashcol py-1.5`} />
                    <td className={`${td} border-b-line bg-cashcol py-1.5`} />
                    <td className={`${td} border-b-line bg-cardcol py-1.5 text-right tabular-nums`}>
                      {moneyFromCents(row.cardCents)}
                    </td>
                    <td className={`${td} border-b-line py-1.5`} />
                    <td className={`${td} border-b-line py-1.5`} />
                  </tr>
                );
              }
              const { entry } = row;
              const location = ctx.locationById.get(entry.locationId);
              const flaggedTint = entry.flagged ? "bg-flagtint" : "";
              return (
                <tr key={entry.id}>
                  <td className={`${td} ${flaggedTint}`}>{shortDayLabel(entry.businessDate)}</td>
                  <td className={`${td} ${flaggedTint}`}>
                    {location ? <LocationChip location={location} /> : "?"}
                  </td>
                  <td className={`${td} ${flaggedTint}`}>{mealLabel(entry.meal)}</td>
                  <td className={`${td} ${entry.flagged ? "bg-flagtint" : "bg-cashcol"} text-right font-semibold tabular-nums`}>
                    {moneyFromCents(entry.cashCents)}
                    {entry.flagged && (
                      <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-flagtint px-1.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.03em] text-alert">
                        ⚑ check
                      </span>
                    )}
                  </td>
                  <td className={`${td} ${entry.flagged ? "bg-flagtint" : "bg-cashcol"}`}>
                    <span className="text-ink2">
                      <b className="font-semibold text-ink">{entry.peopleNames.join(", ")}</b>
                      <span className="ml-1 text-[11.5px] text-ink3">· {entry.splitCount}</span>
                    </span>
                  </td>
                  <td className={`${td} ${entry.flagged ? "bg-flagtint" : "bg-cashcol"} text-right font-extrabold tabular-nums`}>
                    {moneyFromCents(cashShareCents(entry.cashCents, entry.splitCount))}
                  </td>
                  <td className={`${td} ${entry.flagged ? "bg-flagtint" : "bg-cardcol"} text-right font-semibold tabular-nums`}>
                    {moneyFromCents(entry.cardCents)}
                  </td>
                  <td className={`${td} ${flaggedTint} text-[12.5px] text-ink2`}>
                    {entry.enteredByName ?? "—"}{" "}
                    <span className="text-ink3">· {methodLabel(entry)}</span>
                  </td>
                  <td className={`${td} ${flaggedTint} text-right`}>
                    <button type="button" className={miniBtn} onClick={() => setFixing(entry)}>
                      Fix
                    </button>
                    {entry.flagged && (
                      <button
                        type="button"
                        className={`${miniBtnDanger} ml-1.5`}
                        title={entry.anomalyReason ?? undefined}
                        disabled={verifying === entry.id}
                        onClick={() => void verify(entry)}
                      >
                        {verifying === entry.id ? "Verifying…" : "Verify"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {ctx.entries.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-[26px] text-center text-ink3">
                  No records in this range for this filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {fixing && <FixDialog entry={fixing} ctx={ctx} onClose={() => setFixing(null)} />}
    </section>
  );
}
