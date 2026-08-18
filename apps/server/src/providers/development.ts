import type { Position, RoleProfile, TacticalProfile, Valuation } from '@gavel-xi/shared';
import type {
  FootballDataProvider,
  NormalizedCandidate,
  NormalizedManager,
  NormalizedPlayer,
  PlayerSeasonStats,
  ValuationProvider,
  ValuationResult,
} from './types.js';
import { PLAYER_POSITIONS } from './types.js';
import { curatedManagers } from './curated-managers.js';

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roleFor(position: Position, rating: number, index: number): RoleProfile {
  const jitter = (multiplier: number): number => ((index * multiplier) % 13) - 6;
  const attacker = ['AM', 'LW', 'RW', 'ST'].includes(position);
  const defender = ['GK', 'LB', 'CB', 'RB', 'LWB', 'RWB', 'DM'].includes(position);
  return {
    pace: clamp(rating + jitter(3) + (attacker ? 5 : 0)),
    physical: clamp(rating + jitter(5) + (defender ? 5 : 0)),
    technique: clamp(rating + jitter(7) + (attacker ? 4 : 0)),
    creativity: clamp(rating + jitter(11) + (['AM', 'CM', 'LW', 'RW'].includes(position) ? 8 : -3)),
    defending: clamp(rating + jitter(2) + (defender ? 10 : -18)),
    aerial: clamp(rating + jitter(4) + (['CB', 'ST', 'GK'].includes(position) ? 8 : 0)),
    passing: clamp(rating + jitter(6) + (['DM', 'CM', 'AM'].includes(position) ? 8 : 0)),
    finishing: clamp(rating + jitter(8) + (attacker ? 10 : -22)),
    pressing: clamp(rating + jitter(9)),
    composure: clamp(rating + jitter(10)),
  };
}

function valuation(valueEUR: number): Valuation {
  return {
    valueEUR,
    source: 'GAVEL XI development game estimate',
    sourceUrl: null,
    valuationDate: null,
    retrievedAt: new Date(0).toISOString(),
    confidence: 0.3,
    type: 'game_estimate',
  };
}

/**
 * An explicit, non-real development dataset. It is intentionally labelled as a
 * game estimate and is never presented as current external football data.
 */
export class DevelopmentSnapshotProvider implements FootballDataProvider {
  readonly name = 'development-snapshot';
  readonly #players: NormalizedPlayer[];
  readonly #managers: NormalizedManager[];

  constructor(countPerPosition = 32) {
    this.#players = PLAYER_POSITIONS.flatMap((position, positionIndex) =>
      Array.from({ length: countPerPosition }, (_, index) => {
        const strongBand = index < Math.ceil(countPerPosition * 0.65);
        const rating = strongBand ? 94 - (index % 16) : 74 - (index % 18);
        const id = `dev-player-${position.toLowerCase()}-${String(index + 1).padStart(2, '0')}`;
        const baseValue = strongBand
          ? 110_000_000 - index * 3_000_000
          : 45_000_000 - (index % 10) * 2_000_000;
        return {
          id,
          kind: 'PLAYER' as const,
          fullName: `Development ${position} ${String(index + 1).padStart(2, '0')}`,
          commonName: `DEV ${position} ${index + 1}`,
          age: 20 + ((index + positionIndex) % 14),
          nationality: ['ARG', 'BRA', 'ENG', 'ESP', 'FRA', 'GER', 'NED', 'POR'][
            (index + positionIndex) % 8
          ]!,
          club: `Development Club ${(index % 12) + 1}`,
          league: 'Development League',
          positions: [position],
          preferredPosition: position,
          imageUrl: null,
          season: 'DEVELOPMENT',
          appearances: 12 + (index % 21),
          starts: 8 + (index % 17),
          minutes: 720 + (index % 20) * 73,
          goals: ['ST', 'LW', 'RW', 'AM'].includes(position) ? 3 + (index % 16) : index % 4,
          assists: ['CM', 'AM', 'LW', 'RW'].includes(position) ? 2 + (index % 11) : index % 3,
          cleanSheets: position === 'GK' ? 4 + (index % 10) : 0,
          currentFormRating: clamp(rating),
          availabilityRating: clamp(91 - (index % 18)),
          competitionStrength: 75,
          lastFive: Array.from({ length: 5 }, (_, match) =>
            clamp(rating + ((index + match * 3) % 9) - 4),
          ),
          role: roleFor(position, rating, index),
          valuation: valuation(Math.max(5_000_000, baseValue)),
          dataSource: 'development-snapshot (synthetic, non-current)',
          dataUpdatedAt: new Date(0).toISOString(),
        } satisfies NormalizedPlayer;
      }),
    );

