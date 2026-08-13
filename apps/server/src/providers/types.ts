import type { CandidateSnapshot, Position, TacticalProfile, Valuation } from '@gavel-xi/shared';

export interface NormalizedPlayer extends CandidateSnapshot {
  kind: 'PLAYER';
}

export interface NormalizedManager extends CandidateSnapshot {
  kind: 'MANAGER';
  tactics: TacticalProfile;
}

export type NormalizedCandidate = NormalizedPlayer | NormalizedManager;

export interface PlayerSeasonStats {
  candidateId: string;
  season: string;
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  updatedAt: string;
}

export interface DataHealthReport {
  provider: string;
  connected: boolean;
  generatedAt: string;
  leagues: Array<{ id: string; name: string; season: string | null }>;
  teamsFound: number;
  activePlayersFound: number;
  managersFound: number;
  statsCoveragePercent: number;
  positionCoverage: Record<string, number>;
  valuationCoveragePercent: number;
  freshness: string | null;
  samplePlayers: Array<{ name: string; club: string; league: string; position: string }>;
  errors: string[];
}

export interface FootballDataProvider {
  readonly name: string;
  getActivePlayers(): Promise<NormalizedPlayer[]>;
  getPlayerSeasonStats(id: string): Promise<PlayerSeasonStats | null>;
  getCurrentSquad(teamId: string): Promise<NormalizedPlayer[]>;
  getManagers(): Promise<NormalizedManager[]>;
  getDataHealth?(): Promise<DataHealthReport>;
}

export type ValuationResult = Valuation;

export interface ValuationProvider {
  readonly name: string;
  getPlayerValuation(player: NormalizedCandidate): Promise<ValuationResult>;
}

export class ProviderUnavailableError extends Error {
  constructor(provider: string, message: string, options?: ErrorOptions) {
    super(`${provider}: ${message}`, options);
    this.name = 'ProviderUnavailableError';
  }
}

export const PLAYER_POSITIONS: readonly Exclude<Position, 'MANAGER'>[] = [
  'GK',
  'LB',
  'CB',
  'RB',
  'LWB',
  'RWB',
  'DM',
  'CM',
  'AM',
  'LW',
  'RW',
  'ST',
];
