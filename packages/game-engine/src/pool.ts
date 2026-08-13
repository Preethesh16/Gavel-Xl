import type { CandidateSnapshot, FormationSlot, RoomSettingsInput } from '@gavel-xi/shared';
import { getFormation, isPositionCompatible } from './formations.js';
import { positionPercentiles, scoreCurrentForm } from './ratings.js';
import { createSeededRandom, nextRandom, shuffle, type SeededRandom } from './rng.js';
import type {
  CandidateTier,
  CycleState,
  EngineMember,
  EngineSnapshot,
  GeneratedPool,
  PoolCandidate,
} from './types.js';

export interface GeneratePoolInput {
  seed: string;
  settings: RoomSettingsInput;
  members: EngineMember[];
  snapshot: EngineSnapshot;
}

function roundReserve(valueEUR: number, incrementEUR: number, maximumEUR: number): number {
  const safe = Math.max(incrementEUR, Math.min(maximumEUR, valueEUR));
  return Math.max(incrementEUR, Math.round(safe / incrementEUR) * incrementEUR);
}

function makePoolCandidate(
  candidate: CandidateSnapshot,
  tier: CandidateTier,
  settings: RoomSettingsInput,
  random: SeededRandom,
  strictCycleCapEUR: number,
): { poolCandidate: PoolCandidate; random: SeededRandom } {
  const multiplierDraw = nextRandom(random);
  const priorityDraw = nextRandom(multiplierDraw.random);
  const valueEUR = candidate.valuation.valueEUR;
  if (valueEUR === null || valueEUR <= 0)
    throw new Error(`CANDIDATE_WITHOUT_VALUATION:${candidate.id}`);
  const multiplier = 0.7 + multiplierDraw.value * 0.3;
  const productMaximum = candidate.kind === 'MANAGER' ? 80_000_000 : 250_000_000;
  const maximum =
    settings.budgetMode === 'STRICT' ? Math.min(productMaximum, strictCycleCapEUR) : productMaximum;
  return {
    poolCandidate: {
      candidate,
      tier,
      openingBidEUR: roundReserve(valueEUR * multiplier, settings.bidIncrementEUR, maximum),
      returnPriority: priorityDraw.value,
      status: 'QUEUED',
      returnCount: 0,
    },
    random: priorityDraw.random,
  };
}

function availableForSlot(
  slot: FormationSlot,
  candidates: CandidateSnapshot[],
  usedIds: Set<string>,
): CandidateSnapshot[] {
  return candidates.filter(
    (candidate) =>
      !usedIds.has(candidate.id) &&
      candidate.valuation.valueEUR !== null &&
      candidate.valuation.valueEUR > 0 &&
      (slot.position === 'MANAGER'
        ? candidate.kind === 'MANAGER'
        : candidate.kind === 'PLAYER' && isPositionCompatible(slot, candidate.positions)),
  );
}

