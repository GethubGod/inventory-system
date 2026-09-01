// Streaming STT relay for the tips voice sheet's "live_transcript" A/B
// variant, modeled on quick-order-voice-stream. The browser opens a
// WebSocket, streams base64 PCM (16kHz mono) chunks, and receives rolling
// partial transcripts to render in the header pill. Field extraction still
// happens on the pause-chunk cadence via tip-voice-parse — this socket is
// display-only.
//
// Auth: entry-session token in the query string (browsers cannot set WS
// headers), so this function is deployed with verify_jwt = false like
// quick-order-voice-stream.

// @ts-ignore Deno Edge Functions support remote npm-style imports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2?no-dts';
import { getTipSessionById, sha256Hex } from '../_shared/tips.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  upgradeWebSocket(req: Request): { socket: WebSocket; response: Response };
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const geminiApiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY');
const liveModel = Deno.env.get('GEMINI_LIVE_MODEL') ?? 'gemini-2.5-flash-native-audio-preview-12-2025';

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

const LIVE_INSTRUCTION = `You are passively transcribing a restaurant closer reporting end-of-day tips (shift, cash amount, card amount, names splitting). Do not respond conversationally. If you must output text, output only a terse cleaned transcript of what was said.`;

function extractTranscript(raw: unknown): { text?: string; turnComplete?: boolean } {
  if (!raw || typeof raw !== 'object') return {};
  const serverContent = (raw as Record<string, unknown>).serverContent as
    | Record<string, unknown>
    | undefined;
  const inputTranscription = serverContent?.inputTranscription as
    | Record<string, unknown>
    | undefined;
  return {
    text: typeof inputTranscription?.text === 'string' ? inputTranscription.text : undefined,
    turnComplete: Boolean(serverContent?.turnComplete),
  };
}

Deno.serve(async (req) => {
  const upgrade = req.headers.get('upgrade') ?? '';
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade.', { status: 400 });
  }

  // Auth: single-use short-lived ticket minted by tip-entry-auth
  // (action "voice_ticket"), so the long-lived session token never rides in
  // a URL that proxies might log.
  const url = new URL(req.url);
  const ticket = url.searchParams.get('ticket')?.trim() ?? '';
  if (ticket.length < 16 || ticket.length > 128) {
    return new Response('Invalid ticket.', { status: 401 });
  }
  const ticketHash = await sha256Hex(ticket);
  const { data: ticketRow } = await supabaseAdmin
    .from('tip_ws_tickets')
    .update({ used: true })
    .eq('token_hash', ticketHash)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .select('session_id')
    .maybeSingle();
  if (!ticketRow?.session_id) {
    return new Response('Ticket expired.', { status: 401 });
  }
  const session = await getTipSessionById(supabaseAdmin, ticketRow.session_id);
  if (!session) {
    return new Response('Session expired.', { status: 401 });
  }
  if (!geminiApiKey) {
    return new Response('Streaming transcription unavailable.', { status: 503 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let upstream: WebSocket | null = null;

  // Hard caps: a listening session is a couple of minutes at most.
  const MAX_STREAM_MS = 4 * 60 * 1000;
  const MAX_FRAME_BYTES = 256 * 1024;
  const killTimer = setTimeout(() => {
    try {
      socket.close();
      upstream?.close();
    } catch {
      // Already closed.
    }
  }, MAX_STREAM_MS);

  socket.onopen = () => {
    upstream = new WebSocket(
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`,
    );
    upstream.onopen = () => {
      upstream?.send(JSON.stringify({
        setup: {
          model: `models/${liveModel}`,
          generationConfig: { responseModalities: ['TEXT'], temperature: 0 },
          systemInstruction: { parts: [{ text: LIVE_INSTRUCTION }] },
          inputAudioTranscription: {},
        },
      }));
    };
    upstream.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data));
        if (parsed.setupComplete) {
          send(socket, { type: 'ready' });
          return;
        }
        const { text, turnComplete } = extractTranscript(parsed);
        if (text) send(socket, { type: 'partial_transcript', text });
        if (turnComplete) send(socket, { type: 'turn_complete' });
      } catch {
        // Ignore unreadable upstream frames; this stream is display-only.
      }
    };
    upstream.onerror = () => {
      send(socket, { type: 'error', message: 'Live transcript unavailable.' });
    };
    upstream.onclose = () => {
      send(socket, { type: 'closed' });
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    };
  };

  socket.onmessage = (event) => {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
    if (typeof event.data !== 'string') return;
    if (event.data.length > MAX_FRAME_BYTES) return;
    if (event.data === '__finish__') {
      upstream.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      return;
    }
    // Anything else is a base64 PCM chunk.
    upstream.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: event.data }],
      },
    }));
  };

  socket.onclose = () => {
    clearTimeout(killTimer);
    try {
      upstream?.close();
    } catch {
      // Already closed.
    }
  };

  return response;
});
