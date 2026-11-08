// Narration engines behind one interface, so page handling (useBle) doesn't care which
// voice is speaking:
//   prepare(text) - get a page ready (Kokoro starts synthesizing it in the background)
//   play(prepared) - speak it, interrupting whatever is playing
// Gapless continuous reading prepares the next page while the current one plays.
import * as Speech from 'expo-speech';
import {
  AudioContext,
  AudioManager,
  type AudioBuffer,
  type AudioBufferQueueSourceNode,
} from 'react-native-audio-api';
import { setTelemetryEnabled, type KokoroTextToSpeech } from 'react-native-executorch';
import { cleanForSpeech, splitForSpeech } from './narration';

// Model downloads otherwise send an anonymous event; nothing about reading leaves the phone.
setTelemetryEnabled(false);

export interface SpeakOptions {
  /** System voice identifier, or Kokoro voice key, depending on the engine. */
  voice: string | null;
  /** 1.0 is normal speed. */
  rate: number;
}

export interface PlayCallbacks {
  /** The page was read to the end. */
  onDone?: () => void;
  /** Playback stopped without us asking (audio route lost, synthesis failed). */
  onInterrupted?: () => void;
}

export interface Prepared {
  readonly text: string;
}

export interface Narrator {
  readonly kind: 'system' | 'kokoro';
  prepare(text: string, options: SpeakOptions): Prepared;
  play(prepared: Prepared, callbacks: PlayCallbacks): void;
  /** Drop a prepared page that will not be played. */
  discard(prepared: Prepared): void;
  /** Stop playback and drop anything being prepared. */
  stop(): void;
}

function clampRate(rate: number) {
  return Math.max(0.5, Math.min(2, rate));
}

// --- iOS system voices (AVSpeechSynthesizer via expo-speech) ------------------------------
interface SystemPrepared extends Prepared {
  readonly options: SpeakOptions;
}

export class SystemNarrator implements Narrator {
  readonly kind = 'system' as const;
  private token = 0;

  // System voices start instantly; there is nothing to do ahead of time.
  prepare(text: string, options: SpeakOptions): Prepared {
    return { text, options } as SystemPrepared;
  }

  play(prepared: Prepared, { onDone, onInterrupted }: PlayCallbacks): void {
    this.stop();
    const { text, options } = prepared as SystemPrepared;
    // Sentence-sized utterances: the last one ending reliably marks the page as done.
    const pieces = splitForSpeech(text);
    if (!pieces.length) {
      onDone?.();
      return;
    }
    const token = this.token;
    const interrupted = () => {
      if (token === this.token) {
        this.token += 1;
        onInterrupted?.();
      }
    };
    pieces.forEach((piece, index) => {
      Speech.speak(piece, {
        language: 'en-US',
        rate: clampRate(options.rate),
        voice: options.voice ?? undefined,
        onDone:
          index === pieces.length - 1
            ? () => {
                if (token === this.token) onDone?.();
              }
            : undefined,
        onStopped: interrupted,
        onError: interrupted,
      });
    });
  }

  discard(): void {}

  stop(): void {
    this.token += 1;
    Speech.stop();
  }
}

// --- Kokoro neural voice, on device (react-native-executorch + react-native-audio-api) ----
type Synthesize = NonNullable<KokoroTextToSpeech<string>['synthesize']>;

class KokoroPrepared implements Prepared {
  readonly buffers: AudioBuffer[] = [];
  done = false;
  failed = false;
  cancelled = false;
  onBuffer?: (buffer: AudioBuffer) => void;
  onFinished?: () => void;
  constructor(
    readonly text: string,
    readonly options: SpeakOptions,
  ) {}
}

export const KOKORO_VOICES = [
  { key: 'af_heart', label: 'Heart', gender: 'female' },
  { key: 'af_sarah', label: 'Sarah', gender: 'female' },
  { key: 'af_river', label: 'River', gender: 'female' },
  { key: 'am_michael', label: 'Michael', gender: 'male' },
  { key: 'am_adam', label: 'Adam', gender: 'male' },
] as const;
export const DEFAULT_KOKORO_VOICE = 'af_heart';

