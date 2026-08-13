import type {
  CandidateSnapshot,
  CheckpointView,
  PublicLot,
  ReplayEventView,
  RoomSettingsInput,
} from '@gavel-xi/shared';
import type {
  AuthoritativeEngine,
  EngineCommandResult,
  EngineEffect,
  EngineMutation,
  EngineProjection,
  EngineStartInput,
} from '../src/engine-port.js';

interface TestState {
  projection: EngineProjection;
  nextWakeAt: number | null;
  pausedAt?: number | null;
  allCandidates: CandidateSnapshot[];
  initialSettings: RoomSettingsInput;
}

function state(value: unknown): TestState {
  return structuredClone(value) as TestState;
}

function mutation(testState: TestState, effects: EngineEffect[] = []): EngineMutation {
  return {
    state: structuredClone(testState),
    projection: structuredClone(testState.projection),
    effects: structuredClone(effects),
    nextWakeAt: testState.nextWakeAt,
  };
}

function replay(
  projection: EngineProjection,
  at: number,
  type: string,
  title: string,
  detail: string,
): ReplayEventView[] {
  return [
    ...projection.replay,
    {
      id: `event-${projection.replay.length + 1}`,
      at,
      sequence: projection.replay.length + 1,
      type,
      title,
      detail,
    },
  ];
}

export class TestEngine implements AuthoritativeEngine {
  start(input: EngineStartInput): EngineMutation {
    const candidate = input.snapshot.candidates.find((entry) => entry.kind === 'PLAYER')!;
    const lot: PublicLot = {
      id: 'test-lot-1',
      sequence: 1,
      cycleId: 'test-cycle-1',
      position: candidate.preferredPosition,
      candidate,
      openingBidEUR: 1_000_000,
      originalOpeningBidEUR: 1_000_000,
      isReturning: false,
      returnCount: 0,
      currentBidEUR: null,
      currentLeaderId: null,
      eligibleMemberIds: input.members.map(({ id }) => id),
      passedMemberIds: [],
      openedAt: input.now,
      endsAt: input.now + input.settings.auctionTimerSeconds * 1_000,
    };
    const projection: EngineProjection = {
      phase: 'BIDDING',
      seedCommitment: `commitment-${input.seed}`,
      currentLot: lot,
      squads: [],
      auctionSequence: 1,
      resolvedCycles: 0,
      totalCycles: 12,
      checkpoint: null,
      evaluation: null,
      replay: [
        {
          id: 'event-1',
          at: input.now,
          sequence: 1,
          type: 'REVEAL',
          title: 'CARD REVEALED',
          detail: candidate.commonName,
          candidateId: candidate.id,
        },
      ],
    };
    const testState: TestState = {
      projection,
      nextWakeAt: lot.endsAt,
      allCandidates: structuredClone(input.snapshot.candidates),
      initialSettings: input.settings,
    };
    return mutation(testState, [
      { type: 'GAME_PREPARED' },
      { type: 'LOT_REVEALED', lot },
      { type: 'LOT_OPENED', lot },
    ]);
  }

  bid(
    value: unknown,
    memberId: string,
    input: { amountEUR: number; auctionSequence: number },
    now: number,
  ): EngineCommandResult {
    const current = state(value);
    const lot = current.projection.currentLot;
    if (lot === null || current.projection.phase !== 'BIDDING')
      return this.#reject(current, 'AUCTION_CLOSED', 'Auction closed.');
    if (input.auctionSequence !== lot.sequence)
      return this.#reject(current, 'STALE_AUCTION', 'Stale auction.', lot);
    if (!lot.eligibleMemberIds.includes(memberId))
      return this.#reject(current, 'NOT_ELIGIBLE', 'Not eligible.', lot);
    const minimum =
      lot.currentBidEUR === null
        ? lot.openingBidEUR
        : lot.currentBidEUR + current.initialSettings.bidIncrementEUR;
    if (input.amountEUR < minimum) return this.#reject(current, 'BID_TOO_LOW', 'Bid too low.', lot);
    lot.currentBidEUR = input.amountEUR;
    lot.currentLeaderId = memberId;
    lot.endsAt = now + current.initialSettings.auctionTimerSeconds * 1_000;
    current.projection.replay = replay(
      current.projection,
      now,
      'BID',
      'BID',
      String(input.amountEUR),
    );
    current.nextWakeAt = lot.endsAt;
    return {
      ...mutation(current, [{ type: 'BID_ACCEPTED', lot, memberId, amountEUR: input.amountEUR }]),
      accepted: true,
    };
  }

