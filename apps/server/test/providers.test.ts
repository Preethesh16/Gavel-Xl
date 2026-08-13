import { generateCandidatePool } from '@gavel-xi/game-engine';
import { roomSettingsSchema, type CandidateSnapshot } from '@gavel-xi/shared';
import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '../src/cache.js';
import { InMemoryPersistence } from '../src/persistence.js';
import {
  ApiFootballProvider,
  DevelopmentSnapshotProvider,
  DevelopmentValuationProvider,
  FrozenSnapshotService,
  type FootballDataProvider,
} from '../src/providers/index.js';
import { SessionTokenService } from '../src/security.js';

const FORMATIONS = ['4-2-1-3', '4-3-3', '4-2-3-1', '4-4-2', '3-4-2-1', '3-5-2', '5-2-1-2'] as const;

describe('data and infrastructure adapters', () => {
  it('has enough diverse strong/fallback development candidates for every N=8 formation', async () => {
    const provider = new DevelopmentSnapshotProvider();
    const candidates: CandidateSnapshot[] = [
      ...(await provider.getActivePlayers()),
      ...(await provider.getManagers()),
    ];
    for (const formation of FORMATIONS) {
      const settings = roomSettingsSchema.parse({ formation });
      const pool = generateCandidatePool({
        seed: `capacity-${formation}`,
        settings,
        members: Array.from({ length: 8 }, (_, index) => ({
          id: `member-${index + 1}`,
          budgetEUR: settings.budgetEUR,
          joinedAt: index,
        })),
        snapshot: {
          id: 'development-capacity',
          provider: provider.name,
          createdAt: new Date(0).toISOString(),
          sourceUpdatedAt: new Date(0).toISOString(),
          candidates,
        },
      });
      expect(pool.cycles).toHaveLength(12);
      expect(pool.cycles.every((cycle) => cycle.candidates.length === 8)).toBe(true);
      expect(
        new Set(
          pool.cycles.flatMap((cycle) => cycle.candidates.map(({ candidate }) => candidate.id)),
        ).size,
      ).toBe(96);
      for (const cycle of pool.cycles) {
        expect(cycle.candidates.filter(({ tier }) => tier === 'STRONG')).toHaveLength(7);
        expect(cycle.candidates.filter(({ tier }) => tier === 'FALLBACK')).toHaveLength(1);
      }
    }
  });

  it('derives API-Football season from the clock, queries configured leagues and follows pagination', async () => {
    const requests: URL[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input : input.url,
      );
      requests.push(url);
      const league = Number(url.searchParams.get('league'));
      const page = Number(url.searchParams.get('page'));
      const id = league * 100 + page;
      return new Response(
        JSON.stringify({
          response: [
            {
              player: {
                id,
                name: `Player ${id}`,
                age: 24,
                nationality: 'France',
                photo: null,
              },
              statistics: [
                {
                  team: { name: `Club ${league}` },
                  league: { name: `League ${league}` },
                  games: {
                    position: 'Attacker',
                    appearences: 20,
                    lineups: 18,
                    minutes: 1_500,
                    rating: '7.4',
                  },
                  goals: { total: 9, assists: 4 },
                },
              ],
            },
          ],
          paging: { current: page, total: league === 39 ? 2 : 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const provider = new ApiFootballProvider('test-key', {
      fetch: fakeFetch,
      leagueIds: [39, 140],
      now: () => new Date('2026-01-20T00:00:00Z'),
    });
    const players = await provider.getActivePlayers();
    expect(players).toHaveLength(3);
    expect(players.every(({ preferredPosition }) => preferredPosition === 'ST')).toBe(true);
    expect(requests.map((url) => url.searchParams.get('season'))).toEqual(['2025', '2025', '2025']);
    expect(
      requests.map((url) => `${url.searchParams.get('league')}:${url.searchParams.get('page')}`),
    ).toEqual(['39:1', '140:1', '39:2']);
  });

  it('uses alternate provider after failure and reuses a frozen snapshot consistently', async () => {
    const failing: FootballDataProvider = {
      name: 'broken',
      getActivePlayers: async () => {
        throw new Error('offline');
      },
      getPlayerSeasonStats: async () => null,
      getCurrentSquad: async () => [],
      getManagers: async () => [],
    };
    const persistence = new InMemoryPersistence();
    const service = new FrozenSnapshotService({
      providers: [failing, new DevelopmentSnapshotProvider()],
      valuationProvider: new DevelopmentValuationProvider(),
      cache: new InMemoryCache(),
      snapshots: persistence,
      now: () => new Date('2026-08-13T00:00:00Z'),
    });
    const first = await service.acquire();
    const second = await service.acquire();
    expect(first.provider).toBe('development-snapshot');
    expect(second).toEqual(first);
    expect(first.candidates.length).toBeGreaterThan(300);
  });

  it('returns a viable slightly-stale snapshot without hitting a provider', async () => {
    const development = new DevelopmentSnapshotProvider();
    let playerRequests = 0;
    let managerRequests = 0;
    const counted: FootballDataProvider = {
      name: 'counted-development',
      getActivePlayers: async () => {
        playerRequests += 1;
        return development.getActivePlayers();
      },
      getPlayerSeasonStats: async (playerId) => development.getPlayerSeasonStats(playerId),
      getCurrentSquad: async (clubId) => development.getCurrentSquad(clubId),
      getManagers: async () => {
        managerRequests += 1;
        return development.getManagers();
      },
    };
    const persistence = new InMemoryPersistence();
    let now = Date.parse('2026-08-13T00:00:00Z');
    const service = new FrozenSnapshotService({
      providers: [counted],
      valuationProvider: new DevelopmentValuationProvider(),
      cache: new InMemoryCache(),
      snapshots: persistence,
      freshForMs: 1_000,
      staleForMs: 5_000,
      now: () => new Date(now),
    });
    const first = await service.acquire();
    now += 2_000;

    const stale = await service.acquire();

    expect(stale).toEqual(first);
    expect([playerRequests, managerRequests]).toEqual([1, 1]);
  });

  it('rejects a nonempty but unplayable primary snapshot and tries the alternate provider', async () => {
    const alternate = new DevelopmentSnapshotProvider();
    const allPlayers = await alternate.getActivePlayers();
    const allManagers = await alternate.getManagers();
    const incomplete: FootballDataProvider = {
      name: 'strikers-only',
      getActivePlayers: async () =>
        structuredClone(
          allPlayers.filter(({ preferredPosition }) => preferredPosition === 'ST').slice(0, 8),
        ),
      getPlayerSeasonStats: async () => null,
      getCurrentSquad: async () => [],
      getManagers: async () => structuredClone(allManagers.slice(0, 8)),
    };
    const persistence = new InMemoryPersistence();
    const service = new FrozenSnapshotService({
      providers: [incomplete, alternate],
      valuationProvider: new DevelopmentValuationProvider(),
      cache: new InMemoryCache(),
      snapshots: persistence,
      now: () => new Date('2026-08-13T00:00:00Z'),
    });

    const snapshot = await service.acquire();

    expect(snapshot.provider).toBe('development-snapshot');
    expect((await persistence.getLatestSnapshot())?.provider).toBe('development-snapshot');
  });

  it('does not reuse a fresh cached snapshot that cannot support a room', async () => {
    const alternate = new DevelopmentSnapshotProvider();
    const allPlayers = await alternate.getActivePlayers();
    const allManagers = await alternate.getManagers();
    const persistence = new InMemoryPersistence();
    await persistence.putSnapshot({
      id: 'invalid-cached-snapshot',
      provider: 'cached-strikers-only',
      createdAt: '2026-08-13T00:00:00.000Z',
      sourceUpdatedAt: '2026-08-13T00:00:00.000Z',
      candidates: [
        ...structuredClone(
          allPlayers.filter(({ preferredPosition }) => preferredPosition === 'ST').slice(0, 8),
        ),
        ...structuredClone(allManagers.slice(0, 8)),
      ],
    });
    const service = new FrozenSnapshotService({
      providers: [alternate],
      valuationProvider: new DevelopmentValuationProvider(),
      cache: new InMemoryCache(),
      snapshots: persistence,
      now: () => new Date('2026-08-13T00:00:00Z'),
    });

    const snapshot = await service.acquire();

    expect(snapshot.provider).toBe('development-snapshot');
    expect(snapshot.id).not.toBe('invalid-cached-snapshot');
  });

  it('serializes locks/counters and signs tamper-resistant expiring session tokens', async () => {
    const cache = new InMemoryCache();
    let value = 0;
    await Promise.all(
      Array.from({ length: 100 }, async () =>
        cache.withLock('room:atomic', async () => {
          const before = value;
          await Promise.resolve();
          value = before + 1;
        }),
      ),
    );
    expect(value).toBe(100);
    expect(
      await Promise.all(Array.from({ length: 4 }, () => cache.increment('rate', 1_000))),
    ).toEqual([1, 2, 3, 4]);

    let now = 1_000_000;
    const tokens = new SessionTokenService(
      'a-secret-longer-than-thirty-two-characters',
      300,
      () => now,
    );
    const memberId = '00000000-0000-4000-8000-000000000001';
    const token = tokens.issue('ABC234', memberId);
    expect(tokens.verify(token)).toMatchObject({ roomCode: 'ABC234', memberId });
    expect(tokens.verify(`${token.slice(0, -1)}x`)).toBeNull();
    now += 301_000;
    expect(tokens.verify(token)).toBeNull();
  });
});
