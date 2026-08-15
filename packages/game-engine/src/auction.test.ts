import { randomUUID } from 'node:crypto';
import type { PublicLot } from '@gavel-xi/shared';
import { describe, expect, it } from 'vitest';
import { GavelEngine, assertEngineInvariants, maximumLegalBid } from './auction.js';
import { formRating } from './ratings.js';
import { verifySeedCommitment } from './rng.js';
import { fixtureMembers, fixtureSettings, fixtureSnapshot } from './test-fixtures.js';
import type { EngineState } from './types.js';

function open(engine: GavelEngine, state: EngineState): EngineState {
  expect(state.phase).toBe('REVEALING');
  return engine.advance(state, state.nextWakeAt ?? 0).state;
}

function bidInput(lot: PublicLot, amountEUR = lot.openingBidEUR, idempotencyKey = randomUUID()) {
  return {
    roomCode: 'ABC234',
    auctionSequence: lot.sequence,
    amountEUR,
    idempotencyKey,
  };
}

function passInput(lot: PublicLot) {
  return { roomCode: 'ABC234', auctionSequence: lot.sequence };
}

function nextOpen(engine: GavelEngine, source: EngineState): EngineState {
  let state = source;
  if (state.phase === 'CHECKPOINT') {
    const continued = engine.checkpoint(state, (state.nextWakeAt ?? 0) + 1);
    expect(continued.accepted).toBe(true);
    state = continued.state;
  } else {
    state = engine.advance(state, state.nextWakeAt ?? 0).state;
  }
  return state.phase === 'REVEALING' ? open(engine, state) : state;
}

function resolveWithFirstEligible(
  engine: GavelEngine,
  source: EngineState,
  now: number,
): EngineState {
  const lot = source.currentLot!;
  const leader = lot.eligibleMemberIds[0]!;
  let result = engine.bid(source, leader, bidInput(lot), now);
  expect(result.accepted).toBe(true);
  let state = result.state;
  for (const memberId of lot.eligibleMemberIds.slice(1)) {
    result = engine.pass(state, memberId, passInput(lot), now + 1);
    expect(result.accepted).toBe(true);
    state = result.state;
  }
  return state;
}

function playComplete(
  memberCount: number,
  formation: '4-2-1-3' | '3-5-2' = '4-2-1-3',
): EngineState {
  const engine = new GavelEngine();
  let state = engine.start({
    seed: `complete-${memberCount}-${formation}`,
    now: 1_000,
    settings: fixtureSettings({ formation, budgetMode: 'CHAOS' }),
    members: fixtureMembers(memberCount),
    snapshot: fixtureSnapshot(),
  }).state;
  state = open(engine, state);
  for (let step = 0; step < 500 && state.phase !== 'RESULTS'; step += 1) {
    if (state.phase === 'BIDDING')
      state = resolveWithFirstEligible(engine, state, 2_000 + step * 10);
    if (state.phase !== 'RESULTS') state = nextOpen(engine, state);
  }
  expect(state.phase).toBe('RESULTS');
  return state;
}