  pass(
    value: unknown,
    memberId: string,
    input: { auctionSequence: number },
    now: number,
  ): EngineCommandResult {
    const current = state(value);
    const lot = current.projection.currentLot;
    if (lot === null || input.auctionSequence !== lot.sequence)
      return this.#reject(current, 'STALE_AUCTION', 'Stale auction.', lot ?? undefined);
    if (lot.passedMemberIds.includes(memberId))
      return this.#reject(current, 'ALREADY_PASSED', 'Already passed.', lot);
    lot.passedMemberIds.push(memberId);
    current.projection.replay = replay(current.projection, now, 'PASS', 'PASS', memberId);
    return { ...mutation(current), accepted: true };
  }

  advance(value: unknown, now: number): EngineMutation {
    const current = state(value);
    if (current.nextWakeAt !== null && current.nextWakeAt > now) return mutation(current);
    current.nextWakeAt = null;
    return mutation(current);
  }

  checkpoint(value: unknown, now: number): EngineCommandResult {
    const current = state(value);
    const memberIds = current.projection.currentLot?.eligibleMemberIds ?? [];
    const first = memberIds[0] ?? '';
    const checkpoint: CheckpointView = {
      number: 1,
      resolvedCycles: current.projection.resolvedCycles,
      leaderId: first,
      bestBusinessMemberId: first,
      bestSigningEntryId: null,
      biggestOverpayEntryId: null,
      budgetLeaderId: first,
      projectedScores: Object.fromEntries(memberIds.map((id) => [id, 50])),
      weaknesses: Object.fromEntries(memberIds.map((id) => [id, 'Incomplete squad'])),
      remainingPositions: Object.fromEntries(memberIds.map((id) => [id, ['GK']])),
    };
    current.projection.checkpoint = checkpoint;
    current.projection.phase = 'CHECKPOINT';
    current.projection.replay = replay(
      current.projection,
      now,
      'CHECKPOINT',
      'SCOUT REPORT',
      'Checkpoint one',
    );
    return {
      ...mutation(current, [
        { type: 'CHECKPOINT_STARTED', number: 1 },
        { type: 'CHECKPOINT_READY' },
      ]),
      accepted: true,
    };
  }

  maximumLegalBid(value: unknown, memberId: string): number {
    const current = state(value);
    const memberIndex = current.projection.currentLot?.eligibleMemberIds.indexOf(memberId) ?? -1;
    return memberIndex < 0 ? 0 : current.initialSettings.budgetEUR - memberIndex * 1_000_000;
  }

  nextWakeAt(value: unknown): number | null {
    return state(value).nextWakeAt;
  }

  pause(value: unknown, now: number): EngineMutation {
    const current = state(value);
    current.pausedAt = now;
    current.nextWakeAt = null;
    return mutation(current);
  }

  resume(value: unknown, now: number): EngineMutation {
    const current = state(value);
    current.pausedAt = null;
    current.nextWakeAt = now;
    return mutation(current);
  }

  candidatesForDebug(value: unknown): CandidateSnapshot[] {
    return state(value).allCandidates;
  }

  #reject(
    current: TestState,
    code: string,
    message: string,
    latestLot?: PublicLot,
  ): EngineCommandResult {
    return {
      ...mutation(current),
      accepted: false,
      error: { code, message, ...(latestLot === undefined ? {} : { latestLot }) },
    };
  }
}