export class KokoroNarrator implements Narrator {
  readonly kind = 'kokoro' as const;
  private context: AudioContext | null = null;
  private source: AudioBufferQueueSourceNode | null = null;
  private token = 0;
  private queue: KokoroPrepared[] = []; // pages waiting to be synthesized, in order
  private synthesizing: KokoroPrepared | null = null;

  constructor(
    private readonly synthesize: Synthesize,
    private readonly synthesizeStop: () => void,
  ) {}

  private audio(): AudioContext {
    if (!this.context) {
      // Same session as the system voice: keeps reading with the screen locked, ignores the mute switch.
      AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'spokenAudio' });
      this.context = new AudioContext();
    }
    return this.context;
  }

  prepare(text: string, options: SpeakOptions): Prepared {
    const prepared = new KokoroPrepared(text, options);
    this.queue.push(prepared);
    void this.pump();
    return prepared;
  }

  // One page at a time: the model is single-use, and the page being heard goes first.
  private async pump(): Promise<void> {
    if (this.synthesizing) {
      return;
    }
    while (this.queue.length) {
      const job = this.queue.shift()!;
      if (job.cancelled) {
        continue;
      }
      this.synthesizing = job;
      try {
        const speed = Math.max(0.5, Math.min(2, job.options.rate));
        const voice = job.options.voice ?? DEFAULT_KOKORO_VOICE;
        for await (const chunk of this.synthesize(cleanForSpeech(job.text), { voice, speed })) {
          if (job.cancelled) {
            break;
          }
          const buffer = this.audio().createBuffer(1, chunk.audio.length, chunk.sampleRate);
          buffer.copyToChannel(chunk.audio as Float32Array<ArrayBuffer>, 0);
          job.buffers.push(buffer);
          job.onBuffer?.(buffer);
        }
      } catch {
        job.failed = !job.cancelled;
      } finally {
        job.done = true;
        this.synthesizing = null;
        job.onFinished?.();
      }
    }
  }

  play(prepared: Prepared, { onDone, onInterrupted }: PlayCallbacks): void {
    this.stopPlayback();
    const job = prepared as KokoroPrepared;
    const token = this.token;
    const context = this.audio();
    void context.resume();
    const source = context.createBufferQueueSource();
    source.connect(context.destination);
    this.source = source;

    let queued = 0;
    let ended = 0;
    let started = false;
    const finishIfDone = () => {
      if (token !== this.token || !job.done || ended < queued) {
        return;
      }
      this.token += 1; // report once
      if (job.failed) {
        onInterrupted?.();
      } else {
        onDone?.();
      }
    };
    const enqueue = (buffer: AudioBuffer) => {
      if (token !== this.token) {
        return;
      }
      source.enqueueBuffer(buffer);
      queued += 1;
      if (!started) {
        source.start();
        started = true;
      }
    };
    source.onBufferEnded = () => {
      ended += 1;
      finishIfDone();
    };
    job.buffers.forEach(enqueue);
    job.onBuffer = enqueue;
    job.onFinished = finishIfDone;
    finishIfDone(); // already fully synthesized and empty, or failed
  }

  discard(prepared: Prepared): void {
    const job = prepared as KokoroPrepared;
    job.cancelled = true;
    if (this.synthesizing === job) {
      this.synthesizeStop();
    }
  }

  private stopPlayback(): void {
    this.token += 1;
    if (this.source) {
      this.source.onBufferEnded = null;
      try {
        this.source.stop();
      } catch {
        // not started yet
      }
      this.source.clearBuffers();
      this.source = null;
    }
  }

  stop(): void {
    this.stopPlayback();
    this.queue.forEach((job) => (job.cancelled = true));
    this.queue = [];
    if (this.synthesizing) {
      this.synthesizing.cancelled = true;
      this.synthesizeStop();
    }
  }
}
