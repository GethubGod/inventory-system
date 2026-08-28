"use client";

// Main tip-entry screen: date/closer header, location card, Lunch|Dinner
// segmented (time-of-day preset; recorded shifts locked out), cash/card
// amounts, roster split chips, live split strip, and the sticky
// "Speak it in" / "Save" bar. Voice entry opens the VoiceSheet, whose result
// feeds the same save flow (including the anomaly confirm). A successful
// save shows a full-screen confirmation, then ends the session and returns
// to the scan gate — one QR scan per entry.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import {
  endSession,
  fetchState,
  getSlot,
  isAlreadyRecorded,
  isSessionInvalid,
  saveEntry,
  TipApiError,
  type SavePayload,
  type SessionState,
} from "@/lib/tips/api";
import { anomalyMessage, type AnomalyResult } from "@/lib/tips/anomaly";
import { formatBusinessDate } from "@/lib/tips/businessDate";
import { formatMoney } from "@/lib/tips/format";
import { mealPreset } from "@/lib/tips/mealPreset";
import { perPersonShare } from "@/lib/tips/split";
import {
  clearSession,
  loadSession,
  type StoredSession,
} from "@/lib/tips/session";
import type { MealPeriod, VoiceVariant } from "@/types/database";
import { AmountWell, isValidAmount } from "./AmountWell";
import { ConfirmDialog } from "./ConfirmDialog";
import { RosterChips } from "./RosterChips";
import { Segmented } from "./Segmented";
import { SplitStrip } from "./SplitStrip";
import { VoiceSheet, type VoiceApplyResult } from "./VoiceSheet";

const MEAL_OPTIONS = [
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
] as const;

/** How long the saved confirmation lingers before returning to the scan gate. */
const SAVED_SCREEN_MS = 4000;

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

function ChevronRightIcon() {
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
 * Full-screen post-save confirmation. Lingers a few seconds, then ends the
 * session and sends the phone back to the scan gate; "Done" skips the wait.
 */
function SavedScreen({
  payload,
  locationName,
  businessDate,
  splitNames,
  onFinished,
}: {
  payload: SavePayload;
  locationName: string;
  businessDate: string;
  splitNames: string[];
  onFinished: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onFinished, SAVED_SCREEN_MS);
    return () => clearTimeout(timer);
  }, [onFinished]);

  const total = payload.cash + payload.card;
  const count = payload.peopleIds.length;
  // Same cent-exact rounding as the live split strip — float division can
  // disagree with it by a cent (e.g. $100 / 3).
  const perPerson = perPersonShare(payload.cash, payload.card, count);

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
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-well bg-well p-3">
            <div className="section-label">Cash</div>
            <p className="mt-1 text-xl font-bold text-ink">
              {formatMoney(payload.cash)}
            </p>
          </div>
          <div className="rounded-well bg-well p-3">
            <div className="section-label">Card</div>
            <p className="mt-1 text-xl font-bold text-ink">
              {formatMoney(payload.card)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-ink2">
          {count === 1
            ? `${splitNames[0] ?? "1 person"} takes ${formatMoney(total)}`
            : `${count} people · ${formatMoney(perPerson)} each`}
        </p>
        {count > 1 && splitNames.length > 0 && (
          <p className="mt-1 text-sm text-ink3">{splitNames.join(", ")}</p>
        )}
      </div>

      <div className="flex-1" />

      <p className="text-center text-sm text-ink3">
        Signing this phone out&hellip; next entry starts with a scan
      </p>
      <button
        type="button"
        onClick={onFinished}
        className="mt-4 w-full rounded-full bg-card py-4 font-semibold text-ink active:bg-well"
      >
        Done
      </button>
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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
  const [pickPersonWarning, setPickPersonWarning] = useState(false);

  const [showVoice, setShowVoice] = useState(false);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [voiceMeta, setVoiceMeta] = useState<VoiceMeta | null>(null);

  const lastPayloadRef = useRef<SavePayload | null>(null);
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

  const amountsValid = isValidAmount(cash) && isValidAmount(card);
  // slotLoading: a meal switch is mid-flight — saving now would send the NEW
  // meal with the OLD meal's crew (and possibly stale amounts).
  const canSave = amountsValid && selectedIds.length > 0 && !saving && !slotLoading;

  const handleSaveClick = useCallback(() => {
    if (selectedIds.length === 0) {
      setPickPersonWarning(true);
      return;
    }
    if (!amountsValid || saving || slotLoading) return;
    void doSave({
      meal,
      cash: Number(cash),
      card: Number(card),
      peopleIds: selectedIds,
      entryMethod: voiceMeta ? "voice" : "typed",
      voiceVariant: voiceMeta?.variant ?? null,
      correctionsCount: voiceMeta?.corrections ?? 0,
      confirmAnomaly: false,
    });
  }, [selectedIds, amountsValid, saving, slotLoading, doSave, meal, cash, card, voiceMeta]);

  const handleVoiceApply = useCallback(
    (result: VoiceApplyResult) => {
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
      void doSave({
        meal: result.meal,
        cash: Number(result.cash),
        card: Number(result.card),
        peopleIds: result.peopleIds,
        entryMethod: "voice",
        voiceVariant: result.variant,
        correctionsCount: result.correctionsCount,
        confirmAnomaly: false,
      });
    },
    [doSave],
  );

  const markTouched = useCallback((field: "cash" | "card" | "people") => {
    setTouchedFields((prev) =>
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

        {/* Location */}
        <button
          type="button"
          onClick={() => setShowLocationDialog(true)}
          className="w-full bg-card rounded-card p-4 flex items-center gap-3 text-left"
        >
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-hidden />
          <span className="font-semibold text-ink">{state.location.name}</span>
          <span className="ml-auto text-ink3">
            <ChevronRightIcon />
          </span>
        </button>

        {/* Meal segmented — time-of-day preset, recorded shifts locked. */}
        <Segmented
          options={MEAL_OPTIONS}
          value={meal}
          onChange={(next) => void changeMeal(next)}
          disabled={slotLoading}
          disabledValues={disabledMeals}
        />
        {disabledMeals.length === 1 && (
          <p className="text-sm text-ink3">
            {disabledMeals[0] === "lunch" ? "Lunch" : "Dinner"} is already
            recorded today — ask a manager if it needs a fix
          </p>
        )}

        {/* Amounts */}
        <div className="bg-card rounded-card p-4">
          <div className="grid grid-cols-2 gap-3">
            <AmountWell label="Cash" value={cash} onChange={handleCashChange} />
            <AmountWell label="Card" value={card} onChange={handleCardChange} />
          </div>
        </div>

        {/* Roster */}
        <div className="bg-card rounded-card p-4">
          <div className="section-label">Who&apos;s splitting</div>
          <div className="mt-3">
            <RosterChips
              roster={displayRoster}
              selectedIds={selectedIds}
              onToggle={togglePerson}
            />
          </div>
          {pickPersonWarning && (
            <p className="mt-3 text-alert text-sm">Pick at least one person</p>
          )}
        </div>

        <SplitStrip
          cash={isValidAmount(cash) ? Number(cash) : 0}
          card={isValidAmount(card) ? Number(card) : 0}
          count={selectedIds.length}
        />
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
            disabled={saving || slotLoading || !amountsValid}
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
