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
  const num = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(num) || num < 0 || num >= 100000) return null;
  return Math.round(num * 100);
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
    if (!valid || busy || cashCents === null || cardCents === null) return;
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    try {
      const { error: updateError } = await supabase
        .from("tip_entries")
        .update({
          cash_amount: cashCents / 100,
          card_amount: cardCents / 100,
          split_count: peopleIds.length,
        })
        .eq("id", entry.id);
      if (updateError) throw new Error(updateError.message);

      const { error: deleteError } = await supabase
        .from("tip_entry_people")
        .delete()
        .eq("tip_entry_id", entry.id);
      if (deleteError) throw new Error(deleteError.message);
      const { error: insertError } = await supabase.from("tip_entry_people").insert(
        peopleIds.map((personId) => ({ tip_entry_id: entry.id, tip_employee_id: personId })),
      );
      if (insertError) throw new Error(insertError.message);

      toast("Entry updated");
      ctx.refetch();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the fix.");
      ctx.refetch(); // the people delete/insert isn't atomic — show the truth
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
            className="rounded-well bg-well px-3.5 py-2.5 text-ink outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">Card (→ payroll)</span>
          <input
            value={card}
            onChange={(event) => setCard(event.target.value)}
            inputMode="decimal"
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
      {error && <p className="mt-3 text-sm text-alert">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btn} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={btnPrim} onClick={() => void save()} disabled={!valid || busy}>
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
