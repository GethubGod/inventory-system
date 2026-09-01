"use client";

// Main tip-entry screen: date/closer header, location card, Lunch|Dinner
// segmented (time-of-day preset; recorded shifts locked out), cash/card
// amounts, roster split chips, live split strip, and the sticky
// "Speak it in" / "Save" bar. Voice entry opens the VoiceSheet, whose result
// fills the form and scrolls to the split so the closer checks who gets what
// before pressing Save. A successful save shows a full-screen confirmation
// (with a way back to edit), then ends the session and returns to the scan
// gate. One QR scan per entry.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { InfoButton } from "@/components/InfoButton";
import { SmelterLogo } from "@/components/Logo";
import {
  endSession,
  fetchState,
  getSlot,
  isAlreadyRecorded,
  isSessionInvalid,
  saveEntry,
  TipApiError,
  type LunchAmounts,
  type SavePayload,
  type SessionState,
  type SlotEntry,
} from "@/lib/tips/api";
import { anomalyMessage, type AnomalyResult } from "@/lib/tips/anomaly";
import { formatBusinessDate } from "@/lib/tips/businessDate";
import {
  deriveShiftAmounts,
  enteredTotal,
  hasNegativeAmount,
  type EnteredScope,
  type MealAmounts,
} from "@/lib/tips/dayScope";
import { moneyFromCents } from "@/lib/tips/dashboardDerive";
import { formatMoney } from "@/lib/tips/format";
import { mealPreset } from "@/lib/tips/mealPreset";
import {
  clearSession,
  loadSession,
  type StoredSession,
} from "@/lib/tips/session";
import { allocatePoolCents, fullShareCents, toCents } from "@/lib/tips/split";
import type { MealPeriod, VoiceVariant } from "@/types/database";
import { AmountWell, isValidAmount } from "./AmountWell";
import { ConfirmDialog } from "./ConfirmDialog";
import { NoteField } from "./NoteField";
import { PayoutList } from "./PayoutList";
import { RosterChips, nextWeight } from "./RosterChips";
import { ScopeSwitch } from "./ScopeSwitch";
import { Segmented } from "./Segmented";
import { SplitStrip } from "./SplitStrip";
import { VoiceSheet, type VoiceApplyResult } from "./VoiceSheet";

const MEAL_OPTIONS = [
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
] as const;

/** How long the saved confirmation lingers before returning to the scan gate. */
const SAVED_SCREEN_MS = 10000;

interface VoiceMeta {
  variant: VoiceVariant;
  corrections: number;
}

function MicIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  );
}

function ChevronRightIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/**
 * Full-screen post-save confirmation. Holds SAVED_SCREEN_MS with a visible
 * countdown over a draining progress bar, then ends the session and sends
 * the phone back to the scan gate; "Done" skips the wait and "Go back and
 * edit" returns to the filled-in form (the same session may re-save the
 * slot). The three wells mirror the entry form's grid but are read-only.
 */
