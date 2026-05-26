// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { z } from 'https://esm.sh/zod@3.25.76';
import { corsHeadersForRequest } from '../_shared/cors.ts';
import { userCanAccessLocation } from '../_shared/location-access.ts';
import type { CatalogItem } from '../parse-order/types.ts';
import {
  verifyVoiceActions,
  type VoiceParsedAction,
  type VoiceUnresolvedAction,
} from './structured-actions.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY');

const QUICK_ORDER_VOICE_MODEL =
  Deno.env.get('QUICK_ORDER_VOICE_MODEL') ?? 'gemini-2.5-flash';
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MIN_DURATION_MS = 700;
const MAX_DURATION_MS = 30_000;
const GEMINI_TIMEOUT_MS = 30_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const VoiceActionSchema = z.object({
  type: z.enum([
    'add',
    'remove',
    'set_remaining',
    'note',
    'unknown',
    'order',
    'inventory_remaining',
    'no_order_needed',
    'update_quantity',
    'needs_input',
  ]),
  itemName: z.string().nullable().default(null),
  matchedItemId: z.string().nullable().default(null),
  spokenItemText: z.string().default(''),
  spokenItemName: z.string().nullable().default(null),
  quantity: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  remainingQuantity: z.number().nullable().default(null),
  remainingUnit: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  sourceText: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
});

const VoiceParseSchema = z.object({
  rawTranscript: z.string().default(''),
  normalizedText: z.string().default(''),
  detectedLanguages: z.array(z.string()).default([]),
  actions: z.array(VoiceActionSchema).default([]),
  unknownItems: z.array(z.string()).default([]),
  needsInput: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  usedFallbackModel: z.boolean().default(false),
});

type VoiceParseResult = z.infer<typeof VoiceParseSchema>;

type VerifiedVoiceParseResult = Omit<VoiceParseResult, 'actions'> & {
  actions: VoiceParsedAction[];
  unresolved: VoiceUnresolvedAction[];
  needsReview: boolean;
};

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersForRequest(req), 'Content-Type': 'application/json' },
  });
}

function errorResponse(
  req: Request,
  status: number,
  errorCode: string,
  message: string,
  retryable = false,
  extra: Record<string, unknown> = {},
) {
  return jsonResponse(req, {
    success: false,
    errorCode,
    message,
    retryable,
    ...extra,
  }, status);
}

function asString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function clampConfidence(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Unauthorized', status: 401, user: null };
  }
  const token = authHeader.replace('Bearer ', '').trim();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { error: 'Unauthorized', status: 401, user: null };

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_suspended')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.is_suspended) {
    return { error: 'Suspended accounts cannot use Quick Order voice.', status: 403, user: null };
  }
  return { error: null, status: 200, user };
}

async function fetchCatalog(locationId: string): Promise<CatalogItem[]> {
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, aliases, base_unit, pack_unit, allowed_units, supplier_id, location_id, active, default_order_unit')
    .eq('active', true)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .limit(1000);
  if (error) {
    console.warn('[quick-order-voice-parse] catalog fetch failed', error);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[])
    .map((row): CatalogItem | null => {
      const id = typeof row.id === 'string' ? row.id : null;
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!id || !name) return null;
      return {
        id,
        name,
        aliases: Array.isArray(row.aliases)
          ? row.aliases.filter((entry): entry is string => typeof entry === 'string')
          : [],
        default_unit: typeof row.base_unit === 'string'
          ? row.base_unit
          : typeof row.pack_unit === 'string'
            ? row.pack_unit
            : null,
        base_unit: typeof row.base_unit === 'string' ? row.base_unit : null,
        pack_unit: typeof row.pack_unit === 'string' ? row.pack_unit : null,
        supplier_id: typeof row.supplier_id === 'string' ? row.supplier_id : null,
        location_id: typeof row.location_id === 'string' ? row.location_id : null,
        allowed_units: Array.isArray(row.allowed_units)
          ? row.allowed_units.filter((entry): entry is string => typeof entry === 'string')
          : null,
        default_order_unit: typeof row.default_order_unit === 'string' ? row.default_order_unit : null,
      };
    })
    .filter((entry): entry is CatalogItem => Boolean(entry))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function compactCatalogForPrompt(catalog: CatalogItem[], limit = 250): string {
  return catalog.slice(0, limit).map((item) => {
    const aliases = item.aliases.length > 0 ? ` aliases: ${item.aliases.slice(0, 6).join(', ')}` : '';
    const units = [item.default_order_unit, item.default_unit, ...(item.allowed_units ?? [])]
      .filter((entry): entry is string => Boolean(entry))
      .slice(0, 4);
    return `- ${item.name}${aliases}${units.length ? ` units: ${[...new Set(units)].join(', ')}` : ''}`;
  }).join('\n');
}

