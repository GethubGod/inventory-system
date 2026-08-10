// Incremental field-merge for the voice sheet checklist. Each speech pause
// sends a chunk to tip-voice-parse; the parsed fields are merged into the
// accumulated state with these rules:
//
//   * A field the user TYPED is locked — voice never overwrites it, unless
//     this parse was an explicit per-field re-record (targetField).
//   * Otherwise, a non-null parsed value with confidence >= MIN_ACCEPT
//     overwrites the current value ("later speech wins", so corrections like
//     "no wait, card was three fifty" apply).
//   * People: the model receives the already-captured people in its context
//     and returns the COMPLETE final list, so a non-empty parsed list
//     replaces the current selection. Unmatched spoken names accumulate for
//     the review screen to resolve.
//   * When targetField is set, only that field is merged.

import type { TipVoiceFields } from "./voiceSchema";

export type FieldSource = "voice" | "typed" | null;
export type TargetField = "meal" | "cash" | "card" | "people";

export interface ScalarFieldState<T> {
  value: T | null;
  confidence: number;
  source: FieldSource;
}

export interface PeopleFieldState {
  /** Selected roster ids. */
  ids: string[];
  /** id -> display name for the checklist row. */
  names: Record<string, string>;
  unmatched: string[];
  confidence: number;
  source: FieldSource;
}

export interface TipFieldsState {
  meal: ScalarFieldState<"lunch" | "dinner">;
  cash: ScalarFieldState<number>;
  card: ScalarFieldState<number>;
  people: PeopleFieldState;
}

export const MIN_ACCEPT_CONFIDENCE = 0.35;
/** Below this, a captured field shows the "?" low-confidence flag in review. */
export const LOW_CONFIDENCE = 0.75;

export function emptyFields(): TipFieldsState {
  return {
    meal: { value: null, confidence: 0, source: null },
    cash: { value: null, confidence: 0, source: null },
    card: { value: null, confidence: 0, source: null },
    people: { ids: [], names: {}, unmatched: [], confidence: 0, source: null },
  };
}

function mergeScalar<T>(
  current: ScalarFieldState<T>,
  parsedValue: T | null,
  parsedConfidence: number,
  isTarget: boolean,
): ScalarFieldState<T> {
  if (parsedValue === null || parsedConfidence < MIN_ACCEPT_CONFIDENCE) {
    return current;
  }
  if (current.source === "typed" && !isTarget) return current;
  return { value: parsedValue, confidence: parsedConfidence, source: "voice" };
}

export function mergeParsed(
  state: TipFieldsState,
  parsed: TipVoiceFields,
  targetField: TargetField | null = null,
): TipFieldsState {
  const applies = (field: TargetField) =>
    targetField === null || targetField === field;

  const next: TipFieldsState = {
    meal: applies("meal")
      ? mergeScalar(
          state.meal,
          parsed.meal.value,
          parsed.meal.confidence,
          targetField === "meal",
        )
      : state.meal,
    cash: applies("cash")
      ? mergeScalar(
          state.cash,
          parsed.cash.value,
          parsed.cash.confidence,
          targetField === "cash",
        )
      : state.cash,
    card: applies("card")
      ? mergeScalar(
          state.card,
          parsed.card.value,
          parsed.card.confidence,
          targetField === "card",
        )
      : state.card,
    people: state.people,
  };

  if (applies("people")) {
    const { matched, unmatched, confidence } = parsed.people;
    const locked = state.people.source === "typed" && targetField !== "people";
    if (!locked && matched.length > 0 && confidence >= MIN_ACCEPT_CONFIDENCE) {
      const names: Record<string, string> = {};
      for (const person of matched) names[person.id] = person.name;
      next.people = {
        ids: matched.map((p) => p.id),
        names,
        unmatched: dedupe([...state.people.unmatched, ...unmatched]),
        confidence,
        source: "voice",
      };
    } else if (unmatched.length > 0) {
      next.people = {
        ...state.people,
        unmatched: dedupe([...state.people.unmatched, ...unmatched]),
      };
    }
  }

  return next;
}

/** Apply a manual (typed) edit; locks the field against voice overwrites. */
export function setTyped<K extends "meal" | "cash" | "card">(
  state: TipFieldsState,
  field: K,
  value: TipFieldsState[K]["value"],
): TipFieldsState {
  return {
    ...state,
    [field]: { value, confidence: 1, source: "typed" as const },
  };
}

export function setTypedPeople(
  state: TipFieldsState,
  ids: string[],
  names: Record<string, string>,
): TipFieldsState {
  return {
    ...state,
    people: { ids, names, unmatched: [], confidence: 1, source: "typed" },
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
