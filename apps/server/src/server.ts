import { randomBytes } from 'node:crypto';
import cors from '@fastify/cors';
import { createGameEngine } from '@gavel-xi/game-engine';
import type { Ack, RoomSettingsInput } from '@gavel-xi/shared';
import { createAdapter as createSocketRedisAdapter } from '@socket.io/redis-adapter';
import Fastify, { type FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { Server as SocketServer, type Socket } from 'socket.io';
import type { ZodType } from 'zod';
import { InMemoryCache, RedisCacheAdapter, type CacheAdapter } from './cache.js';
import { loadConfig, parseConfig, type ServerConfig } from './config.js';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './contracts.js';
import type { AuthoritativeEngine } from './engine-port.js';
import { DomainError, errorMessage } from './errors.js';
import { InMemoryPersistence, PrismaPersistence, type PersistenceAdapter } from './persistence.js';
import { createOptionalNarrativeEnricher, type EvaluationNarrativeEnricher } from './narrative.js';
import {
  ApiFootballProvider,
  DevelopmentSnapshotProvider,
  GameEstimateValuationProvider,
  SportmonksProvider,
  type FootballDataProvider,
  type ValuationProvider,
} from './providers/index.js';
import { FrozenSnapshotService } from './providers/snapshots.js';
import { RoomService } from './room-service.js';
import { RoomScheduler } from './scheduler.js';
import { SessionTokenService } from './security.js';
import { memberChannel, roomChannel, SocketPublisher } from './socket-publisher.js';
import { socketSchemas } from './validation.js';
import { debugRoomView } from './views.js';

type GavelSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface BuildServerOptions {
  config?: Partial<ServerConfig>;
  engine?: AuthoritativeEngine;
  persistence?: PersistenceAdapter;
  cache?: CacheAdapter;
  dataProviders?: FootballDataProvider[];
  valuationProvider?: ValuationProvider;
  narrativeEnricher?: EvaluationNarrativeEnricher;
  now?: () => number;
  seed?: () => string;
  roomCode?: () => string;
  logger?: boolean;
}

export interface GavelServer {
  app: FastifyInstance;
  io: SocketServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  roomService: RoomService;
  persistence: PersistenceAdapter;
  cache: CacheAdapter;
  config: ServerConfig;
  start(options?: { host?: string; port?: number }): Promise<string>;
  stop(): Promise<void>;
  address(): string | null;
}

function safeCallback<T>(callback: unknown, ack: Ack<T>): void {
  if (typeof callback === 'function') (callback as (value: Ack<T>) => void)(ack);
}

function parsed<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DomainError(
      'BAD_PAYLOAD',
      result.error.issues[0]?.message ?? 'That action payload is invalid.',
    );
  }
  return result.data;
}

function definedSettings(value: Record<string, unknown>): Partial<RoomSettingsInput> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<RoomSettingsInput>;
}

