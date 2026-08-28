"use client";

// Recorded tips — the dense ledger (Tips v3, option D2). Rows newest-first
// grouped by day with day-total rows; tinted cash/card column groups; flagged
// rows get a red tint, a "⚑ check" chip, and a Verify button. Clicking a row
// unfolds a three-card detail panel: how the number was reached (raw →
// −lunch → recorded, then card and gratuity), who takes what (weighted), and
// the note. Fix opens a manager edit dialog that updates the entry + its
// people directly under RLS (manager edits do not go through tip_save_entry).

import { Fragment, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  entryFullShareCents,
  entryShareCents,
  moneyFromCents,
  type LedgerEntry,
} from "@/lib/tips/dashboardDerive";
import { shortDayLabel } from "@/lib/tips/dashboardRange";
import { fullShareCents as poolFullShareCents } from "@/lib/tips/split";
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

/** "3:41 PM" in the restaurant's timezone. */
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

/** $ amount field value → cents, or null when invalid (0 .. $99,999.99). */
function parseAmountToCents(value: string): number | null {
  const stripped = value.replace(/[$,\s]/g, "");
  if (stripped === "") return null; // Number("") is 0 — a cleared field is invalid, not $0
  const num = Number(stripped);
  if (!Number.isFinite(num) || num < 0 || num >= 100000) return null;
  return Math.round(num * 100);
}

const WEIGHT_OPTIONS = [1, 0.75, 0.5, 0.25] as const;