describe('authoritative auction engine', () => {
  it('publishes a verifiable commitment while retaining deterministic state', () => {
    const engine = new GavelEngine();
    const mutation = engine.start({
      seed: 'secret-seed',
      now: 100,
      settings: fixtureSettings(),
      members: fixtureMembers(2),
      snapshot: fixtureSnapshot(),
    });
    expect(verifySeedCommitment('secret-seed', mutation.projection.seedCommitment)).toBe(true);
    expect(mutation.projection.phase).toBe('REVEALING');
    expect(mutation.effects.map(({ type }) => type)).toEqual(['GAME_PREPARED', 'LOT_REVEALED']);
  });

  it('rejects stale, ineligible, low, unsafe and duplicate-order bids without corrupting state', () => {
    const engine = new GavelEngine();
    let state = open(
      engine,
      engine.start({
        seed: 'bid-validation',
        now: 0,
        settings: fixtureSettings({ budgetMode: 'STRICT' }),
        members: fixtureMembers(2),
        snapshot: fixtureSnapshot(),
      }).state,
    );
    const lot = state.currentLot!;
    const memberId = lot.eligibleMemberIds[0]!;
    expect(
      engine.bid(state, memberId, { ...bidInput(lot), auctionSequence: lot.sequence - 1 }, 1).error
        ?.code,
    ).toBe('STALE_AUCTION');
    expect(engine.bid(state, 'not-a-member', bidInput(lot), 1).error?.code).toBe('NOT_ELIGIBLE');
    expect(engine.bid(state, memberId, bidInput(lot, lot.openingBidEUR - 1), 1).error?.code).toBe(
      'BID_TOO_LOW',
    );
    const maximum = maximumLegalBid(state, memberId);
    expect(
      engine.bid(state, memberId, bidInput(lot, maximum + state.settings.bidIncrementEUR), 1).error
        ?.code,
    ).toBe('BUDGET_EXCEEDED');

    const key = randomUUID();
    const first = engine.bid(state, memberId, bidInput(lot, lot.openingBidEUR, key), 1);
    expect(first.accepted).toBe(true);
    const repeated = engine.bid(first.state, memberId, bidInput(lot, lot.openingBidEUR, key), 2);
    expect(repeated.accepted).toBe(true);
    expect(repeated.state.replay.filter((event) => event.type === 'BID')).toHaveLength(1);
    state = first.state;
    const rival = lot.eligibleMemberIds[1]!;
    expect(engine.bid(state, rival, bidInput(lot, lot.openingBidEUR), 2).error?.code).toBe(
      'BID_TOO_LOW',
    );
  });

  it('adds fifteen seconds to the deadline after every accepted bid', () => {
    const engine = new GavelEngine();
    const state = open(
      engine,
      engine.start({
        seed: 'anti-snipe',
        now: 10_000,
        settings: fixtureSettings(),
        members: fixtureMembers(3),
        snapshot: fixtureSnapshot(),
      }).state,
    );
    const lot = state.currentLot!;
    const originalDeadline = lot.endsAt!;
    const now = originalDeadline - 8_000;
    const result = engine.bid(state, lot.eligibleMemberIds[0]!, bidInput(lot), now);
    expect(result.state.currentLot?.endsAt).toBe(originalDeadline + 15_000);
    expect(result.nextWakeAt).toBe(originalDeadline + 15_000);
    const second = engine.bid(
      result.state,
      lot.eligibleMemberIds[1]!,
      bidInput(lot, lot.openingBidEUR + state.settings.bidIncrementEUR),
      now + 1_000,
    );
    expect(second.state.currentLot?.endsAt).toBe(originalDeadline + 30_000);
    expect(second.nextWakeAt).toBe(originalDeadline + 30_000);
  });

  it('rejects bid and pass actions at the exact authoritative deadline and after it', () => {
    const engine = new GavelEngine();
    const state = open(
      engine,
      engine.start({
        seed: 'deadline-boundary',
        now: 10_000,
        settings: fixtureSettings(),
        members: fixtureMembers(2),
        snapshot: fixtureSnapshot(),
      }).state,
    );
    const lot = state.currentLot!;
    for (const now of [lot.endsAt!, lot.endsAt! + 1]) {
      expect(engine.bid(state, lot.eligibleMemberIds[0]!, bidInput(lot), now).error?.code).toBe(
        'AUCTION_CLOSED',
      );
      expect(engine.pass(state, lot.eligibleMemberIds[0]!, passInput(lot), now).error?.code).toBe(
        'AUCTION_CLOSED',
      );
    }
  });

  it('rejects a mathematically impossible strict room before revealing the pool', () => {
    const engine = new GavelEngine();
    expect(() =>
      engine.start({
        seed: 'strict-infeasible',
        now: 0,
        settings: fixtureSettings({
          budgetMode: 'STRICT',
          budgetEUR: 100_000_000,
          bidIncrementEUR: 50_000_000,
        }),
        members: fixtureMembers(2, 100_000_000),
        snapshot: fixtureSnapshot(),
      }),
    ).toThrow('STRICT_BUDGET_INFEASIBLE');
  });

  it('preserves every director completion reserve under adversarial max-safe bidding', () => {
    const engine = new GavelEngine();
    let state = engine.start({
      seed: 'aggressive-0',
      now: 0,
      settings: fixtureSettings({ budgetMode: 'STRICT', budgetEUR: 750_000_000 }),
      members: fixtureMembers(2, 750_000_000),
      snapshot: fixtureSnapshot(80),
    }).state;
    let now = 0;
    for (let guard = 0; guard < 500 && state.phase !== 'RESULTS'; guard += 1) {
      now += 1;
      if (['REVEALING', 'SOLD', 'UNSOLD', 'FORCED_ASSIGNMENT', 'NEXT_LOT'].includes(state.phase)) {
        state = engine.advance(state, state.nextWakeAt ?? now).state;
      } else if (state.phase === 'CHECKPOINT') {
        state = engine.checkpoint(state, now).state;
      } else if (state.phase === 'BIDDING') {
        const lot = state.currentLot!;
        const legal = lot.eligibleMemberIds
          .map((memberId) => ({ memberId, maximum: maximumLegalBid(state, memberId) }))
          .filter(({ maximum }) => maximum >= lot.openingBidEUR)
          .sort((left, right) => right.maximum - left.maximum);
        const winner = legal[0];
        if (!winner) {
          for (const memberId of lot.eligibleMemberIds) {
            state = engine.pass(state, memberId, passInput(lot), now).state;
          }
        } else {
          const bid = engine.bid(state, winner.memberId, bidInput(lot, winner.maximum), now);
          expect(bid.accepted, bid.error?.message).toBe(true);
          state = bid.state;
          for (const memberId of lot.eligibleMemberIds.filter((id) => id !== winner.memberId)) {
            state = engine.pass(state, memberId, passInput(lot), now).state;
          }
        }
      }
      for (const entry of state.squads.filter(({ acquisition }) => acquisition !== 'AUCTION')) {
        const poolCandidate = state.cycles
          .find((cycle) => cycle.id === entry.cycleId)!
          .candidates.find((candidate) => candidate.candidate.id === entry.candidate.id)!;
        expect(entry.purchasePriceEUR).toBe(
          poolCandidate.openingBidEUR / (poolCandidate.returnCount > 0 ? 2 : 1),
        );
        expect(entry.acquisition).toBe('FORCED');
      }
      expect(state.members.every((member) => member.remainingBudgetEUR >= 0)).toBe(true);
    }
    expect(state.phase).toBe('RESULTS');
    assertEngineInvariants(state, true);
  });

  it('keeps an unsold return at exactly half price on every subsequent return', () => {
    const engine = new GavelEngine();
    let state = open(
      engine,
      engine.start({
        seed: 'unsold-price',
        now: 0,
        settings: fixtureSettings(),
        members: fixtureMembers(3),
        snapshot: fixtureSnapshot(),
      }).state,
    );
    const original = state.currentLot!;
    for (const memberId of original.eligibleMemberIds) {
      state = engine.pass(state, memberId, passInput(original), 1).state;
    }
    expect(state.phase).toBe('UNSOLD');
    state.revealQueue = [];
    state = engine.advance(state, state.nextWakeAt!).state;
    expect(state.currentLot?.candidate.id).toBe(original.candidate.id);
    expect(state.currentLot?.openingBidEUR).toBe(original.originalOpeningBidEUR / 2);
    state = open(engine, state);
    const second = state.currentLot!;
    for (const memberId of second.eligibleMemberIds) {
      state = engine.pass(state, memberId, passInput(second), 2).state;
    }
    state.revealQueue = [];
    state = engine.advance(state, state.nextWakeAt!).state;
    expect(state.currentLot?.openingBidEUR).toBe(original.originalOpeningBidEUR / 2);
    expect(state.currentLot?.returnCount).toBe(2);
  });

  it('forces the remaining two-player candidate and updates every completion invariant', () => {
    const engine = new GavelEngine();
    let state = open(
      engine,
      engine.start({
        seed: 'forced-two',
        now: 0,
        settings: fixtureSettings(),
        members: fixtureMembers(2),
        snapshot: fixtureSnapshot(),
      }).state,
    );
    const cycleId = state.currentLot!.cycleId;
    state = resolveWithFirstEligible(engine, state, 10);
    expect(state.squads.filter((entry) => entry.cycleId === cycleId)).toHaveLength(2);
    expect(state.squads.some((entry) => entry.acquisition === 'FORCED')).toBe(true);
    expect(state.cycles.find((cycle) => cycle.id === cycleId)?.resolved).toBe(true);
    assertEngineInvariants(state);
  });

  it('caps an unaffordable chaos forced signing at the remaining budget and labels emergency allocation', () => {
    const engine = new GavelEngine();
    let state = open(
      engine,
      engine.start({
        seed: 'emergency',
        now: 0,
        settings: fixtureSettings({ budgetMode: 'CHAOS' }),
        members: fixtureMembers(2),
        snapshot: fixtureSnapshot(),
      }).state,
    );
    const lot = state.currentLot!;
    const forcedMemberId = lot.eligibleMemberIds[1]!;
    state.members.find((member) => member.id === forcedMemberId)!.remainingBudgetEUR = 1_000_000;
    state = resolveWithFirstEligible(engine, state, 1);
    const emergency = state.squads.find((entry) => entry.memberId === forcedMemberId)!;
    expect(emergency.acquisition).toBe('EMERGENCY');
    expect(emergency.purchasePriceEUR).toBe(1_000_000);
    expect(state.members.find((member) => member.id === forcedMemberId)?.remainingBudgetEUR).toBe(
      0,
    );
  });

  it('holds back the weaker fallback until two players are sold in a three-director slot', () => {
    const engine = new GavelEngine();
    let state = open(
      engine,
      engine.start({
        seed: 'three-original-shape',
        now: 0,
        settings: fixtureSettings({ budgetMode: 'CHAOS' }),
        members: fixtureMembers(3),
        snapshot: fixtureSnapshot(),
      }).state,
    );
    const cycleId = state.currentLot!.cycleId;
    const firstLot = state.currentLot!;
    for (const memberId of firstLot.eligibleMemberIds) {
      state = engine.pass(state, memberId, passInput(firstLot), 1).state;
    }
    const cycle = state.cycles.find((entry) => entry.id === cycleId)!;
    const otherIds = cycle.candidates
      .filter(({ candidate, tier }) => tier === 'STRONG' && candidate.id !== firstLot.candidate.id)
      .map(({ candidate }) => candidate.id);
    // Isolate this positional cycle so its unsold strong candidate returns next.
    state.revealQueue = otherIds;
    state = nextOpen(engine, state);
    const secondLot = state.currentLot!;
    const directorA = secondLot.eligibleMemberIds[0]!;
    let result = engine.bid(state, directorA, bidInput(secondLot), 2);
    state = result.state;
    for (const memberId of secondLot.eligibleMemberIds.filter((id) => id !== directorA)) {
      state = engine.pass(state, memberId, passInput(secondLot), 3).state;
    }
    state = nextOpen(engine, state);
    const thirdLot = state.currentLot!;
    const directorB = thirdLot.eligibleMemberIds.find((id) => id !== directorA)!;
    result = engine.bid(state, directorB, bidInput(thirdLot), 4);
    state = result.state;
    for (const memberId of thirdLot.eligibleMemberIds.filter((id) => id !== directorB)) {
      state = engine.pass(state, memberId, passInput(thirdLot), 5).state;
    }
    expect(state.squads.filter((entry) => entry.cycleId === cycleId)).toHaveLength(3);
    const forced = state.squads.find((entry) => entry.acquisition !== 'AUCTION')!;
    const fallback = cycle.candidates.find(({ tier }) => tier === 'FALLBACK')!;
    expect(forced.candidate.id).toBe(fallback.candidate.id);
    expect(
      state.squads
        .filter((entry) => entry.cycleId === cycleId && entry.acquisition === 'AUCTION')
        .every(
          (entry) =>
            formRating(entry.candidate, state.settings.formLookback) >
            formRating(forced.candidate, state.settings.formLookback),
        ),
    ).toBe(true);
  });

  it.each([2, 3, 4])(
    'completes every mandatory slot and calculates exactly 100 metrics for N=%i',
    (count) => {
      const state = playComplete(count, count === 4 ? '3-5-2' : '4-2-1-3');
      assertEngineInvariants(state, true);
      expect(state.squads).toHaveLength(count * 12);
      for (const member of state.members) {
        expect(state.squads.filter((entry) => entry.memberId === member.id)).toHaveLength(12);
        expect(
          state.squads.filter(
            (entry) => entry.memberId === member.id && entry.candidate.preferredPosition === 'CB',
          ),
        ).toHaveLength(count === 4 ? 3 : 2);
      }
      expect(state.evaluation?.metrics).toHaveLength(100);
      expect(state.evaluation?.teams).toHaveLength(count);
      expect(state.evaluation?.headToHead).toHaveLength((count * (count - 1)) / 2);
      for (const metric of state.evaluation?.metrics ?? []) {
        expect(Object.keys(metric.scores)).toHaveLength(count);
        expect(Object.values(metric.scores).every((score) => score >= 0 && score <= 100)).toBe(
          true,
        );
      }
      expect(state.resolvedCycles).toBe(12);
    },
  );

  it('enters a generated checkpoint exactly at four resolved cycles and resumes only on command', () => {
    const engine = new GavelEngine();
    let state = engine.start({
      seed: 'checkpoint-four',
      now: 0,
      settings: fixtureSettings({ budgetMode: 'CHAOS' }),
      members: fixtureMembers(2),
      snapshot: fixtureSnapshot(),
    }).state;
    state = open(engine, state);
    while (state.resolvedCycles < 4) {
      state = resolveWithFirstEligible(engine, state, 10 + state.resolvedCycles);
      if (state.resolvedCycles < 4) state = nextOpen(engine, state);
    }
    expect(state.phase).toBe('CHECKPOINT');
    expect(state.checkpoint?.resolvedCycles).toBe(4);
    expect(state.checkpoint?.projectedScores).toHaveProperty('member-1');
    expect(engine.advance(state, 99_999).state.phase).toBe('CHECKPOINT');
    expect(engine.checkpoint(state, 100_000).state.phase).toBe('REVEALING');
  });
});