function buildPrompt(catalog: CatalogItem[], mode: string | null): string {
  return `You are interpreting a noisy restaurant voice order for a sushi restaurant inventory app.

Task:
- Transcribe the speech.
- Normalize accented English, broken English, shorthand, repeated words, filler words, kitchen background noise, and mixed English/Chinese.
- Map spoken item names only to likely valid inventory candidates from the catalog. Do not hallucinate item names.
- Identify add, remove, inventory remaining, no-order-needed/note, unknown items, and missing input.
- Prefer one action per ordered item.
- Use decimal quantities for mixed fractions; for example, "one and a half bags" must become 1.5 bags.
- Units include case/cs, box, bag, pack/pk, bottle/bt, tray, piece/pcs, lb/pound.
- Only include a unit when the user spoke one. Do not invent units or item ids.
- Keep normalizedText concise and line-based in "Item quantity unit" style. No bullets, numbering, or prose.
- Return strict JSON only.
- If uncertain, return needs_input or unknown instead of guessing.
- This is not a spoken assistant. Do not write conversational prose.

Composer mode: ${mode === 'inventory' ? 'inventory remaining' : 'order'}

Common mappings:
- yellow tail = yellowtail
- norie = nori
- massago = masago
- tree/tee/free can mean three when near a quantity
- cs/case/cases mean case
- pk/pkg means pack
- bt means bottle
- pcs/pc/each mean piece
- a lot/plenty/full = no_order_needed
- almost out/low/half left/one left = inventory_remaining
- "no need", "don't order", "we have enough", "we have a lot" should never become a direct order
- "no wait", "actually", and "change that to" are corrections; use the corrected final intent
- "salmon" should prefer an exact one-word Salmon item over longer items like Salmon roe. "salmon roe" must stay Salmon roe.
- If quantity is missing, return the action with quantity null.
- If unit is missing, return unit null.

Valid inventory candidates:
${compactCatalogForPrompt(catalog)}
`;
}

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    rawTranscript: { type: 'string' },
    normalizedText: { type: 'string' },
    detectedLanguages: { type: 'array', items: { type: 'string' } },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['add', 'remove', 'set_remaining', 'note', 'unknown', 'order', 'inventory_remaining', 'no_order_needed', 'update_quantity', 'needs_input'],
          },
          itemName: { type: 'string', nullable: true },
          matchedItemId: { type: 'string', nullable: true },
          spokenItemText: { type: 'string' },
          spokenItemName: { type: 'string', nullable: true },
          quantity: { type: 'number', nullable: true },
          unit: { type: 'string', nullable: true },
          remainingQuantity: { type: 'number', nullable: true },
          remainingUnit: { type: 'string', nullable: true },
          confidence: { type: 'number' },
          sourceText: { type: 'string', nullable: true },
          reason: { type: 'string', nullable: true },
        },
        required: ['type', 'spokenItemText', 'confidence'],
      },
    },
    unknownItems: { type: 'array', items: { type: 'string' } },
    needsInput: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    usedFallbackModel: { type: 'boolean' },
  },
  required: ['rawTranscript', 'normalizedText', 'actions', 'confidence'],
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function parseGeminiJson(rawText: string): VoiceParseResult | null {
  const candidates = [rawText, rawText.match(/\{[\s\S]*\}/)?.[0]].filter(
    (entry): entry is string => Boolean(entry),
  );
  for (const candidate of candidates) {
    try {
      return VoiceParseSchema.parse(JSON.parse(candidate));
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function callGeminiVoice(input: {
  audioBase64: string;
  mimeType: string;
  prompt: string;
  model: string;
  usedFallbackModel: boolean;
}): Promise<VoiceParseResult> {
  if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');
  let lastRawText = '';
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
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
                    : `${input.prompt}

The previous response was invalid JSON or did not match the schema. Retry once and return only strict JSON matching the response schema. Do not include markdown or prose.`,
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
        throw new Error(`Gemini voice request failed: ${response.status} ${await response.text()}`);
      }
      const payload = await response.json();
      const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      lastRawText = String(rawText);
      const parsed = parseGeminiJson(lastRawText);
      if (!parsed) throw new Error('Gemini returned invalid JSON');
      return { ...parsed, usedFallbackModel: input.usedFallbackModel };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 1) break;
    } finally {
      clearTimeout(timer);
    }
  }

  const error = lastError ?? new Error('Gemini returned invalid JSON');
  if (lastRawText) {
    console.warn('[quick-order-voice-parse] invalid Gemini JSON', lastRawText.slice(0, 500));
  }
  throw error;
}

