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
      statsCoveragePercent: 100,
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
    return catalog;
  }
}
