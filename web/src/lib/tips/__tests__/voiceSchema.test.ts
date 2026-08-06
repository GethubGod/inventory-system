import { describe, expect, it } from "vitest";
import { parseVoiceResponse } from "../voiceSchema";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

function validPayload() {
  return {
    ok: true,
    rawTranscript: "cash one twenty, card three forty, lunch, Aki and Ben",
    latencyMs: 812,
    fields: {
      meal: { value: "lunch", confidence: 0.9 },
      cash: { value: 120, confidence: 0.85 },
      card: { value: 340, confidence: 0.8 },
      people: {
        matched: [{ id: UUID, name: "Aki" }],
        unmatched: ["Ben"],
        confidence: 0.7,
      },
    },
    warnings: ["card amount inferred"],
  };
}

describe("parseVoiceResponse: valid payloads", () => {
  it("parses a full valid payload", () => {
    const parsed = parseVoiceResponse(validPayload());
    expect(parsed).not.toBeNull();
    expect(parsed!.ok).toBe(true);
    expect(parsed!.fields.meal.value).toBe("lunch");
    expect(parsed!.fields.cash.value).toBe(120);
    expect(parsed!.fields.card.value).toBe(340);
    expect(parsed!.fields.people.matched).toEqual([{ id: UUID, name: "Aki" }]);
    expect(parsed!.fields.people.unmatched).toEqual(["Ben"]);
    expect(parsed!.warnings).toEqual(["card amount inferred"]);
  });

  it("defaults warnings to [] when absent", () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).warnings;
    const parsed = parseVoiceResponse(payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.warnings).toEqual([]);
  });

  it("accepts all-null field values with confidence 0", () => {
    const payload = validPayload();
    payload.fields = {
      meal: { value: null, confidence: 0 },
      cash: { value: null, confidence: 0 },
      card: { value: null, confidence: 0 },
      people: { matched: [], unmatched: [], confidence: 0 },
    } as never;
    const parsed = parseVoiceResponse(payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.fields.cash.value).toBeNull();
    expect(parsed!.fields.meal.value).toBeNull();
  });

  it("strips unknown extra keys (zod default)", () => {
    const payload = { ...validPayload(), injected: "extra" };
    const parsed = parseVoiceResponse(payload);
    expect(parsed).not.toBeNull();
    expect("injected" in parsed!).toBe(false);
  });
});

describe("parseVoiceResponse: rejected payloads return null", () => {
  it("rejects ok: false", () => {
    expect(parseVoiceResponse({ ...validPayload(), ok: false })).toBeNull();
  });

  it("rejects a payload with no ok field", () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).ok;
    expect(parseVoiceResponse(payload)).toBeNull();
  });

  it("rejects confidence outside [0, 1]", () => {
    const tooHigh = validPayload();
    tooHigh.fields.cash.confidence = 1.5;
    expect(parseVoiceResponse(tooHigh)).toBeNull();

    const negative = validPayload();
    negative.fields.meal.confidence = -0.1;
    expect(parseVoiceResponse(negative)).toBeNull();
  });

  it("rejects negative or absurd money values", () => {
    const negative = validPayload();
    negative.fields.cash.value = -5;
    expect(parseVoiceResponse(negative)).toBeNull();

    const absurd = validPayload();
    absurd.fields.card.value = 100000;
    expect(parseVoiceResponse(absurd)).toBeNull();
  });

  it("rejects a matched person id that is not a uuid", () => {
    const payload = validPayload();
    payload.fields.people.matched = [{ id: "not-a-uuid", name: "Aki" }];
    expect(parseVoiceResponse(payload)).toBeNull();
  });

  it("rejects an unknown meal value", () => {
    const payload = validPayload();
    payload.fields.meal.value = "brunch" as never;
    expect(parseVoiceResponse(payload)).toBeNull();
  });

  it("rejects a payload missing the fields object", () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).fields;
    expect(parseVoiceResponse(payload)).toBeNull();
  });

  it("rejects non-object junk", () => {
    expect(parseVoiceResponse(null)).toBeNull();
    expect(parseVoiceResponse("nope")).toBeNull();
    expect(parseVoiceResponse(42)).toBeNull();
  });
});
