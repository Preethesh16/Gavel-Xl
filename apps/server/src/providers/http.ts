import type { Position, RoleProfile, TacticalProfile, Valuation } from '@gavel-xi/shared';
import type {
  FootballDataProvider,
  NormalizedManager,
  NormalizedPlayer,
  PlayerSeasonStats,
} from './types.js';
import { ProviderUnavailableError } from './types.js';

interface ProviderHttpOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  maxPages?: number;
}

export interface ApiFootballOptions extends ProviderHttpOptions {
  currentSeason?: number;
  leagueIds: number[];
  now?: () => Date;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function number(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function string(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function relationArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const wrapper = record(value);
  return Array.isArray(wrapper?.['data']) ? wrapper['data'] : [];
}

function currentTeam(raw: JsonRecord, stats: JsonRecord | null): JsonRecord | null {
  const direct = record(raw['team']) ?? record(raw['current_team']) ?? record(stats?.['team']);
  if (direct !== null) return direct;
  const career = relationArray(raw['career'])
    .map(record)
    .filter((entry): entry is JsonRecord => entry !== null);
  const currentCareer = career.find((entry) => entry['end'] === null || entry['active'] === true);
  const careerTeam = record(currentCareer?.['team']);
  if (careerTeam !== null) return careerTeam;
  const teams = relationArray(raw['teams'])
    .map(record)
    .filter((team): team is JsonRecord => team !== null);
  return (
    teams.find((team) => {
      const pivot = record(team['pivot']);
      return team['active'] === true || pivot?.['active'] === true || pivot?.['end'] === null;
    }) ??
    teams.at(-1) ??
    null
  );
}

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

const UNAVAILABLE_VALUATION: Valuation = {
  valueEUR: null,
  source: 'unavailable',
  sourceUrl: null,
  valuationDate: null,
  retrievedAt: new Date(0).toISOString(),
  confidence: 0,
  type: 'game_estimate',
};

function normalizePosition(raw: unknown): Position | null {
  const value = string(record(raw)?.['name'] ?? raw)
    .toUpperCase()
    .replace('/', '_');
  const aliases: Record<string, Position> = {
    GOALKEEPER: 'GK',
    DEFENDER: 'CB',
    'CENTRE-BACK': 'CB',
    'LEFT-BACK': 'LB',
    'RIGHT-BACK': 'RB',
    MIDFIELDER: 'CM',
    'DEFENSIVE MIDFIELD': 'DM',
    'ATTACKING MIDFIELD': 'AM',
    ATTACKER: 'ST',
    FORWARD: 'ST',
    'LEFT WINGER': 'LW',
    'RIGHT WINGER': 'RW',
  };
  const allowed = new Set<Position>([
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
    'MANAGER',
  ]);
  return allowed.has(value as Position) ? (value as Position) : (aliases[value] ?? null);
}

function arrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const outer = record(payload);
  if (outer === null) return [];
  if (Array.isArray(outer['data'])) return outer['data'];
  if (Array.isArray(outer['response'])) return outer['response'];
  return [];
}

abstract class HttpFootballProvider implements FootballDataProvider {
  abstract readonly name: string;
  protected readonly fetcher: typeof globalThis.fetch;
  protected readonly baseUrl: string;
  protected readonly maxPages: number;

  constructor(options: ProviderHttpOptions, defaultBaseUrl: string) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? defaultBaseUrl;
    this.maxPages = options.maxPages ?? 50;
  }

  protected abstract headers(): Record<string, string>;
  protected abstract playersPath(): string;
  protected abstract managersPath(): string;

