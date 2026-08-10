// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { userCanAccessLocation } from '../_shared/location-access.ts';
import type { CatalogItem } from '../parse-order/types.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  upgradeWebSocket(req: Request): { socket: WebSocket; response: Response };
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY');
const liveModel = Deno.env.get('GEMINI_LIVE_MODEL') ?? 'gemini-live-2.5-flash-preview';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function send(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
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

function buildLiveInstruction(catalog: CatalogItem[], mode: string | null): string {
  return `You clean restaurant inventory voice dictation for a sushi ordering app.

Return only concise editable order text. Do not explain.
Normalize accents, noisy words, restaurant shorthand, fillers, repeated words, mixed English/Chinese, and item aliases.
Prefer valid catalog item names. If uncertain, keep the spoken item text instead of hallucinating.
Use compact quantity lines, for example:
yellowtail 5 lb
salmon 3 cases
sriracha 1 case

Composer mode: ${mode === 'inventory' ? 'inventory remaining' : 'order'}

Common mappings:
- yellow tail = yellowtail
- norie = nori
- massago = masago
- a lot/plenty/full = no order
- almost out/low/half left/one left = remaining inventory wording

Valid inventory candidates:
${compactCatalogForPrompt(catalog)}`;
}

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

async function fetchCatalog(locationId: string): Promise<CatalogItem[]> {
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, aliases, base_unit, pack_unit, allowed_units, supplier_id, location_id, active, default_order_unit')
    .eq('active', true)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .limit(1000);
  if (error) {
    console.warn('[quick-order-voice-stream] catalog fetch failed', error);
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

async function recordVoiceEvent(input: {
  userId: string;
  locationId: string;
  sessionId: string | null;
  rawTranscript: string | null;
  normalizedText: string | null;
  latencyMs: number;
  modelUsed: string | null;
  errorCode?: string | null;
  outcome: 'shown' | 'failed';
}) {
  const { error } = await supabaseAdmin
    .from('quick_order_voice_parse_events')
    .insert({
      user_id: input.userId,
      location_id: input.locationId,
      session_id: input.sessionId,
      raw_transcript: input.rawTranscript,
      normalized_text: input.normalizedText,
      parsed_actions: [],
      warnings: [],
      error_code: input.errorCode ?? null,
      model_used: input.modelUsed,
      fallback_used: false,
      latency_ms: input.latencyMs,
      confidence: null,
      outcome: input.outcome,
    });
  if (error) console.warn('[quick-order-voice-stream] event insert failed', error);
}

async function authenticate(url: URL) {
  const token = url.searchParams.get('jwt')?.trim();
  if (!token) return { status: 403, error: 'Auth token not provided', userId: null };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { status: 403, error: 'Invalid auth token', userId: null };
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_suspended')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.is_suspended) {
    return { status: 403, error: 'Suspended accounts cannot use Quick Order voice.', userId: null };
  }
  return { status: 200, error: null, userId: user.id };
}

function normalizeGeminiTextMessage(raw: unknown): {
  inputTranscript?: string;
  modelText?: string;
  turnComplete?: boolean;
} {
  if (!raw || typeof raw !== 'object') return {};
  const message = raw as Record<string, unknown>;
  const serverContent = message.serverContent as Record<string, unknown> | undefined;
  const inputTranscription = serverContent?.inputTranscription as Record<string, unknown> | undefined;
  const modelTurn = serverContent?.modelTurn as Record<string, unknown> | undefined;
  const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts : [];
  const modelText = parts
    .map((part) => typeof (part as Record<string, unknown>).text === 'string' ? (part as Record<string, string>).text : '')
    .filter(Boolean)
    .join('')
    .trim();
  return {
    inputTranscript: typeof inputTranscription?.text === 'string' ? inputTranscription.text : undefined,
    modelText: modelText || undefined,
    turnComplete: Boolean(serverContent?.turnComplete),
  };
}

Deno.serve(async (req) => {
  const upgrade = req.headers.get('upgrade') ?? '';
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade.', { status: 400 });
  }

  const url = new URL(req.url);
  const locationId = url.searchParams.get('location_id')?.trim() ?? null;
  const requestedUserId = url.searchParams.get('user_id')?.trim() ?? null;
  const sessionId = url.searchParams.get('session_id')?.trim() ?? null;
  const mode = url.searchParams.get('mode')?.trim() ?? 'order';

  const auth = await authenticate(url);
  if (!auth.userId) return new Response(auth.error ?? 'Unauthorized', { status: auth.status });
  if (!locationId || !UUID_PATTERN.test(locationId)) {
    return new Response('Invalid location.', { status: 400 });
  }
  if (requestedUserId !== auth.userId) {
    return new Response('Authenticated user mismatch.', { status: 403 });
  }
  if (sessionId && !UUID_PATTERN.test(sessionId)) {
    return new Response('Invalid Quick Order session.', { status: 400 });
  }
  if (Deno.env.get('ENABLE_QUICK_ORDER_VOICE_STREAMING') !== 'true') {
    return new Response('Realtime voice is disabled.', { status: 403 });
  }
  if (!geminiApiKey) {
    return new Response('Voice ordering is temporarily unavailable.', { status: 503 });
  }
  const access = await userCanAccessLocation(supabaseAdmin, auth.userId, locationId);
  if (!access.allowed) {
    return new Response(access.error ?? 'Forbidden.', { status: access.status });
  }

  const catalog = await fetchCatalog(locationId);
  if (catalog.length === 0) {
    return new Response('Catalog unavailable.', { status: 503 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const startedAt = Date.now();
  let upstream: WebSocket | null = null;
  let rawTranscript = '';
  let finalText = '';

  socket.onopen = () => {
    upstream = new WebSocket(
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`,
    );
    upstream.onopen = () => {
      upstream?.send(JSON.stringify({
        setup: {
          model: `models/${liveModel}`,
          generationConfig: {
            responseModalities: ['TEXT'],
            temperature: 0.1,
          },
          systemInstruction: {
            parts: [{ text: buildLiveInstruction(catalog, mode) }],
          },
          inputAudioTranscription: {},
        },
      }));
    };
    upstream.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data));
        if (parsed.setupComplete) {
          send(socket, { type: 'warning', message: 'Realtime voice ready.' });
          return;
        }
        const normalized = normalizeGeminiTextMessage(parsed);
        if (normalized.inputTranscript) {
          rawTranscript = normalized.inputTranscript;
          send(socket, { type: 'partial_transcript', text: normalized.inputTranscript });
        }
        if (normalized.modelText) {
          finalText = normalized.modelText;
          send(socket, { type: normalized.turnComplete ? 'final_text' : 'cleaned_partial', normalizedText: normalized.modelText, rawTranscript });
        }
        if (normalized.turnComplete && finalText) {
          const latencyMs = Date.now() - startedAt;
          send(socket, {
            type: 'done',
            rawTranscript,
            normalizedText: finalText,
            confidence: 0.75,
            warnings: [],
            voiceEventId: null,
            latencyMs,
          });
          void recordVoiceEvent({
            userId: auth.userId!,
            locationId,
            sessionId,
            rawTranscript,
            normalizedText: finalText,
            latencyMs,
            modelUsed: liveModel,
            outcome: 'shown',
          });
        }
      } catch {
        send(socket, { type: 'warning', message: 'Received an unreadable realtime voice update.' });
      }
    };
    upstream.onerror = () => {
      send(socket, {
        type: 'error',
        errorCode: 'NETWORK_ERROR',
        message: 'Realtime voice connection failed. Falling back to upload.',
        retryable: true,
      });
    };
    upstream.onclose = () => {
      send(socket, { type: 'done' });
    };
  };

  socket.onmessage = async (event) => {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'finish') {
          upstream.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
          upstream.send(JSON.stringify({ clientContent: { turns: [], turnComplete: true } }));
        }
      } catch {
        upstream.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: event.data }],
          },
        }));
      }
      return;
    }
    const buffer = event.data instanceof ArrayBuffer
      ? event.data
      : await (event.data as Blob).arrayBuffer();
    upstream.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: arrayBufferToBase64(buffer) }],
      },
    }));
  };

  socket.onerror = () => upstream?.close();
  socket.onclose = () => upstream?.close();

  return response;
});
