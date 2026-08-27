// Thin wrapper around the browser's native SpeechRecognition for the
// "local_live" voice variant. Continuous + interim results, with the
// platform quirks handled here so the voice sheet stays simple:
//
//  * iOS Safari and Chrome both end recognition sessions on their own
//    (silence, tab switches, engine hiccups) — while running, the wrapper
//    restarts transparently.
//  * A restart implicitly finalizes any pending interim text (Safari often
//    never flags a final result before ending) — the wrapper emits it as a
//    final utterance so no speech is lost.
//  * Utterance callbacks carry the CURRENT utterance's text only; the
//    caller re-parses that text on every interim update.

export interface LiveSpeechCallbacks {
  /** Interim or final text for the utterance in progress. */
  onUtterance: (text: string, isFinal: boolean) => void;
  /** Fatal problems only — transient no-speech/abort states auto-restart. */
  onError: (kind: "permission" | "unavailable") => void;
}

interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: MinimalRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface MinimalRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type SpeechRecognitionCtor = new () => MinimalSpeechRecognition;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class LiveSpeech {
  private recognition: MinimalSpeechRecognition | null = null;
  private callbacks: LiveSpeechCallbacks | null = null;
  private running = false;
  private pendingInterim = "";
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;

  static isSupported(): boolean {
    return recognitionCtor() !== null;
  }

  start(callbacks: LiveSpeechCallbacks): boolean {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      callbacks.onError("unavailable");
      return false;
    }
    this.callbacks = callbacks;
    this.running = true;
    this.spawn(Ctor);
    return true;
  }

  private spawn(Ctor: SpeechRecognitionCtor): void {
    const recognition = new Ctor();
    this.recognition = recognition;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      if (!this.running || !this.callbacks) return;
      this.consecutiveErrors = 0;
      // Walk every result from the engine's change index: finals are emitted
      // once, and everything still interim is joined into the live utterance.
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          if (text.trim()) this.callbacks.onUtterance(text.trim(), true);
        } else {
          interim += text;
        }
      }
      this.pendingInterim = interim.trim();
      if (this.pendingInterim) {
        this.callbacks.onUtterance(this.pendingInterim, false);
      }
    };

    recognition.onerror = (event) => {
      if (!this.running || !this.callbacks) return;
      const error = event.error ?? "";
      if (error === "not-allowed" || error === "service-not-allowed") {
        this.running = false;
        this.callbacks.onError("permission");
        return;
      }
      // "no-speech"/"aborted"/"network" — let onend handle the restart, but
      // give up if the engine errors over and over without ever hearing us.
      this.consecutiveErrors += 1;
      if (this.consecutiveErrors >= 4) {
        this.running = false;
        this.callbacks.onError("unavailable");
      }
    };

    recognition.onend = () => {
      if (!this.callbacks) return;
      // The engine ended the session; whatever interim text is left is as
      // final as it will ever get.
      this.flushInterim();
      if (!this.running) return;
      // Restart shortly — immediate restarts can throw on Safari.
      this.restartTimer = setTimeout(() => {
        if (!this.running) return;
        try {
          this.spawn(Ctor);
        } catch {
          this.running = false;
          this.callbacks?.onError("unavailable");
        }
      }, 120);
    };

    recognition.start();
  }

  private flushInterim(): void {
    if (this.pendingInterim && this.callbacks) {
      this.callbacks.onUtterance(this.pendingInterim, true);
    }
    this.pendingInterim = "";
  }

  /** Stop listening; flushes any pending interim text as final. */
  stop(): void {
    this.running = false;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
    }
    this.flushInterim();
    this.callbacks = null;
  }
}
