import type { CandidateSnapshot, FormationSlot, RoomSettingsInput } from '@gavel-xi/shared';
import { getFormation } from './formations.js';
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

const COVER_STAR_ODDS = 30;

export function isLamineYamal(candidate: CandidateSnapshot): boolean {
  const name = `${candidate.fullName} ${candidate.commonName}`.toLocaleLowerCase();
  return candidate.kind === 'PLAYER' && name.includes('lamine') && name.includes('yamal');
}

export function coverStarAppears(seed: string): boolean {
  return (
    nextRandom(createSeededRandom(`${seed}:cover-star:lamine-yamal`)).value < 1 / COVER_STAR_ODDS
  );
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
        ? candidate.kind === 'MANAGER' && candidate.preferredPosition === 'MANAGER'
        : candidate.kind === 'PLAYER' &&
          candidate.preferredPosition === slot.position &&
          candidate.positions.includes(slot.position)),
  );
}

const STAR_RANK_POWER = 6;
const STAR_RANK_BOOST = 30;

/**
 * Builds a weighted random order without replacement. Higher-ranked strong
 * candidates receive a pronounced star preference, while the baseline weight
 * leaves every strong candidate with a real chance. The random stream remains
 * entirely seed-derived, so replays are deterministic.
 */
function starPreferredOrder(
  rankedCandidates: CandidateSnapshot[],
  random: SeededRandom,
): { values: CandidateSnapshot[]; random: SeededRandom } {
  let cursor = random;
  const weighted = rankedCandidates.map((candidate, index) => {
    const draw = nextRandom(cursor);
    cursor = draw.random;
    const rank = (rankedCandidates.length - index) / Math.max(1, rankedCandidates.length);
    const weight = 1 + STAR_RANK_BOOST * Math.pow(rank, STAR_RANK_POWER);
    return {
      candidate,
      // Exponential-race sampling gives weighted draws without replacement.
      priority: -Math.log(Math.max(Number.EPSILON, draw.value)) / weight,
    };
  });
  weighted.sort(
    (left, right) =>
      left.priority - right.priority || left.candidate.id.localeCompare(right.candidate.id),
  );
  return { values: weighted.map(({ candidate }) => candidate), random: cursor };
}

function diversify(
  candidates: CandidateSnapshot[],
  count: number,
  random: SeededRandom,
  preferHigherRanks = false,
): { selected: CandidateSnapshot[]; random: SeededRandom } {
  const mixed = preferHigherRanks
    ? starPreferredOrder(candidates, random)
    : shuffle(candidates, random);
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
  featuredCandidate?: CandidateSnapshot,
): { candidates: PoolCandidate[]; random: SeededRandom } {
  const available = availableForSlot(slot, source, usedIds).filter(
    (candidate) => !isLamineYamal(candidate) || candidate.id === featuredCandidate?.id,
  );
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
  const strongPick = diversify(strongPool, count - 1, fallbackPick.random, true);
  let tiered: Array<{ candidate: CandidateSnapshot; tier: CandidateTier }> = [
    ...strongPick.selected.map((candidate) => ({ candidate, tier: 'STRONG' as const })),
    ...fallbackPick.selected.map((candidate) => ({ candidate, tier: 'FALLBACK' as const })),
  ];
  if (featuredCandidate && available.some(({ id }) => id === featuredCandidate.id)) {
    const withoutFeatured = tiered.filter(({ candidate }) => candidate.id !== featuredCandidate.id);
    const fallback = withoutFeatured.find(({ tier }) => tier === 'FALLBACK');
    const strong = withoutFeatured.filter(({ tier }) => tier === 'STRONG').slice(0, count - 2);
    tiered = [
      ...strong,
      { candidate: featuredCandidate, tier: 'STRONG' },
      ...(fallback ? [fallback] : []),
    ];
  }
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
  const coverStar = coverStarAppears(input.seed)
    ? input.snapshot.candidates.find(isLamineYamal)
    : undefined;
  let coverStarAdded = false;
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
      !coverStarAdded && coverStar?.preferredPosition === formationSlot.position
        ? coverStar
        : undefined,
    );
    if (generated.candidates.some(({ candidate }) => candidate.id === coverStar?.id)) {
      coverStarAdded = true;
    }
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
  // The one lower-rated fallback in each slot is deliberately withheld from
  // the public auction. It becomes the forced deal only after the other N-1
  // candidates have been sold, guaranteeing exactly one completed slot per
  // director without exposing the fallback early.
  const auctionCandidateIds = cycles.flatMap((cycle) =>
    cycle.candidates.filter(({ tier }) => tier === 'STRONG').map(({ candidate }) => candidate.id),
  );
  const reveal = shuffle(auctionCandidateIds, random);
  return { formation, cycles, revealQueue: reveal.values };
}

export function poolCandidateCount(pool: GeneratedPool, position: string): number {
  return pool.cycles
    .filter((cycle) => cycle.position === position)
    .reduce((total, cycle) => total + cycle.candidates.length, 0);
}
