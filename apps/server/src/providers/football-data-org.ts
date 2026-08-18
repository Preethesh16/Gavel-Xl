import { randomInt } from 'node:crypto';
import type { Position, RoleProfile, TacticalProfile, Valuation } from '@gavel-xi/shared';
import {
  type FootballDataProvider,
  type NormalizedManager,
  type NormalizedPlayer,
  type PlayerSeasonStats,
  ProviderUnavailableError,
} from './types.js';

type Json = Record<string, unknown>;

const COMPETITIONS = ['PL', 'PD', 'SA', 'BL1', 'FL1'] as const;
const EMPTY_ROLE: RoleProfile = {
  pace: 50,
  physical: 50,
  technique: 50,
  creativity: 50,
  defending: 50,
  aerial: 50,
  passing: 50,
  finishing: 50,
  pressing: 50,
  composure: 50,
};
const EMPTY_TACTICS: TacticalProfile = {
  possession: 50,
  pressing: 50,
  transition: 50,
  lowBlock: 50,
  highLine: 50,
  directness: 50,
  widthPreference: 50,
  buildUpRisk: 50,
  tacticalFlexibility: 50,
};
const ESTIMATE: Valuation = {
  valueEUR: null,
  source: 'unavailable',
  sourceUrl: null,
  valuationDate: null,
  retrievedAt: new Date(0).toISOString(),
  confidence: 0,
  type: 'game_estimate',
};

