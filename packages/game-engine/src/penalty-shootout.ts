import type { CandidateSnapshot, PenaltyKickView, PenaltyShootoutView } from '@gavel-xi/shared';
import { createSeededRandom, nextRandom } from './rng.js';

export interface PenaltyTeam {
  memberId: string;
  players: CandidateSnapshot[];
  goalkeeping: number;
}

// At least 100 complete sudden-death pairs, followed by one conditional pair,
// keeps pathological random streams bounded without selecting a winner by rank.
export const MAX_SHOOTOUT_ROUNDS = 106;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function penaltyAbility(player: CandidateSnapshot | undefined): number {
  if (!player) return 50;
  return player.role.finishing * 0.45 + player.role.composure * 0.35 + player.role.technique * 0.2;
}

/** A game model based on finishing, composure, technique and the opposing keeper. */
export function penaltyScoringChance(
  player: CandidateSnapshot | undefined,
  opposingGoalkeeping: number,
): number {
  return clamp(
    0.74 + (penaltyAbility(player) - 70) / 250 - (opposingGoalkeeping - 70) / 500,
    0.5,
    0.93,
  );
}

function orderedTakers(team: PenaltyTeam): CandidateSnapshot[] {
  return team.players
    .filter(({ kind }) => kind === 'PLAYER')
    .sort(
      (left, right) =>
        penaltyAbility(right) - penaltyAbility(left) || left.id.localeCompare(right.id),
    );
}

/**
 * Simulates a match tiebreak only. It never contributes to the draft's 100-metric
 * standings. The optional draw source lets rule tests cover rare kick sequences.
 */
export function simulatePenaltyShootout(
  home: PenaltyTeam,
  away: PenaltyTeam,
  seed: string,
  draw?: () => number,
): PenaltyShootoutView {
  let random = createSeededRandom(
    JSON.stringify([seed, 'penalty-shootout', home.memberId, away.memberId]),
  );
  const next =
    draw ??
    (() => {
      const result = nextRandom(random);
      random = result.random;
      return result.value;
    });
  const homePlayers = orderedTakers(home);
  const awayPlayers = orderedTakers(away);
  // Teams must have equal numbers eligible; no taker repeats before every
  // eligible teammate has taken one. Empty test/partial squads use an unnamed
  // replacement with neutral ability, never a fabricated real player.
  const eligibleCount = Math.max(1, Math.min(homePlayers.length, awayPlayers.length));
  const homeTakers = homePlayers.slice(0, eligibleCount);
  const awayTakers = awayPlayers.slice(0, eligibleCount);
  const kicks: PenaltyKickView[] = [];
  let homeGoals = 0;
  let awayGoals = 0;
  let homeTaken = 0;
  let awayTaken = 0;

  const takeKick = (
    team: PenaltyTeam,
    isHome: boolean,
    round: number,
    forcedScored?: boolean,
  ): void => {
    const takers = isHome ? homeTakers : awayTakers;
    const taker = takers[(round - 1) % eligibleCount];
    const keeper = isHome ? away.goalkeeping : home.goalkeeping;
    const probability = penaltyScoringChance(taker, keeper);
    const roll = next();
    const scored = forcedScored ?? roll < probability;
    // Conditional on a failed kick, distinguish a save from an off-target shot.
    const failureRoll = forcedScored === false ? roll : (roll - probability) / (1 - probability);
    const saveShare = clamp(0.6 + (keeper - 50) / 250, 0.4, 0.85);
    const outcome: PenaltyKickView['outcome'] = scored
      ? 'SCORED'
      : failureRoll < saveShare
        ? 'SAVED'
        : 'MISSED';
    if (isHome) {
      homeTaken += 1;
      if (scored) homeGoals += 1;
    } else {
      awayTaken += 1;
      if (scored) awayGoals += 1;
    }
    kicks.push({
      round,
      memberId: team.memberId,
      takerId: taker?.id ?? null,
      takerName:
        taker?.commonName ||
        taker?.fullName ||
        `Penalty taker ${((round - 1) % eligibleCount) + 1}`,
      outcome,
      homeGoals,
      awayGoals,
    });
  };
  const complete = (
    resolution: PenaltyShootoutView['resolution'] = 'STANDARD',
  ): PenaltyShootoutView => ({
    homeGoals,
    awayGoals,
    winnerId: homeGoals > awayGoals ? home.memberId : away.memberId,
    kicks,
    suddenDeath: kicks.some(({ round }) => round > 5),
    resolution,
  });
  const clinched = (): boolean =>
    homeGoals > awayGoals + Math.max(0, 5 - awayTaken) ||
    awayGoals > homeGoals + Math.max(0, 5 - homeTaken);

  for (let round = 1; round <= 5; round += 1) {
    takeKick(home, true, round);
    if (clinched()) return complete();
    takeKick(away, false, round);
    if (clinched()) return complete();
  }
  for (let round = 6; round < MAX_SHOOTOUT_ROUNDS; round += 1) {
    takeKick(home, true, round);
    takeKick(away, false, round);
    // A sudden-death decision only follows the same number of kicks per side.
    if (homeGoals !== awayGoals) return complete();
  }

  // After 100 tied sudden-death pairs, sample the final pair conditional on one
  // side scoring and the other missing. This preserves their relative scoring
  // chances and exposes the shortcut in the result instead of inventing a toss.
  const homeChance = penaltyScoringChance(
    homeTakers[(MAX_SHOOTOUT_ROUNDS - 1) % eligibleCount],
    away.goalkeeping,
  );
  const awayChance = penaltyScoringChance(
    awayTakers[(MAX_SHOOTOUT_ROUNDS - 1) % eligibleCount],
    home.goalkeeping,
  );
  const homeOnly = homeChance * (1 - awayChance);
  const awayOnly = awayChance * (1 - homeChance);
  const homeWins = next() < homeOnly / (homeOnly + awayOnly);
  takeKick(home, true, MAX_SHOOTOUT_ROUNDS, homeWins);
  takeKick(away, false, MAX_SHOOTOUT_ROUNDS, !homeWins);
  return complete('CONDITIONED_SUDDEN_DEATH');
}