    const developmentManagers = Array.from(
      { length: Math.max(12, countPerPosition) },
      (_, index) => {
        const rating = index < 10 ? 94 - index : 72 - (index % 8);
        const tactics: TacticalProfile = {
          possession: clamp(rating + ((index * 3) % 19) - 9),
          pressing: clamp(rating + ((index * 5) % 19) - 9),
          transition: clamp(rating + ((index * 7) % 19) - 9),
          lowBlock: clamp(rating + ((index * 11) % 19) - 9),
          highLine: clamp(rating + ((index * 13) % 19) - 9),
          directness: clamp(rating + ((index * 2) % 19) - 9),
          widthPreference: clamp(rating + ((index * 4) % 19) - 9),
          buildUpRisk: clamp(rating + ((index * 6) % 19) - 9),
          tacticalFlexibility: clamp(rating + ((index * 8) % 19) - 9),
        };
        return {
          id: `dev-manager-${String(index + 1).padStart(2, '0')}`,
          kind: 'MANAGER' as const,
          fullName: `Development Manager ${String(index + 1).padStart(2, '0')}`,
          commonName: `DEV BOSS ${index + 1}`,
          age: 38 + index,
          nationality: ['ESP', 'ITA', 'GER', 'ARG', 'POR', 'FRA'][index % 6]!,
          club: `Development Club ${(index % 12) + 1}`,
          league: 'Development League',
          positions: ['MANAGER'] as Position[],
          preferredPosition: 'MANAGER' as const,
          imageUrl: null,
          season: 'DEVELOPMENT',
          appearances: 30,
          starts: 30,
          minutes: 0,
          goals: 0,
          assists: 0,
          cleanSheets: 0,
          currentFormRating: clamp(rating),
          availabilityRating: 100,
          competitionStrength: 75,
          lastFive: Array.from({ length: 5 }, (_, match) =>
            clamp(rating + ((index + match) % 7) - 3),
          ),
          role: roleFor('MANAGER', rating, index),
          tactics,
          valuation: valuation(Math.max(5_000_000, 42_000_000 - index * 1_500_000)),
          dataSource: 'development-snapshot (synthetic, non-current)',
          dataUpdatedAt: new Date(0).toISOString(),
        } satisfies NormalizedManager;
      },
    );
    this.#managers = [...curatedManagers(), ...developmentManagers];
  }

  async getActivePlayers(): Promise<NormalizedPlayer[]> {
    return structuredClone(this.#players);
  }

  async getPlayerSeasonStats(id: string): Promise<PlayerSeasonStats | null> {
    const player = this.#players.find((candidate) => candidate.id === id);
    return player === undefined
      ? null
      : {
          candidateId: player.id,
          season: player.season,
          appearances: player.appearances,
          starts: player.starts,
          minutes: player.minutes,
          goals: player.goals,
          assists: player.assists,
          cleanSheets: player.cleanSheets,
          updatedAt: player.dataUpdatedAt,
        };
  }

  async getCurrentSquad(teamId: string): Promise<NormalizedPlayer[]> {
    return this.#players
      .filter((player) => player.club === teamId)
      .map((player) => structuredClone(player));
  }

  async getManagers(): Promise<NormalizedManager[]> {
    return structuredClone(this.#managers);
  }
}

export class DevelopmentValuationProvider implements ValuationProvider {
  readonly name = 'gavel-xi-game-estimate';

  async getPlayerValuation(player: NormalizedCandidate): Promise<ValuationResult> {
    return structuredClone(player.valuation);
  }
}

/** Honest fallback: a reproducible game estimate, never an alleged external market value. */
export class GameEstimateValuationProvider implements ValuationProvider {
  readonly name = 'gavel-xi-game-estimate';

  async getPlayerValuation(player: NormalizedCandidate): Promise<ValuationResult> {
    if (player.valuation.valueEUR !== null && player.valuation.source !== 'unavailable') {
      return structuredClone(player.valuation);
    }
    const ageFactor =
      player.kind === 'MANAGER' ? 1 : Math.max(0.55, 1.25 - Math.max(0, player.age - 23) * 0.035);
    const formFactor = Math.pow(Math.max(1, player.currentFormRating) / 100, 2.4);
    const competitionFactor = 0.65 + Math.max(0, player.competitionStrength) / 250;
    const raw =
      (player.kind === 'MANAGER' ? 35_000_000 : 145_000_000) *
      ageFactor *
      formFactor *
      competitionFactor;
    const valueEUR = Math.max(2_000_000, Math.round(raw / 1_000_000) * 1_000_000);
    return {
      valueEUR,
      source: 'GAVEL XI position-aware game estimate',
      sourceUrl: null,
      valuationDate: null,
      retrievedAt: new Date().toISOString(),
      confidence: 0.25,
      type: 'game_estimate',
    };
  }
}
