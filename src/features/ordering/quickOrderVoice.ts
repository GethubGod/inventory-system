import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import type { QuickOrderVoiceErrorCode } from './quickOrderVoiceState';

const QUICK_ORDER_VOICE_UPLOAD_TIMEOUT_MS = 45_000;
export {
  isQuickOrderVoiceTooShort,
  reduceQuickOrderVoiceState,
  type QuickOrderVoiceErrorCode,
  type QuickOrderVoiceEvent,
  type QuickOrderVoiceMachineState,
  type QuickOrderVoiceStatus,
} from './quickOrderVoiceState';

export type QuickOrderVoiceUploadInput = {
  uri: string;
  durationMs: number;
  locationId: string;
  userId: string;
  sessionId: string | null;
  mode: 'order' | 'inventory';
  existingItems: unknown[];
  recentMessages: unknown[];
};

export type VoiceTranscriptResult = {
  success: true;
  rawTranscript: string;
  normalizedText: string;
  detectedLanguages: string[];
  modelUsed: string;
  fallbackUsed: boolean;
  latencyMs: number;
  latencyBreakdown?: Record<string, unknown>;
  voiceEventId: string | null;
  warnings: string[];
  confidence: number;
  needsReview: boolean;
  actions: VoiceParsedAction[];
  unresolved: VoiceUnresolvedAction[];
  source: 'upload' | 'stream';
};

export type VoiceParsedAction = {
  type: 'add' | 'remove' | 'set_remaining' | 'note' | 'unknown';
  itemId: string | null;
  itemName: string;
  canonicalItemName: string | null;
  spokenItemName: string;
  quantity: number | null;
  unit: string | null;
  confidence: number;
  catalogMatchConfidence: number;
  sourceText: string;
  alternatives?: {
    itemId: string;
    itemName: string;
    confidence: number;
  }[];
};

export type VoiceUnresolvedAction = {
  sourceText: string;
  reason:
    | 'missing_quantity'
    | 'missing_unit'
    | 'unknown_item'
    | 'ambiguous_item'
    | 'unsupported_command'
    | 'low_confidence';
  spokenItemName?: string;
  alternatives?: {
    itemId: string;
    itemName: string;
    confidence: number;
  }[];
};

export type VoiceTranscriptFailure = {
  success: false;
  errorCode: QuickOrderVoiceErrorCode;
  message: string;
  retryable: boolean;
  rawTranscript?: string;
  normalizedText?: string;
  warnings?: string[];
};

export type VoiceTranscriptResponse =
  | VoiceTranscriptResult
  | VoiceTranscriptFailure;

export type QuickOrderVoiceStreamEvent =
  | { type: 'partial_transcript'; text: string }
  | { type: 'cleaned_partial'; text: string }
  | { type: 'final_text'; rawTranscript?: string; normalizedText: string; confidence?: number; warnings?: string[]; voiceEventId?: string | null; latencyMs?: number }
  | { type: 'warning'; message: string }
  | { type: 'error'; errorCode?: QuickOrderVoiceErrorCode; message: string; retryable?: boolean }
  | { type: 'done'; rawTranscript?: string; normalizedText?: string; confidence?: number; warnings?: string[]; voiceEventId?: string | null; latencyMs?: number };

export type VoiceStreamSession = {
  sendAudioChunk: (chunk: ArrayBuffer | Uint8Array | string) => void;
  finish: () => void;
  close: () => void;
};

