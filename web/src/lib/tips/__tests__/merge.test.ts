import { describe, expect, it } from "vitest";
import {
  MIN_ACCEPT_CONFIDENCE,
  emptyFields,
  mergeParsed,
  setTyped,
  setTypedPeople,
} from "../merge";
import type { TipVoiceFields } from "../voiceSchema";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

function parsedFixture(overrides: Partial<TipVoiceFields> = {}): TipVoiceFields {
  return {
    meal: { value: null, confidence: 0 },
    cash: { value: null, confidence: 0 },
    card: { value: null, confidence: 0 },
    people: { matched: [], unmatched: [], confidence: 0 },
    ...overrides,
  };
}

describe("mergeParsed scalar fields", () => {
  it("captures a confident parsed value into empty state with source voice", () => {
    const next = mergeParsed(
      emptyFields(),
      parsedFixture({ cash: { value: 120, confidence: 0.9 } }),
    );
    expect(next.cash).toEqual({ value: 120, confidence: 0.9, source: "voice" });
    // Untouched fields stay empty.
    expect(next.card.value).toBeNull();
    expect(next.meal.value).toBeNull();
  });

  it("ignores parsed values below MIN_ACCEPT_CONFIDENCE", () => {
    const next = mergeParsed(
      emptyFields(),
      parsedFixture({
        cash: { value: 120, confidence: MIN_ACCEPT_CONFIDENCE - 0.01 },
      }),
    );
    expect(next.cash.value).toBeNull();
    expect(next.cash.source).toBeNull();
  });

  it("ignores null parsed values so they never clobber captured ones", () => {
    const captured = mergeParsed(
      emptyFields(),
      parsedFixture({ cash: { value: 120, confidence: 0.9 } }),
    );
    const next = mergeParsed(
      captured,
      parsedFixture({ cash: { value: null, confidence: 0.9 } }),
    );
    expect(next.cash.value).toBe(120);
  });

  it("later speech wins: a second confident value replaces the first", () => {
    let state = mergeParsed(
      emptyFields(),
      parsedFixture({ cash: { value: 120, confidence: 0.9 } }),
    );
    state = mergeParsed(
      state,
      parsedFixture({ cash: { value: 350, confidence: 0.8 } }),
    );
    expect(state.cash).toEqual({ value: 350, confidence: 0.8, source: "voice" });
  });

  it("typed fields are locked against voice overwrites", () => {
    let state = setTyped(emptyFields(), "cash", 200);
    state = mergeParsed(
      state,
      parsedFixture({ cash: { value: 999, confidence: 0.99 } }),
    );
    expect(state.cash).toEqual({ value: 200, confidence: 1, source: "typed" });
  });

  it("an explicit per-field re-record overrides the typed lock", () => {
    let state = setTyped(emptyFields(), "cash", 200);
    state = mergeParsed(
      state,
      parsedFixture({ cash: { value: 999, confidence: 0.99 } }),
      "cash",
    );
    expect(state.cash).toEqual({ value: 999, confidence: 0.99, source: "voice" });
  });

  it("setTyped meal locks meal against voice", () => {
    let state = setTyped(emptyFields(), "meal", "lunch");
    state = mergeParsed(
      state,
      parsedFixture({ meal: { value: "dinner", confidence: 0.95 } }),
    );
    expect(state.meal).toEqual({ value: "lunch", confidence: 1, source: "typed" });
  });

  it("with a targetField, all other fields are ignored", () => {
    const state = mergeParsed(
      emptyFields(),
      parsedFixture({
        meal: { value: "dinner", confidence: 0.9 },
        cash: { value: 120, confidence: 0.9 },
        card: { value: 340, confidence: 0.9 },
        people: {
          matched: [{ id: ID_A, name: "Aki" }],
          unmatched: ["Zed"],
          confidence: 0.9,
        },
      }),
      "card",
    );
    expect(state.card).toEqual({ value: 340, confidence: 0.9, source: "voice" });
    expect(state.meal.value).toBeNull();
    expect(state.cash.value).toBeNull();
    expect(state.people.ids).toEqual([]);
    expect(state.people.unmatched).toEqual([]);
  });
});

