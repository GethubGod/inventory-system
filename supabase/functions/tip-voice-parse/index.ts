// Voice -> structured tip fields, modeled on quick-order-voice-parse.
// Gemini Flash does STT + extraction in one shot against a strict response
// schema; output is zod-validated and clamped server-side, and spoken names
// are matched against the location's roster (unmatched names are returned for
// the UI to resolve — never guessed into the roster).
//
// Called incrementally: the client sends a chunk on each speech pause along
// with the accumulated known-fields state, and merges what comes back.
// target_field supports the review screen's per-field re-record mics.

// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { z } from 'https://esm.sh/zod@3.25.76';
import { corsHeadersForRequest } from '../_shared/cors.ts';
import { normalizeAmount, validateTipSession } from '../_shared/tips.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY');
const TIP_VOICE_MODEL = Deno.env.get('TIP_VOICE_MODEL') ?? 'gemini-2.5-flash';

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const GEMINI_TIMEOUT_MS = 20_000;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// MIRROR of web/src/lib/tips/voiceSchema.ts (canonical + unit tested there).
const TipParseSchema = z.object({
  rawTranscript: z.string().default(''),
  meal: z.enum(['lunch', 'dinner']).nullable().default(null),
  mealConfidence: z.number().min(0).max(1).default(0),
  cash: z.number().nullable().default(null),
  cashConfidence: z.number().min(0).max(1).default(0),
  card: z.number().nullable().default(null),
  cardConfidence: z.number().min(0).max(1).default(0),
  people: z.array(z.string()).default([]),
  peopleConfidence: z.number().min(0).max(1).default(0),
  warnings: z.array(z.string()).default([]),
});

type TipParseResult = z.infer<typeof TipParseSchema>;

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    rawTranscript: { type: 'string' },
    meal: { type: 'string', enum: ['lunch', 'dinner'], nullable: true },
    mealConfidence: { type: 'number' },
    cash: { type: 'number', nullable: true },
    cashConfidence: { type: 'number' },
    card: { type: 'number', nullable: true },
    cardConfidence: { type: 'number' },
    people: { type: 'array', items: { type: 'string' } },
    peopleConfidence: { type: 'number' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['rawTranscript'],
};

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

