export type CommentaryVoice = 'af_heart' | 'bf_emma' | 'device';
export type NeuralStatus = {
  state: 'idle' | 'loading' | 'ready' | 'unavailable';
  progress: number;
};

/** Bound total inference time separately from the duration of generated speech. */
export function neuralSynthesisBudget(text: string): number {
  return Math.min(180_000, Math.max(30_000, text.trim().split(/\s+/).length * 1500 + 15_000));
}

/** One model per tab, retained across the room/results route transition. */
export class NeuralCommentary {
  private worker: Worker | null = null;
  private status: NeuralStatus = { state: 'idle', progress: 0 };
  private listeners = new Set<(status: NeuralStatus) => void>();
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private pending: {
    id: number;
    resolve: () => void;
    onChunk: (wav: ArrayBuffer, text: string) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    deadline: number;
  } | null = null;

  subscribe(listener: (status: NeuralStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get ready(): boolean {
    return this.status.state === 'ready';
  }

  private publish(status: NeuralStatus): void {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }

  private fail(): void {
    if (this.loadTimer !== null) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.publish({ state: 'unavailable', progress: 0 });
  }

  prepare(retry = false): void {
    if (this.worker || (this.status.state === 'unavailable' && !retry)) return;
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      this.publish({ state: 'unavailable', progress: 0 });
      return;
    }
    this.publish({ state: 'loading', progress: 0 });
    const fail = () => this.fail();
    try {
      this.worker = new Worker('/audio/commentary-worker.js', { type: 'module' });
      this.worker.onerror = fail;
      this.worker.onmessageerror = fail;
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          this.publish({ state: 'loading', progress: Math.max(0, Math.min(100, data.progress)) });
        } else if (data.type === 'ready') {
          if (this.loadTimer !== null) clearTimeout(this.loadTimer);
          this.loadTimer = null;
          this.publish({ state: 'ready', progress: 100 });
        } else if (data.type === 'load-error') {
          fail();
        } else if (this.pending && this.pending.id === data.id) {
          const pending = this.pending;
          if (data.type === 'audio' && data.wav instanceof ArrayBuffer) {
            clearTimeout(pending.timeout);
            pending.timeout = setTimeout(
              () => this.fail(),
              Math.min(30_000, Math.max(0, pending.deadline - Date.now())),
            );
            pending.onChunk(data.wav, typeof data.text === 'string' ? data.text : '');
          } else {
            this.pending = null;
            clearTimeout(pending.timeout);
            if (data.type === 'complete') pending.resolve();
            else {
              pending.reject(new Error('Neural commentary failed'));
              this.fail();
            }
          }
        }
      };
      // A blocked CDN, failed download, or low-memory device cannot stall the game.
      this.loadTimer = setTimeout(fail, 180_000);
      this.worker.postMessage({ type: 'prepare' });
    } catch {
      fail();
    }
  }

  synthesize(
    text: string,
    voice: Exclude<CommentaryVoice, 'device'>,
    onChunk: (wav: ArrayBuffer, text: string) => void,
  ): Promise<void> {
    this.cancel();
    if (!this.ready || !this.worker) return Promise.reject(new Error('Neural voice not ready'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.fail();
      }, 30_000);
      this.pending = {
        id,
        resolve,
        reject,
        onChunk,
        timeout,
        deadline: Date.now() + neuralSynthesisBudget(text),
      };
      this.worker!.postMessage({ type: 'speak', id, text: text.slice(0, 1800), voice });
    });
  }

  cancel(): void {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timeout);
    this.worker?.postMessage({ type: 'cancel', id: pending.id });
    pending.reject(new Error('Neural commentary cancelled'));
  }
}

let commentary: NeuralCommentary | null = null;
export function getNeuralCommentary(): NeuralCommentary {
  commentary ??= new NeuralCommentary();
  return commentary;
}
