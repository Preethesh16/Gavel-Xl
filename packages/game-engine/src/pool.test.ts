import { describe, expect, it } from 'vitest';
import { FORMATION_NAMES } from './formations.js';
import { generateCandidatePool, poolCandidateCount } from './pool.js';
import { fixtureMembers, fixtureSettings, fixtureSnapshot } from './test-fixtures.js';

describe('candidate pool generation', () => {
  it.each([2, 3, 4, 8])(
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
