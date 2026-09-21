import type { CandidateSnapshot, PenaltyShootoutView } from '@gavel-xi/shared';
import { describe, expect, it } from 'vitest';
import {
  MAX_SHOOTOUT_ROUNDS,
  penaltyScoringChance,
  simulatePenaltyShootout,
  type PenaltyTeam,
} from './penalty-shootout.js';
import { fixtureSnapshot } from './test-fixtures.js';

function team(memberId: string): PenaltyTeam {
  return {
    memberId,
    players: fixtureSnapshot()
      .candidates.filter(({ kind }) => kind === 'PLAYER')
      .slice(0, 11)
      .map((candidate, index) => ({ ...structuredClone(candidate), id: `${memberId}-${index}` })),
    goalkeeping: 70,
  };
}

function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index++];
    if (value === undefined) throw new Error('Shootout continued beyond the deciding kick');
    return value;
  };
}

function validateTally(result: PenaltyShootoutView): void {
  let home = 0;
  let away = 0;
  for (const kick of result.kicks) {
    if (kick.outcome === 'SCORED') {
      if (kick.memberId === 'home') home += 1;
      else away += 1;
    }
    expect(kick.homeGoals).toBe(home);
    expect(kick.awayGoals).toBe(away);
  }
  expect(result.homeGoals).toBe(home);
  expect(result.awayGoals).toBe(away);
  expect(result.winnerId).toBe(home > away ? 'home' : 'away');
}

describe('penalty shootouts', () => {
  it('clinches at 3–0 after three kicks each without taking redundant penalties', () => {
    const result = simulatePenaltyShootout(
      team('home'),
      team('away'),
      'clinch',
      sequence([0, 0.99, 0, 0.99, 0, 0.99]),
    );
    expect(result).toMatchObject({
      homeGoals: 3,
      awayGoals: 0,
      winnerId: 'home',
      suddenDeath: false,
      resolution: 'STANDARD',
    });
    expect(result.kicks).toHaveLength(6);
    validateTally(result);
  });

  it('can clinch after the first side takes its fourth kick', () => {
    const result = simulatePenaltyShootout(
      team('home'),
      team('away'),
      'unequal-kicks',
      sequence([0, 0, 0, 0.99, 0, 0.99, 0]),
    );
    expect(result).toMatchObject({ homeGoals: 4, awayGoals: 1, winnerId: 'home' });
    expect(result.kicks).toHaveLength(7);
    validateTally(result);
  });

  it('allows the second side to clinch and never assumes the home side wins', () => {
    const result = simulatePenaltyShootout(
      team('home'),
      team('away'),
      'away-winner',
      sequence([0.99, 0, 0.99, 0, 0.99, 0]),
    );
    expect(result).toMatchObject({ homeGoals: 0, awayGoals: 3, winnerId: 'away' });
    validateTally(result);
  });

  it('requires both kicks in each sudden-death pair, including when both score', () => {
    const result = simulatePenaltyShootout(
      team('home'),
      team('away'),
      'sudden-death',
      sequence([...Array<number>(12).fill(0), 0.99, 0]),
    );
    expect(result).toMatchObject({
      homeGoals: 6,
      awayGoals: 7,
      winnerId: 'away',
      suddenDeath: true,
    });
    expect(result.kicks).toHaveLength(14);
    expect(result.kicks.at(-1)?.round).toBe(7);
    validateTally(result);
  });

  it('uses every eligible player before allowing a repeat taker and excludes managers', () => {
    const home = team('home');
    const manager = fixtureSnapshot().candidates.find(({ kind }) => kind === 'MANAGER')!;
    home.players.push(manager);
    const result = simulatePenaltyShootout(
      home,
      team('away'),
      'all-takers',
      sequence([...Array<number>(22).fill(0), 0, 0.99]),
    );
    const homeKicks = result.kicks.filter(({ memberId }) => memberId === 'home');
    expect(new Set(homeKicks.slice(0, 11).map(({ takerId }) => takerId)).size).toBe(11);
    expect(homeKicks[11]?.takerId).toBe(homeKicks[0]?.takerId);
    expect(homeKicks.some(({ takerId }) => takerId === manager.id)).toBe(false);
    expect(
      homeKicks.every(({ takerName }) =>
        home.players.some(({ commonName }) => commonName === takerName),
      ),
    ).toBe(true);
  });

  it('models stronger takers and opposing goalkeepers in opposite directions', () => {
    const player = team('home').players[0] as CandidateSnapshot;
    const strong = structuredClone(player);
    strong.role.finishing = 100;
    strong.role.composure = 100;
    strong.role.technique = 100;
    expect(penaltyScoringChance(strong, 70)).toBeGreaterThan(penaltyScoringChance(player, 70));
    expect(penaltyScoringChance(player, 95)).toBeLessThan(penaltyScoringChance(player, 45));
  });

  it('is stable for a seed, logs real outcomes, and varies across seeds', () => {
    const home = team('home');
    const away = team('away');
    const first = simulatePenaltyShootout(home, away, 'stable');
    expect(simulatePenaltyShootout(structuredClone(home), structuredClone(away), 'stable')).toEqual(
      first,
    );
    const results = Array.from({ length: 100 }, (_, index) =>
      simulatePenaltyShootout(home, away, `variety-${index}`),
    );
    expect(new Set(results.map(({ winnerId }) => winnerId)).size).toBe(2);
    expect(new Set(results.flatMap(({ kicks }) => kicks.map(({ outcome }) => outcome)))).toEqual(
      new Set(['SCORED', 'SAVED', 'MISSED']),
    );
    for (const result of results) {
      expect(result.homeGoals).not.toBe(result.awayGoals);
      expect(result.kicks.length).toBeLessThanOrEqual(MAX_SHOOTOUT_ROUNDS * 2);
      validateTally(result);
    }
  });

  it('bounds pathological all-score streams with a disclosed conditional sudden-death pair', () => {
    const result = simulatePenaltyShootout(team('home'), team('away'), 'cap', () => 0);
    expect(result).toMatchObject({
      winnerId: 'home',
      suddenDeath: true,
      resolution: 'CONDITIONED_SUDDEN_DEATH',
    });
    expect(result.kicks).toHaveLength(MAX_SHOOTOUT_ROUNDS * 2);
    expect(result.homeGoals - result.awayGoals).toBe(1);
    expect(result.kicks.at(-1)?.round).toBe(MAX_SHOOTOUT_ROUNDS);
    validateTally(result);
  });
});