function diversify(
  candidates: CandidateSnapshot[],
  count: number,
  random: SeededRandom,
): { selected: CandidateSnapshot[]; random: SeededRandom } {
  const mixed = shuffle(candidates, random);
  const selected: CandidateSnapshot[] = [];
  const clubCounts = new Map<string, number>();
  const nationalityCounts = new Map<string, number>();
  for (const candidate of mixed.values) {
    if (selected.length >= count) break;
    const clubCount = clubCounts.get(candidate.club) ?? 0;
    const nationCount = nationalityCounts.get(candidate.nationality) ?? 0;
    const hasAlternative = mixed.values.some(
      (alternative) =>
        !selected.includes(alternative) &&
        (clubCounts.get(alternative.club) ?? 0) < clubCount &&
        (nationalityCounts.get(alternative.nationality) ?? 0) <= nationCount,
    );
    if ((clubCount >= 1 || nationCount >= 2) && hasAlternative) continue;
    selected.push(candidate);
    clubCounts.set(candidate.club, clubCount + 1);
    nationalityCounts.set(candidate.nationality, nationCount + 1);
  }
  for (const candidate of mixed.values) {
    if (selected.length >= count) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return { selected, random: mixed.random };
}

function candidatesForCycle(
  slot: FormationSlot,
  source: CandidateSnapshot[],
  usedIds: Set<string>,
  count: number,
  settings: RoomSettingsInput,
  random: SeededRandom,
  strictCycleCapEUR: number,
): { candidates: PoolCandidate[]; random: SeededRandom } {
  const available = availableForSlot(slot, source, usedIds);
  const percentiles = positionPercentiles(available, settings.formLookback);
  const preferredStrong = available
    .filter((candidate) => (percentiles.get(candidate.id) ?? 0) >= 80)
    .sort(
      (left, right) =>
        scoreCurrentForm(right, settings.formLookback) -
          scoreCurrentForm(left, settings.formLookback) || left.id.localeCompare(right.id),
    );
  const preferredFallback = available
    .filter((candidate) => {
      const percentile = percentiles.get(candidate.id) ?? 0;
      return percentile >= 50 && percentile <= 75;
    })
    .sort(
      (left, right) =>
        scoreCurrentForm(right, settings.formLookback) -
          scoreCurrentForm(left, settings.formLookback) || left.id.localeCompare(right.id),
    );
  if (available.length < count) {
    throw new Error(
      `INSUFFICIENT_CANDIDATES:${slot.position}:available=${available.length}/${count}`,
    );
  }
  const fallbackPool =
    preferredFallback.length > 0
      ? preferredFallback
      : [...available].sort(
          (left, right) =>
            Math.abs((percentiles.get(left.id) ?? 0) - 62) -
              Math.abs((percentiles.get(right.id) ?? 0) - 62) || left.id.localeCompare(right.id),
        );
  const fallbackPick = diversify(fallbackPool, 1, random);
  const fallbackId = fallbackPick.selected[0]!.id;
  const strongWithoutFallback = preferredStrong.filter((candidate) => candidate.id !== fallbackId);
  const fillers = available
    .filter(
      (candidate) =>
        candidate.id !== fallbackId &&
        !strongWithoutFallback.some((strongCandidate) => strongCandidate.id === candidate.id),
    )
    .sort(
      (left, right) =>
        scoreCurrentForm(right, settings.formLookback) -
          scoreCurrentForm(left, settings.formLookback) || left.id.localeCompare(right.id),
    );
  const strongPool =
    strongWithoutFallback.length >= count - 1
      ? strongWithoutFallback
      : [...strongWithoutFallback, ...fillers.slice(0, count - 1 - strongWithoutFallback.length)];
  const strongPick = diversify(strongPool, count - 1, fallbackPick.random);
  const tiered: Array<{ candidate: CandidateSnapshot; tier: CandidateTier }> = [
    ...strongPick.selected.map((candidate) => ({ candidate, tier: 'STRONG' as const })),
    ...fallbackPick.selected.map((candidate) => ({ candidate, tier: 'FALLBACK' as const })),
  ];
  const mixed = shuffle(tiered, strongPick.random);
  let cursor = mixed.random;
  const result: PoolCandidate[] = [];
  for (const { candidate, tier } of mixed.values) {
    usedIds.add(candidate.id);
    const built = makePoolCandidate(candidate, tier, settings, cursor, strictCycleCapEUR);
    cursor = built.random;
    result.push(built.poolCandidate);
  }
  return { candidates: result, random: cursor };
}

export function generateCandidatePool(input: GeneratePoolInput): GeneratedPool {
  const participantCount = input.members.length;
  if (!Number.isInteger(participantCount) || participantCount < 2 || participantCount > 8) {
    throw new Error(`INVALID_PARTICIPANT_COUNT:${participantCount}`);
  }
  if (new Set(input.members.map((member) => member.id)).size !== participantCount) {
    throw new Error('DUPLICATE_MEMBER_ID');
  }
  const formation = getFormation(input.settings.formation);
  const strictCycleCapEUR =
    Math.floor(input.settings.budgetEUR / formation.slots.length / input.settings.bidIncrementEUR) *
    input.settings.bidIncrementEUR;
  const usedIds = new Set<string>();
  let random = createSeededRandom(`${input.seed}:candidate-pool`);
  const cycles: CycleState[] = [];
  for (const formationSlot of formation.slots) {
    const generated = candidatesForCycle(
      formationSlot,
      input.snapshot.candidates,
      usedIds,
      participantCount,
      input.settings,
      random,
      strictCycleCapEUR,
    );
    random = generated.random;
    cycles.push({
      id: `${formationSlot.id}-cycle`,
      slotId: formationSlot.id,
      position: formationSlot.position,
      cycleIndex: formationSlot.cycleIndex,
      candidates: generated.candidates,
      assignments: {},
      resolved: false,
    });
  }
  const candidateIds = cycles.flatMap((cycle) =>
    cycle.candidates.map(({ candidate }) => candidate.id),
  );
  const reveal = shuffle(candidateIds, random);
  return { formation, cycles, revealQueue: reveal.values };
}

export function poolCandidateCount(pool: GeneratedPool, position: string): number {
  return pool.cycles
    .filter((cycle) => cycle.position === position)
    .reduce((total, cycle) => total + cycle.candidates.length, 0);
}
