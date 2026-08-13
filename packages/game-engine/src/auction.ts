import type {
  BidInput,
  CandidateSnapshot,
  PassInput,
  PublicLot,
  SquadEntryView,
} from '@gavel-xi/shared';
import { evaluateGame } from './evaluation.js';
import { generateCandidatePool } from './pool.js';
import { formRating } from './ratings.js';
import { seedCommitment } from './rng.js';
import type {
  CycleState,
  EngineCommandResult,
  EngineEffect,
  EngineMutation,
  EngineProjection,
  EngineStartInput,
  EngineState,
  PoolCandidate,
} from './types.js';

const OUTCOME_HOLD_MS = 900;

interface CandidateLocation {
  cycle: CycleState;
  poolCandidate: PoolCandidate;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function projection(state: EngineState): EngineProjection {
  return {
    phase: state.phase,
    seedCommitment: state.seedCommitment,
    currentLot: clone(state.currentLot),
    squads: clone(state.squads),
    auctionSequence: state.auctionSequence,
    resolvedCycles: state.resolvedCycles,
    totalCycles: state.cycles.length,
    checkpoint: clone(state.checkpoint),
    evaluation: clone(state.evaluation),
    replay: clone(state.replay),
  };
}

function mutation(state: EngineState, effects: EngineEffect[] = []): EngineMutation {
  return {
    state,
    projection: projection(state),
    effects,
    nextWakeAt: state.nextWakeAt,
  };
}

function accepted(state: EngineState, effects: EngineEffect[] = []): EngineCommandResult {
  return { ...mutation(state, effects), accepted: true };
}

function rejected(source: EngineState, code: string, message: string): EngineCommandResult {
  const state = clone(source);
  const error =
    state.currentLot === null
      ? { code, message }
      : { code, message, latestLot: clone(state.currentLot) };
  return { ...mutation(state), accepted: false, error };
}

function locateCandidate(state: EngineState, candidateId: string): CandidateLocation | null {
  for (const cycle of state.cycles) {
    const poolCandidate = cycle.candidates.find(({ candidate }) => candidate.id === candidateId);
    if (poolCandidate) return { cycle, poolCandidate };
  }
  return null;
}

export function effectiveReserve(candidate: PoolCandidate): number {
  return candidate.returnCount > 0 ? candidate.openingBidEUR / 2 : candidate.openingBidEUR;
}

function candidateStillAvailable(candidate: PoolCandidate, excludedCandidateId?: string): boolean {
  return (
    candidate.candidate.id !== excludedCandidateId &&
    candidate.status !== 'SOLD' &&
    candidate.status !== 'FORCED'
  );
}

/**
 * Conservative mandatory reserve for a member, with an optional projected sale.
 * Reserving the highest remaining price per cycle prevents two directors from
 * relying on the same bargain candidate and makes forced allocations solvent.
 */
export function safeCompletionReserve(
  state: EngineState,
  memberId: string,
  options: { projectedWinnerId?: string; projectedCandidateId?: string } = {},
): number {
  const projectedLocation = options.projectedCandidateId
    ? locateCandidate(state, options.projectedCandidateId)
    : null;
  return state.cycles.reduce((total, cycle) => {
    const alreadyAssigned = cycle.assignments[memberId] !== undefined;
    const projectedAssignment =
      options.projectedWinnerId === memberId && projectedLocation?.cycle.id === cycle.id;
    if (alreadyAssigned || projectedAssignment) return total;
    const reserves = cycle.candidates
      .filter((candidate) => candidateStillAvailable(candidate, options.projectedCandidateId))
      .map(effectiveReserve);
    if (reserves.length === 0) return Number.POSITIVE_INFINITY;
    return total + Math.max(...reserves);
  }, 0);
}

function strictSalePreservesCompletion(
  state: EngineState,
  winnerId: string,
  candidateId: string,
  purchasePriceEUR: number,
): { safe: true } | { safe: false; memberId: string; requiredEUR: number; availableEUR: number } {
  for (const member of state.members) {
    const completionReserve = safeCompletionReserve(state, member.id, {
      projectedWinnerId: winnerId,
      projectedCandidateId: candidateId,
    });
    const availableEUR =
      member.remainingBudgetEUR - (member.id === winnerId ? purchasePriceEUR : 0);
    if (!Number.isFinite(completionReserve) || completionReserve > availableEUR) {
      return { safe: false, memberId: member.id, requiredEUR: completionReserve, availableEUR };
    }
  }
  return { safe: true };
}

function appendReplay(
  state: EngineState,
  at: number,
  type: string,
  title: string,
  detail: string,
  optional: { memberId?: string; candidateId?: string; amountEUR?: number } = {},
): void {
  state.replaySequence += 1;
  state.replay.push({
    id: `event-${state.replaySequence}`,
    at,
    sequence: state.replaySequence,
    type,
    title,
    detail,
    ...(optional.memberId === undefined ? {} : { memberId: optional.memberId }),
    ...(optional.candidateId === undefined ? {} : { candidateId: optional.candidateId }),
    ...(optional.amountEUR === undefined ? {} : { amountEUR: optional.amountEUR }),
  });
}

function candidateForNextReveal(state: EngineState): CandidateLocation | null {
  while (state.revealQueue.length > 0) {
    const candidateId = state.revealQueue.shift()!;
    const location = locateCandidate(state, candidateId);
    if (location?.poolCandidate.status === 'QUEUED') return location;
  }
  return (
    state.cycles
      .flatMap((cycle) =>
        cycle.candidates
          .filter((candidate) => candidate.status === 'UNSOLD' && !cycle.resolved)
          .map((poolCandidate) => ({ cycle, poolCandidate })),
      )
      .sort(
        (left, right) =>
          left.poolCandidate.returnPriority - right.poolCandidate.returnPriority ||
          left.poolCandidate.candidate.id.localeCompare(right.poolCandidate.candidate.id),
      )[0] ?? null
  );
}

function revealNext(state: EngineState, now: number): EngineEffect[] {
  const location = candidateForNextReveal(state);
  if (location === null) {
    if (state.cycles.every((cycle) => cycle.resolved)) return completeGame(state, now);
    throw new Error('POOL_EXHAUSTED_BEFORE_COMPLETION');
  }
  const eligibleMemberIds = state.members
    .filter((member) => location.cycle.assignments[member.id] === undefined)
    .map((member) => member.id);
  if (eligibleMemberIds.length === 0) {
    location.poolCandidate.status = 'FORCED';
    return revealNext(state, now);
  }
  location.poolCandidate.status = 'ACTIVE';
  state.auctionSequence += 1;
  state.currentLot = {
    id: `lot-${state.auctionSequence}-${location.poolCandidate.candidate.id}`,
    sequence: state.auctionSequence,
    cycleId: location.cycle.id,
    position: location.cycle.position,
    candidate: clone(location.poolCandidate.candidate),
    openingBidEUR: effectiveReserve(location.poolCandidate),
    originalOpeningBidEUR: location.poolCandidate.openingBidEUR,
    isReturning: location.poolCandidate.returnCount > 0,
    returnCount: location.poolCandidate.returnCount,
    currentBidEUR: null,
    currentLeaderId: null,
    eligibleMemberIds,
    passedMemberIds: [],
    openedAt: null,
    endsAt: null,
  };
  state.phase = 'REVEALING';
  state.nextWakeAt = now + state.settings.revealSeconds * 1_000;
  appendReplay(
    state,
    now,
    'REVEAL',
    location.poolCandidate.returnCount > 0 ? 'BACK ON THE MARKET' : 'CARD REVEALED',
    `${location.cycle.position} · ${location.poolCandidate.candidate.commonName}`,
    { candidateId: location.poolCandidate.candidate.id },
  );
  return [{ type: 'LOT_REVEALED', lot: clone(state.currentLot) }];
}

function openCurrentLot(state: EngineState, now: number): EngineEffect[] {
  if (state.currentLot === null) throw new Error('MISSING_CURRENT_LOT');
  state.phase = 'BIDDING';
  state.currentLot.openedAt = now;
  state.currentLot.endsAt = now + state.settings.auctionTimerSeconds * 1_000;
  state.nextWakeAt = state.currentLot.endsAt;
  appendReplay(
    state,
    now,
    'OPENED',
    'THE MARKET IS OPEN',
    `${state.currentLot.candidate.commonName} · reserve ${state.currentLot.openingBidEUR}`,
    { candidateId: state.currentLot.candidate.id, amountEUR: state.currentLot.openingBidEUR },
  );
  return [{ type: 'LOT_OPENED', lot: clone(state.currentLot) }];
}

function markNewlyResolvedCycle(state: EngineState, cycle: CycleState): boolean {
  if (cycle.resolved || Object.keys(cycle.assignments).length !== state.members.length)
    return false;
  cycle.resolved = true;
  state.resolvedCycles += 1;
  return true;
}

function assignCandidate(
  state: EngineState,
  cycle: CycleState,
  poolCandidate: PoolCandidate,
  memberId: string,
  amountEUR: number,
  now: number,
  acquisition: SquadEntryView['acquisition'],
): SquadEntryView {
  if (cycle.assignments[memberId] !== undefined) throw new Error('DUPLICATE_CYCLE_ASSIGNMENT');
  if (state.squads.some((entry) => entry.candidate.id === poolCandidate.candidate.id)) {
    throw new Error('DUPLICATE_CANDIDATE_ASSIGNMENT');
  }
  const member = state.members.find((entry) => entry.id === memberId);
  if (!member) throw new Error('UNKNOWN_MEMBER');
  const price = Math.max(0, Math.min(amountEUR, member.remainingBudgetEUR));
  member.remainingBudgetEUR -= price;
  if (acquisition === 'EMERGENCY') member.emergencyAllocations += 1;
  cycle.assignments[memberId] = poolCandidate.candidate.id;
  poolCandidate.status = acquisition === 'AUCTION' ? 'SOLD' : 'FORCED';
  state.revealQueue = state.revealQueue.filter(
    (candidateId) => candidateId !== poolCandidate.candidate.id,
  );
  const entry: SquadEntryView = {
    id: `entry-${memberId}-${cycle.id}`,
    memberId,
    slotId: cycle.slotId,
    cycleId: cycle.id,
    candidate: clone(poolCandidate.candidate),
    purchasePriceEUR: price,
    marketValueEUR: poolCandidate.candidate.valuation.valueEUR,
    acquisition,
    acquiredAt: now,
  };
  state.squads.push(entry);
  return entry;
}

function forcedAssignment(state: EngineState, cycle: CycleState, now: number): EngineEffect[] {
  if (Object.keys(cycle.assignments).length !== state.members.length - 1) return [];
  const member = state.members.find((entry) => cycle.assignments[entry.id] === undefined);
  const candidate = cycle.candidates.find(
    (entry) => entry.status !== 'SOLD' && entry.status !== 'FORCED' && entry.status !== 'ACTIVE',
  );
  if (!member || !candidate) return [];
  const normalPrice = effectiveReserve(candidate);
  const cannotAfford = normalPrice > member.remainingBudgetEUR;
  if (cannotAfford && state.settings.budgetMode === 'STRICT') {
    throw new Error(
      `STRICT_COMPLETION_INVARIANT:${member.id}:required=${normalPrice}:remaining=${member.remainingBudgetEUR}`,
    );
  }
  const emergency = cannotAfford && state.settings.budgetMode === 'CHAOS';
  const price = emergency ? member.remainingBudgetEUR : normalPrice;
  const acquisition: SquadEntryView['acquisition'] = emergency ? 'EMERGENCY' : 'FORCED';
  assignCandidate(state, cycle, candidate, member.id, price, now, acquisition);
  const forcedLot: PublicLot = {
    id: `forced-${state.auctionSequence}-${candidate.candidate.id}`,
    sequence: state.auctionSequence,
    cycleId: cycle.id,
    position: cycle.position,
    candidate: clone(candidate.candidate),
    openingBidEUR: normalPrice,
    originalOpeningBidEUR: candidate.openingBidEUR,
    isReturning: candidate.returnCount > 0,
    returnCount: candidate.returnCount,
    currentBidEUR: price,
    currentLeaderId: member.id,
    eligibleMemberIds: [member.id],
    passedMemberIds: [],
    openedAt: null,
    endsAt: null,
  };
  appendReplay(
    state,
    now,
    emergency ? 'EMERGENCY' : 'FORCED',
    emergency ? 'EMERGENCY ALLOCATION' : 'FORCED DEAL',
    `${candidate.candidate.commonName} → ${member.id}`,
    { memberId: member.id, candidateId: candidate.candidate.id, amountEUR: price },
  );
  return [{ type: 'LOT_FORCED', lot: forcedLot, memberId: member.id, amountEUR: price, emergency }];
}

function createCheckpoint(state: EngineState): void {
  const projectedScores = Object.fromEntries(
    state.members.map((member) => {
      const entries = state.squads.filter((entry) => entry.memberId === member.id);
      const playerRatings = entries.map((entry) =>
        formRating(entry.candidate, state.settings.formLookback),
      );
      const marketValue = entries.reduce((sum, entry) => sum + (entry.marketValueEUR ?? 0), 0);
      const spent = entries.reduce((sum, entry) => sum + entry.purchasePriceEUR, 0);
      const efficiency = spent <= 0 ? 50 : Math.min(100, 50 + (marketValue / spent - 1) * 25);
      const completeness = (entries.length / state.cycles.length) * 100;
      return [
        member.id,
        Math.round((average(playerRatings) * 0.65 + efficiency * 0.2 + completeness * 0.15) * 10) /
          10,
      ];
    }),
  );
  const ranked = [...state.members].sort(
    (left, right) =>
      projectedScores[right.id]! - projectedScores[left.id]! || left.joinedAt - right.joinedAt,
  );
  const efficiencies = state.squads.map((entry) => ({
    entry,
    score:
      ((entry.marketValueEUR ?? 0) / Math.max(1, entry.purchasePriceEUR)) *
      formRating(entry.candidate, state.settings.formLookback),
  }));
  const best = [...efficiencies].sort((left, right) => right.score - left.score)[0]?.entry ?? null;
  const overpay =
    [...state.squads].sort(
      (left, right) =>
        right.purchasePriceEUR / Math.max(1, right.marketValueEUR ?? 1) -
        left.purchasePriceEUR / Math.max(1, left.marketValueEUR ?? 1),
    )[0] ?? null;
  const budgetLeader = [...state.members].sort(
    (left, right) =>
      right.remainingBudgetEUR - left.remainingBudgetEUR || left.joinedAt - right.joinedAt,
  )[0]!;
  state.checkpointNumber += 1;
  state.checkpoint = {
    number: state.checkpointNumber,
    resolvedCycles: state.resolvedCycles,
    leaderId: ranked[0]!.id,
    bestBusinessMemberId: best?.memberId ?? ranked[0]!.id,
    bestSigningEntryId: best?.id ?? null,
    biggestOverpayEntryId: overpay?.id ?? null,
    budgetLeaderId: budgetLeader.id,
    projectedScores,
    weaknesses: Object.fromEntries(
      state.members.map((member) => {
        const remaining = state.cycles.filter(
          (cycle) => cycle.assignments[member.id] === undefined,
        );
        return [member.id, remaining[0]?.position ?? 'NONE'];
      }),
    ),
    remainingPositions: Object.fromEntries(
      state.members.map((member) => [
        member.id,
        state.cycles
          .filter((cycle) => cycle.assignments[member.id] === undefined)
          .map((cycle) => cycle.position),
      ]),
    ),
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 50 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function completeGame(state: EngineState, now: number): EngineEffect[] {
  assertEngineInvariants(state, true);
  state.phase = 'EVALUATING';
  state.currentLot = null;
  state.nextWakeAt = null;
  const budgets = Object.fromEntries(
    state.members.map((member) => [member.id, member.initialBudgetEUR]),
  );
  state.evaluation = evaluateGame({
    memberIds: state.members.map((member) => member.id),
    squads: state.squads,
    initialBudgets: budgets,
    seed: state.seed,
    seedCommitment: state.seedCommitment,
    formLookback: state.settings.formLookback,
  });
  state.phase = 'RESULTS';
  appendReplay(state, now, 'COMPLETE', 'THE AUCTION IS CLOSED', 'The 100-metric verdict is ready.');
  return [
    { type: 'GAME_COMPLETE' },
    { type: 'EVALUATION_PROGRESS', progress: 100 },
    { type: 'EVALUATION_COMPLETE' },
  ];
}

function afterResolution(
  state: EngineState,
  cycle: CycleState,
  now: number,
  effects: EngineEffect[],
): void {
  markNewlyResolvedCycle(state, cycle);
  if (state.cycles.every((entry) => entry.resolved)) {
    effects.push(...completeGame(state, now));
    return;
  }
  if (
    state.resolvedCycles > 0 &&
    state.resolvedCycles % 4 === 0 &&
    state.resolvedCycles > state.lastCheckpointCycles
  ) {
    state.lastCheckpointCycles = state.resolvedCycles;
    createCheckpoint(state);
    state.phase = 'CHECKPOINT';
    state.nextWakeAt = null;
    effects.push({ type: 'CHECKPOINT_STARTED', number: state.checkpointNumber });
    effects.push({ type: 'CHECKPOINT_READY' });
    return;
  }
  state.nextWakeAt = now + OUTCOME_HOLD_MS;
}

function resolveCurrentLot(state: EngineState, now: number): EngineEffect[] {
  const lot = state.currentLot;
  if (lot === null) throw new Error('MISSING_CURRENT_LOT');
  const location = locateCandidate(state, lot.candidate.id);
  if (!location) throw new Error('CANDIDATE_NOT_IN_POOL');
  state.phase = 'RESOLVING';
  const effects: EngineEffect[] = [];
  if (lot.currentLeaderId !== null && lot.currentBidEUR !== null) {
    assignCandidate(
      state,
      location.cycle,
      location.poolCandidate,
      lot.currentLeaderId,
      lot.currentBidEUR,
      now,
      'AUCTION',
    );
    state.phase = 'SOLD';
    appendReplay(
      state,
      now,
      'SOLD',
      'SOLD',
      `${lot.candidate.commonName} → ${lot.currentLeaderId}`,
      {
        memberId: lot.currentLeaderId,
        candidateId: lot.candidate.id,
        amountEUR: lot.currentBidEUR,
      },
    );
    effects.push({
      type: 'LOT_SOLD',
      lot: clone(lot),
      memberId: lot.currentLeaderId,
      amountEUR: lot.currentBidEUR,
    });
    effects.push(...forcedAssignment(state, location.cycle, now));
    if (effects.some((effect) => effect.type === 'LOT_FORCED')) state.phase = 'FORCED_ASSIGNMENT';
  } else {
    location.poolCandidate.status = 'UNSOLD';
    location.poolCandidate.returnCount += 1;
    location.poolCandidate.returnPriority += 1;
    state.phase = 'UNSOLD';
    appendReplay(state, now, 'UNSOLD', 'UNSOLD', `${lot.candidate.commonName} enters the vault.`, {
      candidateId: lot.candidate.id,
    });
    effects.push({ type: 'LOT_UNSOLD', lot: clone(lot) });
  }
  afterResolution(state, location.cycle, now, effects);
  return effects;
}

function allBiddingDecisionsComplete(lot: PublicLot): boolean {
  if (lot.currentLeaderId === null)
    return lot.passedMemberIds.length === lot.eligibleMemberIds.length;
  return lot.eligibleMemberIds.every(
    (memberId) => memberId === lot.currentLeaderId || lot.passedMemberIds.includes(memberId),
  );
}

export function maximumLegalBid(state: EngineState, memberId: string): number {
  const member = state.members.find((entry) => entry.id === memberId);
  if (!member) return 0;
  if (state.settings.budgetMode === 'CHAOS' || state.currentLot === null)
    return member.remainingBudgetEUR;
  for (const other of state.members) {
    if (other.id === memberId) continue;
    const reserveAfterSale = safeCompletionReserve(state, other.id, {
      projectedWinnerId: memberId,
      projectedCandidateId: state.currentLot.candidate.id,
    });
    if (!Number.isFinite(reserveAfterSale) || reserveAfterSale > other.remainingBudgetEUR) return 0;
  }
  const reserved = safeCompletionReserve(state, memberId, {
    projectedWinnerId: memberId,
    projectedCandidateId: state.currentLot.candidate.id,
  });
  return Math.max(0, member.remainingBudgetEUR - reserved);
}

export function assertEngineInvariants(state: EngineState, requireComplete = false): void {
  const candidateIds = state.cycles.flatMap((cycle) =>
    cycle.candidates.map(({ candidate }) => candidate.id),
  );
  if (new Set(candidateIds).size !== candidateIds.length)
    throw new Error('INVARIANT_DUPLICATE_POOL_CANDIDATE');
  const squadCandidateIds = state.squads.map((entry) => entry.candidate.id);
  if (new Set(squadCandidateIds).size !== squadCandidateIds.length)
    throw new Error('INVARIANT_DUPLICATE_SQUAD_CANDIDATE');
  for (const member of state.members) {
    if (member.remainingBudgetEUR < 0) throw new Error('INVARIANT_NEGATIVE_BUDGET');
    for (const cycle of state.cycles) {
      const entries = state.squads.filter(
        (entry) => entry.memberId === member.id && entry.cycleId === cycle.id,
      );
      if (entries.length > 1) throw new Error('INVARIANT_DUPLICATE_CYCLE_SLOT');
      if (requireComplete && entries.length !== 1) throw new Error('INVARIANT_INCOMPLETE_SQUAD');
    }
  }
  if (state.resolvedCycles !== state.cycles.filter((cycle) => cycle.resolved).length) {
    throw new Error('INVARIANT_RESOLVED_CYCLE_COUNT');
  }
  if (requireComplete && state.squads.length !== state.members.length * state.cycles.length) {
    throw new Error('INVARIANT_WRONG_COMPLETE_SQUAD_SIZE');
  }
}

export class GavelEngine {
  start(input: EngineStartInput): EngineMutation {
    const pool = generateCandidatePool(input);
    if (input.settings.budgetMode === 'STRICT') {
      const minimumCompletionCost = pool.cycles.reduce(
        (total, cycle) => total + Math.max(...cycle.candidates.map(effectiveReserve)),
        0,
      );
      const underfunded = input.members.find((member) => member.budgetEUR < minimumCompletionCost);
      if (underfunded !== undefined) {
        throw new Error(
          `STRICT_BUDGET_INFEASIBLE:${underfunded.id}:minimum=${minimumCompletionCost}:budget=${underfunded.budgetEUR}`,
        );
      }
    }
    const commitment = seedCommitment(input.seed);
    const state: EngineState = {
      version: 1,
      phase: 'READY',
      seed: input.seed,
      seedCommitment: commitment,
      settings: clone(input.settings),
      formation: pool.formation,
      members: input.members.map((member) => ({
        ...member,
        initialBudgetEUR: member.budgetEUR,
        remainingBudgetEUR: member.budgetEUR,
        emergencyAllocations: 0,
      })),
      cycles: pool.cycles,
      revealQueue: pool.revealQueue,
      currentLot: null,
      auctionSequence: 0,
      squads: [],
      resolvedCycles: 0,
      lastCheckpointCycles: 0,
      checkpointNumber: 0,
      checkpoint: null,
      evaluation: null,
      replay: [],
      replaySequence: 0,
      processedIdempotencyKeys: {},
      pausedAt: null,
      nextWakeAt: null,
    };
    appendReplay(state, input.now, 'PREPARED', 'SEED COMMITTED', commitment);
    const effects: EngineEffect[] = [{ type: 'GAME_PREPARED' }, ...revealNext(state, input.now)];
    assertEngineInvariants(state);
    return mutation(state, effects);
  }

  bid(source: unknown, memberId: string, input: BidInput, now: number): EngineCommandResult {
    const sourceState = source as EngineState;
    if (sourceState.pausedAt !== null)
      return rejected(sourceState, 'AUCTION_PAUSED', 'The host has paused the auction.');
    if (sourceState.phase !== 'BIDDING' || sourceState.currentLot === null) {
      return rejected(sourceState, 'AUCTION_CLOSED', 'Bidding is not open for this card.');
    }
    if (sourceState.currentLot.endsAt !== null && now >= sourceState.currentLot.endsAt) {
      return rejected(sourceState, 'AUCTION_CLOSED', 'The gavel has already fallen on this card.');
    }
    if (input.auctionSequence !== sourceState.auctionSequence) {
      return rejected(sourceState, 'STALE_AUCTION', 'That bid belongs to an earlier card.');
    }
    const actionKey = `${memberId}:${input.idempotencyKey}`;
    if (sourceState.processedIdempotencyKeys[actionKey] !== undefined) {
      return accepted(clone(sourceState));
    }
    const state = clone(sourceState);
    const lot = state.currentLot!;
    if (!lot.eligibleMemberIds.includes(memberId)) {
      return rejected(
        sourceState,
        'NOT_ELIGIBLE',
        'Your compatible position cycle is already filled.',
      );
    }
    if (lot.passedMemberIds.includes(memberId)) {
      return rejected(sourceState, 'ALREADY_PASSED', 'Passing is final for this card.');
    }
    const minimum =
      lot.currentBidEUR === null
        ? lot.openingBidEUR
        : lot.currentBidEUR + state.settings.bidIncrementEUR;
    if (!Number.isSafeInteger(input.amountEUR) || input.amountEUR < minimum) {
      return rejected(sourceState, 'BID_TOO_LOW', `The next legal bid is ${minimum}.`);
    }
    const maximum = maximumLegalBid(state, memberId);
    if (input.amountEUR > maximum) {
      return rejected(
        sourceState,
        'BUDGET_EXCEEDED',
        state.settings.budgetMode === 'STRICT'
          ? `MAX SAFE BID is ${maximum}. Funds are reserved for mandatory slots.`
          : `Your maximum legal bid is ${maximum}.`,
      );
    }
    if (state.settings.budgetMode === 'STRICT') {
      const feasibility = strictSalePreservesCompletion(
        state,
        memberId,
        lot.candidate.id,
        input.amountEUR,
      );
      if (!feasibility.safe) {
        return rejected(
          sourceState,
          'BUDGET_EXCEEDED',
          `That deal would leave ${feasibility.memberId} unable to complete mandatory slots (${feasibility.requiredEUR} required, ${feasibility.availableEUR} available).`,
        );
      }
    }
    lot.currentBidEUR = input.amountEUR;
    lot.currentLeaderId = memberId;
    state.processedIdempotencyKeys[actionKey] = state.auctionSequence;
    if (lot.endsAt !== null && lot.endsAt - now <= 3_000 && state.settings.antiSnipeSeconds > 0) {
      lot.endsAt = now + state.settings.antiSnipeSeconds * 1_000;
      state.nextWakeAt = lot.endsAt;
    }
    appendReplay(state, now, 'BID', 'BID ACCEPTED', `${memberId} bids ${input.amountEUR}`, {
      memberId,
      candidateId: lot.candidate.id,
      amountEUR: input.amountEUR,
    });
    const effects: EngineEffect[] = [
      { type: 'BID_ACCEPTED', lot: clone(lot), memberId, amountEUR: input.amountEUR },
    ];
    if (allBiddingDecisionsComplete(lot)) effects.push(...resolveCurrentLot(state, now));
    assertEngineInvariants(state);
    return accepted(state, effects);
  }

  pass(source: unknown, memberId: string, input: PassInput, now: number): EngineCommandResult {
    const sourceState = source as EngineState;
    if (sourceState.pausedAt !== null)
      return rejected(sourceState, 'AUCTION_PAUSED', 'The host has paused the auction.');
    if (sourceState.phase !== 'BIDDING' || sourceState.currentLot === null) {
      return rejected(sourceState, 'AUCTION_CLOSED', 'Passing is not open for this card.');
    }
    if (sourceState.currentLot.endsAt !== null && now >= sourceState.currentLot.endsAt) {
      return rejected(sourceState, 'AUCTION_CLOSED', 'The gavel has already fallen on this card.');
    }
    if (input.auctionSequence !== sourceState.auctionSequence) {
      return rejected(sourceState, 'STALE_AUCTION', 'That pass belongs to an earlier card.');
    }
    const state = clone(sourceState);
    const lot = state.currentLot!;
    if (!lot.eligibleMemberIds.includes(memberId)) {
      return rejected(
        sourceState,
        'NOT_ELIGIBLE',
        'Your compatible position cycle is already filled.',
      );
    }
    if (lot.currentLeaderId === memberId) {
      return rejected(sourceState, 'CONFLICT', 'The current leader cannot pass a binding bid.');
    }
    if (lot.passedMemberIds.includes(memberId)) {
      return rejected(sourceState, 'ALREADY_PASSED', 'You already passed this card.');
    }
    lot.passedMemberIds.push(memberId);
    appendReplay(state, now, 'PASS', 'PASS', `${memberId} leaves this auction.`, {
      memberId,
      candidateId: lot.candidate.id,
    });
    const effects = allBiddingDecisionsComplete(lot) ? resolveCurrentLot(state, now) : [];
    assertEngineInvariants(state);
    return accepted(state, effects);
  }

  advance(source: unknown, now: number): EngineMutation {
    const state = clone(source as EngineState);
    if (state.pausedAt !== null) return mutation(state);
    if (state.nextWakeAt !== null && now < state.nextWakeAt) return mutation(state);
    let effects: EngineEffect[] = [];
    switch (state.phase) {
      case 'READY':
      case 'NEXT_LOT':
      case 'SOLD':
      case 'UNSOLD':
      case 'FORCED_ASSIGNMENT':
        effects = revealNext(state, now);
        break;
      case 'REVEALING':
        effects = openCurrentLot(state, now);
        break;
      case 'BIDDING':
        effects = resolveCurrentLot(state, now);
        break;
      default:
        state.nextWakeAt = null;
    }
    assertEngineInvariants(state);
    return mutation(state, effects);
  }

  checkpoint(source: unknown, now: number): EngineCommandResult {
    const sourceState = source as EngineState;
    if (sourceState.phase !== 'CHECKPOINT') {
      return rejected(
        sourceState,
        'CONFLICT',
        'A room Scout Report can only continue between auctions.',
      );
    }
    const state = clone(sourceState);
    state.checkpoint = null;
    const effects = revealNext(state, now);
    return accepted(state, effects);
  }

  maximumLegalBid(source: unknown, memberId: string): number {
    return maximumLegalBid(source as EngineState, memberId);
  }

  nextWakeAt(source: unknown): number | null {
    return (source as EngineState).nextWakeAt;
  }

  pause(source: unknown, now: number): EngineMutation {
    const state = clone(source as EngineState);
    if (state.pausedAt !== null) return mutation(state);
    state.pausedAt = now;
    state.nextWakeAt = null;
    return mutation(state);
  }

  resume(source: unknown, now: number): EngineMutation {
    const state = clone(source as EngineState);
    if (state.pausedAt === null) return mutation(state);
    const elapsed = Math.max(0, now - state.pausedAt);
    if (state.currentLot?.openedAt !== null && state.currentLot?.openedAt !== undefined)
      state.currentLot.openedAt += elapsed;
    if (state.currentLot?.endsAt !== null && state.currentLot?.endsAt !== undefined)
      state.currentLot.endsAt += elapsed;
    state.pausedAt = null;
    state.nextWakeAt = state.currentLot?.endsAt ?? now;
    return mutation(state);
  }

  candidatesForDebug(source: unknown): CandidateSnapshot[] {
    return (source as EngineState).cycles.flatMap((cycle) =>
      cycle.candidates.map(({ candidate }) => clone(candidate)),
    );
  }
}

export function createGameEngine(): GavelEngine {
  return new GavelEngine();
}