function SavedScreen({
  payload,
  entry,
  lunch,
  locationName,
  businessDate,
  splitNames,
  onFinished,
  onEdit,
}: {
  payload: SavePayload;
  /** The saved row from the server — its derived figures are authoritative. */
  entry: SlotEntry | null;
  /** The lunch figures in scope at save time (client-side fallback only). */
  lunch: LunchAmounts | null;
  locationName: string;
  businessDate: string;
  splitNames: string[];
  onFinished: () => void;
  onEdit: () => void;
}) {
  const totalSeconds = Math.round(SAVED_SCREEN_MS / 1000);
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);

  useEffect(() => {
    const timer = setTimeout(onFinished, SAVED_SCREEN_MS);
    const ticker = setInterval(
      () => setSecondsLeft((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => {
      clearTimeout(timer);
      clearInterval(ticker);
    };
  }, [onFinished]);

  // Prefer the server's stored (derived) figures; fall back to deriving
  // client-side from what was typed when an older server omits them.
  const amounts: MealAmounts = entry
    ? { cash: entry.cash, card: entry.card, gratuity: entry.gratuity ?? 0 }
    : deriveShiftAmounts(
        { cash: payload.cash, card: payload.card, gratuity: payload.gratuity },
        payload.enteredScope,
        lunch,
      ).derived;

  const count = payload.peopleIds.length;
  const poolCents = Math.max(0, toCents(amounts.cash));
  const weights = payload.weights.length === count ? payload.weights : Array(count).fill(1);
  const shares = allocatePoolCents(poolCents, weights);
  const fullShare = fullShareCents(poolCents, weights);
  const reduced = payload.peopleIds
    .map((id, index) => ({
      name: splitNames[index] ?? "",
      weight: weights[index] ?? 1,
      cents: shares[index] ?? 0,
    }))
    .filter((person) => person.weight < 1);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-20">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-tint text-accent">
          <CheckIcon size={28} />
        </span>
        <h1 className="mt-5 text-3xl font-bold text-ink">Saved</h1>
        <p className="mt-2 text-ink2">
          {payload.meal === "lunch" ? "Lunch" : "Dinner"} ·{" "}
          {formatBusinessDate(businessDate)}
        </p>
      </div>

      <div className="mt-8 rounded-card bg-card p-5">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
          <p className="font-bold text-ink">{locationName}</p>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-well bg-well p-3">
            <div className="section-label">Cash</div>
            <p className="mt-1 text-xl font-bold text-ink">
              {formatMoney(amounts.cash)}
            </p>
          </div>
          <div className="rounded-well bg-well p-3">
            <div className="section-label">Card</div>
            <p className="mt-1 text-xl font-bold text-ink">
              {formatMoney(amounts.card)}
            </p>
          </div>
          <div className="rounded-well bg-well p-3">
            <div className="section-label">Gratuity</div>
            <p className="mt-1 text-xl font-bold text-ink">
              {formatMoney(amounts.gratuity)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-ink2">
          {count === 1 ? (
            `${splitNames[0] ?? "1 person"} takes ${moneyFromCents(poolCents)}`
          ) : reduced.length > 0 ? (
            <>
              {count} people · full share <b>{moneyFromCents(fullShare)}</b>
              {reduced.map((person) => (
                <span key={person.name}>
                  , {person.name} <b>{moneyFromCents(person.cents)}</b> (
                  {Math.round(person.weight * 100)}%)
                </span>
              ))}
            </>
          ) : (
            `${count} people · ${moneyFromCents(fullShare)} each`
          )}
        </p>
        {count > 1 && splitNames.length > 0 && (
          <p className="mt-1 text-sm text-ink3">{splitNames.join(", ")}</p>
        )}
        {payload.note && (
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-[5px] bg-poki/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-poki">
              note
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink2">
              {payload.note}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1" />

      <p className="text-center text-sm text-ink3">
        Back to the scan screen in <b className="text-ink2">{secondsLeft}</b>s
      </p>
      <div className="mt-2 h-[3px] overflow-hidden rounded-[2px] bg-well">
        <div
          className="h-full bg-accent transition-[width] duration-1000 ease-linear"
          style={{ width: `${(secondsLeft / totalSeconds) * 100}%` }}
        />
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 rounded-full border border-line bg-card py-4 font-semibold text-ink2 active:bg-well"
        >
          Go back and edit
        </button>
        <button
          type="button"
          onClick={onFinished}
          className="flex-1 rounded-full bg-card py-4 font-semibold text-ink active:bg-well"
        >
          Done
        </button>
      </div>
      <div className="mt-6 flex justify-center">
        <SmelterLogo height={24} />
      </div>
    </main>
  );
}

/** Both shifts recorded: nothing left to enter from this device today. */
function AllDoneScreen({
  locationName,
  businessDate,
  onFinished,
}: {
  locationName: string;
  businessDate: string;
  onFinished: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 pb-10">
      <div className="rounded-card bg-card p-5 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-tint text-accent">
          <CheckIcon size={24} />
        </span>
        <p className="mt-4 font-bold text-ink">All set for today</p>
        <p className="mt-2 text-ink2">
          Lunch and dinner are both recorded for {locationName} (
          {formatBusinessDate(businessDate)}). Need a fix? Ask a manager.
        </p>
      </div>
      <button
        type="button"
        onClick={onFinished}
        className="mt-6 w-full rounded-full bg-card py-4 font-semibold text-ink active:bg-well"
      >
        Done
      </button>
    </main>
  );
}

export function EntryForm() {
  const router = useRouter();

  const [session, setSession] = useState<StoredSession | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [meal, setMeal] = useState<MealPeriod>("dinner");
  const [disabledMeals, setDisabledMeals] = useState<MealPeriod[]>([]);
  const [allDone, setAllDone] = useState(false);
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [gratuity, setGratuity] = useState("");
  // Whole-day vs shift-only Square number. Dinner only — lunch always
  // records what was typed. Defaults to whole day per the approved mockup.
  const [scope, setScope] = useState<EnteredScope>("day");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Share weight per person id (1 | 0.75 | 0.5 | 0.25). Kept independent of
  // selection so deselecting and reselecting someone keeps their badge.
  const [weightById, setWeightById] = useState<Record<string, number>>({});
  const [note, setNote] = useState<string | null>(null);
  // Who the manager's schedule says works each meal today. Seeds the chip
  // pre-selection and floats scheduled people to the top of the picker.
  const [scheduledByMeal, setScheduledByMeal] = useState<
    Partial<Record<MealPeriod, string[]>>
  >({});
  // Fields the user actually edited this visit. VoiceSheet only locks
  // user-edited fields against voice overwrites.
  const [touchedFields, setTouchedFields] = useState<
    Set<"cash" | "card" | "people">
  >(() => new Set());

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{
    message: string;
    retryable: boolean;
  } | null>(null);
  const [pendingAnomaly, setPendingAnomaly] = useState<{
    payload: SavePayload;
    anomaly: AnomalyResult;
  } | null>(null);
  const [savedPayload, setSavedPayload] = useState<SavePayload | null>(null);
  // The row the server stored — its derived figures drive the saved screen.
  const [savedEntry, setSavedEntry] = useState<SlotEntry | null>(null);
  const [pickPersonWarning, setPickPersonWarning] = useState(false);

  // Set by "Go back and edit": the saved meal stays editable and the other
  // meal locks, so one scan still records one shift.
  const [editingSavedMeal, setEditingSavedMeal] = useState<MealPeriod | null>(null);
  // Fields the closer changed by hand after a voice result was reviewed;
  // each counts as one more correction on the eventual save.
  const [postVoiceEdits, setPostVoiceEdits] = useState<Set<"cash" | "card" | "people">>(
    () => new Set(),
  );
  const [showVoice, setShowVoice] = useState(false);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [voiceMeta, setVoiceMeta] = useState<VoiceMeta | null>(null);

  const lastPayloadRef = useRef<SavePayload | null>(null);
  // The split readout: voice results scroll here so the closer sees who gets
  // what before saving.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const finishedRef = useRef(false);
  // Synchronous in-flight guard: the `saving` state lags a render behind the
  // click, so two fast taps (or Save + anomaly "Save anyway") could both
  // start a save. The ref blocks the second one in the same tick.
  const saveInFlightRef = useRef(false);
  // Per-meal memory of the closer's selection, so switching Lunch↔Dinner and
  // back never discards manual picks (or their voice-overwrite protection).
  const savedSelectionsRef = useRef<
    Partial<Record<MealPeriod, { ids: string[]; touched: boolean }>>
  >({});

  /** End the per-scan session and return to the scan gate. */
  const finishSession = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const stored = loadSession();
    clearSession();
    if (stored) void endSession(stored.token);
    router.replace("/");
  }, [router]);

  // Mount/init is split into a pure async step (no state writes) whose
  // outcome is applied in a promise callback — the pattern the repo's landing
  // page uses, and one that keeps setState out of the effect body.
  const runInit = useCallback(async (): Promise<
    | { kind: "redirect"; to: string; clear: boolean }
    | {
        kind: "ready";
        stored: StoredSession;
        fresh: SessionState;
        presetScheduled: string[] | null;
      }
    | { kind: "error"; message: string }
  > => {
    const stored = loadSession();
    if (!stored) return { kind: "redirect", to: "/", clear: false };
    if (stored.closerId === null) {
      return { kind: "redirect", to: "/closer", clear: false };
    }
    try {
      const fresh = await fetchState(stored.token);
      // The roster's scheduled flags cover today's DEFAULT meal. When the
      // preset lands on the other meal (default already recorded), fetch that
      // meal's scheduled list too — best-effort, pre-selection only.
      const preset = mealPreset(fresh.today);
      let presetScheduled: string[] | null = null;
      if (preset.meal && preset.meal !== fresh.today.defaultMeal) {
        try {
          presetScheduled = (await getSlot(stored.token, preset.meal)).scheduledIds;
        } catch {
          presetScheduled = null;
        }
      }
      return { kind: "ready", stored, fresh, presetScheduled };
    } catch (error) {
      if (isSessionInvalid(error)) {
        return { kind: "redirect", to: "/", clear: true };
      }
      return {
        kind: "error",
        message:
          error instanceof TipApiError
            ? error.message
            : "Something went wrong. Try again.",
      };
    }
  }, []);

  const applyInit = useCallback(
    (outcome: Awaited<ReturnType<typeof runInit>>) => {
      if (outcome.kind === "redirect") {
        if (outcome.clear) clearSession();
        router.replace(outcome.to);
        return;
      }
      if (outcome.kind === "error") {
        setLoadError(outcome.message);
        setLoading(false);
        return;
      }
      const preset = mealPreset(outcome.fresh.today);
      setSession(outcome.stored);
      setState(outcome.fresh);
      setDisabledMeals(preset.disabled);
      setAllDone(preset.allRecorded);
      const byMeal: Partial<Record<MealPeriod, string[]>> = {
        [outcome.fresh.today.defaultMeal]: outcome.fresh.roster
          .filter((person) => person.scheduled === true)
          .map((person) => person.id),
      };
      if (
        preset.meal &&
        preset.meal !== outcome.fresh.today.defaultMeal &&
        outcome.presetScheduled
      ) {
        byMeal[preset.meal] = outcome.presetScheduled;
      }
      setScheduledByMeal(byMeal);
      if (preset.meal) {
        setMeal(preset.meal);
        // Scheduled people start selected; the closer can still add/remove.
        setSelectedIds(byMeal[preset.meal] ?? []);
      }
      setLoadError(null);
      setLoading(false);
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    void runInit().then((outcome) => {
      if (!cancelled) applyInit(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, [runInit, applyInit]);

  const changeMeal = useCallback(
    async (next: MealPeriod) => {
      if (!session || next === meal || slotLoading) return;
      if (disabledMeals.includes(next)) return;
      setMeal(next);
      // Remember the crew picked for the meal we're leaving.
      savedSelectionsRef.current[meal] = {
        ids: selectedIds,
        touched: touchedFields.has("people"),
      };
      // The target slot is empty by construction (recorded shifts are
      // locked), but confirm against the server so a save that landed from
      // another device mid-session still gets caught.
      setSlotLoading(true);
      try {
        const slot = await getSlot(session.token, next);
        if (slot.entry) {
          setDisabledMeals((prev) =>
            prev.includes(next) ? prev : [...prev, next],
          );
          setMeal(meal);
        } else {
          // A fresher today-status (with the recorded lunch figures) rides
          // along on get_slot — keep the day-scope subtraction current.
          if (slot.today) {
            const freshToday = slot.today;
            setState((prev) => (prev ? { ...prev, today: freshToday } : prev));
          }
          setScheduledByMeal((prev) => ({ ...prev, [next]: slot.scheduledIds }));
          const saved = savedSelectionsRef.current[next];
          if (saved) {
            // Round-trip: restore what the closer had for this meal.
            setSelectedIds(saved.ids);
            setTouchedFields((prev) => {
              const restored = new Set(prev);
              if (saved.touched) restored.add("people");
              else restored.delete("people");
              return restored;
            });
          } else {
            // First visit: a different shift means a different crew — seed
            // from that meal's schedule (the closer can still adjust).
            setSelectedIds(slot.scheduledIds);
            setPickPersonWarning(false);
            setTouchedFields((prev) => {
              if (!prev.has("people")) return prev;
              const cleared = new Set(prev);
              cleared.delete("people");
              return cleared;
            });
          }
        }
      } catch (error) {
        if (isSessionInvalid(error)) {
          clearSession();
          router.replace("/");
          return;
        }
        // Couldn't confirm the slot: stay on the meal we know about instead
        // of showing the previous meal's crew under the new tab.
        setMeal(meal);
      } finally {
        setSlotLoading(false);
      }
    },
    [session, meal, slotLoading, disabledMeals, selectedIds, touchedFields, router],
  );

  /** A slot came back already-recorded from the server: lock it here too. */
  const applyAlreadyRecorded = useCallback(
    (recordedMeal: MealPeriod) => {
      setDisabledMeals((prev) => {
        const next = prev.includes(recordedMeal) ? prev : [...prev, recordedMeal];
        if (next.length >= 2) setAllDone(true);
        return next;
      });
      const other: MealPeriod = recordedMeal === "lunch" ? "dinner" : "lunch";
      setMeal((current) => (current === recordedMeal ? other : current));
      // Re-fetch and re-apply the whole preset: another device may have
      // recorded BOTH shifts since we loaded (all-done, not just this lock).
      if (session) {
        void fetchState(session.token)
          .then((fresh) => {
            setState(fresh);
            const preset = mealPreset(fresh.today);
            setDisabledMeals(preset.disabled);
            setAllDone(preset.allRecorded);
            setMeal((current) =>
              preset.disabled.includes(current) && preset.meal
                ? preset.meal
                : current,
            );
          })
          .catch(() => undefined);
      }
    },
    [session],
  );

  const doSave = useCallback(
    async (payload: SavePayload) => {
      if (!session || saveInFlightRef.current) return;
      saveInFlightRef.current = true;
      lastPayloadRef.current = payload;
      setSaving(true);
      setSaveError(null);
      try {
        const result = await saveEntry(session.token, payload);
        if (result.anomaly) {
          setPendingAnomaly({ payload, anomaly: result.anomaly });
          return;
        }
        setPendingAnomaly(null);
        setVoiceMeta(null);
        setSavedEntry(result.entry);
        setSavedPayload(payload);
      } catch (error) {
        if (isSessionInvalid(error)) {
          clearSession();
          router.replace("/");
          return;
        }
        const duplicate = isAlreadyRecorded(error);
        if (duplicate) applyAlreadyRecorded(payload.meal);
        setSaveError({
          message:
            error instanceof TipApiError
              ? error.message
              : "Something went wrong. Try again.",
          // No retry for a duplicate slot — the shift is locked instead.
          retryable: !duplicate,
        });
      } finally {
        saveInFlightRef.current = false;
        setSaving(false);
      }
    },
    [session, router, applyAlreadyRecorded],
  );

  // Blank gratuity is legal and means $0 — only a half-typed "." is invalid.
  const amountsValid =
    isValidAmount(cash) &&
    isValidAmount(card) &&
    (gratuity === "" || isValidAmount(gratuity));

  // Day-scope derivation drives the live receipt and the one blocking
  // warning. The server recomputes all of this on save and is authoritative.
  const typedAmounts: MealAmounts = {
    cash: isValidAmount(cash) ? Number(cash) : 0,
    card: isValidAmount(card) ? Number(card) : 0,
    gratuity: isValidAmount(gratuity) ? Number(gratuity) : 0,
  };
  const lunchAmounts = state?.today.lunch ?? null;
  const effectiveScope: EnteredScope = meal === "dinner" ? scope : "shift";
  const { derived: derivedAmounts } = deriveShiftAmounts(
    typedAmounts,
    effectiveScope,
    lunchAmounts,
  );
  const negativeAfterLunch = hasNegativeAmount(derivedAmounts);

  const poolCents = Math.max(0, toCents(derivedAmounts.cash));
  // Allocation order is the ROSTER order (sort_order, name — the same rule
  // the dashboard ranks by), not tap order: largest-remainder ties break by
  // position, so every surface must order the split identically or the odd
  // cent lands on different people on different screens.
  const orderedSelectedIds = useMemo(() => {
    const selected = new Set(selectedIds);
    return state
      ? state.roster.filter((person) => selected.has(person.id)).map((person) => person.id)
      : selectedIds;
  }, [state, selectedIds]);
  const selectedWeights = orderedSelectedIds.map((id) => weightById[id] ?? 1);
  // A meal switch in flight still has the previous meal's amounts and crew.
  // Block saves until the requested slot has been applied.
  const canSave =
    amountsValid &&
    !negativeAfterLunch &&
    selectedIds.length > 0 &&
    !saving &&
    !slotLoading;

  // Plain functions (no manual memoization) — the React Compiler handles
  // these; nesting them in useCallback fights its dependency analysis.
  const buildPayload = (
    base: Pick<
      SavePayload,
      | "meal"
      | "cash"
      | "card"
      | "peopleIds"
      | "entryMethod"
      | "voiceVariant"
      | "correctionsCount"
    >,
  ): SavePayload => {
    // Same canonical roster ordering as the live allocation above, so the
    // saved screen, the server, and the dashboard all see one split order.
    const picked = new Set(base.peopleIds);
    const peopleIds = state
      ? state.roster.filter((person) => picked.has(person.id)).map((person) => person.id)
      : base.peopleIds;
    return {
      ...base,
      peopleIds,
      // All three amounts go AS TYPED — the server does the subtraction.
      gratuity: isValidAmount(gratuity) ? Number(gratuity) : 0,
      enteredScope: base.meal === "dinner" ? scope : "shift",
      weights: peopleIds.map((id) => weightById[id] ?? 1),
      note,
      confirmAnomaly: false,
    };
  };

  const handleSaveClick = () => {
    if (selectedIds.length === 0) {
      setPickPersonWarning(true);
      return;
    }
    if (!amountsValid || negativeAfterLunch || saving || slotLoading) return;
    void doSave(
      buildPayload({
        meal,
        cash: Number(cash),
        card: Number(card),
        peopleIds: selectedIds,
        entryMethod: voiceMeta ? "voice" : "typed",
        voiceVariant: voiceMeta?.variant ?? null,
        correctionsCount: voiceMeta ? voiceMeta.corrections + postVoiceEdits.size : 0,
      }),
    );
  };

  const handleVoiceApply = (result: VoiceApplyResult) => {
    setShowVoice(false);
    setMeal(result.meal);
    setCash(result.cash);
    setCard(result.card);
    setSelectedIds(result.peopleIds);
    setPickPersonWarning(false);
    setVoiceMeta({
      variant: result.variant,
      corrections: result.correctionsCount,
    });
    setPostVoiceEdits(new Set());
    // Voice may have switched the shift without going through changeMeal.
    // Confirm that slot with the server so the day-scope subtraction uses
    // today's recorded lunch and a slot saved meanwhile locks here too.
    if (result.meal !== meal && session) {
      const token = session.token;
      void getSlot(token, result.meal)
        .then((slot) => {
          if (slot.entry) {
            applyAlreadyRecorded(result.meal);
            return;
          }
          if (slot.today) {
            const freshToday = slot.today;
            setState((prev) => (prev ? { ...prev, today: freshToday } : prev));
          }
          setScheduledByMeal((prev) => ({ ...prev, [result.meal]: slot.scheduledIds }));
        })
        .catch((error: unknown) => {
          if (isSessionInvalid(error)) {
            clearSession();
            router.replace("/");
          }
        });
    }
    // Voice fills cash/card/people only; the typed gratuity, scope, weights
    // and note stay as they were. Nothing is saved yet: the closer still
    // hands out the cash in person, so bring the split into view and let
    // them press Save once it looks right.
    window.setTimeout(() => {
      splitRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };

  const markTouched = useCallback((field: "cash" | "card" | "people") => {
    setTouchedFields((prev) =>
      prev.has(field) ? prev : new Set(prev).add(field),
    );
    setPostVoiceEdits((prev) =>
      prev.has(field) ? prev : new Set(prev).add(field),
    );
  }, []);

  const handleCashChange = useCallback(
    (value: string) => {
      setCash(value);
      markTouched("cash");
    },
    [markTouched],
  );

  const handleCardChange = useCallback(
    (value: string) => {
      setCard(value);
      markTouched("card");
    },
    [markTouched],
  );

  const handleGratuityChange = useCallback((value: string) => {
    setGratuity(value);
  }, []);

  const togglePerson = useCallback(
    (id: string) => {
      setPickPersonWarning(false);
      markTouched("people");
      setSelectedIds((prev) =>
        prev.includes(id)
          ? prev.filter((existing) => existing !== id)
          : [...prev, id],
      );
    },
    [markTouched],
  );

  /** Cycle a selected person's share badge: 100 → 75 → 50 → 25 → 100. */
  const cycleWeight = useCallback((id: string) => {
    setWeightById((prev) => ({ ...prev, [id]: nextWeight(prev[id] ?? 1) }));
  }, []);

  // Scheduled people sort first for the current meal; unscheduled staff sink
  // to the bottom. Stable sort keeps the server's sort_order/name order
  // within each group.
  const displayRoster = useMemo(() => {
    if (!state) return [];
    const scheduled = new Set(scheduledByMeal[meal] ?? []);
    return [...state.roster].sort(
      (a, b) => Number(scheduled.has(b.id)) - Number(scheduled.has(a.id)),
    );
  }, [state, scheduledByMeal, meal]);

  // Recorded shifts are locked; while editing a just-saved shift the other
  // one locks too (one scan, one shift).
  const lockedMeals: MealPeriod[] = editingSavedMeal
    ? [...new Set<MealPeriod>([...disabledMeals, editingSavedMeal === "lunch" ? "dinner" : "lunch"])]
    : disabledMeals;

  if (loading) {
    return (
      <main className="max-w-md mx-auto px-5 min-h-dvh flex items-center justify-center">
        <p className="text-ink3">Loading…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="max-w-md mx-auto px-5 min-h-dvh flex items-center justify-center">
        <div className="bg-card rounded-card p-5 w-full text-center">
          <p className="text-ink2">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setLoadError(null);
              void runInit().then(applyInit);
            }}
            className="mt-4 rounded-full px-6 py-3 font-semibold bg-accent text-white"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!session || !state) return null;

  if (savedPayload) {
    return (
      <SavedScreen
        payload={savedPayload}
        entry={savedEntry}
        lunch={lunchAmounts}
        locationName={state.location.name}
        businessDate={state.today.businessDate}
        splitNames={savedPayload.peopleIds
          .map(
            (id) =>
              state.roster
                .find((person) => person.id === id)
                ?.name.trim()
                .split(/\s+/)[0] ?? "",
          )
          .filter(Boolean)}
        onFinished={finishSession}
        onEdit={() => {
          setEditingSavedMeal(savedPayload.meal);
          setSavedPayload(null);
          setSavedEntry(null);
        }}
      />
    );
  }

  if (allDone) {
    return (
      <AllDoneScreen
        locationName={state.location.name}
        businessDate={state.today.businessDate}
        onFinished={finishSession}
      />
    );
  }

  return (
    <main className="max-w-md mx-auto px-5 min-h-dvh flex flex-col">
      <div className="flex-1 space-y-4 pt-6">
        {/* Header */}
        <header className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-ink">Tips</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className="bg-card rounded-full px-3 py-1.5 text-sm text-ink">
              {formatBusinessDate(state.today.businessDate)}
            </span>
            <button
              type="button"
              onClick={() => router.push("/closer")}
              className="bg-card rounded-full px-3 py-1.5 text-sm text-ink flex items-center gap-1.5"
            >
              <Avatar name={session.closerName ?? ""} size={20} />
              {session.closerName}
            </button>
          </div>
        </header>

        {/* Location: a pill the size of the date and closer chips. */}
        <button
          type="button"
          onClick={() => setShowLocationDialog(true)}
          className="bg-card rounded-full px-3 py-1.5 text-sm text-ink inline-flex items-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden />
          <span className="font-semibold">{state.location.name}</span>
          <span className="text-ink3">
            <ChevronRightIcon size={14} />
          </span>
        </button>

        {/* Meal segmented — time-of-day preset, recorded shifts locked. */}
        <Segmented
          options={MEAL_OPTIONS}
          value={meal}
          onChange={(next) => void changeMeal(next)}
          disabled={slotLoading}
          disabledValues={lockedMeals}
          disabledHints={{
            lunch: disabledMeals.includes("lunch")
              ? "Lunch is already recorded for today."
              : "Scan the QR code again to enter lunch.",
            dinner: disabledMeals.includes("dinner")
              ? "Dinner is already recorded for today."
              : "Scan the QR code again to enter dinner.",
          }}
        />

        {/* Amounts */}
        <div className="bg-card rounded-card p-4">
          {/* Scope sits directly above the wells with no label over it —
              dinner only. Lunch always records what was typed. */}
          {meal === "dinner" && (
            <div className="mb-3">
              <ScopeSwitch value={scope} onChange={setScope} disabled={saving} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <AmountWell label="Cash" value={cash} onChange={handleCashChange} compact />
            <AmountWell label="Card" value={card} onChange={handleCardChange} compact />
            <AmountWell
              label="Gratuity"
              value={gratuity}
              onChange={handleGratuityChange}
              compact
              hint="Leave gratuity blank on a night with no large parties."
            />
          </div>
          {meal === "dinner" && (
            <div className="mt-3 grid gap-1 border-t border-dashed border-line pt-2.5 text-sm tabular-nums">
              <div className="flex text-ink2">
                <span>
                  {scope === "day" ? "Entered (whole day)" : "Entered (dinner only)"}
                </span>
                <span className="ml-auto font-semibold text-ink">
                  {formatMoney(enteredTotal(typedAmounts))}
                </span>
              </div>
              {scope === "day" && (
                <div className="flex text-ink2">
                  <span>Lunch amount</span>
                  <span className="ml-auto font-semibold text-alert">
                    &minus;
                    {formatMoney(
                      lunchAmounts ? enteredTotal(lunchAmounts) : 0,
                    )}
                  </span>
                </div>
              )}
              <div className="mt-0.5 flex border-t border-line pt-1.5 font-extrabold text-ink">
                <span>Dinner records</span>
                <span className="ml-auto text-base">
                  {formatMoney(enteredTotal(derivedAmounts))}
                </span>
              </div>
            </div>
          )}
          {/* The one warning the entry screen ever shows. A whole-day dinner
              with no lunch on record says NOTHING here — it saves flagged
              for the manager. */}
          {negativeAfterLunch && (
            <div className="mt-3 rounded-well bg-tint p-3 text-sm text-alert">
              Lunch already recorded more than this. Check the Square report.{" "}
              <b>Save is off until this is fixed.</b>
            </div>
          )}
        </div>

        {/* Roster */}
        <div className="bg-card rounded-card p-4">
          <div className="flex items-center gap-1.5">
            <div className="section-label">Who&apos;s splitting</div>
            <InfoButton label="About splitting">
              Tap a name to add or remove them. Tap the % badge on a selected name to
              give them a smaller share.
            </InfoButton>
          </div>
          <div className="mt-3">
            <RosterChips
              roster={displayRoster}
              selectedIds={selectedIds}
              onToggle={togglePerson}
              weights={weightById}
              onCycleWeight={cycleWeight}
            />
          </div>
          {pickPersonWarning && (
            <p className="mt-3 text-alert text-sm">Pick at least one person</p>
          )}
        </div>

        {/* Renders only when at least one share is under 100%. */}
        <PayoutList
          people={orderedSelectedIds.map((id, index) => ({
            id,
            name:
              displayRoster.find((person) => person.id === id)?.name ?? "?",
            weight: selectedWeights[index] ?? 1,
            cents: allocatePoolCents(poolCents, selectedWeights)[index] ?? 0,
          }))}
        />

        <div ref={splitRef}>
          <SplitStrip poolCents={poolCents} weights={selectedWeights} />
        </div>

        <NoteField note={note} onChange={setNote} />
      </div>

      {/* Sticky bottom bar */}
      <div className="sticky bottom-0 bg-cream pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {saveError && (
          <div className="mb-3 bg-tint text-alert rounded-well p-3 flex items-center gap-3">
            <span className="text-sm flex-1">{saveError.message}</span>
            {saveError.retryable && (
              <button
                type="button"
                onClick={() => {
                  const payload = lastPayloadRef.current;
                  if (payload) void doSave(payload);
                }}
                className="bg-card text-ink rounded-full px-4 py-2 text-sm font-semibold shrink-0"
              >
                Retry
              </button>
            )}
          </div>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setShowVoice(true)}
            className="flex-[1.4] bg-accent text-white rounded-full py-4 font-semibold flex items-center justify-center gap-2"
          >
            <MicIcon />
            Speak it in
          </button>
          {/* Kept tappable when only people are missing so the zero-people
              guard can surface "Pick at least one person" instead of
              silently doing nothing. */}
          <button
            type="button"
            disabled={saving || slotLoading || !amountsValid || negativeAfterLunch}
            onClick={handleSaveClick}
            className={`flex-1 rounded-full py-4 font-semibold ${
              canSave ? "bg-card text-ink" : "bg-disabled text-white"
            }`}
          >
            Save →
          </button>
        </div>
      </div>

      {/* Location-switch info */}
      <ConfirmDialog
        open={showLocationDialog}
        title="Switch location"
        body="Switching location means scanning that location's QR code. This phone will sign out first."
        confirmLabel="Sign out & scan"
        cancelLabel="Stay here"
        // A save in flight must land (and show its confirmation) before the
        // session can be ended from here.
        confirmDisabled={saving}
        onConfirm={() => {
          setShowLocationDialog(false);
          finishSession();
        }}
        onCancel={() => setShowLocationDialog(false)}
      />

      {/* Anomaly confirm */}
      <ConfirmDialog
        open={pendingAnomaly !== null}
        title="Double-checking"
        body={
          pendingAnomaly
            ? `${anomalyMessage(
                pendingAnomaly.anomaly,
                state.location.name,
                pendingAnomaly.payload.meal,
              )} Save anyway?`
            : ""
        }
        confirmLabel="Save anyway"
        cancelLabel="Go back"
        confirmDisabled={saving}
        onConfirm={() => {
          const pending = pendingAnomaly;
          if (!pending) return;
          setPendingAnomaly(null);
          void doSave({ ...pending.payload, confirmAnomaly: true });
        }}
        onCancel={() => setPendingAnomaly(null)}
      />

      {/* Voice sheet */}
      {showVoice && (
        <VoiceSheet
          sessionToken={session.token}
          locationName={state.location.name}
          roster={displayRoster}
          initialMeal={meal}
          disabledMeals={disabledMeals}
          initialCash={cash}
          initialCard={card}
          initialPeopleIds={selectedIds}
          userTouched={{
            cash: touchedFields.has("cash"),
            card: touchedFields.has("card"),
            people: touchedFields.has("people"),
          }}
          onCancel={() => setShowVoice(false)}
          onApply={handleVoiceApply}
        />
      )}
    </main>
  );
}