describe("mergeParsed people", () => {
  it("a non-empty matched list replaces the current selection", () => {
    let state = mergeParsed(
      emptyFields(),
      parsedFixture({
        people: {
          matched: [
            { id: ID_A, name: "Aki" },
            { id: ID_B, name: "Ben" },
          ],
          unmatched: [],
          confidence: 0.9,
        },
      }),
    );
    expect(state.people.ids).toEqual([ID_A, ID_B]);

    state = mergeParsed(
      state,
      parsedFixture({
        people: {
          matched: [
            { id: ID_A, name: "Aki" },
            { id: ID_C, name: "Cara" },
          ],
          unmatched: [],
          confidence: 0.8,
        },
      }),
    );
    expect(state.people.ids).toEqual([ID_A, ID_C]);
    expect(state.people.names).toEqual({ [ID_A]: "Aki", [ID_C]: "Cara" });
    expect(state.people.source).toBe("voice");
    expect(state.people.confidence).toBe(0.8);
  });

  it("unmatched names accumulate and dedupe across merges", () => {
    let state = mergeParsed(
      emptyFields(),
      parsedFixture({
        people: {
          matched: [{ id: ID_A, name: "Aki" }],
          unmatched: ["Zed", "Yara"],
          confidence: 0.9,
        },
      }),
    );
    state = mergeParsed(
      state,
      parsedFixture({
        people: {
          matched: [{ id: ID_A, name: "Aki" }],
          unmatched: ["Zed", "Walt"],
          confidence: 0.9,
        },
      }),
    );
    expect(state.people.unmatched).toEqual(["Zed", "Yara", "Walt"]);
  });

  it("an empty matched list leaves the selection but still accumulates unmatched", () => {
    let state = mergeParsed(
      emptyFields(),
      parsedFixture({
        people: {
          matched: [
            { id: ID_A, name: "Aki" },
            { id: ID_B, name: "Ben" },
          ],
          unmatched: [],
          confidence: 0.9,
        },
      }),
    );
    state = mergeParsed(
      state,
      parsedFixture({
        people: { matched: [], unmatched: ["Zed"], confidence: 0.6 },
      }),
    );
    expect(state.people.ids).toEqual([ID_A, ID_B]);
    expect(state.people.unmatched).toEqual(["Zed"]);
    expect(state.people.confidence).toBe(0.9);
  });

  it("low-confidence people parses do not replace the selection", () => {
    let state = mergeParsed(
      emptyFields(),
      parsedFixture({
        people: {
          matched: [{ id: ID_A, name: "Aki" }],
          unmatched: [],
          confidence: 0.9,
        },
      }),
    );
    state = mergeParsed(
      state,
      parsedFixture({
        people: {
          matched: [{ id: ID_B, name: "Ben" }],
          unmatched: [],
          confidence: MIN_ACCEPT_CONFIDENCE - 0.01,
        },
      }),
    );
    expect(state.people.ids).toEqual([ID_A]);
  });

  it("setTypedPeople clears unmatched and locks against non-target voice merges", () => {
    let state = mergeParsed(
      emptyFields(),
      parsedFixture({
        people: {
          matched: [{ id: ID_A, name: "Aki" }],
          unmatched: ["Zed"],
          confidence: 0.9,
        },
      }),
    );
    state = setTypedPeople(state, [ID_B], { [ID_B]: "Ben" });
    expect(state.people).toEqual({
      ids: [ID_B],
      names: { [ID_B]: "Ben" },
      unmatched: [],
      confidence: 1,
      source: "typed",
    });

    const afterVoice = mergeParsed(
      state,
      parsedFixture({
        people: {
          matched: [{ id: ID_C, name: "Cara" }],
          unmatched: [],
          confidence: 0.95,
        },
      }),
    );
    expect(afterVoice.people.ids).toEqual([ID_B]);
    expect(afterVoice.people.source).toBe("typed");
  });

  it("a people-targeted re-record overrides the typed lock", () => {
    let state = setTypedPeople(emptyFields(), [ID_B], { [ID_B]: "Ben" });
    state = mergeParsed(
      state,
      parsedFixture({
        people: {
          matched: [{ id: ID_C, name: "Cara" }],
          unmatched: [],
          confidence: 0.95,
        },
      }),
      "people",
    );
    expect(state.people.ids).toEqual([ID_C]);
    expect(state.people.source).toBe("voice");
  });
});
