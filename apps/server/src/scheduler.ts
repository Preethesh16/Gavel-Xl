import type { RoomService } from './room-service.js';

const MAX_TIMEOUT_MS = 2_147_483_647;

interface ScheduledWake {
  wakeAt: number;
}

/**
 * Process-local wakeups with persisted revision fencing. Multiple production
 * workers may schedule the same deadline; the shared Redis room lock plus revision
 * makes all but one wake a no-op.
 */
export class RoomScheduler {
  readonly #service: RoomService;
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #hostTimers = new Map<string, NodeJS.Timeout>();
  readonly #now: () => number;
  #closed = false;

  constructor(service: RoomService, now: () => number = Date.now) {
    this.#service = service;
    this.#now = now;
  }

  schedule(roomCode: string, wake: ScheduledWake | null): void {
    this.cancel(roomCode);
    if (wake === null || this.#closed) return;
    const delay = Math.max(0, Math.min(MAX_TIMEOUT_MS, wake.wakeAt - this.#now()));
    const timer = setTimeout(() => {
      this.#timers.delete(roomCode);
      void this.#advance(roomCode, wake.wakeAt);
    }, delay);
    timer.unref();
    this.#timers.set(roomCode, timer);
  }

  scheduleHostTransfer(roomCode: string, hostMemberId: string, wakeAt: number | null): void {
    // A non-host disconnect has no transfer deadline and must not cancel an
    // already scheduled host-grace timer for the same room.
    if (wakeAt === null || this.#closed) return;
    this.cancelHostTransfer(roomCode);
    const delay = Math.max(0, Math.min(MAX_TIMEOUT_MS, wakeAt - this.#now()));
    const timer = setTimeout(() => {
      this.#hostTimers.delete(roomCode);
      void this.#service.transferHostIfDisconnected(roomCode, hostMemberId).catch(() => undefined);
    }, delay);
    timer.unref();
    this.#hostTimers.set(roomCode, timer);
  }

  cancel(roomCode: string): void {
    const timer = this.#timers.get(roomCode);
    if (timer !== undefined) clearTimeout(timer);
    this.#timers.delete(roomCode);
  }

  cancelHostTransfer(roomCode: string): void {
    const timer = this.#hostTimers.get(roomCode);
    if (timer !== undefined) clearTimeout(timer);
    this.#hostTimers.delete(roomCode);
  }

  close(): void {
    this.#closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    for (const timer of this.#hostTimers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#hostTimers.clear();
  }

  async #advance(roomCode: string, expectedWakeAt: number): Promise<void> {
    if (this.#closed) return;
    try {
      const outcome = await this.#service.advance(roomCode, expectedWakeAt);
      if (outcome !== null) {
        this.schedule(
          roomCode,
          outcome.nextWakeAt === null ? null : { wakeAt: outcome.nextWakeAt },
        );
      }
    } catch {
      // A room can disappear or finish between scheduling and execution.
    }
  }
}
