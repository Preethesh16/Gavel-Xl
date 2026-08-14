import { describe, expect, it } from 'vitest';
import { FORMATION_NAMES } from './formations.js';
import { generateCandidatePool, poolCandidateCount } from './pool.js';
import { scoreCurrentForm } from './ratings.js';
import { fixtureMembers, fixtureSettings, fixtureSnapshot } from './test-fixtures.js';

describe('candidate pool generation', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])(
    'creates exactly N candidates with N-1 strong and one fallback for N=%i',
    (count) => {
      const pool = generateCandidatePool({
        seed: `pool-${count}`,
        settings: fixtureSettings(),
        members: fixtureMembers(count),
        snapshot: fixtureSnapshot(),
      });
      expect(pool.cycles).toHaveLength(12);
      for (const cycle of pool.cycles) {
        expect(cycle.candidates).toHaveLength(count);
        expect(
          cycle.candidates.every(
            ({ candidate }) =>
              candidate.preferredPosition === cycle.position &&
              candidate.positions.includes(cycle.position),
          ),
        ).toBe(true);
        expect(cycle.candidates.filter((candidate) => candidate.tier === 'STRONG')).toHaveLength(
          count - 1,
        );
        expect(cycle.candidates.filter((candidate) => candidate.tier === 'FALLBACK')).toHaveLength(
          1,
        );
      }
    },
  );

  it('creates eight independent CB candidates across two cycles for four players', () => {
    const pool = generateCandidatePool({
      seed: 'four-centre-backs',
      settings: fixtureSettings({ formation: '4-2-1-3' }),
      members: fixtureMembers(4),
      snapshot: fixtureSnapshot(),
    });
    expect(pool.cycles.filter((cycle) => cycle.position === 'CB')).toHaveLength(2);
    expect(poolCandidateCount(pool, 'CB')).toBe(8);
  });

  it.each(FORMATION_NAMES)(
    'supports eight directors without duplicate candidates in %s',
    (formation) => {
      const pool = generateCandidatePool({
        seed: `capacity-${formation}`,
        settings: fixtureSettings({ formation }),
        members: fixtureMembers(8),
        snapshot: fixtureSnapshot(),
      });
      const ids = pool.cycles.flatMap((cycle) =>
        cycle.candidates.map(({ candidate }) => candidate.id),
      );
      expect(ids).toHaveLength(96);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(pool.revealQueue).size).toBe(ids.length);
    },
  );

  it('is deterministic for a seed but changes the hidden order for another seed', () => {
    const input = {
      settings: fixtureSettings(),
      members: fixtureMembers(3),
      snapshot: fixtureSnapshot(),
    };
    const first = generateCandidatePool({ ...input, seed: 'same' });
    const again = generateCandidatePool({ ...input, seed: 'same' });
    const other = generateCandidatePool({ ...input, seed: 'other' });
    expect(first).toEqual(again);
    expect(first.revealQueue).not.toEqual(other.revealQueue);
  });

  it('never fills a winger cycle with a striker even when the striker lists winger second', () => {
    const snapshot = fixtureSnapshot(8);
    const striker = snapshot.candidates.find(
      ({ preferredPosition }) => preferredPosition === 'ST',
    )!;
    striker.fullName = 'Harry Kane';
    striker.commonName = 'Harry Kane';
    striker.positions = ['ST', 'LW'];
    snapshot.candidates = snapshot.candidates.filter(
      (candidate) => candidate.preferredPosition !== 'LW' || candidate.id.endsWith('-0'),
    );

    expect(() =>
      generateCandidatePool({
        seed: 'harry-kane-is-a-striker',
        settings: fixtureSettings({ formation: '4-3-3' }),
        members: fixtureMembers(2),
        snapshot,
      }),
    ).toThrow('INSUFFICIENT_CANDIDATES:LW:available=1/2');
  });

  it('strongly prefers elite players without guaranteeing them and preserves seeded variety', () => {
    const snapshot = fixtureSnapshot(60);
    const rankedStrikers = snapshot.candidates
      .filter(({ preferredPosition }) => preferredPosition === 'ST')
      .sort(
        (left, right) =>
          scoreCurrentForm(right) - scoreCurrentForm(left) || left.id.localeCompare(right.id),
      );
    const eliteIds = new Set(rankedStrikers.slice(0, 3).map(({ id }) => id));
    const eliteSelections = new Map<string, number>();
    const allSelectionCounts = new Map<string, number>();
    const strongSelections = new Set<string>();
    let cyclesWithElite = 0;

    for (let index = 0; index < 160; index += 1) {
      const pool = generateCandidatePool({
        seed: `star-preference-${index}`,
        settings: fixtureSettings({ formation: '4-3-3' }),
        members: fixtureMembers(2),
        snapshot,
      });
      const strikerCycle = pool.cycles.find(({ position }) => position === 'ST')!;
      const strong = strikerCycle.candidates.find(({ tier }) => tier === 'STRONG')!.candidate;
      strongSelections.add(strong.id);
      allSelectionCounts.set(strong.id, (allSelectionCounts.get(strong.id) ?? 0) + 1);
      if (eliteIds.has(strong.id)) {
        cyclesWithElite += 1;
        eliteSelections.set(strong.id, (eliteSelections.get(strong.id) ?? 0) + 1);
      }
    }

    expect(cyclesWithElite / 160).toBeGreaterThan(0.7);
    expect(cyclesWithElite).toBeLessThan(160);
    expect(eliteSelections.size).toBe(eliteIds.size);
    expect(allSelectionCounts.get(rankedStrikers[0]!.id)).toBeGreaterThan(0);
    expect(allSelectionCounts.get(rankedStrikers[0]!.id)).toBeLessThan(160);
    expect(strongSelections.size).toBeGreaterThan(10);
  });

  it('rejects participant counts outside two to eight and insufficient provider data', () => {
    expect(() =>
      generateCandidatePool({
        seed: 'one',
        settings: fixtureSettings(),
        members: fixtureMembers(1),
        snapshot: fixtureSnapshot(),
      }),
    ).toThrow('INVALID_PARTICIPANT_COUNT');
    expect(() =>
      generateCandidatePool({
        seed: 'thin',
        settings: fixtureSettings({ formation: '3-5-2' }),
        members: fixtureMembers(8),
        snapshot: fixtureSnapshot(8),
      }),
    ).toThrow('INSUFFICIENT_CANDIDATES');
  });
});
