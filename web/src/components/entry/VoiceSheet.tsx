"use client";

// Bottom sheet for voice tip entry. Listens continuously, sends a chunk to
// tip-voice-parse after each speech pause, and fills a five-row checklist
// (Location, Shift, Cash, Card, People). Every field stays editable by tap.
// "Done talking" moves to a review state with low-confidence flags and
// per-field re-record; "Save tips" hands the values back to the entry form.
//
// Engines: where the browser supports native SpeechRecognition (variant
// "local_live"), words are transcribed ON DEVICE and parsed locally — fields
// fill while you're still talking, no network in the loop. Elsewhere (or if
// recognition breaks mid-session) the original Gemini chunk pipeline runs:
// A/B variant "waveform" shows a level waveform, "live_transcript" streams
// PCM over a WebSocket for a rolling transcript pill (session.ts).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  parseVoiceChunk,
  requestVoiceStreamUrl,
  type RosterPerson,
} from "@/lib/tips/api";
import { formatMoney } from "@/lib/tips/format";
import {
  LOW_CONFIDENCE,
  emptyFields,
  mergeParsed,
  setTyped,
  setTypedPeople,
  type TargetField,
  type TipFieldsState,
} from "@/lib/tips/merge";
import { parseLocalUtterance, type KnownFieldState } from "@/lib/tips/localVoiceParse";
import { TipRecorder } from "@/lib/tips/recorder";
import { getVoiceVariant } from "@/lib/tips/session";
import { LiveSpeech } from "@/lib/tips/speech";
import type { MealPeriod, VoiceVariant } from "@/types/database";
import { AmountWell, isValidAmount } from "./AmountWell";
import { LiveTranscript } from "./LiveTranscript";
import { RosterChips } from "./RosterChips";
import { Segmented } from "./Segmented";
import { Waveform } from "./Waveform";

export interface VoiceApplyResult {
  meal: MealPeriod;
  cash: string;
  card: string;
  peopleIds: string[];
  correctionsCount: number;
  variant: VoiceVariant;
}

type Phase = "listening" | "review";
type RowKey = "location" | "meal" | "cash" | "card" | "people";

const MEAL_OPTIONS = [
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
] as const;

const WAITING_TEXT: Record<Exclude<RowKey, "location">, string> = {
  meal: "Waiting — say the shift",
  cash: "Waiting — say the cash amount",
  card: "Waiting — say the card amount",
  people: "Waiting — say the names",
};

const ROW_LABELS: Record<RowKey, string> = {
  location: "Location",
  meal: "Shift",
  cash: "Cash",
  card: "Card",
  people: "People",
};

function MicIcon({ size = 18 }: { size?: number }) {
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
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  );
}

