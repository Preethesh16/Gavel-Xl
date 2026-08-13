import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createGameEngine } from '@gavel-xi/game-engine';
import { roomSettingsSchema, type Ack, type RoomView, type SessionPayload } from '@gavel-xi/shared';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCache, RedisCacheAdapter } from '../src/cache.js';
import type { FrozenSnapshot, PersistedEvent, StoredRoom } from '../src/domain.js';
import {
  InMemoryPersistence,
  PersistenceConflictError,
  PrismaPersistence,
} from '../src/persistence.js';
import {
  DevelopmentSnapshotProvider,
  DevelopmentValuationProvider,
} from '../src/providers/index.js';
import { FrozenSnapshotService } from '../src/providers/snapshots.js';
import { buildServer, type GavelServer } from '../src/server.js';
import { TestEngine } from './helpers.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
const redisUrl = process.env.TEST_REDIS_URL ?? '';
const infrastructureAvailable = databaseUrl !== '' && redisUrl !== '';

function persistedEvent(room: StoredRoom, type: string): PersistedEvent {
  return {
    id: randomUUID(),
    roomCode: room.code,
    sequence: room.eventSequence,
    type,
    at: room.updatedAt,
    payload: { type },
  };
}

async function developmentSnapshot(): Promise<FrozenSnapshot> {
  const persistence = new InMemoryPersistence();
  return new FrozenSnapshotService({
    providers: [new DevelopmentSnapshotProvider()],
    valuationProvider: new DevelopmentValuationProvider(),
    cache: new InMemoryCache(),
    snapshots: persistence,
  }).acquire();
}