async function recordVoiceEvent(input: {
  userId: string;
  locationId: string;
  sessionId: string | null;
  result?: VerifiedVoiceParseResult | null;
  modelUsed?: string | null;
  fallbackUsed?: boolean;
  latencyMs: number;
  latencyBreakdown?: Record<string, unknown>;
  errorCode?: string | null;
  outcome: 'shown' | 'failed';
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('quick_order_voice_parse_events')
    .insert({
      user_id: input.userId,
      location_id: input.locationId,
      session_id: input.sessionId,
      raw_transcript: input.result?.rawTranscript ?? null,
      normalized_text: input.result?.normalizedText ?? null,
      parsed_actions: input.result?.actions ?? [],
      warnings: input.result?.warnings ?? [],
      error_code: input.errorCode ?? null,
      model_used: input.modelUsed ?? null,
      fallback_used: input.fallbackUsed ?? false,
      latency_ms: input.latencyMs,
      latency_breakdown: input.latencyBreakdown ?? {},
      confidence: input.result ? clampConfidence(input.result.confidence) : null,
      outcome: input.outcome,
    })
    .select('id')
    .maybeSingle();
  if (error) {
    console.warn('[quick-order-voice-parse] event insert failed', error);
    return null;
  }
  return typeof data?.id === 'string' ? data.id : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersForRequest(req) });
  }
  if (req.method !== 'POST') {
    return errorResponse(req, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', false);
  }

  const startedAt = Date.now();
  const uploadReceivedAt = new Date(startedAt).toISOString();
  let userId: string | null = null;
  let locationId: string | null = null;
  let sessionId: string | null = null;

  try {
    const auth = await getAuthenticatedUser(req);
    if (auth.error || !auth.user) {
      return errorResponse(req, auth.status, 'AUTH_REQUIRED', auth.error ?? 'Unauthorized.', false);
    }
    userId = auth.user.id;

    const form = await req.formData();
    locationId = asString(form.get('location_id'));
    sessionId = asString(form.get('session_id'));
    const requestedUserId = asString(form.get('user_id'));
    const mode = asString(form.get('mode'));
    const durationMs = Number(asString(form.get('duration_ms')) ?? NaN);
    const audio = form.get('audio');

    if (!locationId || !UUID_PATTERN.test(locationId)) {
      return errorResponse(req, 400, 'INVALID_LOCATION', 'Choose a location before using voice order.', false);
    }
    if (requestedUserId !== userId) {
      return errorResponse(req, 403, 'AUTH_MISMATCH', 'Authenticated user mismatch.', false);
    }
    if (sessionId && !UUID_PATTERN.test(sessionId)) {
      return errorResponse(req, 400, 'INVALID_SESSION', 'Invalid Quick Order session.', false);
    }
    const access = await userCanAccessLocation(supabaseAdmin, userId, locationId);
    if (!access.allowed) {
      return errorResponse(req, access.status, 'LOCATION_FORBIDDEN', access.error ?? 'Forbidden.', false);
    }
    const { data: voiceConfigRows } = await supabaseAdmin
      .from('app_config')
      .select('key, value')
      .in('key', ['quick_order_voice_enabled']);
    const voiceConfigEnabled = (voiceConfigRows ?? []).some((row: { key: string; value: unknown }) =>
      row.key === 'quick_order_voice_enabled' && row.value === true
    );
    const voiceEnabled = Deno.env.get('ENABLE_QUICK_ORDER_VOICE') === 'true' || voiceConfigEnabled;
    if (!voiceEnabled) {
      return errorResponse(req, 403, 'VOICE_DISABLED', 'Voice Quick Order is not enabled yet.', false);
    }
    if (!geminiApiKey) {
      await recordVoiceEvent({ userId, locationId, sessionId, latencyMs: Date.now() - startedAt, errorCode: 'API_KEY_MISSING', outcome: 'failed' });
      return errorResponse(req, 503, 'API_KEY_MISSING', 'Voice ordering is temporarily unavailable.', true);
    }
    if (!(audio instanceof File)) {
      return errorResponse(req, 400, 'INVALID_AUDIO', 'No audio recording was received.', false);
    }
    if (audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
      return errorResponse(req, 413, 'FILE_TOO_LARGE', 'That recording is too large. Try a shorter voice order.', true);
    }
    const mimeType = audio.type || 'audio/mp4';
    if (!/^(audio\/mp4|audio\/m4a|audio\/aac|audio\/mpeg|audio\/webm|audio\/x-m4a)$/i.test(mimeType)) {
      return errorResponse(req, 415, 'INVALID_AUDIO', 'That audio format is not supported.', true);
    }
    if (Number.isFinite(durationMs) && durationMs < MIN_DURATION_MS) {
      return errorResponse(req, 400, 'TOO_SHORT', 'Hold the mic a little longer and try again.', true);
    }
    if (Number.isFinite(durationMs) && durationMs > MAX_DURATION_MS + 1_000) {
      return errorResponse(req, 400, 'TOO_LONG', 'Voice orders can be up to 30 seconds.', true);
    }

    const catalogStartedAt = Date.now();
    const [catalog, audioBuffer] = await Promise.all([
      fetchCatalog(locationId),
      audio.arrayBuffer(),
    ]);
    const catalogLoadedMs = Date.now() - catalogStartedAt;
    if (catalog.length === 0) {
      return errorResponse(req, 503, 'CATALOG_EMPTY', 'I could not load the item catalog. Try again.', true);
    }

    const audioBase64 = arrayBufferToBase64(audioBuffer);
    const prompt = buildPrompt(catalog, mode);

    let modelUsed = QUICK_ORDER_VOICE_MODEL;
    let fallbackUsed = false;
    let voiceResult: VerifiedVoiceParseResult;
    let geminiLatencyMs = 0;
    let catalogMatchMs = 0;
    try {
      const geminiStartedAt = Date.now();
      const primary = await callGeminiVoice({
        audioBase64,
        mimeType,
        prompt,
        model: QUICK_ORDER_VOICE_MODEL,
        usedFallbackModel: false,
      });
      geminiLatencyMs = Date.now() - geminiStartedAt;
      const matchStartedAt = Date.now();
      const verified = verifyVoiceActions({
        actions: primary.actions,
        catalog,
        modelConfidence: primary.confidence,
        warnings: primary.warnings,
      });
      catalogMatchMs = Date.now() - matchStartedAt;
      voiceResult = {
        ...primary,
        actions: verified.actions,
        unresolved: verified.unresolved,
        normalizedText: verified.normalizedText || primary.normalizedText,
        confidence: verified.confidence,
        warnings: verified.warnings,
        needsReview: verified.needsReview,
        usedFallbackModel: false,
      };
    } catch (error) {
      console.warn('[quick-order-voice-parse] Gemini voice parse failed', error);
      throw error;
    }

    const normalizedText = voiceResult.normalizedText.trim();
    const latencyMs = Date.now() - startedAt;
    const latencyBreakdown = {
      uploadReceivedAt,
      catalogLoadedMs,
      geminiLatencyMs,
      catalogMatchMs,
      totalLatencyMs: latencyMs,
    };
    if (!normalizedText && voiceResult.actions.length === 0 && voiceResult.unresolved.length === 0) {
      const voiceEventId = await recordVoiceEvent({
        userId,
        locationId,
        sessionId,
        result: voiceResult,
        modelUsed,
        fallbackUsed,
        latencyMs,
        latencyBreakdown,
        errorCode: 'VOICE_LOW_CONFIDENCE',
        outcome: 'failed',
      });
      return errorResponse(req, 422, 'VOICE_LOW_CONFIDENCE', "I couldn't understand that. Try again.", true, {
        voiceEventId,
        rawTranscript: voiceResult.rawTranscript,
        normalizedText: voiceResult.normalizedText,
        warnings: voiceResult.warnings,
      });
    }

    const voiceEventId = await recordVoiceEvent({
      userId,
      locationId,
      sessionId,
      result: voiceResult,
      modelUsed,
      fallbackUsed,
      latencyMs,
      latencyBreakdown,
      outcome: 'shown',
    });

    return jsonResponse(req, {
      success: true,
      ok: true,
      source: 'upload',
      rawTranscript: voiceResult.rawTranscript,
      normalizedText,
      detectedLanguages: voiceResult.detectedLanguages,
      modelUsed,
      fallbackUsed,
      latencyMs,
      latencyBreakdown,
      voiceEventId,
      actions: voiceResult.actions,
      unresolved: voiceResult.unresolved,
      needsInput: voiceResult.needsInput,
      unknownItems: voiceResult.unknownItems,
      warnings: voiceResult.warnings,
      confidence: voiceResult.confidence,
      needsReview: voiceResult.needsReview,
    });
  } catch (error) {
    console.error('[quick-order-voice-parse] failed', error);
    if (userId && locationId) {
      await recordVoiceEvent({
        userId,
        locationId,
        sessionId,
        latencyMs: Date.now() - startedAt,
        errorCode: 'MODEL_FAILED',
        outcome: 'failed',
      });
    }
    return errorResponse(req, 500, 'MODEL_FAILED', 'Voice order cleanup failed. Try again.', true);
  }
});