const NOTE_MAX_LENGTH = 280;

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
  const [gratuity, setGratuity] = useState((entry.gratuityCents / 100).toFixed(2));
  const [scope, setScope] = useState<"shift" | "day">(entry.enteredScope);
  const [peopleIds, setPeopleIds] = useState<string[]>(entry.peopleIds);
  const [weightById, setWeightById] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      entry.peopleIds.map((id, index) => [id, entry.weights[index] ?? 1]),
    ),
  );
  const [note, setNote] = useState(entry.note ?? "");
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
  const gratuityCents = parseAmountToCents(gratuity);
  const valid =
    cashCents !== null &&
    cardCents !== null &&
    gratuityCents !== null &&
    peopleIds.length >= 1;

  async function save() {
    if (!valid || busy || cashCents === null || cardCents === null || gratuityCents === null)
      return;
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    // PostgREST calls can't share a transaction, so order the steps to keep
    // every intermediate state recoverable: upsert people (adds + weight
    // changes) first, update the amounts + split_count, remove people last.
    // An amounts-only fix (the common case) is then a single atomic UPDATE,
    // and the entry can never pass through a zero-people state.
    try {
      const before = new Set(entry.peopleIds);
      const after = new Set(peopleIds);
      const removed = entry.peopleIds.filter((id) => !after.has(id));
      const beforeWeight = new Map(
        entry.peopleIds.map((id, index) => [id, entry.weights[index] ?? 1]),
      );
      const upserts = peopleIds
        .filter(
          (id) => !before.has(id) || (weightById[id] ?? 1) !== beforeWeight.get(id),
        )
        .map((personId) => ({
          tip_entry_id: entry.id,
          tip_employee_id: personId,
          share_weight: weightById[personId] ?? 1,
        }));

      if (upserts.length > 0) {
        const { error: upsertError } = await supabase
          .from("tip_entry_people")
          // Cast dies once the regenerated database.ts (backend side of the
          // v3 migration) knows share_weight.
          .upsert(upserts as never, { onConflict: "tip_entry_id,tip_employee_id" });
        if (upsertError) throw new Error(upsertError.message);
      }

      const trimmedNote = note.trim().slice(0, NOTE_MAX_LENGTH);
      const nextNote = trimmedNote === "" ? null : trimmedNote;
      const noteChanged = nextNote !== (entry.note ?? null);
      const { error: updateError } = await supabase
        .from("tip_entries")
        // Cast dies once the regenerated database.ts (backend side of the
        // v3 migration) knows the new columns.
        .update({
          cash_amount: cashCents / 100,
          card_amount: cardCents / 100,
          gratuity_amount: gratuityCents / 100,
          entered_scope: scope,
          split_count: peopleIds.length,
          ...(noteChanged
            ? {
                note: nextNote,
                note_at: nextNote === null ? null : new Date().toISOString(),
              }
            : {}),
        } as never)
        .eq("id", entry.id);
      if (updateError) throw new Error(updateError.message);

      if (removed.length > 0) {
        const { error: deleteError } = await supabase
          .from("tip_entry_people")
          .delete()
          .eq("tip_entry_id", entry.id)
          .in("tip_employee_id", removed);
        if (deleteError) throw new Error(deleteError.message);
      }

      toast("Entry updated");
      ctx.refetch();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the fix.");
      ctx.refetch(); // the steps aren't atomic — show what actually landed
      setBusy(false);
    }
  }

  const location = ctx.locationById.get(entry.locationId);
  const previewWeights = peopleIds.map((id) => weightById[id] ?? 1);

  return (
    <ModalShell
      wide
      title={`Fix — ${shortDayLabel(entry.businessDate)} · ${location?.label ?? "?"} ${entry.meal}`}
      onClose={busy ? () => {} : onClose}
    >
      {entry.meal === "dinner" && (
        <div className="mt-4 flex gap-1.5">
          {(
            [
              { value: "day", label: "Whole day (Square)" },
              { value: "shift", label: "Dinner only" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={scope === option.value}
              onClick={() => setScope(option.value)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${
                scope === option.value ? "bg-accent text-white" : "bg-well text-ink2"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-3">
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
        <label className="flex flex-col gap-1">
          <span className="section-label">Gratuity</span>
          <input
            value={gratuity}
            onChange={(event) => setGratuity(event.target.value)}
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
            const weight = weightById[employee.id] ?? 1;
            return (
              <span key={employee.id} className="inline-flex">
                <button
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
                    selected
                      ? "rounded-r-none bg-accent pr-2 text-white"
                      : "bg-well text-ink2"
                  }`}
                >
                  {employee.name}
                  {!employee.active && " (inactive)"}
                </button>
                {selected && (
                  <button
                    type="button"
                    aria-label={`${employee.name} share ${Math.round(weight * 100)}%`}
                    onClick={() =>
                      setWeightById((previous) => {
                        const index = WEIGHT_OPTIONS.indexOf(
                          (previous[employee.id] ?? 1) as (typeof WEIGHT_OPTIONS)[number],
                        );
                        return {
                          ...previous,
                          [employee.id]:
                            WEIGHT_OPTIONS[(index + 1) % WEIGHT_OPTIONS.length],
                        };
                      })
                    }
                    className="flex min-w-[28px] items-center rounded-full rounded-l-none bg-accent pl-0.5 pr-2 text-white"
                  >
                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[10.5px] font-extrabold text-alert">
                      {Math.round(weight * 100)}%
                    </span>
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <label className="mt-4 flex flex-col gap-1">
        <span className="section-label">
          Note · {note.length} / {NOTE_MAX_LENGTH}
        </span>
        <textarea
          value={note}
          rows={2}
          maxLength={NOTE_MAX_LENGTH}
          onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX_LENGTH))}
          className="resize-none rounded-well bg-well px-3.5 py-2.5 text-ink outline-none"
        />
      </label>

      {cashCents !== null && peopleIds.length > 0 && (
        <p className="mt-3 text-[12.5px] text-ink2">
          {moneyFromCents(poolFullShareCents(cashCents, previewWeights))} full share
          {previewWeights.some((weight) => weight < 1) ? " (weighted)" : " each"}
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

/** The unfolded three-card breakdown for one entry. */
function DetailPanel({
  entry,
  lunchEntry,
  onFix,
  onVerify,
  verifying,
}: {
  entry: LedgerEntry;
  /** The recorded lunch row at the same location + business date, if shown. */
  lunchEntry: LedgerEntry | null;
  onFix: () => void;
  onVerify: () => void;
  verifying: boolean;
}) {
  const shares = entryShareCents(entry);
  // Prefix match: when the save was ALSO a statistical outlier the reason is
  // "day_total_no_lunch; <statistical reason>" (contract amendment 2).
  const noLunchFlag = entry.anomalyReason?.startsWith("day_total_no_lunch") ?? false;
  // What was actually subtracted at save time — shown from the raw figures,
  // not the current lunch row (which a fix may have changed since).
  const subtractedCents =
    entry.rawCashCents === null ? null : entry.rawCashCents - entry.cashCents;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-[13px] border border-line bg-card p-3.5">
        <div className="section-label">How this number was reached</div>
        <div className="mt-2 grid gap-1 text-[12.5px] tabular-nums">
          {entry.enteredScope === "day" ? (
            <>
              <div className="flex text-ink2">
                <span>Entered from Square (whole day)</span>
                <span className="ml-auto font-semibold text-ink">
                  {moneyFromCents(entry.rawCashCents ?? entry.cashCents)}
                </span>
              </div>
              <div className="flex text-ink2">
                <span>
                  &minus; lunch recorded
                  {lunchEntry && !noLunchFlag ? ` ${timeLabel(lunchEntry.createdAt)}` : ""}
                </span>
                {noLunchFlag ? (
                  <span className="ml-auto font-semibold text-alert">nothing on record</span>
                ) : (
                  <span className="ml-auto font-semibold text-alert">
                    &minus;{moneyFromCents(subtractedCents ?? 0)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex border-t border-line pt-1.5 font-extrabold text-ink">
                <span>{mealLabel(entry.meal)} cash pool</span>
                <span className="ml-auto">{moneyFromCents(entry.cashCents)}</span>
              </div>
            </>
          ) : (
            <div className="flex font-extrabold text-ink">
              <span>Entered as {entry.meal} only</span>
              <span className="ml-auto">{moneyFromCents(entry.cashCents)}</span>
            </div>
          )}
        </div>
        {noLunchFlag && (
          <p className="mt-2 text-[12.5px] text-alert">
            Flagged <code className="rounded bg-well px-1">day_total_no_lunch</code> — a
            whole-day total was entered with no lunch to subtract.
          </p>
        )}
        <div className="my-2.5 h-px bg-hairline" />
        <div className="grid gap-1 text-[12.5px] tabular-nums">
          <div className="flex text-ink2">
            <span>Card → payroll</span>
            <span className="ml-auto font-semibold text-ink">
              {moneyFromCents(entry.cardCents)}
            </span>
          </div>
          <div className="flex text-ink2">
            <span>Gratuity</span>
            <span className="ml-auto font-semibold text-ink">
              {entry.gratuityCents > 0 ? moneyFromCents(entry.gratuityCents) : "none"}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-[13px] border border-line bg-card p-3.5">
        <div className="section-label">Who takes what</div>
        <table className="mt-1.5 w-full border-collapse text-[12.5px]">
          <tbody>
            {entry.peopleIds.map((personId, index) => {
              const weight = entry.weights[index] ?? 1;
              return (
                <tr key={personId}>
                  <td className="border-b border-hairline py-1">
                    {entry.peopleNames[index] ?? "?"}
                  </td>
                  <td className="border-b border-hairline py-1 text-right text-ink3">
                    {weight < 1 ? `${Math.round(weight * 100)}%` : "full"}
                  </td>
                  <td className="border-b border-hairline py-1 text-right font-semibold tabular-nums">
                    {moneyFromCents(shares[index] ?? 0)}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td className="border-t border-line pt-1.5 font-extrabold">Pool</td>
              <td className="border-t border-line" />
              <td className="border-t border-line pt-1.5 text-right font-extrabold tabular-nums">
                {moneyFromCents(entry.cashCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-[13px] border border-line bg-card p-3.5">
        <div className="section-label">
          Note
          {entry.note && entry.enteredByName
            ? ` · ${entry.enteredByName}${entry.noteAt ? `, ${timeLabel(entry.noteAt)}` : ""}`
            : ""}
        </div>
        {entry.note ? (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{entry.note}</p>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-ink3">No note on this entry.</p>
        )}
        <div className="mt-3 flex gap-2">
          {entry.flagged && (
            <button
              type="button"
              className={miniBtnDanger}
              disabled={verifying}
              onClick={(event) => {
                event.stopPropagation();
                onVerify();
              }}
            >
              {verifying ? "Verifying…" : "Verify"}
            </button>
          )}
          <button
            type="button"
            className={miniBtn}
            onClick={(event) => {
              event.stopPropagation();
              onFix();
            }}
          >
            Fix entry
          </button>
        </div>
      </div>
    </div>
  );
}

export function LedgerPage({ ctx }: { ctx: PageContext }) {
  const toast = useToast();
  const [fixing, setFixing] = useState<LedgerEntry | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  // Flagged rows auto-open their detail when the range first loads. Track the
  // data identity so a refetch after Verify doesn't re-open everything.
  const [autoOpenedKey, setAutoOpenedKey] = useState<string | null>(null);

  const entriesKey = useMemo(
    () => ctx.entries.map((entry) => entry.id).join("|"),
    [ctx.entries],
  );
  // Render-adjustment (not an effect): when a new range's rows arrive, open
  // every still-flagged row's detail before the first paint of that data.
  if (autoOpenedKey !== entriesKey) {
    setAutoOpenedKey(entriesKey);
    const flagged = ctx.entries.filter((entry) => entry.flagged).map((entry) => entry.id);
    if (flagged.length > 0) {
      setOpenIds((previous) => new Set([...previous, ...flagged]));
    }
  }

  // The lunch row at each location+date, for the detail panel's "lunch
  // recorded 3:41 PM" line.
  const lunchByDayLocation = useMemo(() => {
    const map = new Map<string, LedgerEntry>();
    for (const entry of ctx.entries) {
      if (entry.meal === "lunch") {
        map.set(`${entry.businessDate}|${entry.locationId}`, entry);
      }
    }
    return map;
  }, [ctx.entries]);

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

  const toggleOpen = (id: string) => {
    setOpenIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        <span className="text-[12.5px] font-semibold text-ink3">
          {ctx.entries.length} records · click a row for the breakdown
        </span>
        <InfoButton label="About recorded tips">
          <b>Cash</b> is pooled and handed out nightly — the per-person column is the full
          (100%) share; reduced shares live in the row&apos;s breakdown. <b>Card</b> tips ride
          payroll. A flagged row is unusually large against the 4-week history: check the
          drawer count, then Verify. Fix reopens a recorded shift for correction.
        </InfoButton>
      </div>
      <div className={`${panelWrap} overflow-x-auto`}>
        <table className="w-full min-w-[780px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`${th} w-[26px]`} />
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
                    <td className={`${td} border-b-line py-1.5`} />
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
              const open = openIds.has(entry.id);
              const partialCount = entry.weights.filter((weight) => weight < 1).length;
              return (
                <Fragment key={entry.id}>
                  <tr
                    className="cursor-pointer hover:bg-cream/60"
                    onClick={() => toggleOpen(entry.id)}
                  >
                    <td className={`${td} ${flaggedTint} text-[11px] text-ink3`}>
                      {open ? "▾" : "▸"}
                    </td>
                    <td className={`${td} ${flaggedTint}`}>{shortDayLabel(entry.businessDate)}</td>
                    <td className={`${td} ${flaggedTint}`}>
                      {location ? <LocationChip location={location} /> : "?"}
                    </td>
                    <td className={`${td} ${flaggedTint}`}>{mealLabel(entry.meal)}</td>
                    <td className={`${td} ${entry.flagged ? "bg-flagtint" : "bg-cashcol"} text-right font-semibold tabular-nums`}>
                      {entry.enteredScope === "day" && (
                        <span
                          className="mr-1.5 inline-flex cursor-help rounded-[5px] border border-line bg-card px-1 py-0.5 text-[10px] font-extrabold uppercase text-ink2"
                          title={`Entered as a whole-day total${
                            entry.rawCashCents !== null
                              ? ` of ${moneyFromCents(entry.rawCashCents)}`
                              : ""
                          }, lunch subtracted`}
                        >
                          day −lunch
                        </span>
                      )}
                      {moneyFromCents(entry.cashCents)}
                      {entry.flagged && (
                        <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-flagtint px-1.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.03em] text-alert">
                          ⚑ check
                        </span>
                      )}
                    </td>
                    <td className={`${td} ${entry.flagged ? "bg-flagtint" : "bg-cashcol"}`}>
                      <span className="font-semibold text-ink">
                        {entry.splitCount} {entry.splitCount === 1 ? "name" : "names"}
                      </span>
                      {partialCount > 0 && (
                        <span className="ml-1.5 rounded-[5px] bg-okgreen/10 px-1 py-0.5 text-[11px] font-extrabold text-okgreen">
                          {partialCount} partial
                        </span>
                      )}
                    </td>
                    <td className={`${td} ${entry.flagged ? "bg-flagtint" : "bg-cashcol"} text-right font-extrabold tabular-nums`}>
                      {moneyFromCents(entryFullShareCents(entry))}
                      {partialCount > 0 && (
                        <span className="ml-1 text-[11.5px] font-semibold text-ink3">
                          full share
                        </span>
                      )}
                    </td>
                    <td className={`${td} ${entry.flagged ? "bg-flagtint" : "bg-cardcol"} text-right font-semibold tabular-nums`}>
                      {moneyFromCents(entry.cardCents)}
                    </td>
                    <td className={`${td} ${flaggedTint} text-[12.5px] text-ink2`}>
                      {entry.enteredByName ?? "—"}{" "}
                      <span className="text-ink3">· {methodLabel(entry)}</span>
                    </td>
                    <td className={`${td} ${flaggedTint} text-right`}>
                      {entry.note !== null && (
                        <span className="rounded-[5px] bg-poki/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-poki">
                          note
                        </span>
                      )}
                      {entry.flagged && (
                        <button
                          type="button"
                          className={`${miniBtnDanger} ml-1.5`}
                          title={entry.anomalyReason ?? undefined}
                          disabled={verifying === entry.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void verify(entry);
                          }}
                        >
                          {verifying === entry.id ? "Verifying…" : "Verify"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td className={`${td} bg-cream/40`} />
                      <td colSpan={9} className={`${td} bg-cream/40 pb-4`}>
                        <DetailPanel
                          entry={entry}
                          lunchEntry={
                            lunchByDayLocation.get(
                              `${entry.businessDate}|${entry.locationId}`,
                            ) ?? null
                          }
                          onFix={() => setFixing(entry)}
                          onVerify={() => void verify(entry)}
                          verifying={verifying === entry.id}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {ctx.entries.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-[26px] text-center text-ink3">
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