function obj(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function age(date: unknown): number {
  const born = new Date(text(date));
  if (Number.isNaN(born.getTime())) return 25;
  return Math.max(16, Math.min(50, Math.floor((Date.now() - born.getTime()) / 31_556_952_000)));
}
function positions(value: unknown): Position[] {
  const label = text(value).toLowerCase().replaceAll('-', ' ');
  if (label.includes('goal')) return ['GK'];
  if (label.includes('left wing back')) return ['LWB'];
  if (label.includes('right wing back')) return ['RWB'];
  if (label.includes('left back')) return ['LB'];
  if (label.includes('right back')) return ['RB'];
  if (label.includes('centre back') || label.includes('center back') || label === 'defender') {
    return ['CB'];
  }
  if (label.includes('defensive midfield')) return ['DM'];
  if (label.includes('attacking midfield')) return ['AM'];
  if (label.includes('central midfield') || label.includes('centre midfield')) return ['CM'];
  if (label.includes('left wing') || label.includes('left winger')) return ['LW'];
  if (label.includes('right wing') || label.includes('right winger')) return ['RW'];
  if (label.includes('midfield')) return ['CM'];
  if (label.includes('forward') || label.includes('striker') || label.includes('attack'))
    return ['ST'];
  // Do not manufacture a full-back / winger role from an unknown label.
  return ['CB'];
}

export class FootballDataOrgProvider implements FootballDataProvider {
  readonly name = 'football-data.org';
  readonly #key: string;
  readonly #maxClubs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #random: () => number;
  #loaded: Promise<{ players: NormalizedPlayer[]; managers: NormalizedManager[] }> | null = null;
  #loadedAt = 0;

  constructor(
    key: string,
    options: { maxClubs?: number; fetch?: typeof globalThis.fetch; random?: () => number } = {},
  ) {
    this.#key = key;
    this.#maxClubs = Math.max(2, Math.min(5, options.maxClubs ?? 5));
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#random = options.random ?? (() => randomInt(0, 1_000_000) / 1_000_000);
  }

  async getActivePlayers(): Promise<NormalizedPlayer[]> {
    return (await this.#load()).players;
  }
  async getManagers(): Promise<NormalizedManager[]> {
    return (await this.#load()).managers;
  }
  async getCurrentSquad(teamId: string): Promise<NormalizedPlayer[]> {
    return (await this.getActivePlayers()).filter((player) => player.club === teamId);
  }
  async getPlayerSeasonStats(id: string): Promise<PlayerSeasonStats | null> {
    const player = (await this.getActivePlayers()).find((candidate) => candidate.id === id);
    return player === undefined
      ? null
      : {
          candidateId: id,
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

  async #load() {
    if (this.#loaded === null || Date.now() - this.#loadedAt >= 55_000) {
      this.#loadedAt = Date.now();
      this.#loaded = this.#fetchSnapshot().catch((error: unknown) => {
        this.#loaded = null;
        throw error;
      });
    }
    return this.#loaded;
  }
  async #request(path: string): Promise<Json> {
    let response: Response;
    try {
      response = await this.#fetch(`https://api.football-data.org/v4/${path}`, {
        headers: { 'X-Auth-Token': this.#key },
      });
    } catch (error) {
      throw new ProviderUnavailableError(this.name, 'network request failed', { cause: error });
    }
    if (!response.ok) throw new ProviderUnavailableError(this.name, `HTTP ${response.status}`);
    const payload = obj(await response.json());
    if (payload === null) throw new ProviderUnavailableError(this.name, 'invalid JSON response');
    return payload;
  }
  async #fetchSnapshot(): Promise<{ players: NormalizedPlayer[]; managers: NormalizedManager[] }> {
    const clubs: Array<{ id: string; name: string; league: string }> = [];
    // API is capped at ten calls/minute on the free tier. Five competition
    // lists plus up to five team details is safe; chosen clubs vary per cache.
    for (const code of COMPETITIONS) {
      const payload = await this.#request(`competitions/${code}/teams`);
      const teams = array(payload['teams'])
        .map(obj)
        .filter((team): team is Json => team !== null);
      for (let index = teams.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(this.#random() * (index + 1));
        [teams[index], teams[swap]] = [teams[swap]!, teams[index]!];
      }
      for (const team of teams) {
        clubs.push({ id: text(team['id']), name: text(team['name']), league: code });
      }
    }
    for (let index = clubs.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(this.#random() * (index + 1));
      [clubs[index], clubs[swap]] = [clubs[swap]!, clubs[index]!];
    }
    // Five competition lists plus a random 2–5 real clubs is at most ten
    // calls, exactly within football-data.org's free 10-request/minute tier.
    const count = 2 + Math.floor(this.#random() * (this.#maxClubs - 1));
    const selected = clubs.slice(0, count);
    const players = new Map<string, NormalizedPlayer>();
    const managers = new Map<string, NormalizedManager>();
    const updatedAt = new Date().toISOString();
    for (const club of selected) {
      const team = await this.#request(`teams/${club.id}`);
      for (const raw of array(team['squad'])
        .map(obj)
        .filter((entry): entry is Json => entry !== null)) {
        if (text(raw['role'], 'PLAYER') !== 'PLAYER') continue;
        const slots = positions(raw['position']);
        const id = text(raw['id']);
        const fullName = text(raw['name']);
        if (id === '' || fullName === '') continue;
        players.set(id, {
          id: `${this.name}:player:${id}`,
          kind: 'PLAYER',
          fullName,
          commonName: fullName,
          age: age(raw['dateOfBirth']),
          nationality: text(raw['nationality'], 'Unknown'),
          club: text(team['name'], club.name),
          league: club.league,
          positions: slots,
          preferredPosition: slots[0]!,
          imageUrl: null,
          clubImageUrl: text(team['crest']) || null,
          season: 'current',
          appearances: 0,
          starts: 0,
          minutes: 0,
          goals: 0,
          assists: 0,
          cleanSheets: 0,
          currentFormRating: 60,
          availabilityRating: 100,
          competitionStrength: 70,
          lastFive: [],
          role: { ...EMPTY_ROLE },
          valuation: { ...ESTIMATE, retrievedAt: updatedAt },
          dataSource: 'football-data.org',
          dataUpdatedAt: updatedAt,
        });
      }
      const coach = obj(team['coach']);
      const coachId = text(coach?.['id']);
      const coachName = text(coach?.['name']);
      if (coachId !== '' && coachName !== '')
        managers.set(coachId, {
          id: `${this.name}:manager:${coachId}`,
          kind: 'MANAGER',
          fullName: coachName,
          commonName: coachName,
          age: age(coach?.['dateOfBirth']),
          nationality: text(coach?.['nationality'], 'Unknown'),
          club: text(team['name'], club.name),
          league: club.league,
          positions: ['MANAGER'],
          preferredPosition: 'MANAGER',
          imageUrl: null,
          clubImageUrl: text(team['crest']) || null,
          season: 'current',
          appearances: 0,
          starts: 0,
          minutes: 0,
          goals: 0,
          assists: 0,
          cleanSheets: 0,
          currentFormRating: 60,
          availabilityRating: 100,
          competitionStrength: 70,
          lastFive: [],
          role: { ...EMPTY_ROLE },
          tactics: { ...EMPTY_TACTICS },
          valuation: { ...ESTIMATE, retrievedAt: updatedAt },
          dataSource: 'football-data.org',
          dataUpdatedAt: updatedAt,
        });
    }
    return { players: [...players.values()], managers: [...managers.values()] };
  }
}
