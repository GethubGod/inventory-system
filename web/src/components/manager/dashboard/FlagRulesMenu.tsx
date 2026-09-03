"use client";

// "Flag rules" popover for the Recorded tips header: which conditions turn a
// row red. Two switches for the flags the phone records at save time and two
// optional dollar limits evaluated here on the dashboard.

import { useState } from "react";
import type { FlagRules } from "@/lib/tips/flagRules";
import { btn, ModalShell } from "./ui";

function dollarsFromCents(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

/** "300" or "300.50" → cents ($0 is a valid limit); blank or invalid → null (off). */
function centsFromDollars(value: string): number | null {
  const stripped = value.replace(/[$,\s]/g, "");
  if (stripped === "" || !/^\d+(\.\d{0,2})?$/.test(stripped)) return null;
  return Math.round(Number(stripped) * 100);
}

const switchRow = "flex items-start gap-3 py-2.5";
const limitInput =
  "w-28 rounded-[10px] border border-line bg-well px-2.5 py-1.5 text-[13px] tabular-nums text-ink outline-none focus:border-accent";

export function FlagRulesMenu({
  rules,
  onChange,
}: {
  rules: FlagRules;
  onChange: (rules: FlagRules) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cashText, setCashText] = useState(() => dollarsFromCents(rules.cashOverCents));
  const [cardText, setCardText] = useState(() => dollarsFromCents(rules.cardOverCents));

  // Limits commit on blur and again on close, so Escape or a backdrop tap
  // after typing a figure keeps it.
  const commitLimits = () => {
    const cash = centsFromDollars(cashText);
    const card = centsFromDollars(cardText);
    setCashText(dollarsFromCents(cash));
    setCardText(dollarsFromCents(card));
    if (cash !== rules.cashOverCents || card !== rules.cardOverCents) {
      onChange({ ...rules, cashOverCents: cash, cardOverCents: card });
    }
  };
  const close = () => {
    commitLimits();
    setOpen(false);
  };

  const activeCount =
    Number(rules.noLunch) +
    Number(rules.unusualAmounts) +
    Number(rules.cashOverCents !== null) +
    Number(rules.cardOverCents !== null);

  return (
    <>
      <button type="button" className={`${btn} ml-auto`} onClick={() => setOpen(true)}>
        Flag rules · {activeCount} on
      </button>
      {open && (
        <ModalShell title="What gets flagged" onClose={close}>
          <p className="text-[13px] text-ink2">
            A flagged row shows in red with a Verify button until you check it. Changing a
            rule re-checks every recorded shift; verified rows stay clear.
          </p>
          <div className="mt-3 divide-y divide-hairline">
            <label className={switchRow}>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-accent"
                checked={rules.noLunch}
                onChange={(event) => onChange({ ...rules, noLunch: event.target.checked })}
              />
              <span className="text-[13.5px] text-ink">
                <b>Lunch was never entered</b>
                <span className="block text-[12.5px] text-ink2">
                  A whole-day dinner total was saved with no lunch recorded to subtract.
                </span>
              </span>
            </label>
            <label className={switchRow}>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-accent"
                checked={rules.unusualAmounts}
                onChange={(event) =>
                  onChange({ ...rules, unusualAmounts: event.target.checked })
                }
              />
              <span className="text-[13.5px] text-ink">
                <b>Unusual cash or card amount</b>
                <span className="block text-[12.5px] text-ink2">
                  Far above what that shift usually records over the last 4 weeks.
                </span>
              </span>
            </label>
            <div className={switchRow}>
              <span className="mt-1 h-4 w-4 flex-none" aria-hidden />
              <span className="text-[13.5px] text-ink">
                <b>Amount limits</b>
                <span className="block text-[12.5px] text-ink2">
                  Flag any shift over these figures. Leave blank to turn a limit off.
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink2">
                  <label className="flex items-center gap-2">
                    Cash over $
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="off"
                      className={limitInput}
                      value={cashText}
                      onChange={(event) => setCashText(event.target.value)}
                      onBlur={commitLimits}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    Card over $
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="off"
                      className={limitInput}
                      value={cardText}
                      onChange={(event) => setCardText(event.target.value)}
                      onBlur={commitLimits}
                    />
                  </label>
                </span>
              </span>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" className={btn} onClick={close}>
              Done
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}
