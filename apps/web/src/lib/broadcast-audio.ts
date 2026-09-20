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
  /** Settles once when narration finishes or cannot continue, including cancellation. */
  onSettled?: () => void;
}

/** Listener, speech, and cancellation paths can converge on the same completion. */
export function onceSettled(callback?: () => void): () => void {
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    callback?.();
  };
}

/** Presentation events stay local; they never alter or announce ahead of the game state. */
export function emitBroadcast(detail: BroadcastAudioEvent): void {
  const settle = onceSettled(detail.onSettled);
  if (typeof window === 'undefined') {
    settle();
    return;
  }
  const event = new CustomEvent(BROADCAST_AUDIO_EVENT, {
    detail: { ...detail, onSettled: settle },
    cancelable: true,
  });
  window.dispatchEvent(event);
  // The sound listener acknowledges ownership with preventDefault. A public view
  // without a mounted mixer must never leave a ceremony waiting for absent audio.
  if (!event.defaultPrevented) settle();
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
  private pendingExpiry: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private held = false;
  private pending: { message: string; readyAt: number; expiresAt: number } | null = null;
  private settleCurrent: (() => void) | null = null;

  constructor(private readonly driver: NarrationDriver) {}

  queue(message: string, delayMs = 80, onSettled?: () => void): void {
    this.cancel();
    this.settleCurrent = onceSettled(onSettled);
    const delay = Math.max(0, Math.min(delayMs, 10_000));
    this.pending = {
      message,
      readyAt: Date.now() + delay,
      expiresAt: Date.now() + delay + 12_000,
    };
    const generation = this.generation;
    this.pendingExpiry = setTimeout(() => {
      if (generation === this.generation && this.pending) this.cancel();
    }, delay + 12_000);
    this.flush();
  }

  hold(held: boolean): void {
    this.held = held;
    if (!held) this.flush();
  }

  private flush(): void {
    if (!this.pending || this.held) return;
    if (this.pending.expiresAt <= Date.now()) {
      this.cancel();
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
        if (this.pendingExpiry !== null) clearTimeout(this.pendingExpiry);
        this.pendingExpiry = null;
        const finish = () => {
          if (generation !== this.generation) return;
          this.generation += 1;
          if (this.watchdog !== null) clearTimeout(this.watchdog);
          this.watchdog = null;
          const settle = this.settleCurrent;
          this.settleCurrent = null;
          try {
            this.driver.onSpeaking(false);
          } finally {
            settle?.();
          }
        };
        this.driver.onSpeaking(true);
        // Some browser voices never send end/error; never leave the soundtrack ducked.
        // Longer team-analysis scripts need time to finish at normal speaking speed.
        const words = message.trim().split(/\s+/).filter(Boolean).length;
        const speechTimeout = Math.min(60_000, Math.max(15_000, words * 500 + 5_000));
        this.watchdog = setTimeout(() => {
          if (generation !== this.generation) return;
          try {
            this.driver.cancel();
          } catch {
            // A broken browser teardown still releases the presentation.
          } finally {
            finish();
          }
        }, speechTimeout);
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
    if (this.pendingExpiry !== null) clearTimeout(this.pendingExpiry);
    this.timer = null;
    this.watchdog = null;
    this.pendingExpiry = null;
    this.pending = null;
    const settle = this.settleCurrent;
    this.settleCurrent = null;
    try {
      this.driver.cancel();
    } catch {
      // Optional browser audio teardown must not block replacement narration.
    }
    try {
      this.driver.onSpeaking(false);
    } finally {
      settle?.();
    }
  }
}
