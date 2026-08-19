import type { RoomView } from '@gavel-xi/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomService } from '../src/room-service.js';
import { RoomScheduler } from '../src/scheduler.js';

describe('RoomScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a failed overdue wake instead of freezing the auction at zero', async () => {
    vi.useFakeTimers();
    const advance = vi
      .fn<RoomService['advance']>()
      .mockRejectedValueOnce(new Error('temporary persistence failure'))
      .mockResolvedValueOnce({
        room: {} as RoomView,
        nextWakeAt: null,
      });
    const scheduler = new RoomScheduler({ advance } as unknown as RoomService, () => Date.now());

    scheduler.schedule('ABC234', { wakeAt: Date.now() });
    await vi.advanceTimersByTimeAsync(0);
    expect(advance).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(advance).toHaveBeenLastCalledWith('ABC234', expect.any(Number));
    scheduler.close();
  });
});