export type QuickOrderVoiceStreamInput = {
  locationId: string;
  userId: string;
  sessionId: string | null;
  mode: 'order' | 'inventory';
  onEvent: (event: QuickOrderVoiceStreamEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export async function cleanupQuickOrderVoiceFile(uri: string | null | undefined) {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function getSupabaseFunctionsBaseUrl(): string {
  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!baseUrl) throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL');
  return `${baseUrl.replace(/\/+$/, '')}/functions/v1`;
}

function getSupabaseFunctionUrl(functionName: string): string {
  return `${getSupabaseFunctionsBaseUrl()}/${functionName}`;
}

function getSupabaseFunctionWsUrl(functionName: string): string {
  return getSupabaseFunctionUrl(functionName).replace(/^http/i, 'ws');
}

function normalizeVoiceErrorCode(value: unknown): QuickOrderVoiceErrorCode {
  if (
    value === 'PERMISSION_DENIED' ||
    value === 'TOO_SHORT' ||
    value === 'INVALID_AUDIO' ||
    value === 'VOICE_LOW_CONFIDENCE' ||
    value === 'NETWORK_ERROR' ||
    value === 'MODEL_FAILED' ||
    value === 'SCHEMA_INVALID'
  ) {
    return value;
  }
  if (value === 'FILE_TOO_LARGE') return 'INVALID_AUDIO';
  return 'UNKNOWN';
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (
      error.name === 'AbortError' ||
      /aborted|abort/i.test(error.message)
    )
  );
}

function normalizeVoiceParsedActions(value: unknown): VoiceParsedAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VoiceParsedAction[] => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const type = row.type;
    if (
      type !== 'add' &&
      type !== 'remove' &&
      type !== 'set_remaining' &&
      type !== 'note' &&
      type !== 'unknown'
    ) {
      return [];
    }
    const itemName = typeof row.itemName === 'string' ? row.itemName : '';
    const spokenItemName = typeof row.spokenItemName === 'string' ? row.spokenItemName : itemName;
    return [{
      type,
      itemId: typeof row.itemId === 'string' ? row.itemId : null,
      itemName,
      canonicalItemName: typeof row.canonicalItemName === 'string' ? row.canonicalItemName : null,
      spokenItemName,
      quantity: typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : null,
      unit: typeof row.unit === 'string' ? row.unit : null,
      confidence: typeof row.confidence === 'number' ? row.confidence : 0.5,
      catalogMatchConfidence: typeof row.catalogMatchConfidence === 'number' ? row.catalogMatchConfidence : 0,
      sourceText: typeof row.sourceText === 'string' ? row.sourceText : spokenItemName,
      alternatives: normalizeVoiceAlternatives(row.alternatives),
    }];
  });
}

function normalizeVoiceUnresolvedActions(value: unknown): VoiceUnresolvedAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VoiceUnresolvedAction[] => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const reason = row.reason;
    if (
      reason !== 'missing_quantity' &&
      reason !== 'missing_unit' &&
      reason !== 'unknown_item' &&
      reason !== 'ambiguous_item' &&
      reason !== 'unsupported_command' &&
      reason !== 'low_confidence'
    ) {
      return [];
    }
    return [{
      sourceText: typeof row.sourceText === 'string' ? row.sourceText : '',
      reason,
      spokenItemName: typeof row.spokenItemName === 'string' ? row.spokenItemName : undefined,
      alternatives: normalizeVoiceAlternatives(row.alternatives),
    }];
  });
}

function normalizeVoiceAlternatives(value: unknown): VoiceParsedAction['alternatives'] {
  if (!Array.isArray(value)) return undefined;
  const alternatives = value.flatMap((entry): NonNullable<VoiceParsedAction['alternatives']> => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const itemId = typeof row.itemId === 'string' ? row.itemId : null;
    const itemName = typeof row.itemName === 'string' ? row.itemName : null;
    if (!itemId || !itemName) return [];
    return [{
      itemId,
      itemName,
      confidence: typeof row.confidence === 'number' ? row.confidence : 0.5,
    }];
  });
  return alternatives.length > 0 ? alternatives : undefined;
}

