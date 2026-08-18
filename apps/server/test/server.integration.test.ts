import { randomUUID } from 'node:crypto';
import type { Ack, RoomView, SessionPayload } from '@gavel-xi/shared';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, type GavelServer } from '../src/server.js';
import { InMemoryCache } from '../src/cache.js';
import { InMemoryPersistence } from '../src/persistence.js';
import {
  DevelopmentSnapshotProvider,
  DevelopmentValuationProvider,
} from '../src/providers/index.js';
import { TestEngine } from './helpers.js';

const clients: ClientSocket[] = [];
const servers: GavelServer[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.stop();
});

async function fixture(options: { realEngine?: boolean; now?: () => number } = {}): Promise<{
  server: GavelServer;
  url: string;
}> {
  const server = await buildServer({
    ...(options.realEngine ? {} : { engine: new TestEngine() }),
    dataProviders: [new DevelopmentSnapshotProvider()],
    valuationProvider: new DevelopmentValuationProvider(),
    ...(options.now === undefined ? {} : { now: options.now }),
    config: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 0,
      WEB_ORIGIN: 'http://localhost:3000',
      SESSION_SECRET: 'test-session-secret-that-is-at-least-32-bytes',
      HOST_TRANSFER_GRACE_MS: 20,
      DEBUG_ROUTES: true,
    },
  });
  servers.push(server);
  const url = await server.start({ host: '127.0.0.1', port: 0 });
  return { server, url };
}

