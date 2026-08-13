import { createHash } from 'node:crypto';

/** A small serializable PRNG state suitable for deterministic game mechanics. */
export interface SeededRandom {
  readonly seed: string;
  readonly state: number;
}

function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

export function createSeededRandom(seed: string): SeededRandom {
  if (seed.length === 0) throw new Error('GAME_SEED_EMPTY');
  return { seed, state: hash32(seed) };
}

export function nextRandom(random: SeededRandom): { random: SeededRandom; value: number } {
  const state = (random.state + 0x6d2b79f5) >>> 0;
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return {
    random: { seed: random.seed, state },
    value: ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296,
  };
}

export function randomInteger(
  random: SeededRandom,
  minimum: number,
  maximum: number,
): { random: SeededRandom; value: number } {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) {
    throw new Error('INVALID_RANDOM_RANGE');
  }
  const next = nextRandom(random);
  return {
    random: next.random,
    value: minimum + Math.floor(next.value * (maximum - minimum + 1)),
  };
}

export function shuffle<T>(
  values: readonly T[],
  random: SeededRandom,
): { values: T[]; random: SeededRandom } {
  const shuffled = [...values];
  let cursor = random;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const next = randomInteger(cursor, 0, index);
    cursor = next.random;
    const swap = shuffled[index];
    shuffled[index] = shuffled[next.value] as T;
    shuffled[next.value] = swap as T;
  }
  return { values: shuffled, random: cursor };
}

export function pickOne<T>(
  values: readonly T[],
  random: SeededRandom,
): { value: T; random: SeededRandom } {
  if (values.length === 0) throw new Error('CANNOT_PICK_FROM_EMPTY_COLLECTION');
  const next = randomInteger(random, 0, values.length - 1);
  return { value: values[next.value] as T, random: next.random };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export const createSeedCommitment = sha256;
export const seedCommitment = sha256;

export function verifySeedCommitment(seed: string, commitment: string): boolean {
  return sha256(seed) === commitment.toLowerCase();
}