export async function transcribeQuickOrderVoiceFile(
  input: QuickOrderVoiceUploadInput,
): Promise<VoiceTranscriptResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return {
      success: false,
      errorCode: 'UNKNOWN',
      message: 'Sign in again before using voice order.',
      retryable: false,
    };
  }

  const formData = new FormData();
  formData.append('audio', {
    uri: input.uri,
    name: 'quick-order-voice.m4a',
    type: 'audio/mp4',
  } as unknown as Blob);
  formData.append('duration_ms', String(Math.round(input.durationMs)));
  formData.append('location_id', input.locationId);
  formData.append('user_id', input.userId);
  if (input.sessionId) formData.append('session_id', input.sessionId);
  formData.append('mode', input.mode);
  formData.append('existing_items', JSON.stringify(input.existingItems));
  formData.append('recent_messages', JSON.stringify(input.recentMessages));

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, QUICK_ORDER_VOICE_UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(getSupabaseFunctionUrl('quick-order-voice-parse'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      return {
        success: false,
        errorCode: normalizeVoiceErrorCode(payload?.errorCode),
        message:
          typeof payload?.message === 'string'
            ? payload.message
            : 'Voice order cleanup failed. Try again.',
        retryable: payload?.retryable !== false,
        rawTranscript: typeof payload?.rawTranscript === 'string' ? payload.rawTranscript : undefined,
        normalizedText: typeof payload?.normalizedText === 'string' ? payload.normalizedText : undefined,
        warnings: Array.isArray(payload?.warnings)
          ? payload.warnings.filter((entry: unknown): entry is string => typeof entry === 'string')
          : undefined,
      };
    }
    return {
      success: true,
      rawTranscript: typeof payload.rawTranscript === 'string' ? payload.rawTranscript : '',
      normalizedText: typeof payload.normalizedText === 'string' ? payload.normalizedText : '',
      detectedLanguages: Array.isArray(payload.detectedLanguages)
        ? payload.detectedLanguages.filter((entry: unknown): entry is string => typeof entry === 'string')
        : [],
      modelUsed: typeof payload.modelUsed === 'string' ? payload.modelUsed : 'unknown',
      fallbackUsed: Boolean(payload.fallbackUsed),
      latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : 0,
      latencyBreakdown: payload.latencyBreakdown && typeof payload.latencyBreakdown === 'object'
        ? payload.latencyBreakdown as Record<string, unknown>
        : undefined,
      voiceEventId: typeof payload.voiceEventId === 'string' ? payload.voiceEventId : null,
      warnings: Array.isArray(payload.warnings)
        ? payload.warnings.filter((entry: unknown): entry is string => typeof entry === 'string')
        : [],
      confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.5,
      needsReview: payload.needsReview !== false,
      actions: normalizeVoiceParsedActions(payload.actions),
      unresolved: normalizeVoiceUnresolvedActions(payload.unresolved),
      source: payload.source === 'stream' ? 'stream' : 'upload',
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        success: false,
        errorCode: 'NETWORK_ERROR',
        message: 'Voice cleanup took too long. Try again with a shorter order.',
        retryable: true,
      };
    }
    return {
      success: false,
      errorCode: 'NETWORK_ERROR',
      message: "You're offline or the voice cleanup server could not be reached. Try again.",
      retryable: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const uploadQuickOrderVoiceParse = transcribeQuickOrderVoiceFile;

export async function createQuickOrderVoiceStream(
  input: QuickOrderVoiceStreamInput,
): Promise<VoiceStreamSession | null> {
  // TODO(voice-streaming): when streaming becomes the default, emit the same
  // structured actions/unresolved shape as quick-order-voice-parse.
  if (process.env.EXPO_PUBLIC_ENABLE_QUICK_ORDER_VOICE_STREAMING !== 'true') {
    return null;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    input.onEvent({
      type: 'error',
      errorCode: 'UNKNOWN',
      message: 'Sign in again before using voice order.',
      retryable: false,
    });
    return null;
  }

  const params = new URLSearchParams({
    jwt: accessToken,
    location_id: input.locationId,
    user_id: input.userId,
    mode: input.mode,
  });
  if (input.sessionId) params.set('session_id', input.sessionId);

  const ws = new WebSocket(`${getSupabaseFunctionWsUrl('quick-order-voice-stream')}?${params.toString()}`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => input.onOpen?.();
  ws.onclose = () => input.onClose?.();
  ws.onerror = () => {
    input.onEvent({
      type: 'error',
      errorCode: 'NETWORK_ERROR',
      message: 'Realtime voice connection failed. Falling back to upload.',
      retryable: true,
    });
  };
  ws.onmessage = (message) => {
    if (typeof message.data !== 'string') return;
    try {
      input.onEvent(JSON.parse(message.data) as QuickOrderVoiceStreamEvent);
    } catch {
      input.onEvent({
        type: 'warning',
        message: 'Received an unreadable realtime voice update.',
      });
    }
  };

  return {
    sendAudioChunk(chunk) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(chunk);
    },
    finish() {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'finish' }));
    },
    close() {
      ws.close();
    },
  };
}