function gameRoom(code: string, memberPrefix: string, snapshot: FrozenSnapshot): StoredRoom {
  const now = Date.UTC(2026, 7, 13, 12);
  const settings = roomSettingsSchema.parse({ revealSeconds: 2, budgetMode: 'CHAOS' });
  const members = [0, 1].map((index) => ({
    id: `${memberPrefix}-member-${index}`,
    name: `${memberPrefix} ${index}`,
    avatar: 'shield',
    color: index === 0 ? '#62F5C5' : '#FFCA5C',
    isHost: index === 0,
    isReady: index === 1,
    isConnected: true,
    isSpectator: false,
    joinedAt: now + index,
    lastSeenAt: now + index,
    disconnectedAt: null,
    budgetEUR: settings.budgetEUR,
    spentEUR: 0,
    emergencyAllocations: 0,
  }));
  const mutation = createGameEngine().start({
    seed: 'same-snapshot-and-seed',
    now,
    settings,
    members: members.map(({ id, budgetEUR, joinedAt }) => ({ id, budgetEUR, joinedAt })),
    snapshot,
  });
  return {
    code,
    title: `${code} War Room`,
    phase: mutation.projection.phase,
    settings,
    members,
    seed: 'same-snapshot-and-seed',
    seedCommitment: mutation.projection.seedCommitment,
    snapshotId: snapshot.id,
    snapshotUpdatedAt: snapshot.sourceUpdatedAt,
    currentLot: mutation.projection.currentLot,
    squads: mutation.projection.squads,
    auctionSequence: mutation.projection.auctionSequence,
    resolvedCycles: mutation.projection.resolvedCycles,
    totalCycles: mutation.projection.totalCycles,
    checkpoint: mutation.projection.checkpoint,
    evaluation: mutation.projection.evaluation,
    replay: mutation.projection.replay,
    hiddenState: mutation.state,
    eventSequence: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

async function connect(url: string): Promise<ClientSocket> {
  const socket = createClient(url, {
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connection timeout')), 4_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

async function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timeout`)), 5_000);
    const emitter = socket as unknown as {
      emit(name: string, value: unknown, callback: (ack: Ack<T>) => void): void;
    };
    emitter.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function requireData<T>(ack: Ack<T>): T {
  if (!ack.ok || ack.data === undefined) throw new Error(ack.error?.message ?? 'missing ack data');
  return ack.data;
}

describe.skipIf(!infrastructureAvailable)('durable production adapters', () => {
  let prisma: PrismaClient;
  const servers: GavelServer[] = [];
  const clients: ClientSocket[] = [];
  const caches: RedisCacheAdapter[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Room", "DataSnapshot", "Formation" CASCADE');
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    for (const server of servers.splice(0)) await server.stop();
    for (const cache of caches.splice(0)) await cache.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('round-trips restart state and namespaces normalized projections across rooms', async () => {
    const snapshot = await developmentSnapshot();
    const writer = new PrismaPersistence({ connectionString: databaseUrl });
    await writer.connect();
    await writer.putSnapshot(snapshot);
    const first = gameRoom('AAAA22', 'first', snapshot);
    const second = gameRoom('BBBB22', 'second', snapshot);
    await writer.create(first, persistedEvent(first, 'ROOM_CREATED'));
    await writer.create(second, persistedEvent(second, 'ROOM_CREATED'));
    await writer.close();

    const restarted = new PrismaPersistence({ connectionString: databaseUrl });
    await restarted.connect();
    expect(await restarted.get(first.code)).toEqual(first);
    expect(await restarted.getSnapshot(snapshot.id)).toEqual(snapshot);
    expect(await restarted.listEvents(first.code)).toHaveLength(1);

    const games = await prisma.game.findMany({
      orderBy: { id: 'asc' },
      include: { cycles: { include: { candidates: true } } },
    });
    expect(games).toHaveLength(2);
    expect(games[0]!.cycles).toHaveLength(first.totalCycles);
    expect(games[1]!.cycles).toHaveLength(second.totalCycles);
    const firstIds = new Set(
      games[0]!.cycles.flatMap((cycle) => cycle.candidates.map(({ id }) => id)),
    );
    const secondIds = new Set(
      games[1]!.cycles.flatMap((cycle) => cycle.candidates.map(({ id }) => id)),
    );
    expect([...firstIds].some((id) => secondIds.has(id))).toBe(false);
    expect(await prisma.playerSnapshot.count()).toBeGreaterThan(0);
    expect(await prisma.managerSnapshot.count()).toBeGreaterThan(0);
    await restarted.close();
  });

  it('atomically rejects a split-brain stale room commit', async () => {
    const first = new PrismaPersistence({ connectionString: databaseUrl });
    const second = new PrismaPersistence({ connectionString: databaseUrl });
    await Promise.all([first.connect(), second.connect()]);
    const snapshot = await developmentSnapshot();
    await first.putSnapshot(snapshot);
    const initial = gameRoom('CASA22', 'cas-a', snapshot);
    await first.create(initial, persistedEvent(initial, 'ROOM_CREATED'));
    const left = (await first.get(initial.code))!;
    const right = (await second.get(initial.code))!;
    left.title = 'left won';
    right.title = 'right won';
    left.eventSequence += 1;
    right.eventSequence += 1;
    left.updatedAt += 1;
    right.updatedAt += 1;
    const results = await Promise.allSettled([
      first.commit(left, persistedEvent(left, 'LEFT_COMMIT')),
      second.commit(right, persistedEvent(right, 'RIGHT_COMMIT')),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejection?.reason).toBeInstanceOf(PersistenceConflictError);
    expect(await first.listEvents(initial.code)).toHaveLength(2);
    expect(['left won', 'right won']).toContain((await first.get(initial.code))?.title);
    await Promise.all([first.close(), second.close()]);
  });

  it('provides JSON TTLs, atomic fixed-window increments, and cross-client token locks', async () => {
    const first = new RedisCacheAdapter({ url: redisUrl, lockTtlMs: 90 });
    const second = new RedisCacheAdapter({ url: redisUrl, lockTtlMs: 90 });
    caches.push(first, second);
    await Promise.all([first.connect(), second.connect()]);
    const prefix = `adapter-test:${randomUUID()}`;
    await first.set(`${prefix}:json`, { nested: ['value', 2] }, 40);
    expect(await second.get(`${prefix}:json`)).toEqual({ nested: ['value', 2] });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await second.get(`${prefix}:json`)).toBeNull();

    const counts = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? first : second).increment(`${prefix}:rate`, 1_000),
      ),
    );
    expect([...counts].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );

    let active = 0;
    let maximumActive = 0;
    const work = (cache: RedisCacheAdapter, label: string) =>
      cache.withLock(`${prefix}:room`, async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 140));
        active -= 1;
        return label;
      });
    expect(await Promise.all([work(first, 'first'), work(second, 'second')])).toEqual([
      'first',
      'second',
    ]);
    expect(maximumActive).toBe(1);
  });

  it('fans room events across Socket.IO workers through Redis', async () => {
    const common = {
      engine: new TestEngine(),
      dataProviders: [new DevelopmentSnapshotProvider()],
      valuationProvider: new DevelopmentValuationProvider(),
      config: {
        NODE_ENV: 'test' as const,
        HOST: '127.0.0.1',
        PORT: 0,
        WEB_ORIGIN: 'http://localhost:3000',
        SESSION_SECRET: 'test-session-secret-that-is-at-least-32-bytes',
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
      },
    };
    const first = await buildServer({ ...common, roomCode: () => 'FANX22' });
    const second = await buildServer(common);
    servers.push(first, second);
    const [firstUrl, secondUrl] = await Promise.all([
      first.start({ host: '127.0.0.1', port: 0 }),
      second.start({ host: '127.0.0.1', port: 0 }),
    ]);
    const host = await connect(firstUrl);
    const guest = await connect(secondUrl);
    clients.push(host, guest);
    const created = requireData(
      await emitAck<SessionPayload>(host, 'room:create', { name: 'Cross Worker Host' }),
    );
    const joinedEvent = new Promise<{ id: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cross-worker room event timeout')), 4_000);
      host.once('member:joined', (member: { id: string }) => {
        clearTimeout(timer);
        resolve(member);
      });
    });
    const joined = requireData(
      await emitAck<SessionPayload>(guest, 'room:join', {
        roomCode: created.room.code,
        name: 'Cross Worker Guest',
      }),
    );
    expect((await joinedEvent).id).toBe(joined.memberId);
  });

  it('advances one timer despite a spectator revision and duplicate worker wake', async () => {
    const common = {
      dataProviders: [new DevelopmentSnapshotProvider()],
      valuationProvider: new DevelopmentValuationProvider(),
      config: {
        NODE_ENV: 'test' as const,
        HOST: '127.0.0.1',
        PORT: 0,
        WEB_ORIGIN: 'http://localhost:3000',
        SESSION_SECRET: 'test-session-secret-that-is-at-least-32-bytes',
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
      },
    };
    const first = await buildServer({ ...common, roomCode: () => 'TMEX22' });
    const second = await buildServer(common);
    servers.push(first, second);
    const firstUrl = await first.start({ host: '127.0.0.1', port: 0 });
    const secondUrl = await second.start({ host: '127.0.0.1', port: 0 });
    const host = await connect(firstUrl);
    const guest = await connect(secondUrl);
    clients.push(host, guest);
    const created = requireData(
      await emitAck<SessionPayload>(host, 'room:create', { name: 'Host' }),
    );
    const joined = requireData(
      await emitAck<SessionPayload>(guest, 'room:join', {
        roomCode: created.room.code,
        name: 'Guest',
      }),
    );
    requireData(
      await emitAck<RoomView>(guest, 'room:ready', {
        roomCode: created.room.code,
        ready: true,
      }),
    );
    requireData(
      await emitAck<RoomView>(host, 'room:settings', {
        roomCode: created.room.code,
        settings: { revealSeconds: 5, auctionTimerSeconds: 5 },
      }),
    );
    requireData(await emitAck<RoomView>(host, 'game:start', { roomCode: created.room.code }));

    const recovered = await buildServer(common);
    servers.push(recovered);
    const recoveredUrl = await recovered.start({ host: '127.0.0.1', port: 0 });
    const spectator = await connect(recoveredUrl);
    clients.push(spectator);
    const watched = requireData(
      await emitAck<SessionPayload>(spectator, 'room:join', {
        roomCode: created.room.code,
        name: 'Spectator',
      }),
    );
    expect(watched.room.members.find(({ id }) => id === watched.memberId)?.isSpectator).toBe(true);
    let room = await first.roomService.getRoom(created.room.code);
    const deadline = Date.now() + 7_000;
    while (room.phase !== 'BIDDING' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      room = await first.roomService.getRoom(created.room.code);
    }
    expect(room.phase).toBe('BIDDING');
    const events = await first.roomService.eventLog(created.room.code);
    expect(events.filter(({ type }) => type === 'ENGINE_ADVANCED')).toHaveLength(1);
    expect(joined.memberId).not.toBe(watched.memberId);
  }, 25_000);
});
