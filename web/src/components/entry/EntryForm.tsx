"use client";

// Main tip-entry screen: date/closer header, location card, Lunch|Dinner
// segmented, cash/card amounts, roster split chips, live split strip, and the
// sticky "Speak it in" / "Save" bar. Voice entry opens the VoiceSheet, whose
// result feeds the same save flow (including the anomaly confirm).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import {
  fetchState,
  getSlot,
  isSessionInvalid,
  saveEntry,
  TipApiError,
  type SavePayload,
  type SessionState,
  type SlotEntry,
} from "@/lib/tips/api";
import { anomalyMessage, type AnomalyResult } from "@/lib/tips/anomaly";
import { formatBusinessDate } from "@/lib/tips/businessDate";
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

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
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

export function EntryForm() {
  const router = useRouter();

  const [session, setSession] = useState<StoredSession | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [meal, setMeal] = useState<MealPeriod>("dinner");
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingExisting, setEditingExisting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingAnomaly, setPendingAnomaly] = useState<{
    payload: SavePayload;
    anomaly: AnomalyResult;
  } | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [pickPersonWarning, setPickPersonWarning] = useState(false);

  const [showVoice, setShowVoice] = useState(false);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [voiceMeta, setVoiceMeta] = useState<VoiceMeta | null>(null);

  const lastPayloadRef = useRef<SavePayload | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySlot = useCallback((entry: SlotEntry | null) => {
    if (entry) {
      setCash(entry.cash.toFixed(2));
      setCard(entry.card.toFixed(2));
      setSelectedIds(entry.peopleIds);
      setEditingExisting(true);
    } else {
      setCash("");
      setCard("");
      setSelectedIds([]);
      setEditingExisting(false);
    }
    setPickPersonWarning(false);
  }, []);

  // Mount/init is split into a pure async step (no state writes) whose
  // outcome is applied in a promise callback — the pattern the repo's landing
  // page uses, and one that keeps setState out of the effect body.
  const runInit = useCallback(async (): Promise<
    | { kind: "redirect"; to: string; clear: boolean }
    | {
        kind: "ready";
        stored: StoredSession;
        fresh: SessionState;
        slot: SlotEntry | null;
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
      const slot = await getSlot(stored.token, fresh.today.defaultMeal);
      return { kind: "ready", stored, fresh, slot: slot.entry };
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
      setSession(outcome.stored);
      setState(outcome.fresh);
      setMeal(outcome.fresh.today.defaultMeal);
      applySlot(outcome.slot);
      setLoadError(null);
      setLoading(false);
    },
    [router, applySlot],
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

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const changeMeal = useCallback(
    async (next: MealPeriod) => {
      if (!session || next === meal || slotLoading) return;
      setMeal(next);
      setSlotLoading(true);
      try {
        const slot = await getSlot(session.token, next);
        applySlot(slot.entry);
      } catch (error) {
        if (isSessionInvalid(error)) {
          clearSession();
          router.replace("/");
          return;
        }
        // Target slot unknown: start it empty rather than showing stale data.
        applySlot(null);
      } finally {
        setSlotLoading(false);
      }
    },
    [session, meal, slotLoading, applySlot, router],
  );

  const doSave = useCallback(
    async (payload: SavePayload) => {
      if (!session) return;
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
        setEditingExisting(true);
        setVoiceMeta(null);
        setShowSaved(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setShowSaved(false), 2000);
        // Refresh today's recorded/default-meal status in the background.
        void fetchState(session.token)
          .then(setState)
          .catch(() => undefined);
      } catch (error) {
        if (isSessionInvalid(error)) {
          clearSession();
          router.replace("/");
          return;
        }
        setSaveError(
          error instanceof TipApiError
            ? error.message
            : "Something went wrong. Try again.",
        );
      } finally {
        setSaving(false);
      }
    },
    [session, router],
  );

  const amountsValid = isValidAmount(cash) && isValidAmount(card);
  const canSave = amountsValid && selectedIds.length > 0 && !saving;

  const handleSaveClick = useCallback(() => {
    if (selectedIds.length === 0) {
      setPickPersonWarning(true);
      return;
    }
    if (!amountsValid || saving) return;
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
  }, [selectedIds, amountsValid, saving, doSave, meal, cash, card, voiceMeta]);

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

  const togglePerson = useCallback((id: string) => {
    setPickPersonWarning(false);
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((existing) => existing !== id)
        : [...prev, id],
    );
  }, []);

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

        {editingExisting && (
          <div className="inline-flex items-center gap-2 bg-tint text-alert rounded-full px-3 py-1.5 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden />
            Already recorded — editing
          </div>
        )}

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

        {/* Meal segmented */}
        <Segmented
          options={MEAL_OPTIONS}
          value={meal}
          onChange={(next) => void changeMeal(next)}
          disabled={slotLoading}
        />

        {/* Amounts */}
        <div className="bg-card rounded-card p-4">
          <div className="grid grid-cols-2 gap-3">
            <AmountWell label="Cash" value={cash} onChange={setCash} />
            <AmountWell label="Card" value={card} onChange={setCard} />
          </div>
        </div>

        {/* Roster */}
        <div className="bg-card rounded-card p-4">
          <div className="section-label">Who&apos;s splitting</div>
          <div className="mt-3">
            <RosterChips
              roster={state.roster}
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
            <span className="text-sm flex-1">{saveError}</span>
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
            disabled={saving || !amountsValid}
            onClick={handleSaveClick}
            className={`flex-1 rounded-full py-4 font-semibold ${
              canSave ? "bg-card text-ink" : "bg-disabled text-white"
            }`}
          >
            Save →
          </button>
        </div>
      </div>

      {/* Saved toast */}
      {showSaved && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-card rounded-full px-4 py-2 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-tint text-accent flex items-center justify-center">
              <CheckIcon />
            </span>
            <span className="font-semibold text-ink">Saved</span>
          </div>
        </div>
      )}

      {/* Location-switch info */}
      <ConfirmDialog
        open={showLocationDialog}
        title="Switch location"
        body="Switching location needs that location's sticker or PIN."
        confirmLabel="Go to PIN entry"
        cancelLabel="Stay here"
        onConfirm={() => {
          setShowLocationDialog(false);
          router.push("/pin");
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
          roster={state.roster}
          initialMeal={meal}
          initialCash={cash}
          initialCard={card}
          initialPeopleIds={selectedIds}
          onCancel={() => setShowVoice(false)}
          onApply={handleVoiceApply}
        />
      )}
    </main>
  );
}
