// Zod validation of the tip-voice-parse edge function response. The edge
// function validates the model's raw output on its side (mirrored schema);
// this validates what reaches the browser so a malformed/partial response
// can never poison the field state.
import { z } from "zod";

export const FieldConfidenceSchema = z.number().min(0).max(1);

export const TipVoiceFieldsSchema = z.object({
  meal: z.object({
    value: z.union([z.literal("lunch"), z.literal("dinner")]).nullable(),
    confidence: FieldConfidenceSchema,
  }),
  cash: z.object({
    value: z.number().min(0).max(99999.99).nullable(),
    confidence: FieldConfidenceSchema,
  }),
  card: z.object({
    value: z.number().min(0).max(99999.99).nullable(),
    confidence: FieldConfidenceSchema,
  }),
  people: z.object({
    matched: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    unmatched: z.array(z.string()),
    confidence: FieldConfidenceSchema,
  }),
});

export const TipVoiceParseResponseSchema = z.object({
  ok: z.literal(true),
  rawTranscript: z.string(),
  latencyMs: z.number().optional(),
  fields: TipVoiceFieldsSchema,
  warnings: z.array(z.string()).default([]),
});

export type TipVoiceFields = z.infer<typeof TipVoiceFieldsSchema>;
export type TipVoiceParseResponse = z.infer<typeof TipVoiceParseResponseSchema>;

/** Parse an edge response; returns null when it isn't a valid ok-response. */
export function parseVoiceResponse(json: unknown): TipVoiceParseResponse | null {
  const result = TipVoiceParseResponseSchema.safeParse(json);
  return result.success ? result.data : null;
}
