import { randomInt } from 'node:crypto';
import type { Position, RoleProfile, TacticalProfile, Valuation } from '@gavel-xi/shared';
import type {
  DataHealthReport,
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
  /** Number of randomly selected real clubs to archive from each league. */
  teamsPerLeague?: number;
  random?: () => number;
  now?: () => Date;
}

export interface SportmonksOptions extends ProviderHttpOptions {
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
    'CENTRE BACK': 'CB',
    'LEFT-BACK': 'LB',
    'LEFT BACK': 'LB',
    'RIGHT-BACK': 'RB',
    'RIGHT BACK': 'RB',
    'LEFT WING-BACK': 'LWB',
    'LEFT WING BACK': 'LWB',
    'RIGHT WING-BACK': 'RWB',
    'RIGHT WING BACK': 'RWB',
    MIDFIELDER: 'CM',
    'CENTRAL MIDFIELD': 'CM',
    'DEFENSIVE MIDFIELD': 'DM',
    'ATTACKING MIDFIELD': 'AM',
    ATTACKER: 'ST',
    FORWARD: 'ST',
    'CENTRE FORWARD': 'ST',
    'CENTER FORWARD': 'ST',
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

function normalizePositions(raw: unknown): Position[] {
  const label = string(record(raw)?.['name'] ?? raw)
    .toUpperCase()
    .replace('/', '_');
  // API-Football's free historical player response exposes broad groups
  // (Defender/Midfielder/Attacker), not a fabricated detailed role. Keep the
  // verified group truthful while allowing the auction's formation slots.
  if (label === 'DEFENDER') return ['CB', 'LB', 'RB', 'LWB', 'RWB'];
  if (label === 'MIDFIELDER') return ['CM', 'DM', 'AM', 'LW', 'RW'];
  if (label === 'ATTACKER' || label === 'FORWARD') return ['ST', 'LW', 'RW'];
  const position = normalizePosition(raw);
  return position === null ? [] : [position];
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

  protected async load(path: string, paginate = true): Promise<unknown[]> {
    const firstUrl = new URL(path, this.baseUrl);
    if (paginate) firstUrl.searchParams.set('page', '1');
    const first = await this.loadPage(firstUrl);
    if (!paginate || !first.hasMore) return first.values;

    if (this.name !== 'sportmonks') {
      const values = [...first.values];
      for (let page = 2; page <= this.maxPages; page += 1) {
        const url = new URL(path, this.baseUrl);
        url.searchParams.set('page', String(page));
        const result = await this.loadPage(url);
        values.push(...result.values);
        if (!result.hasMore) break;
      }
      return values;
    }

    // Providers on some plans omit pagination metadata. Their full pages are
    // independent, so fetch the bounded fallback window concurrently instead
    // of serially blocking room creation on dozens of network round trips.
    const pages = await Promise.all(
      Array.from({ length: Math.max(0, this.maxPages - 1) }, (_, index) => {
        const url = new URL(path, this.baseUrl);
        url.searchParams.set('page', String(index + 2));
        return this.loadPage(url);
      }),
    );
    return [first.values, ...pages.map((page) => page.values)].flat();
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
    // API-Football can report account suspension and entitlement failures in a
    // 200 response with an empty `response` array. Treat those as failures
    // rather than silently producing an empty player snapshot.
    const providerErrors = outer?.['errors'];
    if (
      (Array.isArray(providerErrors) && providerErrors.length > 0) ||
      (record(providerErrors) !== null && Object.keys(record(providerErrors)!).length > 0)
    ) {
      const detail = Array.isArray(providerErrors)
        ? providerErrors
            .map((entry) => string(entry))
            .filter(Boolean)
            .join('; ')
        : Object.entries(record(providerErrors)!)
            .map(([key, value]) => `${key}: ${string(value)}`)
            .join('; ');
      throw new ProviderUnavailableError(
        this.name,
        detail || 'provider returned an error response',
      );
    }
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
    const positionSource =
      raw['position'] ??
      raw['position_name'] ??
      record(raw['position'])?.['name'] ??
      games?.['position'];
    const positions = normalizePositions(positionSource);
    const position = positions[0] ?? null;
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
      positions,
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
  readonly #now: () => Date;
  #loaded: Promise<{
    players: NormalizedPlayer[];
    managers: NormalizedManager[];
    health: DataHealthReport;
  }> | null = null;

  constructor(token: string, options: SportmonksOptions = {}) {
    super(
      { ...options, maxPages: Math.min(options.maxPages ?? 20, 20) },
      'https://api.sportmonks.com/v3/football/',
    );
    this.#token = token;
    this.#now = options.now ?? (() => new Date());
  }

  protected headers(): Record<string, string> {
    return { Authorization: this.#token };
  }

  protected playersPath(): string {
    // Deliberately unused by this provider. Current candidates come only from
    // active league seasons -> teams -> squads, never `/players` catalogue.
    return '';
  }

  protected managersPath(): string {
    return '';
  }

  override async getActivePlayers(): Promise<NormalizedPlayer[]> {
    return (await this.#currentSeasonData()).players;
  }

  override async getManagers(): Promise<NormalizedManager[]> {
    return (await this.#currentSeasonData()).managers;
  }

  override async getCurrentSquad(teamId: string): Promise<NormalizedPlayer[]> {
    return (await this.getActivePlayers()).filter((player) => player.club === teamId);
  }

  override async getPlayerSeasonStats(id: string): Promise<PlayerSeasonStats | null> {
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

  async getDataHealth(): Promise<DataHealthReport> {
    return (await this.#currentSeasonData()).health;
  }

  async #currentSeasonData() {
    this.#loaded ??= this.#loadCurrentSeasonData();
    return this.#loaded;
  }

  async #loadCurrentSeasonData(): Promise<{
    players: NormalizedPlayer[];
    managers: NormalizedManager[];
    health: DataHealthReport;
  }> {
    const generatedAt = this.#now().toISOString();
    const errors: string[] = [];
    const leagues = await this.load(
      `leagues?api_token=${encodeURIComponent(this.#token)}&per_page=50`,
    );
    const targetNames = new Set([
      'Premier League',
      'La Liga',
      'Serie A',
      'Bundesliga',
      'Ligue 1',
      'Primeira Liga',
      'Eredivisie',
      'Saudi Pro League',
      'Süper Lig',
      'Super Lig',
    ]);
    const selected = leagues
      .map(record)
      .filter((league): league is JsonRecord => league !== null)
      .filter((league) => targetNames.has(string(league['name'])));
    const leagueResults = await Promise.all(
      selected.map(async (league) => {
        const leagueId = string(league['id']);
        const seasons = await this.load(
          `seasons?api_token=${encodeURIComponent(this.#token)}&filters=seasonLeagues:${leagueId}&per_page=50`,
        );
        const current =
          seasons.map(record).find((season) => season?.['is_current'] === true) ?? null;
        if (current === null) {
          errors.push(`${string(league['name'])}: no current season available`);
          return { league, season: null, teams: [] as JsonRecord[] };
        }
        const teams = (
          await this.load(
            `teams/seasons/${string(current['id'])}?api_token=${encodeURIComponent(this.#token)}&include=coaches.coach.nationality&per_page=50`,
          )
        )
          .map(record)
          .filter((team): team is JsonRecord => team !== null);
        return { league, season: current, teams };
      }),
    );
    const rosterJobs = leagueResults.flatMap(({ league, season, teams }) =>
      season === null
        ? []
        : teams.map(async (team) => {
            const seasonId = string(season['id']);
            const teamName = string(team['name']);
            const squad = await this.load(
              `squads/seasons/${seasonId}/teams/${string(team['id'])}?api_token=${encodeURIComponent(this.#token)}&include=player.nationality;player.detailedPosition;player.statistics.details&per_page=50`,
            );
            return { league, season, team, teamName, squad };
          }),
    );
    const rosters = await Promise.all(rosterJobs);
    const players = new Map<string, NormalizedPlayer>();
    for (const { league, season, teamName, squad } of rosters) {
      for (const row of squad) {
        const entry = record(row);
        const player = record(entry?.['player']);
        if (entry === null || player === null) continue;
        const detailed = record(player['detailedposition']);
        const position = normalizePosition(detailed?.['name'] ?? entry['position_id']);
        if (position === null || position === 'MANAGER') continue;
        const stats = relationArray(player['statistics'])
          .map(record)
          .find((value) => value !== null);
        const normalized = this.playerFrom({
          player: {
            ...player,
            position: detailed ?? player['position'],
            team: { name: teamName },
            season: string(season['name']),
          },
          statistics: stats === null ? [] : [stats],
          league_name: string(league['name']),
          updated_at: generatedAt,
        });
        if (normalized !== null)
          players.set(normalized.id, { ...normalized, league: string(league['name']) });
      }
    }
    // Only coaches attached to an active selected-league team enter the room
    // snapshot; the global coach catalogue is intentionally never used.
    const managers = new Map<string, NormalizedManager>();
    for (const { league, season, teams } of leagueResults) {
      if (season === null) continue;
      for (const team of teams) {
        for (const assignment of relationArray(team['coaches'])) {
          const coachAssignment = record(assignment);
          const raw = record(coachAssignment?.['coach']);
          if (coachAssignment?.['active'] !== true || raw === null) continue;
          const normalized = this.managerFrom({
            ...raw,
            team: { name: string(team['name']) },
            season: string(season['name']),
            league_name: string(league['name']),
            updated_at: generatedAt,
          });
          if (normalized !== null)
            managers.set(normalized.id, { ...normalized, league: string(league['name']) });
        }
      }
    }
    const values = [...players.values()];
    const withStats = values.filter((player) => player.appearances > 0 || player.minutes > 0);
    const coverage = Object.fromEntries(
      [...new Set(values.map((player) => player.preferredPosition))].map((position) => [
        position,
        values.filter((player) => player.preferredPosition === position).length,
      ]),
    );
    return {
      players: values,
      managers: [...managers.values()],
      health: {
        provider: this.name,
        connected: true,
        generatedAt,
        leagues: leagueResults.map(({ league, season }) => ({
          id: string(league['id']),
          name: string(league['name']),
          season: season === null ? null : string(season['name']),
        })),
        teamsFound: rosters.length,
        activePlayersFound: values.length,
        managersFound: managers.size,
        statsCoveragePercent:
          values.length === 0 ? 0 : Math.round((withStats.length / values.length) * 100),
        positionCoverage: coverage,
        valuationCoveragePercent: 0,
        freshness: generatedAt,
        samplePlayers: values.slice(0, 12).map((player) => ({
          name: player.fullName,
          club: player.club,
          league: player.league,
          position: player.preferredPosition,
        })),
        errors: [
          ...errors,
          ...(selected.length === 0
            ? ['No requested major European league is available to this Sportmonks subscription.']
            : []),
        ],
      },
    };
  }
}

export class ApiFootballProvider extends HttpFootballProvider {
  readonly name = 'api-football';
  readonly #key: string;
  readonly #season: number;
  readonly #leagueIds: number[];
  readonly #teamsPerLeague: number;
  readonly #random: () => number;
  #archive: Promise<{ players: NormalizedPlayer[]; managers: NormalizedManager[] }> | null = null;

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
    this.#teamsPerLeague = Math.max(1, Math.min(5, options.teamsPerLeague ?? 1));
    this.#random = options.random ?? (() => randomInt(0, 1_000_000) / 1_000_000);
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
    return (await this.#loadArchive()).players;
  }

  override async getManagers(): Promise<NormalizedManager[]> {
    return (await this.#loadArchive()).managers;
  }

  async #loadArchive(): Promise<{ players: NormalizedPlayer[]; managers: NormalizedManager[] }> {
    this.#archive ??= this.#fetchArchive();
    return this.#archive;
  }

  async #fetchArchive(): Promise<{ players: NormalizedPlayer[]; managers: NormalizedManager[] }> {
    // A league-wide players query is 50+ pages per league. Instead, each fresh
    // snapshot randomly samples real clubs from every configured league. The
    // result is frozen for a game, so the player pool is varied yet fair.
    // One random club from each league costs ~45 requests at most (including
    // roster pages), safely below the free 100/day allowance. Requests are
    // deliberately serial: API-Football rejects large concurrent bursts with
    // HTTP 429 even when the daily allowance remains.
    const selectedTeams: Array<{ team: JsonRecord; leagueName: string }> = [];
    for (const leagueId of this.#leagueIds) {
      const response = await this.load(
        `standings?league=${leagueId}&season=${this.#season}`,
        false,
      );
      const league = record(response[0])?.['league'];
      const tables = relationArray(record(league)?.['standings']);
      const rows = tables.flatMap((table) => relationArray(table));
      const selected = [...rows];
      for (let index = selected.length - 1; index > 0; index -= 1) {
        const other = Math.floor(this.#random() * (index + 1));
        [selected[index], selected[other]] = [selected[other]!, selected[index]!];
      }
      for (const row of selected.slice(0, this.#teamsPerLeague)) {
        const team = record(record(row)?.['team']);
        if (team !== null)
          selectedTeams.push({
            team,
            leagueName: string(record(league)?.['name'], `League ${leagueId}`),
          });
      }
    }

    const values: Array<{
      team: JsonRecord;
      leagueName: string;
      players: unknown[];
      managers: unknown[];
    }> = [];
    for (const { team, leagueName } of selectedTeams) {
      const teamId = string(team['id']);
      const players = await this.load(`players?team=${teamId}&season=${this.#season}`);
      const managers = await this.load(`coachs?team=${teamId}`, false);
      values.push({ team, leagueName, players, managers });
    }
    const players = new Map<string, NormalizedPlayer>();
    const managers = new Map<string, NormalizedManager>();
    const updatedAt = new Date().toISOString();
    for (const source of values) {
      for (const raw of source.players) {
        const candidate = this.playerFrom(raw);
        if (candidate !== null) {
          players.set(candidate.id, {
            ...candidate,
            league: source.leagueName,
            season: `${this.#season}/${this.#season + 1}`,
            dataUpdatedAt: updatedAt,
          });
        }
      }
      // API-Football includes historic assistants. Prefer the coach whose
      // career has an open assignment to this club before considering a
      // fallback named staff member.
      const activeCoach = source.managers.find((raw) => {
        const coach = record(raw);
        return relationArray(coach?.['career']).some((assignment) => {
          const career = record(assignment);
          return (
            string(record(career?.['team'])?.['id']) === string(source.team['id']) &&
            (career?.['end'] === null || career?.['end'] === undefined)
          );
        });
      });
      const manager = this.managerFrom(activeCoach ?? source.managers[0]);
      if (manager !== null) {
        managers.set(manager.id, {
          ...manager,
          club: string(source.team['name'], manager.club),
          league: source.leagueName,
          season: `${this.#season}/${this.#season + 1}`,
          dataUpdatedAt: updatedAt,
        });
      }
    }
    return { players: [...players.values()], managers: [...managers.values()] };
  }
}