  protected async load(path: string): Promise<unknown[]> {
    const values: unknown[] = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      const url = new URL(path, this.baseUrl);
      url.searchParams.set('page', String(page));
      const result = await this.loadPage(url);
      values.push(...result.values);
      if (!result.hasMore) break;
    }
    return values;
  }

  private async loadPage(url: URL): Promise<{ values: unknown[]; hasMore: boolean }> {
    let response: Response;
    try {
      response = await this.fetcher(url, { headers: this.headers() });
    } catch (error) {
      throw new ProviderUnavailableError(this.name, 'network request failed', { cause: error });
    }
    if (!response.ok) {
      throw new ProviderUnavailableError(this.name, `HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    const outer = record(payload);
    const sportmonksPagination = record(record(outer?.['meta'])?.['pagination']);
    const apiPaging = record(outer?.['paging']);
  const hasMore =
      typeof sportmonksPagination?.['has_more'] === 'boolean'
        ? sportmonksPagination['has_more']
        : number(sportmonksPagination?.['current_page'], 1) <
            number(sportmonksPagination?.['total_pages'], 1) ||
        number(apiPaging?.['current'], 1) < number(apiPaging?.['total'], 1) ||
        // Some Sportmonks plans omit pagination metadata but still return a
        // full default page. Keep walking those pages until a short page.
        (Array.isArray(arrayPayload(payload)) && arrayPayload(payload).length >= 25);
    return { values: arrayPayload(payload), hasMore };
  }

  protected playerFrom(rawValue: unknown): NormalizedPlayer | null {
    const outer = record(rawValue);
    if (outer === null) return null;
    const raw = record(outer['player']) ?? outer;
    const statistics = relationArray(outer['statistics']);
    const stats = record(statistics[0]);
    const games = record(stats?.['games']);
    const goalStats = record(stats?.['goals']);
    const id = string(raw['id'] ?? raw['player_id']);
    const name = string(raw['display_name'] ?? raw['name'] ?? raw['common_name']);
    const position = normalizePosition(
      raw['position'] ??
        raw['position_name'] ??
        record(raw['position'])?.['name'] ??
        games?.['position'],
    );
    if (
      id === '' ||
      name === '' ||
      position === null ||
      position === 'MANAGER' ||
      raw['active'] === false
    )
      return null;
    const rawRating = number(raw['rating'] ?? games?.['rating'], 6);
    const currentRating = Math.max(1, Math.min(100, rawRating <= 10 ? rawRating * 10 : rawRating));
    const club = currentTeam(raw, stats) ?? record(raw['club']);
    if (club === null) return null;
    const league = record(stats?.['league']);
    const nationality = record(raw['nationality']);
    return {
      id: `${this.name}:${id}`,
      kind: 'PLAYER',
      fullName: name,
      commonName: string(raw['short_name'], name),
      age: number(raw['age']),
      nationality: string(nationality?.['name'] ?? raw['nationality'], 'Unknown'),
      club: string(club?.['name'] ?? raw['team_name'], 'Unknown'),
      league: string(league?.['name'] ?? raw['league_name'], 'Unknown'),
      positions: [position],
      preferredPosition: position,
      imageUrl: string(raw['image_path'] ?? raw['photo']) || null,
      season: string(raw['season'], 'current'),
      appearances: number(raw['appearances'] ?? games?.['appearences']),
      starts: number(raw['starts'] ?? raw['lineups'] ?? games?.['lineups']),
      minutes: number(raw['minutes'] ?? games?.['minutes']),
      goals: number(raw['goals'] ?? goalStats?.['total']),
      assists: number(raw['assists'] ?? goalStats?.['assists']),
      cleanSheets: number(raw['clean_sheets']),
      currentFormRating: currentRating,
      availabilityRating: 100,
      competitionStrength: 70,
      lastFive: [],
      role: { ...EMPTY_ROLE },
      valuation: { ...UNAVAILABLE_VALUATION, retrievedAt: new Date().toISOString() },
      dataSource: this.name,
      dataUpdatedAt: string(raw['updated_at'], new Date().toISOString()),
    };
  }

  protected managerFrom(rawValue: unknown): NormalizedManager | null {
    const raw = record(rawValue);
    if (raw === null) return null;
    const id = string(raw['id'] ?? raw['coach_id']);
    const name = string(raw['display_name'] ?? raw['name']);
    if (id === '' || name === '' || raw['active'] === false) return null;
    const club = currentTeam(raw, null);
    if (club === null) return null;
    return {
      id: `${this.name}:manager:${id}`,
      kind: 'MANAGER',
      fullName: name,
      commonName: string(raw['short_name'], name),
      age: number(raw['age']),
      nationality: string(record(raw['nationality'])?.['name'] ?? raw['nationality'], 'Unknown'),
      club: string(club?.['name'] ?? raw['team_name'], 'Unknown'),
      league: string(raw['league_name'], 'Unknown'),
      positions: ['MANAGER'],
      preferredPosition: 'MANAGER',
      imageUrl: string(raw['image_path'] ?? raw['photo']) || null,
      season: string(raw['season'], 'current'),
      appearances: number(raw['appearances']),
      starts: number(raw['starts']),
      minutes: 0,
      goals: 0,
      assists: 0,
      cleanSheets: 0,
      currentFormRating: Math.max(1, Math.min(100, number(raw['rating'], 60))),
      availabilityRating: 100,
      competitionStrength: 70,
      lastFive: [],
      role: { ...EMPTY_ROLE },
      tactics: { ...EMPTY_TACTICS },
      valuation: { ...UNAVAILABLE_VALUATION, retrievedAt: new Date().toISOString() },
      dataSource: this.name,
      dataUpdatedAt: string(raw['updated_at'], new Date().toISOString()),
    };
  }

  async getActivePlayers(): Promise<NormalizedPlayer[]> {
    return (await this.load(this.playersPath()))
      .map((raw) => this.playerFrom(raw))
      .filter((player): player is NormalizedPlayer => player !== null);
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

  async getCurrentSquad(teamId: string): Promise<NormalizedPlayer[]> {
    return (await this.getActivePlayers()).filter((candidate) => candidate.club === teamId);
  }

  async getManagers(): Promise<NormalizedManager[]> {
    return (await this.load(this.managersPath()))
      .map((raw) => this.managerFrom(raw))
      .filter((manager): manager is NormalizedManager => manager !== null);
  }
}

export class SportmonksProvider extends HttpFootballProvider {
  readonly name = 'sportmonks';
  readonly #token: string;

  constructor(token: string, options: ProviderHttpOptions = {}) {
    super(options, 'https://api.sportmonks.com/v3/football/');
    this.#token = token;
  }

  protected headers(): Record<string, string> {
    return { Authorization: this.#token };
  }

  protected playersPath(): string {
    // The unfiltered `/players` endpoint starts with historical records (often
    // without a current team). Use Sportmonks' active feed so room snapshots
    // contain current squads rather than retired/old catalogue entries.
    return `players?api_token=${encodeURIComponent(this.#token)}&include=position;nationality;teams&per_page=100`;
  }

  protected managersPath(): string {
    return `coaches?api_token=${encodeURIComponent(this.#token)}&include=nationality;teams`;
  }
}

export class ApiFootballProvider extends HttpFootballProvider {
  readonly name = 'api-football';
  readonly #key: string;
  readonly #season: number;
  readonly #leagueIds: number[];

  constructor(key: string, options: ApiFootballOptions) {
    super(options, 'https://v3.football.api-sports.io/');
    this.#key = key;
    const now = (options.now ?? (() => new Date()))();
    this.#season =
      options.currentSeason ??
      (now.getUTCMonth() < 7 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());
    this.#leagueIds = [
      ...new Set(options.leagueIds.filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (this.#leagueIds.length === 0) {
      throw new Error('ApiFootballProvider requires at least one configured league ID');
    }
  }

  protected headers(): Record<string, string> {
    return { 'x-apisports-key': this.#key };
  }

  protected playersPath(): string {
    // getActivePlayers overrides this to collect every configured league.
    return `players?season=${this.#season}&league=${this.#leagueIds[0]!}`;
  }

  protected managersPath(): string {
    return 'coachs';
  }

  override async getActivePlayers(): Promise<NormalizedPlayer[]> {
    const collected = (
      await Promise.all(
        this.#leagueIds.map(async (leagueId) =>
          this.load(`players?season=${this.#season}&league=${leagueId}`),
        ),
      )
    ).flat();
    const unique = new Map<string, NormalizedPlayer>();
    for (const raw of collected) {
      const player = this.playerFrom(raw);
      if (player !== null) unique.set(player.id, player);
    }
    return [...unique.values()];
  }
}