async function connect(url: string): Promise<ClientSocket> {
  const socket = createClient(url, {
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('socket connection timeout')), 3_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return socket;
}

async function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} ack timeout`)), 4_000);
    const emitter = socket as unknown as {
      emit(name: string, body: unknown, callback: (ack: Ack<T>) => void): void;
    };
    emitter.emit(event, payload, (ack) => {
      clearTimeout(timeout);
      resolve(ack);
    });
  });
}

function requireData<T>(ack: Ack<T>): T {
  expect(ack.ok, ack.error?.message).toBe(true);
  expect(ack.data).toBeDefined();
  return ack.data!;
}

function nextSocketEvent<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} event timeout`)), 4_000);
    socket.once(event, (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

async function createTwoPlayerRoom(url: string): Promise<{
  host: ClientSocket;
  guest: ClientSocket;
  hostSession: SessionPayload;
  guestSession: SessionPayload;
}> {
  const host = await connect(url);
  const hostSession = requireData(
    await emitAck<SessionPayload>(host, 'room:create', { name: 'Host', avatar: 'crown' }),
  );
  const guest = await connect(url);
  const guestSession = requireData(
    await emitAck<SessionPayload>(guest, 'room:join', {
      roomCode: hostSession.room.code,
      name: 'Guest',
      avatar: 'shield',
    }),
  );
  return { host, guest, hostSession, guestSession };
}

describe('authoritative realtime server', () => {
  it('allows the canonical Vercel client origin for HTTP and Socket.IO', async () => {
    const { url } = await fixture();
    const origin = 'https://gavel-xl-web.vercel.app';
    const health = await fetch(`${url}/health`, { headers: { origin } });
    const socketHandshake = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { origin },
    });

    expect(health.headers.get('access-control-allow-origin')).toBe(origin);
    expect(socketHandshake.status).toBe(200);
    expect(socketHandshake.headers.get('access-control-allow-origin')).toBe(origin);
  });

  it('sends an authoritative bid ceiling privately and restores it on reconnect', async () => {
    const { url } = await fixture();
    const { host, guest, hostSession, guestSession } = await createTwoPlayerRoom(url);
    const roomCode = hostSession.room.code;
    requireData(await emitAck<RoomView>(guest, 'room:ready', { roomCode, ready: true }));
    const hostLimitEvent = nextSocketEvent<{
      roomCode: string;
      auctionSequence: number;
      maxBidEUR: number;
    }>(host, 'auction:limit');
    const guestLimitEvent = nextSocketEvent<{
      roomCode: string;
      auctionSequence: number;
      maxBidEUR: number;
    }>(guest, 'auction:limit');
    const startedRoom = requireData(await emitAck<RoomView>(host, 'game:start', { roomCode }));
    expect(startedRoom.replay).toEqual([]);
    await expect(hostLimitEvent).resolves.toEqual({
      roomCode,
      auctionSequence: 1,
      maxBidEUR: 750_000_000,
    });
    await expect(guestLimitEvent).resolves.toEqual({
      roomCode,
      auctionSequence: 1,
      maxBidEUR: 749_000_000,
    });

    guest.disconnect();
    const resumedGuest = await connect(url);
    const resumedLimitEvent = nextSocketEvent<{
      roomCode: string;
      auctionSequence: number;
      maxBidEUR: number;
    }>(resumedGuest, 'auction:limit');
    requireData(
      await emitAck<SessionPayload>(resumedGuest, 'room:resume', {
        sessionToken: guestSession.sessionToken,
      }),
    );
    await expect(resumedLimitEvent).resolves.toEqual({
      roomCode,
      auctionSequence: 1,
      maxBidEUR: 749_000_000,
    });
  });

  it('binds one identity per socket and rejects concurrent room-switch attempts without orphaning presence', async () => {
    const { server, url } = await fixture();
    const socket = await connect(url);
    const [first, racing] = await Promise.all([
      emitAck<SessionPayload>(socket, 'room:create', { name: 'Alpha' }),
      emitAck<SessionPayload>(socket, 'room:create', { name: 'Beta' }),
    ]);
    const created = [first, racing].find(({ ok }) => ok);
    const rejected = [first, racing].find(({ ok }) => !ok);
    expect(created?.ok).toBe(true);
    expect(rejected).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const session = requireData(created!);
    expect(await emitAck<SessionPayload>(socket, 'room:create', { name: 'Gamma' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect((await server.persistence.listRooms()).map(({ code }) => code)).toEqual([
      session.room.code,
    ]);
    const original = await server.roomService.getRoom(session.room.code);
    expect(original.members).toHaveLength(1);
    expect(original.members[0]).toMatchObject({
      id: session.memberId,
      isConnected: true,
      isHost: true,
    });
  });

  it('keeps the host transfer grace timer when an unrelated member disconnects', async () => {
    const { server, url } = await fixture();
    const host = await connect(url);
    const hostSession = requireData(
      await emitAck<SessionPayload>(host, 'room:create', { name: 'Original Host' }),
    );
    const firstGuest = await connect(url);
    const firstGuestSession = requireData(
      await emitAck<SessionPayload>(firstGuest, 'room:join', {
        roomCode: hostSession.room.code,
        name: 'First Guest',
      }),
    );
    const secondGuest = await connect(url);
    requireData(
      await emitAck<SessionPayload>(secondGuest, 'room:join', {
        roomCode: hostSession.room.code,
        name: 'Second Guest',
      }),
    );
    host.disconnect();
    secondGuest.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 70));
    const room = await server.roomService.getRoom(hostSession.room.code);
    expect(room.members.find(({ id }) => id === firstGuestSession.memberId)?.isHost).toBe(true);
  });

  it('preserves host ownership while everyone is offline and promotes the first resumed director', async () => {
    const { server, url } = await fixture();
    const { host, guest, hostSession, guestSession } = await createTwoPlayerRoom(url);
    host.disconnect();
    guest.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 70));
    const offline = await server.roomService.getRoom(hostSession.room.code);
    expect(offline.members.filter(({ isHost }) => isHost)).toHaveLength(1);
    expect(offline.members.find(({ isHost }) => isHost)?.id).toBe(hostSession.memberId);

    const resumedGuest = await connect(url);
    const resumed = requireData(
      await emitAck<SessionPayload>(resumedGuest, 'room:resume', {
        sessionToken: guestSession.sessionToken,
      }),
    );
    expect(resumed.room.members.find(({ id }) => id === guestSession.memberId)?.isHost).toBe(true);
    expect(resumed.room.members.filter(({ isHost }) => isHost)).toHaveLength(1);
  });

  it('does not transfer a host to persisted-only presence after restart', async () => {
    const clock = Date.UTC(2026, 7, 13, 12);
    const { server, url } = await fixture({ now: () => clock });
    const transferable = await createTwoPlayerRoom(url);
    const offline = await createTwoPlayerRoom(url);
    await server.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const transferableRoom = await server.roomService.getStoredRoom(
      transferable.hostSession.room.code,
    );
    transferableRoom.members.find(
      ({ id }) => id === transferable.hostSession.memberId,
    )!.isConnected = false;
    transferableRoom.members.find(
      ({ id }) => id === transferable.hostSession.memberId,
    )!.disconnectedAt = clock - 100;
    transferableRoom.members.find(
      ({ id }) => id === transferable.guestSession.memberId,
    )!.isConnected = true;
    transferableRoom.members.find(
      ({ id }) => id === transferable.guestSession.memberId,
    )!.disconnectedAt = null;
    await server.persistence.save(transferableRoom);

    const offlineRoom = await server.roomService.getStoredRoom(offline.hostSession.room.code);
    for (const member of offlineRoom.members) {
      member.isConnected = false;
      member.disconnectedAt = clock - 100;
    }
    await server.persistence.save(offlineRoom);

    const restarted = await buildServer({
      engine: new TestEngine(),
      persistence: server.persistence,
      now: () => clock,
      dataProviders: [new DevelopmentSnapshotProvider()],
      valuationProvider: new DevelopmentValuationProvider(),
      config: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: 0,
        SESSION_SECRET: 'host-recovery-secret-that-is-at-least-32-bytes',
        HOST_TRANSFER_GRACE_MS: 20,
      },
    });
    servers.push(restarted);
    await restarted.start({ host: '127.0.0.1', port: 0 });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(
      (await restarted.roomService.getRoom(transferable.hostSession.room.code)).members.find(
        ({ isHost }) => isHost,
      )?.id,
    ).toBe(transferable.hostSession.memberId);
    expect(
      (await restarted.roomService.getRoom(offline.hostSession.room.code)).members.find(
        ({ isHost }) => isHost,
      )?.id,
    ).toBe(offline.hostSession.memberId);
  });

  it('resets phantom crash presence on startup and transfers the absent host after resume', async () => {
    let clock = Date.UTC(2026, 7, 13, 12);
    const { server, url } = await fixture({ now: () => clock });
    const { hostSession, guestSession } = await createTwoPlayerRoom(url);
    const persisted = new InMemoryPersistence();
    const crashSnapshot = await server.roomService.getStoredRoom(hostSession.room.code);
    await persisted.create(crashSnapshot);
    const cache = new InMemoryCache();
    for (const member of crashSnapshot.members) {
      await cache.set(`presence:${crashSnapshot.code}:${member.id}`, { lastSeenAt: clock }, 60_000);
    }
    await server.stop();
    clock += 1_000;

    const restarted = await buildServer({
      engine: new TestEngine(),
      persistence: persisted,
      cache,
      now: () => clock,
      dataProviders: [new DevelopmentSnapshotProvider()],
      valuationProvider: new DevelopmentValuationProvider(),
      config: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: 0,
        SESSION_SECRET: 'test-session-secret-that-is-at-least-32-bytes',
        HOST_TRANSFER_GRACE_MS: 20,
      },
    });
    servers.push(restarted);
    const restartedUrl = await restarted.start({ host: '127.0.0.1', port: 0 });

    const reset = await restarted.roomService.getStoredRoom(crashSnapshot.code);
    expect(reset.members.every(({ isConnected }) => !isConnected)).toBe(true);
    expect(reset.members.every(({ disconnectedAt }) => disconnectedAt === clock)).toBe(true);
    expect((await persisted.listEvents(crashSnapshot.code)).map(({ type }) => type)).toContain(
      'STARTUP_PRESENCE_RESET',
    );

    const resumedGuest = await connect(restartedUrl);
    requireData(
      await emitAck<SessionPayload>(resumedGuest, 'room:resume', {
        sessionToken: guestSession.sessionToken,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const transferred = await restarted.roomService.getRoom(crashSnapshot.code);
    expect(transferred.members.find(({ id }) => id === hostSession.memberId)).toMatchObject({
      isConnected: false,
      isHost: false,
    });
    expect(transferred.members.find(({ id }) => id === guestSession.memberId)).toMatchObject({
      isConnected: true,
      isHost: true,
    });
  });

  it('never exposes development debug routes in production', async () => {
    const server = await buildServer({
      engine: new TestEngine(),
      dataProviders: [new DevelopmentSnapshotProvider()],
      valuationProvider: new DevelopmentValuationProvider(),
      config: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 0,
        SESSION_SECRET: 'a-unique-production-session-secret-for-tests',
        FOOTBALL_DATA_PROVIDER: 'api-football',
        API_FOOTBALL_KEY: 'production-test-provider-key',
        DEBUG_ROUTES: true,
      },
    });
    servers.push(server);
    const url = await server.start({ host: '127.0.0.1', port: 0 });
    expect((await fetch(`${url}/debug/rooms`)).status).toBe(404);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it('restricts hidden debug state to the current host session', async () => {
    const { url } = await fixture();
    const { hostSession, guestSession } = await createTwoPlayerRoom(url);
    const endpoint = `${url}/debug/rooms/${hostSession.room.code}`;

    expect((await fetch(endpoint)).status).toBe(401);
    expect(
      (
        await fetch(endpoint, {
          headers: { authorization: `Bearer ${guestSession.sessionToken}` },
        })
      ).status,
    ).toBe(403);
    const hostResponse = await fetch(endpoint, {
      headers: { authorization: `Bearer ${hostSession.sessionToken}` },
    });
    expect(hostResponse.status).toBe(200);
    expect((await hostResponse.json()) as object).toHaveProperty('room.hiddenState');
  });

  it('returns an interrupted pre-game preparation to the lobby on restart', async () => {
    const { server, url } = await fixture();
    const host = await connect(url);
    const session = requireData(
      await emitAck<SessionPayload>(host, 'room:create', { name: 'Recovery Host' }),
    );
    const stranded = await server.roomService.getStoredRoom(session.room.code);
    stranded.phase = 'PREPARING_DATA';
    stranded.hiddenState = null;
    await server.persistence.save(stranded);
    await server.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const restarted = await buildServer({
      engine: new TestEngine(),
      persistence: server.persistence,
      dataProviders: [new DevelopmentSnapshotProvider()],
      valuationProvider: new DevelopmentValuationProvider(),
      config: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: 0,
        WEB_ORIGIN: 'http://localhost:3000',
        SESSION_SECRET: 'restart-recovery-secret-that-is-at-least-32-bytes',
      },
    });
    servers.push(restarted);
    await restarted.start({ host: '127.0.0.1', port: 0 });

    const recovered = await restarted.roomService.getRoom(session.room.code);
    expect(recovered.phase).toBe('LOBBY');
    await expect(
      restarted.roomService.updateSettings(session.room.code, session.memberId, {
        budgetEUR: 600_000_000,
      }),
    ).resolves.toMatchObject({ phase: 'LOBBY', settings: { budgetEUR: 600_000_000 } });
    expect(
      (await restarted.persistence.listEvents(session.room.code)).map(({ type }) => type),
    ).toContain('PREPARATION_RECOVERED');
  });

  it('rejects bids and passes at or after the authoritative lot deadline', async () => {
    let clock = Date.UTC(2026, 7, 13, 12);
    const { url } = await fixture({ now: () => clock });
    const { host, guest, hostSession } = await createTwoPlayerRoom(url);
    const roomCode = hostSession.room.code;
    requireData(await emitAck<RoomView>(guest, 'room:ready', { roomCode, ready: true }));
    const started = requireData(await emitAck<RoomView>(host, 'game:start', { roomCode }));
    clock = started.currentLot!.endsAt!;
    expect(
      await emitAck<{ room: RoomView }>(host, 'auction:bid', {
        roomCode,
        amountEUR: started.currentLot!.openingBidEUR,
        auctionSequence: started.auctionSequence,
        idempotencyKey: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: 'AUCTION_CLOSED' } });
    expect(
      await emitAck<{ room: RoomView }>(guest, 'auction:pass', {
        roomCode,
        auctionSequence: started.auctionSequence,
      }),
    ).toMatchObject({ ok: false, error: { code: 'AUCTION_CLOSED' } });
  });

  it('lets only the host pause and resume the auction', async () => {
    const { server, url } = await fixture();
    const { host, guest, hostSession } = await createTwoPlayerRoom(url);
    const roomCode = hostSession.room.code;
    requireData(await emitAck<RoomView>(guest, 'room:ready', { roomCode, ready: true }));
    requireData(await emitAck<RoomView>(host, 'game:start', { roomCode }));

    expect(await emitAck<RoomView>(guest, 'auction:pause', { roomCode })).toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });
    expect(requireData(await emitAck<RoomView>(host, 'auction:pause', { roomCode })).isPaused).toBe(
      true,
    );
    expect((await server.roomService.getRoom(roomCode)).isPaused).toBe(true);
    expect(requireData(await emitAck<RoomView>(host, 'auction:pause', { roomCode })).isPaused).toBe(
      false,
    );
    expect((await server.persistence.listEvents(roomCode)).map(({ type }) => type)).toEqual(
      expect.arrayContaining(['AUCTION_PAUSED', 'AUCTION_RESUMED']),
    );
  });

  it('lets a stale scheduler wake adopt an authoritative extended deadline', async () => {
    let clock = Date.UTC(2026, 7, 13, 12);
    const { server, url } = await fixture({ now: () => clock });
    const { host, guest, hostSession } = await createTwoPlayerRoom(url);
    const roomCode = hostSession.room.code;
    requireData(await emitAck<RoomView>(guest, 'room:ready', { roomCode, ready: true }));
    const started = requireData(await emitAck<RoomView>(host, 'game:start', { roomCode }));
    const originalWakeAt = started.currentLot!.endsAt!;
    clock = originalWakeAt - 1_000;
    const bid = requireData(
      await emitAck<{ room: RoomView }>(host, 'auction:bid', {
        roomCode,
        amountEUR: started.currentLot!.openingBidEUR,
        auctionSequence: started.auctionSequence,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(bid.room.currentLot!.endsAt).toBeGreaterThan(originalWakeAt);

    const healed = await server.roomService.advance(roomCode, originalWakeAt);

    expect(healed?.nextWakeAt).toBe(bid.room.currentLot!.endsAt);
    expect((await server.roomService.getRoom(roomCode)).currentLot?.currentLeaderId).toBe(
      hostSession.memberId,
    );
  });

  it('enforces lobby authority, atomic bids, spectators, reconnect, host transfer and durable events', async () => {
    const { server, url } = await fixture();
    const health = (await (await fetch(`${url}/health`)).json()) as { status: string };
    expect(health.status).toBe('ok');

    const { host, guest, hostSession, guestSession } = await createTwoPlayerRoom(url);
    const roomCode = hostSession.room.code;

    const guestSettings = await emitAck<RoomView>(guest, 'room:settings', {
      roomCode,
      settings: { revealSeconds: 0 },
    });
    expect(guestSettings).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect(await emitAck<RoomView>(host, 'game:restart', { roomCode })).toMatchObject({
      ok: false,
      error: { code: 'REMATCH_UNAVAILABLE' },
    });

    const earlyStart = await emitAck<RoomView>(host, 'game:start', { roomCode });
    expect(earlyStart).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    requireData(await emitAck<RoomView>(guest, 'room:ready', { roomCode, ready: true }));
    const settings = requireData(
      await emitAck<RoomView>(host, 'room:settings', {
        roomCode,
        settings: { revealSeconds: 0, auctionTimerSeconds: 5, antiSnipeSeconds: 5 },
      }),
    );
    expect(settings.settings).toMatchObject({ revealSeconds: 0, auctionTimerSeconds: 5 });
    const started = requireData(await emitAck<RoomView>(host, 'game:start', { roomCode }));
    expect(started.phase).toBe('BIDDING');
    expect(started.seed).toBeNull();
    expect(started.seedCommitment).toBeTruthy();
    expect('hiddenState' in started).toBe(false);

    const spectator = await connect(url);
    const spectatorSession = requireData(
      await emitAck<SessionPayload>(spectator, 'room:join', { roomCode, name: 'Watcher' }),
    );
    expect(
      spectatorSession.room.members.find(({ id }) => id === spectatorSession.memberId)?.isSpectator,
    ).toBe(true);
    expect(spectatorSession.room.currentLot?.eligibleMemberIds).toHaveLength(2);
    const spectatorPass = await emitAck<{ room: RoomView }>(spectator, 'auction:pass', {
      roomCode,
      auctionSequence: started.auctionSequence,
    });
    expect(spectatorPass).toMatchObject({ ok: false, error: { code: 'NOT_DIRECTOR' } });

    const amountEUR = started.currentLot!.openingBidEUR;
    const bidPayload = (idempotencyKey: string) => ({
      roomCode,
      auctionSequence: started.auctionSequence,
      amountEUR,
      idempotencyKey,
    });
    const [firstBid, racingBid] = await Promise.all([
      emitAck<{ room: RoomView }>(host, 'auction:bid', bidPayload(randomUUID())),
      emitAck<{ room: RoomView }>(guest, 'auction:bid', bidPayload(randomUUID())),
    ]);
    expect([firstBid.ok, racingBid.ok].filter(Boolean)).toHaveLength(1);
    expect([firstBid, racingBid].find((ack) => !ack.ok)?.error?.code).toBe('BID_TOO_LOW');

    guest.disconnect();
    const resumedSocket = await connect(url);
    const resumed = requireData(
      await emitAck<SessionPayload>(resumedSocket, 'room:resume', {
        sessionToken: guestSession.sessionToken,
      }),
    );
    expect(resumed.memberId).toBe(guestSession.memberId);
    expect(resumed.room.members.filter(({ id }) => id === guestSession.memberId)).toHaveLength(1);

    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 70));
    const afterTransfer = await server.roomService.getRoom(roomCode);
    expect(afterTransfer.members.find(({ id }) => id === guestSession.memberId)?.isHost).toBe(true);

    const checkpoint = requireData(
      await emitAck<RoomView>(resumedSocket, 'checkpoint:request', { roomCode }),
    );
    expect(checkpoint.phase).toBe('CHECKPOINT');
    expect(checkpoint.checkpoint?.number).toBe(1);

    const storedEvents = await server.persistence.listEvents(roomCode);
    expect(
      storedEvents
        .map(({ sequence }) => sequence)
        .every((sequence, index) => index === 0 || sequence > storedEvents[index - 1]!.sequence),
    ).toBe(true);
    expect(storedEvents.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        'ROOM_CREATED',
        'MEMBER_JOINED',
        'GAME_STARTED',
        'BID_ACCEPTED',
        'HOST_TRANSFERRED',
      ]),
    );
    const debug = (await (
      await fetch(`${url}/debug/rooms/${roomCode}`, {
        headers: { authorization: `Bearer ${guestSession.sessionToken}` },
      })
    ).json()) as {
      room: { hiddenState: unknown };
    };
    expect(debug.room.hiddenState).not.toBeNull();
  });

  it('caps active directors at eight while allowing late spectators without changing auction eligibility', async () => {
    const { url } = await fixture();
    const host = await connect(url);
    const hostSession = requireData(
      await emitAck<SessionPayload>(host, 'room:create', { name: 'Director 1' }),
    );
    const roomCode = hostSession.room.code;
    const directors: ClientSocket[] = [];
    for (let index = 2; index <= 8; index += 1) {
      const socket = await connect(url);
      directors.push(socket);
      requireData(
        await emitAck<SessionPayload>(socket, 'room:join', { roomCode, name: `Director ${index}` }),
      );
    }
    const ninth = await connect(url);
    expect(
      await emitAck<SessionPayload>(ninth, 'room:join', { roomCode, name: 'Director 9' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'ROOM_FULL' },
    });
    for (const director of directors) {
      requireData(await emitAck<RoomView>(director, 'room:ready', { roomCode, ready: true }));
    }
    requireData(
      await emitAck<RoomView>(host, 'room:settings', {
        roomCode,
        settings: { revealSeconds: 0, auctionTimerSeconds: 5 },
      }),
    );
    const started = requireData(await emitAck<RoomView>(host, 'game:start', { roomCode }));
    expect(started.currentLot?.eligibleMemberIds).toHaveLength(8);
    const late = requireData(
      await emitAck<SessionPayload>(ninth, 'room:join', { roomCode, name: 'Director 9' }),
    );
    expect(late.room.members).toHaveLength(9);
    expect(late.room.members.find(({ id }) => id === late.memberId)?.isSpectator).toBe(true);
    expect(late.room.currentLot?.eligibleMemberIds).toHaveLength(8);
  });

  it('runs a complete real two-player game through forced cycles, checkpoints and 100-metric results', async () => {
    let clock = Date.UTC(2026, 7, 13, 12);
    const { server, url } = await fixture({ realEngine: true, now: () => clock });
    const { host, guest, hostSession, guestSession } = await createTwoPlayerRoom(url);
    const roomCode = hostSession.room.code;
    requireData(await emitAck<RoomView>(guest, 'room:ready', { roomCode, ready: true }));
    requireData(
      await emitAck<RoomView>(host, 'room:settings', {
        roomCode,
        settings: {
          revealSeconds: 0,
          auctionTimerSeconds: 5,
          antiSnipeSeconds: 0,
          budgetMode: 'CHAOS',
          budgetEUR: 1_000_000_000,
        },
      }),
    );
    requireData(await emitAck<RoomView>(host, 'game:start', { roomCode }));

    for (
      let guard = 0;
      guard < 100 && (await server.roomService.getRoom(roomCode)).phase !== 'RESULTS';
      guard += 1
    ) {
      const room = await server.roomService.getRoom(roomCode);
      if (
        room.phase === 'REVEALING' ||
        ['SOLD', 'UNSOLD', 'FORCED_ASSIGNMENT', 'NEXT_LOT'].includes(room.phase)
      ) {
        if (room.phase !== 'REVEALING') clock += 1_000;
        await server.roomService.advance(roomCode);
        continue;
      }
      if (room.phase === 'CHECKPOINT') {
        await server.roomService.checkpoint(roomCode, hostSession.memberId);
        continue;
      }
      if (room.phase === 'BIDDING') {
        const lot = room.currentLot!;
        const leaderId = lot.eligibleMemberIds[0]!;
        const leaderSocket = leaderId === hostSession.memberId ? host : guest;
        requireData(
          await emitAck<{ room: RoomView }>(leaderSocket, 'auction:bid', {
            roomCode,
            amountEUR: lot.openingBidEUR,
            auctionSequence: lot.sequence,
            idempotencyKey: randomUUID(),
          }),
        );
        for (const memberId of lot.eligibleMemberIds.filter((id) => id !== leaderId)) {
          const memberSocket = memberId === guestSession.memberId ? guest : host;
          requireData(
            await emitAck<{ room: RoomView }>(memberSocket, 'auction:pass', {
              roomCode,
              auctionSequence: lot.sequence,
            }),
          );
        }
        continue;
      }
      throw new Error(`unexpected phase ${room.phase}`);
    }

    const result = await server.roomService.getRoom(roomCode);
    expect(result.phase).toBe('RESULTS');
    expect(result.seed).not.toBeNull();
    expect(result.evaluation?.metrics).toHaveLength(100);
    expect(result.evaluation?.teams).toHaveLength(2);
    expect(result.squads).toHaveLength(24);
    expect(
      result.members
        .filter(({ isSpectator }) => !isSpectator)
        .map(({ filledSlots }) => filledSlots),
    ).toEqual([12, 12]);
    expect(result.replay.some(({ type }) => type === 'FORCED')).toBe(true);
    expect(result.replay.filter(({ type }) => type === 'COMPLETE')).toHaveLength(1);
    expect((await fetch(`${url}/api/rooms/${roomCode}/results`)).status).toBe(200);
    expect((await fetch(`${url}/api/rooms/${roomCode}/replay`)).status).toBe(200);
    expect((await fetch(`${url}/api/share/${roomCode}`)).status).toBe(200);

    const spectator = await connect(url);
    const spectatorSession = requireData(
      await emitAck<SessionPayload>(spectator, 'room:join', { roomCode, name: 'Final Watcher' }),
    );
    expect(
      spectatorSession.room.members.find(({ id }) => id === spectatorSession.memberId)?.isSpectator,
    ).toBe(true);
    expect(await emitAck<RoomView>(guest, 'game:restart', { roomCode })).toMatchObject({
      ok: false,
      error: { code: 'NOT_HOST' },
    });
    const guestLobbyState = nextSocketEvent<RoomView>(guest, 'room:state');
    const spectatorLobbyState = nextSocketEvent<RoomView>(spectator, 'room:state');
    const restarted = requireData(await emitAck<RoomView>(host, 'game:restart', { roomCode }));
    expect(await guestLobbyState).toMatchObject({ code: roomCode, phase: 'LOBBY' });
    expect(await spectatorLobbyState).toMatchObject({ code: roomCode, phase: 'LOBBY' });
    expect(restarted).toMatchObject({
      code: roomCode,
      phase: 'LOBBY',
      seed: null,
      seedCommitment: null,
      snapshotId: null,
      snapshotUpdatedAt: null,
      currentLot: null,
      squads: [],
      auctionSequence: 0,
      resolvedCycles: 0,
      totalCycles: 0,
      checkpoint: null,
      evaluation: null,
      replay: [],
      isPaused: false,
    });
    expect(restarted.settings.formation).toBe('4-2-1-3');
    expect(restarted.members.map(({ id }) => id)).toEqual([
      hostSession.memberId,
      guestSession.memberId,
      spectatorSession.memberId,
    ]);
    expect(
      restarted.members
        .filter(({ isSpectator }) => !isSpectator)
        .map(({ isReady, budgetEUR, spentEUR, filledSlots }) => ({
          isReady,
          budgetEUR,
          spentEUR,
          filledSlots,
        })),
    ).toEqual([
      { isReady: false, budgetEUR: 1_000_000_000, spentEUR: 0, filledSlots: 0 },
      { isReady: false, budgetEUR: 1_000_000_000, spentEUR: 0, filledSlots: 0 },
    ]);
    expect(restarted.members.find(({ id }) => id === spectatorSession.memberId)).toMatchObject({
      isSpectator: true,
      budgetEUR: 0,
      spentEUR: 0,
      filledSlots: 0,
    });
    expect((await server.persistence.listEvents(roomCode)).at(-1)).toMatchObject({
      type: 'GAME_RESTARTED',
    });
    await expect(
      server.roomService.updateSettings(roomCode, hostSession.memberId, { formation: '4-4-2' }),
    ).resolves.toMatchObject({ phase: 'LOBBY', settings: { formation: '4-4-2' } });
    await expect(
      emitAck<RoomView>(guest, 'room:ready', { roomCode, ready: true }),
    ).resolves.toMatchObject({ ok: true, data: { phase: 'LOBBY' } });
  }, 20_000);
});
