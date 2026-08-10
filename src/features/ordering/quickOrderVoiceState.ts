export type QuickOrderVoiceStatus =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'review_ready'
  | 'adding_to_order'
  | 'added'
  | 'failed'
  | 'cancelled';

export type QuickOrderVoiceEvent =
  | 'start'
  | 'stop'
  | 'transcribe'
  | 'review_ready'
  | 'add_to_order'
  | 'added'
  | 'process_failed'
  | 'cancel'
  | 'reset';

export type QuickOrderVoiceErrorCode =
  | 'PERMISSION_DENIED'
  | 'TOO_SHORT'
  | 'INVALID_AUDIO'
  | 'VOICE_LOW_CONFIDENCE'
  | 'NETWORK_ERROR'
  | 'MODEL_FAILED'
  | 'SCHEMA_INVALID'
  | 'UNKNOWN';

export type QuickOrderVoiceMachineState = {
  status: QuickOrderVoiceStatus;
  uploadInFlight: boolean;
  errorCode: QuickOrderVoiceErrorCode | null;
};

const MIN_RECORDING_MS = 700;

export function reduceQuickOrderVoiceState(
  state: QuickOrderVoiceMachineState,
  event: QuickOrderVoiceEvent,
  errorCode: QuickOrderVoiceErrorCode | null = null,
): QuickOrderVoiceMachineState {
  switch (event) {
    case 'start':
      if (state.status === 'transcribing' || state.uploadInFlight) return state;
      return { status: 'recording', uploadInFlight: false, errorCode: null };
    case 'stop':
      if (state.status !== 'recording') return state;
      return { status: 'transcribing', uploadInFlight: true, errorCode: null };
    case 'transcribe':
      if (state.status !== 'recording' && state.status !== 'failed') return state;
      return { status: 'transcribing', uploadInFlight: true, errorCode: null };
    case 'review_ready':
      if (!state.uploadInFlight) return state;
      return { status: 'review_ready', uploadInFlight: false, errorCode: null };
    case 'add_to_order':
      if (state.status !== 'review_ready') return state;
      return { status: 'adding_to_order', uploadInFlight: false, errorCode: null };
    case 'added':
      if (state.status !== 'adding_to_order' && state.status !== 'review_ready') return state;
      return { status: 'added', uploadInFlight: false, errorCode: null };
    case 'process_failed':
      return { status: 'failed', uploadInFlight: false, errorCode: errorCode ?? 'UNKNOWN' };
    case 'cancel':
      if (state.status === 'transcribing') return state;
      return { status: 'cancelled', uploadInFlight: false, errorCode: null };
    case 'reset':
      return { status: 'idle', uploadInFlight: false, errorCode: null };
    default:
      return state;
  }
}

export function isQuickOrderVoiceTooShort(durationMs: number): boolean {
  return !Number.isFinite(durationMs) || durationMs < MIN_RECORDING_MS;
}
