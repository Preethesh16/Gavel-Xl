import { evaluateGame } from '@gavel-xi/game-engine';
import { roomSettingsSchema } from '@gavel-xi/shared';
import { describe, expect, it } from 'vitest';
import type { StoredRoom } from '../src/domain.js';
import { roomView } from '../src/views.js';

describe('historical result shootouts', () => {
  it('serves reproducible shootouts for old tied matches without rewriting saved scores or rankings', () => {
    const evaluation = evaluateGame({
      memberIds: ['home', 'away'],
      squads: [],
      initialBudgets: { home: 750_000_000, away: 750_000_000 },
      seed: 'historical-result-seed',
      seedCommitment: 'historical-commitment',
      formLookback: 'CURRENT_SEASON',
    });
    evaluation.headToHead = [
      {
        homeMemberId: 'home',
        awayMemberId: 'away',
        homeGoals: 2,
        awayGoals: 2,
        explanation: 'Original analysis.',
      },
      {
        homeMemberId: 'home',
        awayMemberId: 'away',
        homeGoals: 3,
        awayGoals: 1,
        explanation: 'Decisive match.',
      },
    ];
    const room: StoredRoom = {
      code: 'ABCDEF',
      title: 'Saved final',
      phase: 'COMPLETE',
      settings: roomSettingsSchema.parse({}),
      members: [],
      squads: [],
      seed: evaluation.seed,
      seedCommitment: evaluation.seedCommitment,
      snapshotId: null,
      snapshotUpdatedAt: null,
      currentLot: null,
      auctionSequence: 24,
      resolvedCycles: 12,
      totalCycles: 12,
      checkpoint: null,
      evaluation,
      replay: [],
      hiddenState: null,
      eventSequence: 100,
      createdAt: 0,
      updatedAt: 1,
      completedAt: 1,
    };
    const before = structuredClone(room);
    const first = roomView(room, 10).evaluation!;
    const second = roomView(room, 20).evaluation!;
    expect(first.headToHead[0]!.penaltyShootout).toBeDefined();
    expect(first.headToHead[0]!.penaltyShootout!.winnerId).toMatch(/^(home|away)$/);
    expect(first.headToHead[0]).toMatchObject(evaluation.headToHead[0]!);
    expect(first.headToHead[1]).toEqual(evaluation.headToHead[1]);
    expect(first.teams).toEqual(evaluation.teams);
    expect(first.metrics).toEqual(evaluation.metrics);
    expect(first.awards).toEqual(evaluation.awards);
    expect(second).toEqual(first);
    expect(room).toEqual(before);
  });
});
