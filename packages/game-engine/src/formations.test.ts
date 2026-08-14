import { describe, expect, it } from 'vitest';

import {
  FORMATIONS,
  FORMATION_NAMES,
  FORMATION_PRESETS,
  getFormation,
  isPositionCompatible,
  resolveFormation,
} from './formations.js';
import {
  createSeedCommitment,
  createSeededRandom,
  nextRandom,
  randomInteger,
  sha256,
  shuffle,
  seedCommitment,
  verifySeedCommitment,
} from './rng.js';

describe('formation presets', () => {
  it('contains all seven data-driven presets with eleven players and a manager', () => {
    expect(FORMATION_NAMES).toEqual([
      '4-2-1-3',
      '4-3-3',
      '4-2-3-1',
      '4-4-2',
      '3-4-2-1',
      '3-5-2',
      '5-2-1-2',
    ]);
    expect(FORMATION_PRESETS).toBe(FORMATIONS);
    expect(getFormation('4-3-3')).toEqual(resolveFormation('4-3-3'));

    for (const formation of Object.values(FORMATIONS)) {
      expect(formation.slots).toHaveLength(12);
      expect(formation.slots.filter(({ position }) => position === 'MANAGER')).toHaveLength(1);
      expect(formation.slots.filter(({ position }) => position !== 'MANAGER')).toHaveLength(11);
      expect(new Set(formation.slots.map(({ id }) => id)).size).toBe(12);
    }
  });

  it('represents repeated positions as independently indexed cycles', () => {
    const fourTwoOneThree = resolveFormation('4-2-1-3');
    expect(
      fourTwoOneThree.slots
        .filter(({ position }) => position === 'CB')
        .map(({ id, cycleIndex }) => ({ id, cycleIndex })),
    ).toEqual([
      { id: 'cb-1', cycleIndex: 0 },
      { id: 'cb-2', cycleIndex: 1 },
    ]);
    expect(
      fourTwoOneThree.slots
        .filter(({ position }) => position === 'DM')
        .map(({ cycleIndex }) => cycleIndex),
    ).toEqual([0, 1]);

    const threeFiveTwo = resolveFormation('3-5-2');
    expect(threeFiveTwo.slots.filter(({ position }) => position === 'CB')).toHaveLength(3);
    expect(
      threeFiveTwo.slots
        .filter(({ position }) => position === 'CB')
        .map(({ cycleIndex }) => cycleIndex),
    ).toEqual([0, 1, 2]);
    expect(threeFiveTwo.slots.filter(({ position }) => position === 'ST')).toHaveLength(2);
  });

  it('returns defensive copies rather than exposing mutable preset data', () => {
    const first = resolveFormation('4-3-3');
    const second = resolveFormation('4-3-3');
    first.slots[0]?.compatiblePositions.push('ST');
    first.slots.splice(1, 1);

    expect(second.slots).toHaveLength(12);
    expect(second.slots[0]?.compatiblePositions).toEqual(['GK']);
    expect(FORMATIONS['4-3-3'].slots).toHaveLength(12);
  });

  it('uses exact football positions for slot eligibility', () => {
    const formation = resolveFormation('4-2-3-1');
    const leftBack = formation.slots.find(({ position }) => position === 'LB');
    const attackingMidfield = formation.slots.find(({ position }) => position === 'AM');

    expect(leftBack).toBeDefined();
    expect(attackingMidfield).toBeDefined();
    expect(isPositionCompatible(leftBack!, ['LB'])).toBe(true);
    expect(isPositionCompatible(leftBack!, ['LWB'])).toBe(false);
    expect(isPositionCompatible(leftBack!, ['RB', 'CB'])).toBe(false);
    expect(isPositionCompatible(attackingMidfield!, ['AM'])).toBe(true);
    expect(isPositionCompatible(attackingMidfield!, ['LW'])).toBe(false);

    for (const preset of Object.values(FORMATIONS)) {
      for (const formationSlot of preset.slots) {
        expect(formationSlot.compatiblePositions).toEqual([formationSlot.position]);
      }
    }
  });

  it('keeps wing-back presentation roles backed by verified full-back positions', () => {
    const formation = resolveFormation('3-5-2');
    const leftWingBack = formation.slots.find(({ label }) => label === 'LWB');
    const rightWingBack = formation.slots.find(({ label }) => label === 'RWB');

    expect(leftWingBack).toMatchObject({ position: 'LB', compatiblePositions: ['LB'] });
    expect(rightWingBack).toMatchObject({ position: 'RB', compatiblePositions: ['RB'] });
  });
});

describe('seeded randomisation and commitment', () => {
  it('matches the standard SHA-256 vector and verifies commitments', () => {
    const commitment = createSeedCommitment('abc');
    expect(commitment).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abc')).toBe(commitment);
    expect(seedCommitment('abc')).toBe(commitment);
    expect(verifySeedCommitment('abc', commitment)).toBe(true);
    expect(verifySeedCommitment('tampered', commitment)).toBe(false);
  });

  it('produces the same stream for the same seed and a different stream for another seed', () => {
    const stream = (seed: string): number[] => {
      let random = createSeededRandom(seed);
      const values: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const next = nextRandom(random);
        random = next.random;
        values.push(next.value);
      }
      return values;
    };

    expect(stream('room-seed')).toEqual(stream('room-seed'));
    expect(stream('room-seed')).not.toEqual(stream('different-seed'));
    expect(stream('room-seed').every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('shuffles deterministically without losing, duplicating, or mutating values', () => {
    const source = Array.from({ length: 64 }, (_, index) => index);
    const first = shuffle(source, createSeededRandom('shuffle-me'));
    const second = shuffle(source, createSeededRandom('shuffle-me'));

    expect(first.values).toEqual(second.values);
    expect(first.values).not.toEqual(source);
    expect([...first.values].sort((a, b) => a - b)).toEqual(source);
    expect(source).toEqual(Array.from({ length: 64 }, (_, index) => index));
  });

  it('keeps integer draws inside inclusive boundary ranges', () => {
    let random = createSeededRandom('range-boundaries');
    const seen = new Set<number>();
    for (let index = 0; index < 2_000; index += 1) {
      const next = randomInteger(random, 2, 8);
      random = next.random;
      expect(next.value).toBeGreaterThanOrEqual(2);
      expect(next.value).toBeLessThanOrEqual(8);
      seen.add(next.value);
    }
    expect(seen).toEqual(new Set([2, 3, 4, 5, 6, 7, 8]));
  });

  it('rejects empty seeds and invalid integer ranges', () => {
    expect(() => createSeededRandom('')).toThrow('GAME_SEED_EMPTY');
    expect(() => randomInteger(createSeededRandom('seed'), 5, 4)).toThrow('INVALID_RANDOM_RANGE');
    expect(() => randomInteger(createSeededRandom('seed'), 0.5, 2)).toThrow('INVALID_RANDOM_RANGE');
  });
});
