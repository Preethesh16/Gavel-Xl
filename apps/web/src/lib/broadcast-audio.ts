export const BROADCAST_AUDIO_EVENT = 'gavel-xi:broadcast-audio';
export const BROADCAST_CANCEL_EVENT = 'gavel-xi:broadcast-cancel';

export type SoundCue =
  | 'join'
  | 'reveal'
  | 'bid'
  | 'outbid'
  | 'sold'
  | 'unsold'
  | 'forced'
  | 'checkpoint'
  | 'category'
  | 'winner'
  | 'scan'
  | 'transition';

export interface BroadcastAudioEvent {
  /** Stable for this presentation beat, so a rerender cannot repeat the commentary. */
  id: string;
  cue: SoundCue;
  message?: string;
  delayMs?: number;
}

/** Presentation events stay local; they never alter or announce ahead of the game state. */
export function emitBroadcast(detail: BroadcastAudioEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BROADCAST_AUDIO_EVENT, { detail }));
}

export function cancelBroadcastNarration(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(BROADCAST_CANCEL_EVENT));
}

interface NarrationDriver {
  speak: (message: string, done: () => void) => void;
  cancel: () => void;
  onSpeaking: (speaking: boolean) => void;
}

/** A single replaceable line, not a speech queue that can trail behind the live match. */
export class BroadcastNarrator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private held = false;
  private pending: { message: string; readyAt: number; expiresAt: number } | null = null;

  constructor(private readonly driver: NarrationDriver) {}

  queue(message: string, delayMs = 80): void {
    this.cancel();
    const delay = Math.max(0, Math.min(delayMs, 10_000));
    this.pending = {
      message,
      readyAt: Date.now() + delay,
      expiresAt: Date.now() + delay + 12_000,
    };
    this.flush();
  }

  hold(held: boolean): void {
    this.held = held;
    if (!held) this.flush();
  }

  private flush(): void {
    if (!this.pending || this.held) return;
    if (this.pending.expiresAt <= Date.now()) {
      this.pending = null;
      return;
    }
    const generation = this.generation;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (generation !== this.generation || this.held || !this.pending) return;
        const { message } = this.pending;
        this.pending = null;
        const finish = () => {
          if (generation !== this.generation) return;
          if (this.watchdog !== null) clearTimeout(this.watchdog);
          this.watchdog = null;
          this.driver.onSpeaking(false);
        };
        this.driver.onSpeaking(true);
        // Some browser voices never send end/error; never leave the soundtrack ducked.
        this.watchdog = setTimeout(() => {
          if (generation !== this.generation) return;
          this.driver.cancel();
          finish();
        }, 15_000);
        try {
          this.driver.speak(message, finish);
        } catch {
          finish();
        }
      },
      Math.max(0, this.pending.readyAt - Date.now()),
    );
  }

  cancel(): void {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.timer = null;
    this.watchdog = null;
    this.pending = null;
    this.driver.cancel();
    this.driver.onSpeaking(false);
  }
}