function origins(config: ServerConfig): string[] {
  return [
    ...new Set(
      [config.WEB_ORIGIN, config.CLIENT_ORIGIN]
        .filter((value): value is string => value !== undefined)
        .flatMap((value) => value.split(','))
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
}

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function session(
  socket: GavelSocket,
  expectedRoomCode?: string,
): { memberId: string; roomCode: string } {
  const { memberId, roomCode } = socket.data;
  if (memberId === undefined || roomCode === undefined) {
    throw new DomainError('NOT_A_MEMBER', 'Create, join, or resume a room first.');
  }
  if (expectedRoomCode !== undefined && roomCode !== expectedRoomCode) {
    throw new DomainError('NOT_A_MEMBER', 'That action belongs to another room.');
  }
  return { memberId, roomCode };
}

async function bindIdentity(
  socket: GavelSocket,
  payload: { room: { code: string }; memberId: string; sessionToken: string },
): Promise<void> {
  if (
    (socket.data.roomCode !== undefined && socket.data.roomCode !== payload.room.code) ||
    (socket.data.memberId !== undefined && socket.data.memberId !== payload.memberId)
  ) {
    throw new DomainError(
      'CONFLICT',
      'This connection already represents another director. Leave before switching rooms.',
    );
  }
  socket.data.roomCode = payload.room.code;
  socket.data.memberId = payload.memberId;
  socket.data.sessionToken = payload.sessionToken;
  socket.data.lastHeartbeatAt = Date.now();
  await socket.join([roomChannel(payload.room.code), memberChannel(payload.memberId)]);
}

export function configuredProviders(config: ServerConfig): FootballDataProvider[] {
  const sportmonks =
    config.SPORTMONKS_API_TOKEN === undefined
      ? null
      : new SportmonksProvider(config.SPORTMONKS_API_TOKEN);
  const apiFootball =
    config.API_FOOTBALL_KEY === undefined
      ? null
      : new ApiFootballProvider(config.API_FOOTBALL_KEY, {
          leagueIds: config.API_FOOTBALL_LEAGUE_IDS.split(',')
            .map(Number)
            .filter((value) => Number.isSafeInteger(value) && value > 0),
          ...(config.API_FOOTBALL_SEASON === undefined
            ? {}
            : { currentSeason: config.API_FOOTBALL_SEASON }),
        });
  switch (config.FOOTBALL_DATA_PROVIDER) {
    case 'sportmonks':
      return [sportmonks!];
    case 'api-football':
      return [apiFootball!];
    case 'demo':
      return [new DevelopmentSnapshotProvider()];
    case 'auto':
      return [
        ...(sportmonks === null ? [] : [sportmonks]),
        ...(apiFootball === null ? [] : [apiFootball]),
        ...(config.NODE_ENV === 'production' ? [] : [new DevelopmentSnapshotProvider()]),
      ];
  }
}

export async function buildServer(options: BuildServerOptions = {}): Promise<GavelServer> {
  const defaults = loadConfig();
  const parsedConfig = parseConfig({ ...defaults, ...options.config });
  const config: ServerConfig =
    parsedConfig.SESSION_SECRET === undefined
      ? { ...parsedConfig, SESSION_SECRET: randomBytes(32).toString('hex') }
      : parsedConfig;
  const now = options.now ?? Date.now;
  const persistence: PersistenceAdapter =
    options.persistence ??
    (config.DATABASE_URL === undefined
      ? new InMemoryPersistence()
      : new PrismaPersistence({ connectionString: config.DATABASE_URL }));
  const cache: CacheAdapter =
    options.cache ??
    (config.REDIS_URL === undefined
      ? new InMemoryCache()
      : new RedisCacheAdapter({ url: config.REDIS_URL }));

  try {
    await persistence.connect?.();
    await cache.connect?.();
  } catch (error) {
    await Promise.allSettled([cache.close?.(), persistence.close?.()]);
    throw new Error('Configured persistence or cache adapter failed to initialize', {
      cause: error,
    });
  }

  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cors, {
    origin: origins(config),
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  const httpServer = app.server;
  const io = new SocketServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: { origin: origins(config), credentials: true },
    maxHttpBufferSize: 64 * 1_024,
    pingInterval: 10_000,
    pingTimeout: config.PRESENCE_TIMEOUT_MS,
  });
  let closeSocketAdapter = async (): Promise<void> => undefined;
  if (config.REDIS_URL !== undefined) {
    const pubClient = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    const subClient = pubClient.duplicate();
    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createSocketRedisAdapter(pubClient, subClient));
    } catch (error) {
      pubClient.disconnect(false);
      subClient.disconnect(false);
      await Promise.allSettled([cache.close?.(), persistence.close?.()]);
      throw new Error('Configured Socket.IO Redis adapter failed to initialize', { cause: error });
    }
    let socketAdapterClosed = false;
    closeSocketAdapter = async () => {
      if (socketAdapterClosed) return;
      socketAdapterClosed = true;
      const close = async (client: Redis): Promise<void> => {
        try {
          await client.quit();
        } catch {
          client.disconnect(false);
        }
      };
      await Promise.all([close(pubClient), close(subClient)]);
    };
  }
  const publisher = new SocketPublisher(io);
  const dataProviders = options.dataProviders ?? configuredProviders(config);
  const snapshotService = new FrozenSnapshotService({
    providers: dataProviders,
    valuationProvider: options.valuationProvider ?? new GameEstimateValuationProvider(),
    cache,
    snapshots: persistence,
    now: () => new Date(now()),
  });
  const tokenService = new SessionTokenService(
    config.SESSION_SECRET!,
    config.SESSION_TTL_SECONDS,
    now,
  );
  const narrativeEnricher =
    options.narrativeEnricher ??
    createOptionalNarrativeEnricher({
      ...(config.GROQ_API_KEY === undefined ? {} : { apiKey: config.GROQ_API_KEY }),
      cache,
      model: config.GROQ_MODEL,
      timeoutMs: config.GROQ_TIMEOUT_MS,
    });
  const roomService = new RoomService({
    persistence,
    cache,
    snapshots: snapshotService,
    engine: options.engine ?? createGameEngine(),
    tokens: tokenService,
    publisher,
    ...(narrativeEnricher === undefined ? {} : { narratives: narrativeEnricher }),
    now,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(options.roomCode === undefined ? {} : { roomCode: options.roomCode }),
    hostTransferGraceMs: config.HOST_TRANSFER_GRACE_MS,
  });
  const scheduler = new RoomScheduler(roomService, now);
  let listeningAddress: string | null = null;
  let stopped = false;

  app.get('/health', async () => ({
    status: 'ok',
    service: 'gavel-xi-server',
    cache: await cache.health(),
    now: new Date(now()).toISOString(),
  }));

  if (config.NODE_ENV !== 'production' && (config.DEBUG_ROUTES ?? true)) {
    app.get('/admin/data-health', async () => {
      const reports = await Promise.all(
        dataProviders.map(async (provider) => {
          if (provider.getDataHealth === undefined)
            return {
              provider: provider.name,
              connected: false,
              generatedAt: new Date(now()).toISOString(),
              leagues: [],
              teamsFound: 0,
              activePlayersFound: 0,
              managersFound: 0,
              statsCoveragePercent: 0,
              positionCoverage: {},
              valuationCoveragePercent: 0,
              freshness: null,
              samplePlayers: [],
              errors: ['This provider does not expose a data-health diagnostic.'],
            };
          try {
            return await provider.getDataHealth();
          } catch (error) {
            return {
              provider: provider.name,
              connected: false,
              generatedAt: new Date(now()).toISOString(),
              leagues: [],
              teamsFound: 0,
              activePlayersFound: 0,
              managersFound: 0,
              statsCoveragePercent: 0,
              positionCoverage: {},
              valuationCoveragePercent: 0,
              freshness: null,
              samplePlayers: [],
              errors: [errorMessage(error)],
            };
          }
        }),
      );
      return { reports };
    });
  }

  app.get<{ Params: { code: string } }>('/api/rooms/:code/results', async (request, reply) => {
    try {
      const room = await roomService.getRoom(request.params.code.toUpperCase());
      if (room.evaluation === null)
        return reply.code(404).send({ error: 'Results are not available yet.' });
      return { room };
    } catch (error) {
      return reply.code(404).send({ error: errorMessage(error) });
    }
  });

  app.get<{ Params: { code: string } }>('/api/rooms/:code/replay', async (request, reply) => {
    try {
      const room = await roomService.getRoom(request.params.code.toUpperCase());
      if (!['RESULTS', 'COMPLETE'].includes(room.phase)) {
        return reply.code(409).send({ error: 'The auction recap unlocks after the game.' });
      }
      return { roomCode: room.code, replay: room.replay };
    } catch (error) {
      return reply.code(404).send({ error: errorMessage(error) });
    }
  });

  app.get<{ Params: { code: string } }>('/api/share/:code', async (request, reply) => {
    try {
      const room = await roomService.getRoom(request.params.code.toUpperCase());
      if (room.evaluation === null)
        return reply.code(404).send({ error: 'Share result is not available yet.' });
      const champion = [...room.evaluation.teams].sort((left, right) => left.rank - right.rank)[0];
      return {
        title: room.title,
        roomCode: room.code,
        champion:
          champion === undefined
            ? null
            : {
                member: room.members.find((member) => member.id === champion.memberId) ?? null,
                result: champion,
              },
        teams: room.evaluation.teams,
        awards: room.evaluation.awards,
        seed: room.seed,
        seedCommitment: room.seedCommitment,
      };
    } catch (error) {
      return reply.code(404).send({ error: errorMessage(error) });
    }
  });

  if (config.NODE_ENV !== 'production' && (config.DEBUG_ROUTES ?? true)) {
    app.get<{ Params: { code: string } }>('/debug/rooms/:code', async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      const claims = token === null ? null : tokenService.verify(token);
      const roomCode = request.params.code.toUpperCase();
      if (claims === null || claims.roomCode !== roomCode) {
        return reply.code(401).send({ error: 'A valid room session is required.' });
      }
      try {
        const room = await roomService.getStoredRoom(roomCode);
        if (room.members.find((member) => member.id === claims.memberId)?.isHost !== true) {
          return reply.code(403).send({ error: 'Only the current host can inspect debug state.' });
        }
        return debugRoomView(room);
      } catch (error) {
        return reply.code(404).send({ error: errorMessage(error) });
      }
    });
    app.get('/debug/rooms', async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      const claims = token === null ? null : tokenService.verify(token);
      if (claims === null) {
        return reply.code(401).send({ error: 'A valid host session is required.' });
      }
      try {
        const room = await roomService.getStoredRoom(claims.roomCode);
        if (room.members.find((member) => member.id === claims.memberId)?.isHost !== true) {
          return reply.code(403).send({ error: 'Only the current host can inspect debug state.' });
        }
        return { rooms: [debugRoomView(room)] };
      } catch (error) {
        return reply.code(404).send({ error: errorMessage(error) });
      }
    });
  }

  io.on('connection', (socket) => {
    let identityLeaseSequence = 0;
    let activeIdentityLease: number | null = null;
    const beginIdentityBinding = (): number => {
      if (
        activeIdentityLease !== null ||
        socket.data.memberId !== undefined ||
        socket.data.roomCode !== undefined
      ) {
        throw new DomainError(
          'CONFLICT',
          'This connection already represents a director. Leave before creating or joining another room.',
        );
      }
      identityLeaseSequence += 1;
      activeIdentityLease = identityLeaseSequence;
      return activeIdentityLease;
    };

    socket.on('room:create', async (raw, callback) => {
      let identityLease: number | null = null;
      try {
        identityLease = beginIdentityBinding();
        const rate = await cache.increment(`rate:create:${socket.handshake.address}`, 60_000);
        if (rate > 10)
          throw new DomainError('RATE_LIMITED', 'Too many rooms created from this connection.');
        const result = await roomService.create(parsed(socketSchemas['room:create'], raw));
        await bindIdentity(socket, result);
        await roomService.publishBidLimit(result.room.code, result.memberId);
        safeCallback(callback, { ok: true, data: result });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      } finally {
        if (identityLease !== null && activeIdentityLease === identityLease) {
          activeIdentityLease = null;
        }
      }
    });

    socket.on('room:join', async (raw, callback) => {
      let identityLease: number | null = null;
      try {
        identityLease = beginIdentityBinding();
        const rate = await cache.increment(`rate:join:${socket.handshake.address}`, 60_000);
        if (rate > 30) throw new DomainError('RATE_LIMITED', 'Too many room join attempts.');
        const result = await roomService.join(parsed(socketSchemas['room:join'], raw));
        await bindIdentity(socket, result);
        await roomService.publishBidLimit(result.room.code, result.memberId);
        if (result.room.members.find((member) => member.id === result.memberId)?.isHost === true) {
          scheduler.cancelHostTransfer(result.room.code);
        }
        safeCallback(callback, { ok: true, data: result });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      } finally {
        if (identityLease !== null && activeIdentityLease === identityLease) {
          activeIdentityLease = null;
        }
      }
    });

    socket.on('room:resume', async (raw, callback) => {
      let identityLease: number | null = null;
      try {
        identityLease = beginIdentityBinding();
        const input = parsed(socketSchemas['room:resume'], raw);
        const result = await roomService.resume(input.sessionToken);
        await bindIdentity(socket, result);
        await roomService.publishBidLimit(result.room.code, result.memberId);
        if (result.room.members.find((member) => member.id === result.memberId)?.isHost === true) {
          scheduler.cancelHostTransfer(result.room.code);
        }
        safeCallback(callback, { ok: true, data: result });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      } finally {
        if (identityLease !== null && activeIdentityLease === identityLease) {
          activeIdentityLease = null;
        }
      }
    });

    socket.on('room:ready', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['room:ready'], raw);
        const actor = session(socket, input.roomCode);
        const result = await roomService.setReady(input.roomCode, actor.memberId, input.ready);
        safeCallback(callback, { ok: true, data: result });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      }
    });

    socket.on('room:settings', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['room:settings'], raw);
        const actor = session(socket, input.roomCode);
        const result = await roomService.updateSettings(
          input.roomCode,
          actor.memberId,
          definedSettings(input.settings),
        );
        safeCallback(callback, { ok: true, data: result });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      }
    });

    socket.on('game:start', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['game:start'], raw);
        const actor = session(socket, input.roomCode);
        const result = await roomService.start(input.roomCode, actor.memberId);
        scheduler.schedule(
          input.roomCode,
          result.nextWakeAt === null ? null : { wakeAt: result.nextWakeAt },
        );
        safeCallback(callback, { ok: true, data: result.room });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      }
    });

    socket.on('auction:bid', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['auction:bid'], raw);
        const actor = session(socket, input.roomCode);
        const result = await roomService.bid(input.roomCode, actor.memberId, input);
        scheduler.schedule(
          input.roomCode,
          result.nextWakeAt === null ? null : { wakeAt: result.nextWakeAt },
        );
        safeCallback(callback, { ok: true, data: { room: result.room } });
      } catch (error) {
        const rejection = errorMessage(error);
        if (rejection.latestLot !== undefined) {
          socket.emit('auction:outbid', {
            roomCode: socket.data.roomCode ?? '',
            latestLot: rejection.latestLot,
            message: rejection.message,
          });
        }
        safeCallback(callback, { ok: false, error: rejection });
      }
    });

    socket.on('auction:pass', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['auction:pass'], raw);
        const actor = session(socket, input.roomCode);
        const result = await roomService.pass(input.roomCode, actor.memberId, input);
        scheduler.schedule(
          input.roomCode,
          result.nextWakeAt === null ? null : { wakeAt: result.nextWakeAt },
        );
        safeCallback(callback, { ok: true, data: { room: result.room } });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      }
    });

    socket.on('team:request', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['team:request'], raw);
        const actor = session(socket, input.roomCode);
        const result = await roomService.team(input.roomCode, actor.memberId, input.scope);
        safeCallback(callback, { ok: true, data: result });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      }
    });

    socket.on('checkpoint:request', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['checkpoint:request'], raw);
        const actor = session(socket, input.roomCode);
        const result = await roomService.checkpoint(input.roomCode, actor.memberId);
        scheduler.schedule(
          input.roomCode,
          result.nextWakeAt === null ? null : { wakeAt: result.nextWakeAt },
        );
        safeCallback(callback, { ok: true, data: result.room });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      }
    });

    socket.on('auction:pause', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['auction:pause'], raw);
        const actor = session(socket, input.roomCode);
        const room = await roomService.getRoom(input.roomCode);
        const result = room.isPaused
          ? await roomService.resumeAuction(input.roomCode, actor.memberId)
          : await roomService.pause(input.roomCode, actor.memberId);
        scheduler.schedule(
          input.roomCode,
          result.nextWakeAt === null ? null : { wakeAt: result.nextWakeAt },
        );
        safeCallback(callback, { ok: true, data: result.room });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      }
    });

    socket.on('presence:heartbeat', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['presence:heartbeat'], raw);
        const actor = session(socket, input.roomCode);
        await roomService.heartbeat(input.roomCode, actor.memberId);
        socket.data.lastHeartbeatAt = now();
        safeCallback(callback, { ok: true });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      }
    });

    socket.on('room:leave', async (raw, callback) => {
      try {
        const input = parsed(socketSchemas['room:leave'], raw);
        const actor = session(socket, input.roomCode);
        const transferAt = await roomService.leave(input.roomCode, actor.memberId);
        scheduler.scheduleHostTransfer(input.roomCode, actor.memberId, transferAt);
        await socket.leave(roomChannel(input.roomCode));
        await socket.leave(memberChannel(actor.memberId));
        socket.data = {};
        safeCallback(callback, { ok: true });
      } catch (error) {
        safeCallback(callback, { ok: false, error: errorMessage(error) });
      }
    });

    socket.on('disconnect', () => {
      const { roomCode, memberId } = socket.data;
      if (roomCode === undefined || memberId === undefined) return;
      void io
        .in(memberChannel(memberId))
        .fetchSockets()
        .then(async (sockets) => {
          if (sockets.length > 0) return;
          const transferAt = await roomService.disconnect(roomCode, memberId);
          scheduler.scheduleHostTransfer(roomCode, memberId, transferAt);
        })
        .catch(() => undefined);
    });
  });

  return {
    app,
    io,
    roomService,
    persistence,
    cache,
    config,
    async start(overrides = {}) {
      if (listeningAddress !== null) return listeningAddress;
      if (stopped) throw new Error('SERVER_ALREADY_STOPPED');
      await app.ready();
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        httpServer.once('error', onError);
        httpServer.listen(overrides.port ?? config.PORT, overrides.host ?? config.HOST, () => {
          httpServer.off('error', onError);
          resolve();
        });
      });
      const address = httpServer.address();
      if (address === null) throw new Error('SERVER_LISTEN_FAILED');
      listeningAddress =
        typeof address === 'string'
          ? address
          : `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`;
      const presenceScanStartedAt = now();
      const activeIdentities = (await io.fetchSockets()).flatMap((socket) => {
        const { roomCode, memberId } = socket.data;
        return roomCode === undefined || memberId === undefined ? [] : [{ roomCode, memberId }];
      });
      await roomService.reconcileStartupPresence(activeIdentities, presenceScanStartedAt);
      for (const room of await roomService.recoverActiveRooms()) {
        scheduler.schedule(room.roomCode, {
          wakeAt: room.nextWakeAt,
        });
      }
      for (const transfer of await roomService.recoverHostTransfers()) {
        scheduler.scheduleHostTransfer(transfer.roomCode, transfer.hostMemberId, transfer.wakeAt);
      }
      return listeningAddress;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      scheduler.close();
      let shutdownFailure: unknown;
      try {
        await new Promise<void>((resolve) => io.close(() => resolve()));
        if (httpServer.listening) {
          await new Promise<void>((resolve, reject) => {
            httpServer.close((error) => (error === undefined ? resolve() : reject(error)));
          });
        }
        await app.close();
      } catch (error) {
        shutdownFailure = error;
      } finally {
        const resources = await Promise.allSettled([
          closeSocketAdapter(),
          cache.close?.(),
          persistence.close?.(),
        ]);
        listeningAddress = null;
        if (shutdownFailure === undefined) {
          const rejected = resources.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
          );
          if (rejected !== undefined) shutdownFailure = rejected.reason;
        }
      }
      if (shutdownFailure !== undefined) throw shutdownFailure;
    },
    address: () => listeningAddress,
  };
}