function asString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildPrompt(input: {
  locationName: string;
  rosterNames: string[];
  knownState: Record<string, unknown> | null;
  targetField: string | null;
}): string {
  const known = input.knownState ? JSON.stringify(input.knownState) : '{}';
  const target = input.targetField
    ? `\nThe user is re-recording ONLY the "${input.targetField}" field. Extract just that field; leave every other field null/empty.`
    : '';
  return `You are transcribing an end-of-day tip report spoken by a tired restaurant closer, possibly with an accent, kitchen noise, or mixed English/Chinese.

They report four things, in any order, possibly across multiple recordings:
- shift: lunch or dinner
- cash tips in dollars
- credit card tips in dollars
- who is splitting the tips (first names from the staff list below)

Rules:
- Transcribe the speech into rawTranscript exactly as heard.
- Amounts are US dollars. "one twenty" = 120, "one twenty five" = 125, "three hundred" = 300, "eighty five fifty" = 85.50, "forty bucks" = 40. Use cents only when clearly spoken ("seven dollars and thirty cents" = 7.30). Zero is a valid amount ("no cash tips" = cash 0).
- "cash" amounts go to cash, "card"/"credit"/"credit card" amounts to card. If they say just one number with no field word and cash is already known, it is probably card (and vice versa) — but lower the confidence.
- people: when anyone is named, return the COMPLETE final list of people splitting the tips — keep previously captured people from "Already captured" unless the speaker removed or corrected them, and add the newly named ones. Use names as spoken; match against the staff list when close (e.g. "Jo" for "Jose" if unambiguous). Return an empty list when nobody was named in this recording.
- Corrections win: "no wait, card was three fifty" replaces the earlier card amount.
- Set each field's confidence honestly; use null and confidence 0 for anything not spoken in THIS recording.
- Do not invent values. Do not return conversational prose.

Location: ${input.locationName}
Staff list: ${input.rosterNames.join(', ') || '(empty)'}
Already captured (context only — do not repeat into your output unless corrected): ${known}${target}
Return strict JSON only.`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function parseGeminiJson(rawText: string): TipParseResult | null {
  const candidates = [rawText, rawText.match(/\{[\s\S]*\}/)?.[0]].filter(
    (entry): entry is string => Boolean(entry),
  );
  for (const candidate of candidates) {
    try {
      return TipParseSchema.parse(JSON.parse(candidate));
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function callGemini(input: {
  audioBase64: string;
  mimeType: string;
  prompt: string;
}): Promise<TipParseResult> {
  if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${TIP_VOICE_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                {
                  text: attempt === 0
                    ? input.prompt
                    : `${input.prompt}\n\nThe previous response was invalid JSON. Return only strict JSON matching the schema.`,
                },
                { inlineData: { mimeType: input.mimeType, data: input.audioBase64 } },
              ],
            }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
              responseSchema: GEMINI_RESPONSE_SCHEMA,
            },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);
      }
      const payload = await response.json();
      const rawText = String(payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
      const parsed = parseGeminiJson(rawText);
      if (!parsed) throw new Error('Gemini returned invalid JSON');
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Gemini returned invalid JSON');
}

/** Match spoken names to the roster: exact, then unique prefix, then contains. */
function matchPeople(
  spoken: string[],
  roster: Array<{ id: string; name: string }>,
): { matched: Array<{ id: string; name: string }>; unmatched: string[] } {
  const matched = new Map<string, { id: string; name: string }>();
  const unmatched: string[] = [];
  for (const raw of spoken) {
    const heard = raw.trim().toLowerCase();
    if (!heard) continue;
    const exact = roster.filter((r) => r.name.trim().toLowerCase() === heard);
    const prefix = exact.length ? exact : roster.filter((r) => r.name.trim().toLowerCase().startsWith(heard));
    const contains = prefix.length ? prefix : roster.filter((r) => r.name.trim().toLowerCase().includes(heard));
    if (contains.length === 1) {
      matched.set(contains[0].id, contains[0]);
    } else {
      unmatched.push(raw.trim());
    }
  }
  return { matched: [...matched.values()], unmatched };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersForRequest(req) });
  }
  if (req.method !== 'POST') {
    return json(req, { ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const form = await req.formData();
    const session = await validateTipSession(supabaseAdmin, asString(form.get('session_token')));
    if (!session) {
      return json(req, { ok: false, code: 'session_invalid', error: 'Session expired. Scan the sticker again.' }, 401);
    }
    if (!geminiApiKey) {
      return json(req, { ok: false, code: 'api_key_missing', error: 'Voice entry is temporarily unavailable. Type it in instead.' }, 503);
    }

    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size <= 0) {
      return json(req, { ok: false, code: 'invalid_audio', error: 'No audio was received.' }, 400);
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return json(req, { ok: false, code: 'too_large', error: 'That recording is too long.' }, 413);
    }
    const mimeType = audio.type || 'audio/webm';
    if (!/^audio\/(webm|mp4|m4a|x-m4a|aac|mpeg|ogg|wav)(;.*)?$/i.test(mimeType)) {
      return json(req, { ok: false, code: 'invalid_audio', error: 'That audio format is not supported.' }, 415);
    }

    const targetField = asString(form.get('target_field'));
    if (targetField && !['meal', 'cash', 'card', 'people'].includes(targetField)) {
      return json(req, { ok: false, error: 'Invalid target field.' }, 400);
    }
    let knownState: Record<string, unknown> | null = null;
    const knownStateRaw = asString(form.get('known_state'));
    if (knownStateRaw && knownStateRaw.length <= 4000) {
      try {
        knownState = JSON.parse(knownStateRaw);
      } catch {
        knownState = null;
      }
    }

    const { data: rosterRows, error: rosterError } = await supabaseAdmin
      .from('tip_employees')
      .select('id, name')
      .eq('active', true)
      .or(`location_id.is.null,location_id.eq.${session.location_id}`);
    if (rosterError) throw rosterError;
    const roster = (rosterRows ?? []) as Array<{ id: string; name: string }>;

    const startedAt = Date.now();
    const audioBase64 = arrayBufferToBase64(await audio.arrayBuffer());
    const parsed = await callGemini({
      audioBase64,
      mimeType: mimeType.split(';')[0],
      prompt: buildPrompt({
        locationName: session.location_name,
        rosterNames: roster.map((r) => r.name),
        knownState,
        targetField,
      }),
    });

    const people = matchPeople(parsed.people, roster);
    const cash = parsed.cash === null ? null : normalizeAmount(parsed.cash);
    const card = parsed.card === null ? null : normalizeAmount(parsed.card);

    return json(req, {
      ok: true,
      rawTranscript: parsed.rawTranscript,
      latencyMs: Date.now() - startedAt,
      fields: {
        meal: { value: parsed.meal, confidence: parsed.mealConfidence },
        cash: { value: cash, confidence: cash === null && parsed.cash !== null ? 0 : parsed.cashConfidence },
        card: { value: card, confidence: card === null && parsed.card !== null ? 0 : parsed.cardConfidence },
        people: {
          matched: people.matched,
          unmatched: people.unmatched,
          confidence: parsed.peopleConfidence,
        },
      },
      warnings: parsed.warnings,
    });
  } catch (error) {
    console.error('[tip-voice-parse] failed', error);
    return json(req, {
      ok: false,
      code: 'parse_failed',
      error: "Couldn't process that audio. Keep talking or tap a row to type it.",
    }, 500);
  }
});
