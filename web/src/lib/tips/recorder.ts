// Microphone capture for the voice sheet.
//
// Three concurrent outputs from one getUserMedia stream:
//   * onLevel  — RMS amplitude ~30x/sec for the Variant A waveform.
//   * onChunk  — a self-contained audio Blob emitted after each speech pause
//                (~1.4s of silence). Implemented by stopping and immediately
//                restarting the MediaRecorder so every chunk has a valid
//                container header; blobs go to tip-voice-parse.
//   * onPcm    — base64 16kHz mono PCM16 frames for the Variant B live
//                transcript WebSocket. Only produced when enabled.
//
// Safari records audio/mp4, Chrome/Android audio/webm — both accepted by the
// edge function.

export interface RecorderCallbacks {
  onLevel?: (level: number) => void;
  onChunk?: (blob: Blob) => void;
  onPcm?: (base64: string) => void;
  onError?: (message: string) => void;
}

const SILENCE_MS = 1400;
const MIN_SPEECH_MS = 400;
const SPEECH_RMS = 0.015;
const PCM_TARGET_RATE = 16000;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

function floatTo16kPcmBase64(
  input: Float32Array,
  inputRate: number,
): string | null {
  if (inputRate <= 0 || input.length === 0) return null;
  const ratio = inputRate / PCM_TARGET_RATE;
  const outLength = Math.floor(input.length / ratio);
  if (outLength === 0) return null;
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(input.length - 1, left + 1);
    const frac = pos - left;
    const sample = input[left] * (1 - frac) + input[right] * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(out.buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export class TipRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private recorder: MediaRecorder | null = null;
  private mimeType: string | undefined;
  private callbacks: RecorderCallbacks = {};
  private pcmEnabled = false;
  private running = false;

  private lastSpeechAt = 0;
  private speechStartedAt = 0;
  private hadSpeechThisSegment = false;
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private pendingStopResolve: ((blob: Blob | null) => void) | null = null;
  private restartAfterStop = false;

  static isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined"
    );
  }

  async start(callbacks: RecorderCallbacks, options?: { pcm?: boolean }): Promise<void> {
    if (this.running) return;
    this.callbacks = callbacks;
    this.pcmEnabled = options?.pcm === true;
    this.mimeType = pickMimeType();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.running = true;

    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioContextCtor();
    await this.audioContext.resume();
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but still the widest-support way to tap
    // raw samples on iOS Safari without shipping a worklet asset.
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (!this.running) return;
      const samples = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      this.callbacks.onLevel?.(Math.min(1, rms * 12));
      const now = Date.now();
      if (rms >= SPEECH_RMS) {
        if (!this.hadSpeechThisSegment) this.speechStartedAt = now;
        this.hadSpeechThisSegment = true;
        this.lastSpeechAt = now;
      }
      if (this.pcmEnabled && this.audioContext) {
        const base64 = floatTo16kPcmBase64(
          new Float32Array(samples),
          this.audioContext.sampleRate,
        );
        if (base64) this.callbacks.onPcm?.(base64);
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.startSegment();
    this.silenceTimer = setInterval(() => this.checkSilence(), 250);
  }

  private startSegment(): void {
    if (!this.stream || !this.running) return;
    try {
      this.recorder = this.mimeType
        ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
        : new MediaRecorder(this.stream);
    } catch {
      this.callbacks.onError?.("Recording is not supported on this phone.");
      return;
    }
    const segmentChunks: Blob[] = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) segmentChunks.push(event.data);
    };
    this.recorder.onstop = () => {
      const blob =
        segmentChunks.length > 0
          ? new Blob(segmentChunks, { type: this.recorder?.mimeType || this.mimeType || "audio/webm" })
          : null;
      const resolve = this.pendingStopResolve;
      this.pendingStopResolve = null;
      if (resolve) {
        resolve(blob);
      } else if (blob && this.hadSpeechThisSegment) {
        this.callbacks.onChunk?.(blob);
      }
      this.hadSpeechThisSegment = false;
      if (this.restartAfterStop && this.running) {
        this.startSegment();
      }
    };
    this.recorder.start();
  }

  private checkSilence(): void {
    if (!this.running || !this.recorder || this.recorder.state !== "recording") return;
    if (!this.hadSpeechThisSegment) return;
    const now = Date.now();
    const spokeLongEnough = this.lastSpeechAt - this.speechStartedAt >= MIN_SPEECH_MS;
    if (now - this.lastSpeechAt >= SILENCE_MS && spokeLongEnough) {
      // Pause detected: close this segment (emits chunk) and start the next.
      this.restartAfterStop = true;
      this.recorder.stop();
    }
  }

  /** Stop everything; resolves with the final segment when it had speech. */
  async finish(): Promise<Blob | null> {
    if (!this.running) return null;
    this.running = false;
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    this.restartAfterStop = false;

    let finalBlob: Blob | null = null;
    if (this.recorder && this.recorder.state === "recording") {
      const hadSpeech = this.hadSpeechThisSegment;
      finalBlob = await new Promise<Blob | null>((resolve) => {
        this.pendingStopResolve = (blob) => resolve(hadSpeech ? blob : null);
        this.recorder?.stop();
      });
    }
    this.teardown();
    return finalBlob;
  }

  cancel(): void {
    this.running = false;
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    this.restartAfterStop = false;
    try {
      if (this.recorder && this.recorder.state === "recording") this.recorder.stop();
    } catch {
      // Already stopped.
    }
    this.teardown();
  }

  private teardown(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = null;
    this.source = null;
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}