function CheckIcon({ size = 12 }: { size?: number }) {
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

function StopIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function VoiceSheet({
  sessionToken,
  locationName,
  roster,
  initialMeal,
  disabledMeals = [],
  initialCash,
  initialCard,
  initialPeopleIds,
  userTouched,
  onCancel,
  onApply,
}: {
  sessionToken: string;
  locationName: string;
  roster: RosterPerson[];
  initialMeal: MealPeriod;
  /** Shifts already recorded today — voice can't switch to them. */
  disabledMeals?: MealPeriod[];
  initialCash: string;
  initialCard: string;
  initialPeopleIds: string[];
  /** Fields the user edited by hand this visit — locked against voice.
   *  Merely prefilled values (loaded from a saved slot) stay overwritable. */
  userTouched: { cash: boolean; card: boolean; people: boolean };
  onCancel: () => void;
  onApply: (result: VoiceApplyResult) => void;
}) {
  // Local-first: native speech recognition parses on device (instant fills);
  // the Gemini chunk pipeline is the fallback when it's unsupported/broken.
  const [engine, setEngine] = useState<"local" | "gemini">(() =>
    LiveSpeech.isSupported() ? "local" : "gemini",
  );
  const [abVariant] = useState<VoiceVariant>(() => getVoiceVariant());
  const variant: VoiceVariant = engine === "local" ? "local_live" : abVariant;

  const buildInitialFields = useCallback((): TipFieldsState => {
    let fields = emptyFields();
    fields = {
      ...fields,
      meal: { value: initialMeal, confidence: 0.6, source: null },
    };
    // User-edited values seed as typed (voice can't overwrite); prefilled
    // values seed captured but unlocked so re-speaking them still works.
    if (isValidAmount(initialCash)) {
      fields = userTouched.cash
        ? setTyped(fields, "cash", Number(initialCash))
        : {
            ...fields,
            cash: { value: Number(initialCash), confidence: 0.9, source: null },
          };
    }
    if (isValidAmount(initialCard)) {
      fields = userTouched.card
        ? setTyped(fields, "card", Number(initialCard))
        : {
            ...fields,
            card: { value: Number(initialCard), confidence: 0.9, source: null },
          };
    }
    if (initialPeopleIds.length > 0) {
      const names: Record<string, string> = {};
      for (const id of initialPeopleIds) {
        const person = roster.find((r) => r.id === id);
        if (person) names[id] = person.name;
      }
      fields = userTouched.people
        ? setTypedPeople(fields, initialPeopleIds, names)
        : {
            ...fields,
            people: {
              ids: initialPeopleIds,
              names,
              unmatched: [],
              confidence: 0.9,
              source: null,
            },
          };
    }
    return fields;
  }, [initialMeal, initialCash, initialCard, initialPeopleIds, roster, userTouched]);

  const [fields, setFieldsState] = useState<TipFieldsState>(buildInitialFields);
  const fieldsRef = useRef(fields);
  /** State setter that keeps fieldsRef in sync for the async chunk queue. */
  const setFields = useCallback(
    (updater: (prev: TipFieldsState) => TipFieldsState) => {
      setFieldsState((prev) => {
        const next = updater(prev);
        fieldsRef.current = next;
        return next;
      });
    },
    [],
  );

  const [phase, setPhase] = useState<Phase>("listening");
  const [transcript, setTranscript] = useState("");
  const [corrections, setCorrections] = useState(0);
  const [level, setLevel] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [wsDead, setWsDead] = useState(false);
  const [micError, setMicError] = useState(false);
  const [voiceBroken, setVoiceBroken] = useState(false);
  const [parseWarning, setParseWarning] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [epoch, setEpoch] = useState(0);

  // Inline row editing.
  const [editingRow, setEditingRow] = useState<RowKey | null>(null);
  const [editValue, setEditValue] = useState("");
  const [locationHint, setLocationHint] = useState(false);
  const [mealLockedHint, setMealLockedHint] = useState<MealPeriod | null>(null);
  const peopleEditWasVoiceRef = useRef(false);

  // Targeted re-record (review state).
  const [rerecordField, setRerecordField] = useState<TargetField | null>(null);
  const rerecordRecorderRef = useRef<TipRecorder | null>(null);

  const recorderRef = useRef<TipRecorder | null>(null);
  const speechRef = useRef<LiveSpeech | null>(null);
  const rerecordSpeechRef = useRef<LiveSpeech | null>(null);
  /** Fields as they stood before the in-flight utterance began — every
   *  interim update re-merges the whole utterance against this base, so
   *  mid-utterance revisions by the recognizer converge cleanly. */
  const utteranceBaseRef = useRef<TipFieldsState | null>(null);
  /** Amount field voice touched last — target of a bare "actually seventy". */
  const lastAmountFieldRef = useRef<"cash" | "card" | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const parseErrorsRef = useRef(0);
  const disposedRef = useRef(false);
  /** Bumped on "Redo all" so parses still in flight can't merge into the
   *  fresh session's fields. */
  const generationRef = useRef(0);
  const levelThrottleRef = useRef(0);

  const closeWs = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send("__finish__");
    } catch {
      // Socket already dead; nothing to flush.
    }
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }, []);

  /**
   * Local engine: merge one utterance (interim or final) into the fields.
   * Runs synchronously on every recognition update — this is what makes
   * "say fifty, watch it land" instant.
   */
  const applyLocalUtterance = useCallback(
    (text: string, isFinal: boolean, targetField: TargetField | null = null) => {
      if (disposedRef.current) return;
      const base = utteranceBaseRef.current ?? fieldsRef.current;
      utteranceBaseRef.current = base;
      const known: KnownFieldState = {
        cash: base.cash.value,
        card: base.card.value,
        lastAmountField: lastAmountFieldRef.current,
        people: base.people.ids.map((id) => ({
          id,
          name: base.people.names[id] ?? "",
        })),
      };
      const parsed = parseLocalUtterance(text, roster, known);
      if (parsed.card.value !== null) lastAmountFieldRef.current = "card";
      else if (parsed.cash.value !== null) lastAmountFieldRef.current = "cash";
      setFields((prev) => {
        const merged = mergeParsed(base, parsed, targetField);
        // Keep typed edits that landed mid-utterance: merge rules already
        // guard them because base captured their "typed" source.
        void prev;
        if (
          merged.meal.value !== null &&
          merged.meal.value !== base.meal.value &&
          disabledMeals.includes(merged.meal.value)
        ) {
          setMealLockedHint(merged.meal.value);
          return { ...merged, meal: base.meal };
        }
        return merged;
      });
      if (isFinal) {
        utteranceBaseRef.current = null;
        const spoken = text.trim();
        if (spoken) {
          setTranscript((prevT) => (prevT ? `${prevT} ${spoken}` : spoken));
        }
        setLiveText("");
      } else {
        setLiveText(text);
      }
    },
    [roster, disabledMeals, setFields],
  );

  /** A manual edit mid-utterance re-bases the merge on the edited fields. */
  const rebaseUtterance = useCallback(() => {
    utteranceBaseRef.current = null;
  }, []);

  /**
   * Sequential chunk queue: each blob waits for the previous parse before it
   * is sent, so "later speech wins" merges apply in spoken order. Errors are
   * swallowed per-item so the chain never sticks in a rejected state.
   */
  const enqueueChunk = useCallback(
    (blob: Blob, targetField: TargetField | null = null): Promise<void> => {
      const generation = generationRef.current;
      queueRef.current = queueRef.current.then(async () => {
        if (disposedRef.current || generation !== generationRef.current) return;
        setInFlight((n) => n + 1);
        try {
          const current = fieldsRef.current;
          const response = await parseVoiceChunk({
            sessionToken,
            audio: blob,
            knownState: {
              meal: current.meal.value,
              cash: current.cash.value,
              card: current.card.value,
              people: Object.values(current.people.names),
            },
            targetField,
          });
          if (disposedRef.current || generation !== generationRef.current) return;
          setFields((prev) => {
            const merged = mergeParsed(prev, response.fields, targetField);
            // A shift that is already recorded today can't be re-entered —
            // hold the previous meal and tell the speaker why.
            if (
              merged.meal.value !== null &&
              merged.meal.value !== prev.meal.value &&
              disabledMeals.includes(merged.meal.value)
            ) {
              setMealLockedHint(merged.meal.value);
              return { ...merged, meal: prev.meal };
            }
            return merged;
          });
          const spoken = response.rawTranscript.trim();
          if (spoken) {
            setTranscript((prev) => (prev ? `${prev} ${spoken}` : spoken));
          }
          parseErrorsRef.current = 0;
        } catch {
          if (disposedRef.current || generation !== generationRef.current) return;
          parseErrorsRef.current += 1;
          setParseWarning(true);
          if (parseErrorsRef.current >= 3) setVoiceBroken(true);
        } finally {
          // An orphaned item's increment was already wiped by "Redo all"'s
          // setInFlight(0) — decrementing again would undercount a fresh chunk.
          if (generation === generationRef.current) {
            setInFlight((n) => Math.max(0, n - 1));
          }
        }
      });
      return queueRef.current;
    },
    [sessionToken, setFields, disabledMeals],
  );

  // Main capture. Local engine: native SpeechRecognition, zero network.
  // Gemini engine: recorder + chunk queue (+ variant B transcript WS).
  // Re-runs on "Redo all" via the epoch counter and on engine fallback.
  useEffect(() => {
    let cancelled = false;
    disposedRef.current = false;

    if (engine === "local") {
      const speech = new LiveSpeech();
      speechRef.current = speech;
      speech.start({
        onUtterance: (text, isFinal) => {
          if (!cancelled) applyLocalUtterance(text, isFinal);
        },
        onError: (kind) => {
          if (cancelled) return;
          if (kind === "permission") {
            setMicError(true);
            return;
          }
          // Recognition engine gave up — hand the session to the Gemini
          // pipeline with all captured fields intact.
          setEngine("gemini");
        },
      });
      return () => {
        cancelled = true;
        speech.stop();
        speechRef.current = null;
      };
    }

    const recorder = new TipRecorder();
    recorderRef.current = recorder;

    if (variant === "live_transcript") {
      // The stream URL needs a single-use ticket first; if the sheet is
      // cancelled or unmounted while that request is in flight, never open
      // the socket.
      requestVoiceStreamUrl(sessionToken)
        .then((url) => {
          if (cancelled) return;
          const ws = new WebSocket(url);
          wsRef.current = ws;
          ws.onmessage = (event) => {
            if (cancelled || typeof event.data !== "string") return;
            try {
              const message = JSON.parse(event.data) as {
                type?: string;
                text?: string;
              };
              if (
                message.type === "partial_transcript" &&
                typeof message.text === "string" &&
                message.text.trim()
              ) {
                const text = message.text.trim();
                setLiveText((prev) => (prev ? `${prev} ${text}` : text));
              }
            } catch {
              // Non-JSON frame; ignore.
            }
          };
          // Streaming failures never block field capture — fall back silently.
          ws.onerror = () => {
            if (!cancelled) setWsDead(true);
          };
          ws.onclose = () => {
            if (!cancelled) setWsDead(true);
          };
        })
        .catch(() => {
          // Ticket request or socket open failed; streaming failure only
          // downgrades the header feedback, never blocks capture.
          if (!cancelled) setWsDead(true);
        });
    }

    recorder
      .start(
        {
          onLevel: (value) => {
            if (cancelled) return;
            const now = performance.now();
            if (now - levelThrottleRef.current < 33) return;
            levelThrottleRef.current = now;
            setLevel(value);
          },
          onChunk: (blob) => {
            if (!cancelled) void enqueueChunk(blob);
          },
          onPcm:
            variant === "live_transcript"
              ? (base64) => {
                  const ws = wsRef.current;
                  if (ws && ws.readyState === WebSocket.OPEN) ws.send(base64);
                }
              : undefined,
          onError: () => {
            if (!cancelled) setVoiceBroken(true);
          },
        },
        { pcm: variant === "live_transcript" },
      )
      .catch(() => {
        if (!cancelled) setMicError(true);
      });

    return () => {
      cancelled = true;
      recorder.cancel();
      closeWs();
    };
  }, [epoch, engine, variant, sessionToken, enqueueChunk, applyLocalUtterance, closeWs]);

  // Unmount: make sure any targeted re-record recorder is also released.
  useEffect(
    () => () => {
      disposedRef.current = true;
      rerecordRecorderRef.current?.cancel();
      rerecordRecorderRef.current = null;
      rerecordSpeechRef.current?.stop();
      rerecordSpeechRef.current = null;
    },
    [],
  );

  const handleCancel = useCallback(() => {
    disposedRef.current = true;
    recorderRef.current?.cancel();
    rerecordRecorderRef.current?.cancel();
    speechRef.current?.stop();
    rerecordSpeechRef.current?.stop();
    closeWs();
    onCancel();
  }, [closeWs, onCancel]);

  const handleDone = useCallback(async () => {
    if (finishing) return;
    if (engine === "local") {
      // stop() flushes any pending interim as a final utterance through
      // applyLocalUtterance — review opens on settled values immediately.
      speechRef.current?.stop();
      speechRef.current = null;
      setEditingRow(null);
      setPhase("review");
      return;
    }
    setFinishing(true);
    try {
      const recorder = recorderRef.current;
      const finalBlob = recorder ? await recorder.finish() : null;
      closeWs();
      if (finalBlob) void enqueueChunk(finalBlob);
      // Drain the queue so review opens on settled values.
      await queueRef.current;
    } finally {
      setFinishing(false);
      setEditingRow(null);
      setPhase("review");
    }
  }, [finishing, engine, closeWs, enqueueChunk]);

  const handleRedoAll = useCallback(() => {
    setCorrections((count) => count + 1);
    // Orphan any parse still in flight — it belongs to the old session.
    generationRef.current += 1;
    queueRef.current = Promise.resolve();
    setInFlight(0);
    const fresh = buildInitialFields();
    fieldsRef.current = fresh;
    setFieldsState(fresh);
    setTranscript("");
    setLiveText("");
    setWsDead(false);
    setParseWarning(false);
    setVoiceBroken(false);
    setMealLockedHint(null);
    parseErrorsRef.current = 0;
    setEditingRow(null);
    setLocationHint(false);
    setRerecordField(null);
    rerecordRecorderRef.current?.cancel();
    rerecordRecorderRef.current = null;
    utteranceBaseRef.current = null;
    lastAmountFieldRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
    rerecordSpeechRef.current?.stop();
    rerecordSpeechRef.current = null;
    setPhase("listening");
    setEpoch((value) => value + 1);
  }, [buildInitialFields]);

  // ---- Typing commits (lock the field, count corrections of voice values).

  const commitAmount = useCallback(
    (field: "cash" | "card", raw: string) => {
      const value = isValidAmount(raw) ? Number(raw) : null;
      const previous = fieldsRef.current[field];
      if (previous.source === "voice" && previous.value !== value) {
        setCorrections((count) => count + 1);
      }
      setFields((prev) => setTyped(prev, field, value));
      rebaseUtterance();
      setEditingRow(null);
    },
    [setFields, rebaseUtterance],
  );

  const commitMeal = useCallback(
    (meal: MealPeriod) => {
      if (disabledMeals.includes(meal)) return;
      const previous = fieldsRef.current.meal;
      if (previous.source === "voice" && previous.value !== meal) {
        setCorrections((count) => count + 1);
      }
      setFields((prev) => setTyped(prev, "meal", meal));
      rebaseUtterance();
      setEditingRow(null);
    },
    [setFields, disabledMeals, rebaseUtterance],
  );

  const togglePerson = useCallback(
    (id: string) => {
      if (peopleEditWasVoiceRef.current) {
        setCorrections((count) => count + 1);
        peopleEditWasVoiceRef.current = false;
      }
      const current = fieldsRef.current.people;
      const ids = current.ids.includes(id)
        ? current.ids.filter((existing) => existing !== id)
        : [...current.ids, id];
      const names: Record<string, string> = {};
      for (const personId of ids) {
        const person = roster.find((r) => r.id === personId);
        if (person) names[personId] = person.name;
      }
      // setTypedPeople clears unmatched — manual edit resolves them.
      setFields((prev) => setTypedPeople(prev, ids, names));
      rebaseUtterance();
    },
    [roster, setFields, rebaseUtterance],
  );

  const confirmLowConfidence = useCallback(
    (field: Exclude<RowKey, "location">) => {
      setFields((prev) => {
        if (field === "meal") return { ...prev, meal: { ...prev.meal, confidence: 1 } };
        if (field === "cash") return { ...prev, cash: { ...prev.cash, confidence: 1 } };
        if (field === "card") return { ...prev, card: { ...prev.card, confidence: 1 } };
        return { ...prev, people: { ...prev.people, confidence: 1 } };
      });
    },
    [setFields],
  );

  // ---- Targeted re-record.

  const startRerecord = useCallback(
    async (field: TargetField) => {
      if (rerecordField !== null) return;
      setRerecordField(field);
      if (engine === "local") {
        utteranceBaseRef.current = null;
        const speech = new LiveSpeech();
        rerecordSpeechRef.current = speech;
        speech.start({
          onUtterance: (text, isFinal) => applyLocalUtterance(text, isFinal, field),
          onError: (kind) => {
            rerecordSpeechRef.current = null;
            setRerecordField(null);
            if (kind === "permission") setMicError(true);
            else setVoiceBroken(true);
          },
        });
        return;
      }
      const recorder = new TipRecorder();
      rerecordRecorderRef.current = recorder;
      try {
        await recorder.start({
          onChunk: (blob) => void enqueueChunk(blob, field),
          onError: () => setVoiceBroken(true),
        });
      } catch {
        rerecordRecorderRef.current = null;
        setRerecordField(null);
        setVoiceBroken(true);
      }
    },
    [rerecordField, engine, applyLocalUtterance, enqueueChunk],
  );

  const stopRerecord = useCallback(async () => {
    const field = rerecordField;
    setRerecordField(null);
    if (engine === "local") {
      rerecordSpeechRef.current?.stop();
      rerecordSpeechRef.current = null;
      utteranceBaseRef.current = null;
      if (field) setCorrections((count) => count + 1);
      return;
    }
    const recorder = rerecordRecorderRef.current;
    rerecordRecorderRef.current = null;
    if (!recorder || !field) return;
    const blob = await recorder.finish();
    if (blob) void enqueueChunk(blob, field);
    setCorrections((count) => count + 1);
  }, [rerecordField, engine, enqueueChunk]);

  // ---- Derived checklist state.

  const mealCaptured = fields.meal.value !== null;
  const cashCaptured = fields.cash.value !== null;
  const cardCaptured = fields.card.value !== null;
  const peopleCaptured = fields.people.ids.length > 0;

  const firstEmpty: Exclude<RowKey, "location"> | null = !mealCaptured
    ? "meal"
    : !cashCaptured
      ? "cash"
      : !cardCaptured
        ? "card"
        : !peopleCaptured
          ? "people"
          : null;

  const isLowConfidence = useCallback(
    (field: Exclude<RowKey, "location">): boolean => {
      if (field === "people") {
        return (
          fields.people.source === "voice" &&
          fields.people.ids.length > 0 &&
          fields.people.confidence < LOW_CONFIDENCE
        );
      }
      const state = fields[field];
      return (
        state.source === "voice" &&
        state.value !== null &&
        state.confidence < LOW_CONFIDENCE
      );
    },
    [fields],
  );

  const unresolvedLowConfidence =
    isLowConfidence("meal") ||
    isLowConfidence("cash") ||
    isLowConfidence("card") ||
    isLowConfidence("people");

  const canSave =
    phase === "review" &&
    mealCaptured &&
    cashCaptured &&
    cardCaptured &&
    peopleCaptured &&
    !unresolvedLowConfidence &&
    rerecordField === null &&
    inFlight === 0 &&
    !finishing;

  const handleSave = useCallback(() => {
    const current = fieldsRef.current;
    if (
      current.meal.value === null ||
      current.cash.value === null ||
      current.card.value === null ||
      current.people.ids.length === 0
    ) {
      return;
    }
    disposedRef.current = true;
    closeWs();
    onApply({
      meal: current.meal.value,
      cash: current.cash.value.toFixed(2),
      card: current.card.value.toFixed(2),
      peopleIds: current.people.ids,
      correctionsCount: corrections,
      variant,
    });
  }, [closeWs, onApply, corrections, variant]);

  const peopleDisplay = useMemo(() => {
    return fields.people.ids
      .map((id) => firstName(fields.people.names[id] ?? ""))
      .filter(Boolean)
      .join(", ");
  }, [fields.people]);

  const openEditor = useCallback(
    (row: RowKey) => {
      setLocationHint(false);
      if (row === "location") {
        setLocationHint(true);
        return;
      }
      if (row === "cash" || row === "card") {
        const value = fields[row].value;
        setEditValue(value !== null ? value.toFixed(2) : "");
      }
      if (row === "people") {
        peopleEditWasVoiceRef.current = fields.people.source === "voice";
      }
      setEditingRow(row);
    },
    [fields],
  );

  const handleRowTap = useCallback(
    (row: RowKey) => {
      if (row === "location") {
        setLocationHint((visible) => !visible);
        return;
      }
      if (editingRow === row) return;
      // In review, tapping an unresolved low-confidence row confirms it.
      if (phase === "review" && isLowConfidence(row)) {
        confirmLowConfidence(row);
        return;
      }
      openEditor(row);
    },
    [editingRow, phase, isLowConfidence, confirmLowConfidence, openEditor],
  );

  // ---- Rendering.

  if (micError) {
    return (
      <div className="fixed inset-0 z-40 bg-dim flex items-end justify-center">
        <div className="w-full max-w-md bg-cream rounded-t-sheet max-h-[92dvh] overflow-y-auto">
          <div className="w-10 h-1.5 rounded-full bg-disabled mx-auto mt-3" />
          <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4">
            <div className="bg-card rounded-card p-5 text-ink2">
              Can&apos;t use the mic on this phone — type it in instead.
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="w-full rounded-full py-4 font-semibold bg-card text-ink"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderRow = (row: RowKey) => {
    const label = ROW_LABELS[row];
    const isRerecordingRow = rerecordField === row;
    const captured =
      row === "location"
        ? true
        : row === "meal"
          ? mealCaptured
          : row === "cash"
            ? cashCaptured
            : row === "card"
              ? cardCaptured
              : peopleCaptured;
    // "?" low-confidence flags only apply in the review state; while
    // listening a captured row always reads as captured.
    const low =
      phase === "review" && row !== "location" && isLowConfidence(row);
    const waiting =
      row !== "location" &&
      !captured &&
      (phase === "review" || firstEmpty === row);

    let display: string | null = null;
    if (row === "location") display = locationName;
    else if (row === "meal" && fields.meal.value !== null) {
      display = fields.meal.value === "lunch" ? "Lunch" : "Dinner";
    } else if (row === "cash" && fields.cash.value !== null) {
      display = formatMoney(fields.cash.value);
    } else if (row === "card" && fields.card.value !== null) {
      display = formatMoney(fields.card.value);
    } else if (row === "people" && peopleCaptured) {
      display = peopleDisplay;
    }

    const unmatchedCount = row === "people" ? fields.people.unmatched.length : 0;

    return (
      <div key={row}>
        <button
          type="button"
          onClick={() => handleRowTap(row)}
          className="w-full flex items-center gap-3 py-3.5 px-4 text-left"
        >
          <span
            className={`w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 ${
              isRerecordingRow
                ? "bg-accent text-white"
                : captured && !waiting && !low
                  ? "bg-tint text-accent"
                  : "bg-well"
            }`}
          >
            {isRerecordingRow ? (
              <MicIcon size={12} />
            ) : captured && !low ? (
              <span className="text-accent">
                <CheckIcon />
              </span>
            ) : waiting || low ? (
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            ) : null}
          </span>
          <span className="text-ink2">{label}</span>
          <span className="ml-auto flex items-center gap-2 min-w-0">
            {isRerecordingRow ? (
              <span className="font-semibold text-accent">Listening…</span>
            ) : waiting ? (
              <span className="text-alert text-sm text-right">
                {WAITING_TEXT[row]}
              </span>
            ) : display !== null ? (
              <span key={display} className="value-pop font-semibold text-ink truncate">
                {display}
                {low && <span className="text-alert">?</span>}
                {unmatchedCount > 0 && (
                  <span className="text-alert font-medium">
                    {" "}
                    +{unmatchedCount} unknown
                  </span>
                )}
              </span>
            ) : null}
            {phase === "review" && row !== "location" && (
              <span
                role="button"
                tabIndex={0}
                aria-label={
                  isRerecordingRow ? `Stop re-recording ${label}` : `Re-record ${label}`
                }
                onClick={(event) => {
                  event.stopPropagation();
                  if (isRerecordingRow) void stopRerecord();
                  else void startRerecord(row);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (isRerecordingRow) void stopRerecord();
                    else void startRerecord(row);
                  }
                }}
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  isRerecordingRow ? "bg-accent text-white" : "bg-tint text-accent"
                }`}
              >
                {isRerecordingRow ? <StopIcon /> : <MicIcon size={14} />}
              </span>
            )}
          </span>
        </button>
        {row === "location" && locationHint && (
          <div className="px-4 pb-3 text-ink3 text-sm">
            Signed into {locationName}. Scan that location&apos;s QR code to
            switch.
          </div>
        )}
        {(row === "cash" || row === "card") && editingRow === row && (
          <div className="px-4 pb-4">
            <AmountWell
              label={label}
              value={editValue}
              onChange={setEditValue}
              autoFocus
              onCommit={(value) => commitAmount(row, value)}
            />
          </div>
        )}
        {row === "meal" && editingRow === "meal" && (
          <div className="px-4 pb-4">
            <Segmented
              options={MEAL_OPTIONS}
              value={fields.meal.value}
              onChange={commitMeal}
              compact
              wellTrack
              disabledValues={disabledMeals}
            />
          </div>
        )}
        {row === "people" && editingRow === "people" && (
          <div className="px-4 pb-4">
            <RosterChips
              roster={roster}
              selectedIds={fields.people.ids}
              onToggle={togglePerson}
            />
            {fields.people.unmatched.length > 0 && (
              <p className="mt-2 text-alert text-sm">
                Didn&apos;t recognize: {fields.people.unmatched.join(", ")}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const listening = phase === "listening";

  return (
    <div className="fixed inset-0 z-40 bg-dim flex items-end justify-center">
      <div className="w-full max-w-md bg-cream rounded-t-sheet max-h-[92dvh] overflow-y-auto">
        <div className="w-10 h-1.5 rounded-full bg-disabled mx-auto mt-3" />
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3 min-h-[46px]">
            {listening ? (
              <>
                <span
                  className={`w-[38px] h-[38px] rounded-full bg-accent text-white flex items-center justify-center shrink-0 ${
                    inFlight > 0 ? "animate-pulse" : ""
                  }`}
                >
                  <MicIcon />
                </span>
                <span className="font-semibold text-ink">Listening…</span>
                <div className="flex-1 flex justify-end min-w-0">
                  {variant === "local_live" ? (
                    <LiveTranscript text={liveText} />
                  ) : variant === "waveform" ? (
                    <Waveform level={level} />
                  ) : !wsDead ? (
                    <LiveTranscript text={liveText} />
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <span className="w-[38px] h-[38px] rounded-full bg-tint text-accent flex items-center justify-center shrink-0">
                  <CheckIcon size={16} />
                </span>
                <span className="font-semibold text-ink">Check it</span>
              </>
            )}
          </div>

          {voiceBroken && (
            <div className="bg-tint text-alert rounded-well p-3 text-sm">
              Voice isn&apos;t working right now — your captured fields are
              kept. Tap rows to finish typing.
            </div>
          )}

          {/* Checklist */}
          <div className="bg-card rounded-card divide-y divide-hairline overflow-hidden">
            {(["location", "meal", "cash", "card", "people"] as const).map(
              renderRow,
            )}
          </div>

          {listening ? (
            <div className="bg-card rounded-card p-4 text-ink2 text-sm">
              Speak in any order — it fills in what it hears. Tap any row to
              type it.
            </div>
          ) : (
            transcript && (
              <div className="bg-card rounded-card p-4">
                <div className="section-label">You said</div>
                <p className="mt-2 text-ink2 text-sm max-h-28 overflow-y-auto">
                  {transcript}
                </p>
              </div>
            )
          )}

          {parseWarning && !voiceBroken && (
            <p className="text-alert text-sm">
              Voice is having trouble — captured fields are kept
            </p>
          )}

          {mealLockedHint && (
            <p className="text-alert text-sm">
              {mealLockedHint === "lunch" ? "Lunch" : "Dinner"} is already
              recorded today — keeping{" "}
              {mealLockedHint === "lunch" ? "dinner" : "lunch"}.
            </p>
          )}

          {/* CTAs */}
          {listening ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 rounded-full py-4 font-semibold bg-card text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={finishing}
                onClick={() => void handleDone()}
                className={`flex-[1.4] rounded-full py-4 font-semibold text-white ${
                  finishing ? "bg-disabled" : "bg-accent"
                }`}
              >
                Done talking →
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleRedoAll}
                className="flex-1 rounded-full py-4 font-semibold bg-card text-ink"
              >
                Redo all
              </button>
              <button
                type="button"
                disabled={!canSave}
                onClick={handleSave}
                className={`flex-[1.4] rounded-full py-4 font-semibold text-white ${
                  canSave ? "bg-accent" : "bg-disabled"
                }`}
              >
                Save tips →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
