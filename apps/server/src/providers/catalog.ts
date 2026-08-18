import type { CandidateSnapshot } from '@gavel-xi/shared';
import type { CatalogRepository } from '../persistence.js';
import type {
  DataHealthReport,
  FootballDataProvider,
  NormalizedManager,
  NormalizedPlayer,
  PlayerSeasonStats,
} from './types.js';
import { ProviderUnavailableError } from './types.js';
import { curatedManagers } from './curated-managers.js';

/**
 * Reads the immutable player catalogue. This adapter deliberately makes no
 * network requests: match creation is independent of external API quotas.
 */
export class CatalogProvider implements FootballDataProvider {
  readonly name = 'gavel-player-catalog';
  readonly #catalog: CatalogRepository;

  constructor(catalog: CatalogRepository) {
    this.#catalog = catalog;
  }

  async getActivePlayers(): Promise<NormalizedPlayer[]> {
    return (await this.#read()).players as NormalizedPlayer[];
  }

  async getManagers(): Promise<NormalizedManager[]> {
    return (await this.#read()).managers as NormalizedManager[];
  }

  async getCurrentSquad(teamId: string): Promise<NormalizedPlayer[]> {
    return (await this.getActivePlayers()).filter((player) => player.club === teamId);
  }

  async getPlayerSeasonStats(id: string): Promise<PlayerSeasonStats | null> {
    const player = (await this.getActivePlayers()).find((entry) => entry.id === id);
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

  async getDataHealth(): Promise<DataHealthReport> {
    const { players, managers } = await this.#read();
    const positions = Object.fromEntries(
      [...new Set(players.flatMap((player) => player.positions))].map((position) => [
        position,
        players.filter((player) => player.positions.includes(position)).length,
      ]),
    );
    return {
      provider: this.name,
      connected: true,
      generatedAt: new Date().toISOString(),
      leagues: [...new Set(players.map((player) => player.league))].map((name) => ({
        id: name,
        name,
        season: players.find((player) => player.league === name)?.season ?? null,
      })),
      teamsFound: new Set(players.map((player) => player.club)).size,
      activePlayersFound: players.length,
      managersFound: managers.length,
      // The open catalog contains identity, club, position and valuation data.
      // Its role/form numbers are market-derived estimates, not live match stats.
      statsCoveragePercent: 0,
      positionCoverage: positions,
      valuationCoveragePercent: Math.round(
        (players.filter((player) => player.valuation.valueEUR !== null).length /
          Math.max(1, players.length)) *
          100,
      ),
      freshness:
        players
          .map((player) => player.dataUpdatedAt)
          .sort()
          .at(-1) ?? null,
      samplePlayers: players.slice(0, 8).map((player) => ({
        name: player.fullName,
        club: player.club,
        league: player.league,
        position: player.preferredPosition,
      })),
      errors: [],
    };
  }

  async #read(): Promise<{ players: CandidateSnapshot[]; managers: CandidateSnapshot[] }> {
    const catalog = await this.#catalog.getCatalog();
    if (catalog === null || catalog.players.length === 0 || catalog.managers.length === 0) {
      throw new ProviderUnavailableError(
        this.name,
        'catalog is empty; run pnpm --filter @gavel-xi/server catalog:import <file>',
      );
    }
    const clubStrength = new Map<string, number>();
    for (const player of catalog.players) {
      clubStrength.set(
        player.club,
        (clubStrength.get(player.club) ?? 0) + (player.valuation.valueEUR ?? 0),
      );
    }
    const normalizedManagers = catalog.managers.map((candidate) =>
      normalizeCatalogCandidate(candidate, clubStrength.get(candidate.club)),
    );
    const featuredManagers = curatedManagers();
    const featuredNames = new Set(
      featuredManagers.map((candidate) => normalizedName(candidate.fullName)),
    );
    return {
      players: catalog.players.map((candidate) => normalizeCatalogCandidate(candidate)),
      managers: [
        ...featuredManagers,
        ...normalizedManagers.filter(
          (candidate) => !featuredNames.has(normalizedName(candidate.fullName)),
        ),
      ],
    };
  }
}

function normalizedName(value: string): string {
  return value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]/g, '');
}

function stableRecentForm(id: string, baseline: number): number[] {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Array.from({ length: 5 }, (_, index) => {
    const shift = ((hash >>> (index * 5)) & 31) - 15;
    return Math.max(35, Math.min(97, Math.round(baseline + shift * 0.45)));
  });
}

function recentFormRating(lastFive: number[]): number {
  const values = lastFive.slice(-5);
  const weights = [0.12, 0.16, 0.19, 0.23, 0.3].slice(-values.length);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  return Math.round(
    values.reduce((total, value, index) => total + value * weights[index]!, 0) / totalWeight,
  );
}

/** Correct catalogues imported before the bounded market-rating model shipped. */
function normalizeCatalogCandidate(
  candidate: CandidateSnapshot,
  managerClubStrength?: number,
): CandidateSnapshot {
  if (!candidate.dataSource.startsWith('Transfermarkt-derived open catalogue')) return candidate;
  const value =
    candidate.kind === 'MANAGER'
      ? Math.max(10_000_000, managerClubStrength ?? 10_000_000)
      : (candidate.valuation.valueEUR ?? 1_000_000);
  const rating = Math.max(
    45,
    Math.min(
      94,
      Math.round(
        candidate.kind === 'MANAGER'
          ? 62 + Math.log10(value / 10_000_000) * 12
          : 61 + Math.log10(value / 1_000_000) * 15,
      ),
    ),
  );
  const placeholderForm =
    candidate.currentFormRating >= 98 ||
    candidate.lastFive.length !== 5 ||
    new Set(candidate.lastFive.map(Math.round)).size <= 1;
  const delta = placeholderForm ? rating - candidate.currentFormRating : 0;
  const shifted = (score: number): number => Math.max(1, Math.min(99, Math.round(score + delta)));
  const shiftedLastFive = candidate.lastFive.map(shifted);
  const lastFive = placeholderForm ? stableRecentForm(candidate.id, rating) : shiftedLastFive;
  const currentFormRating = recentFormRating(lastFive);
  const role = candidate.role;
  const tactics = candidate.tactics;
  return {
    ...candidate,
    currentFormRating,
    lastFive,
    role: {
      pace: shifted(role.pace),
      physical: shifted(role.physical),
      technique: shifted(role.technique),
      creativity: shifted(role.creativity),
      defending: shifted(role.defending),
      aerial: shifted(role.aerial),
      passing: shifted(role.passing),
      finishing: shifted(role.finishing),
      pressing: shifted(role.pressing),
      composure: shifted(role.composure),
    },
    ...(tactics === undefined
      ? {}
      : {
          tactics: {
            possession: shifted(tactics.possession),
            pressing: shifted(tactics.pressing),
            transition: shifted(tactics.transition),
            lowBlock: shifted(tactics.lowBlock),
            highLine: shifted(tactics.highLine),
            directness: shifted(tactics.directness),
            widthPreference: shifted(tactics.widthPreference),
            buildUpRisk: shifted(tactics.buildUpRisk),
            tacticalFlexibility: shifted(tactics.tacticalFlexibility),
          },
        }),
  };
}
