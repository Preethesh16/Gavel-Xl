import { randomBytes, randomUUID } from 'node:crypto';
import {
  roomSettingsSchema,
  type BidInput,
  type CreateRoomInput,
  type JoinRoomInput,
  type PassInput,
  type RoomSettingsInput,
  type RoomView,
  type SessionPayload,
} from '@gavel-xi/shared';
import type { CacheAdapter } from './cache.js';
import type { TeamResponse } from './contracts.js';
import type { PersistedEvent, StoredMember, StoredRoom } from './domain.js';
import type { AuthoritativeEngine, EngineEffect, EngineMutation } from './engine-port.js';
import { DomainError } from './errors.js';
import type { RealtimePublisher } from './events.js';
import { mergeEvaluationNarrative, type EvaluationNarrativeEnricher } from './narrative.js';
import { PersistenceConflictError, type PersistenceAdapter } from './persistence.js';
import type { FrozenSnapshotService } from './providers/snapshots.js';
import type { SessionTokenService } from './security.js';
import { memberView, roomView } from './views.js';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MEMBER_COLORS = [
  '#62F5C5',
  '#FFCA5C',
  '#9B8CFF',
  '#FF6B7A',
  '#4DD5FF',
  '#F08BFF',
  '#B4F04A',
  '#FF985C',
];
const MAX_DIRECTORS = 8;
const PRESENCE_LEASE_TTL_MS = 60_000;

export interface ActivePresenceIdentity {
  roomCode: string;
  memberId: string;
}

interface PresenceLease {
  lastSeenAt: number;
}

function presenceKey(roomCode: string, memberId: string): string {
  return `presence:${roomCode}:${memberId}`;
}

export interface RoomServiceOptions {
  persistence: PersistenceAdapter;
  cache: CacheAdapter;
  snapshots: FrozenSnapshotService;
  engine: AuthoritativeEngine;
  tokens: SessionTokenService;
  publisher: RealtimePublisher;
  narratives?: EvaluationNarrativeEnricher;
  now?: () => number;
  seed?: () => string;
  roomCode?: () => string;
  hostTransferGraceMs?: number;
}

export interface MutationOutcome {
  room: RoomView;
  nextWakeAt: number | null;
}

function randomRoomCode(): string {
  const bytes = randomBytes(6);
  return [...bytes].map((byte) => ROOM_ALPHABET[byte! & 31]).join('');
}

function createMember(
  input: Pick<CreateRoomInput, 'name' | 'avatar'>,
  color: string,
  now: number,
  budgetEUR: number,
  isHost: boolean,
  isSpectator: boolean,
): StoredMember {
  return {
    id: randomUUID(),
    name: input.name,
    avatar: input.avatar ?? 'shield',
    color,
    isHost,
    isReady: false,
    isConnected: true,
    isSpectator,
    joinedAt: now,
    lastSeenAt: now,
    disconnectedAt: null,
    budgetEUR: isSpectator ? 0 : budgetEUR,
    spentEUR: 0,
    emergencyAllocations: 0,
  };
}

export class RoomService {
  readonly #persistence: PersistenceAdapter;
  readonly #cache: CacheAdapter;
  readonly #snapshots: FrozenSnapshotService;
  readonly #engine: AuthoritativeEngine;
  readonly #tokens: SessionTokenService;
  readonly #publisher: RealtimePublisher;
  readonly #narratives: EvaluationNarrativeEnricher | undefined;
  readonly #now: () => number;
  readonly #seed: () => string;
  readonly #roomCode: () => string;
  readonly #hostTransferGraceMs: number;

  constructor(options: RoomServiceOptions) {
    this.#persistence = options.persistence;
    this.#cache = options.cache;
    this.#snapshots = options.snapshots;
    this.#engine = options.engine;
    this.#tokens = options.tokens;
    this.#publisher = options.publisher;
    this.#narratives = options.narratives;
    this.#now = options.now ?? Date.now;
    this.#seed = options.seed ?? (() => randomBytes(32).toString('hex'));
    this.#roomCode = options.roomCode ?? randomRoomCode;
    this.#hostTransferGraceMs = options.hostTransferGraceMs ?? 15_000;
  }

  async create(input: CreateRoomInput): Promise<SessionPayload> {
    const now = this.#now();
    const settings = roomSettingsSchema.parse({});
    const code = await this.#uniqueRoomCode();
    const host = createMember(input, MEMBER_COLORS[0]!, now, settings.budgetEUR, true, false);
    const room: StoredRoom = {
      code,
      title: `${input.name}'s War Room`,
      phase: 'LOBBY',
      settings,
      members: [host],
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
      hiddenState: null,
      eventSequence: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await this.#markPresent(room.code, host.id, now);
    await this.#persistence.create(room, this.#event(room, 'ROOM_CREATED', { memberId: host.id }));
    return this.#session(room, host);
  }

  async join(input: JoinRoomInput): Promise<SessionPayload> {
    if (input.sessionToken !== undefined) {
      const claims = this.#tokens.verify(input.sessionToken);
      if (claims === null || claims.roomCode !== input.roomCode) {
        throw new DomainError('SESSION_INVALID', 'That saved room session is no longer valid.');
      }
      return this.resume(input.sessionToken);
    }

    return this.#cache.withLock(`room:${input.roomCode}`, async () => {
      const room = await this.#requireRoom(input.roomCode);
      const gameStarted = room.phase !== 'LOBBY';
      const activeDirectors = room.members.filter((member) => !member.isSpectator);
      if (!gameStarted && activeDirectors.length >= MAX_DIRECTORS) {
        throw new DomainError('ROOM_FULL', 'This room already has eight Sporting Directors.');
      }
      const now = this.#now();
      const member = createMember(
        input,
        MEMBER_COLORS[room.members.length % MEMBER_COLORS.length]!,
        now,
        room.settings.budgetEUR,
        false,
        gameStarted,
      );
      room.members.push(member);
      room.updatedAt = now;
      await this.#markPresent(room.code, member.id, now);
      await this.#commit(room, 'MEMBER_JOINED', {
        memberId: member.id,
        isSpectator: member.isSpectator,
      });
      this.#publisher.emit(room.code, 'member:joined', memberView(room, member));
      this.#broadcastState(room);
      return this.#session(room, member);
    });
  }

  async resume(sessionToken: string): Promise<SessionPayload> {
    const claims = this.#tokens.verify(sessionToken);
    if (claims === null)
      throw new DomainError('SESSION_INVALID', 'That room session has expired or is invalid.');
    return this.#cache.withLock(`room:${claims.roomCode}`, async () => {
      const room = await this.#requireRoom(claims.roomCode);
      const member = room.members.find((entry) => entry.id === claims.memberId);
      if (member === undefined)
        throw new DomainError(
          'SESSION_INVALID',
          'That participant no longer belongs to this room.',
        );
      const now = this.#now();
      member.isConnected = true;
      member.disconnectedAt = null;
      member.lastSeenAt = now;
      room.updatedAt = now;
      await this.#markPresent(room.code, member.id, now);
      const disconnectedHost = room.members.find(
        (entry) =>
          entry.isHost &&
          !entry.isConnected &&
          entry.disconnectedAt !== null &&
          now >= entry.disconnectedAt + this.#hostTransferGraceMs,
      );
      const missingHost = room.members.every((entry) => !entry.isHost);
      const replacement =
        disconnectedHost !== undefined || missingHost ? this.#selectNewHost(room) : null;
      if (replacement !== null) {
        await this.#commit(room, 'HOST_TRANSFERRED', {
          fromMemberId: disconnectedHost?.id ?? null,
          toMemberId: replacement.id,
          onResume: true,
        });
        this.#publisher.emit(room.code, 'host:transferred', {
          roomCode: room.code,
          hostMemberId: replacement.id,
        });
      } else {
        await this.#commit(room, 'MEMBER_RESUMED', { memberId: member.id });
      }
      this.#broadcastState(room);
      return this.#session(room, member);
    });
  }

  async setReady(roomCode: string, memberId: string, ready: boolean): Promise<RoomView> {
    return this.#mutateLobby(roomCode, memberId, async (room, member) => {
      if (member.isSpectator)
        throw new DomainError('NOT_DIRECTOR', 'Spectators cannot ready a squad.');
      member.isReady = ready;
      await this.#commit(room, 'READY_CHANGED', { memberId, ready });
    });
  }

  async updateSettings(
    roomCode: string,
    memberId: string,
    update: Partial<RoomSettingsInput>,
  ): Promise<RoomView> {
    return this.#mutateLobby(roomCode, memberId, async (room, member) => {
      if (!member.isHost)
        throw new DomainError('NOT_HOST', 'Only the host can change room settings.');
      room.settings = roomSettingsSchema.parse({ ...room.settings, ...update });
      for (const director of room.members.filter((entry) => !entry.isSpectator)) {
        director.budgetEUR = room.settings.budgetEUR;
        director.spentEUR = 0;
      }
      await this.#commit(room, 'SETTINGS_CHANGED', { memberId, settings: room.settings });
    });
  }

  async start(roomCode: string, memberId: string): Promise<MutationOutcome> {
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      const actor = this.#requireMember(room, memberId);
      if (!actor.isHost) throw new DomainError('NOT_HOST', 'Only the host can start the auction.');
      if (room.phase !== 'LOBBY')
        throw new DomainError('GAME_ALREADY_STARTED', 'This game has already started.');
      const directors = room.members.filter((member) => !member.isSpectator);
      if (directors.length < 2) {
        throw new DomainError('TOO_FEW_PLAYERS', 'At least two Sporting Directors are required.');
      }
      const waiting = directors.filter((member) => !member.isHost && !member.isReady);
      if (waiting.length > 0)
        throw new DomainError('NOT_READY', 'Every guest must be ready before kick-off.');

      room.phase = 'PREPARING_DATA';
      await this.#commit(room, 'GAME_PREPARING', { memberId });
      this.#broadcastState(room);

      try {
        const snapshot = await this.#snapshots.acquire();
        const seed = this.#seed();
        const mutation = this.#engine.start({
          seed,
          now: this.#now(),
          settings: room.settings,
          members: directors.map(({ id, budgetEUR, joinedAt }) => ({ id, budgetEUR, joinedAt })),
          snapshot,
        });
        room.seed = seed;
        room.snapshotId = snapshot.id;
        room.snapshotUpdatedAt = snapshot.sourceUpdatedAt;
        await this.#applyMutation(room, mutation);
        await this.#commit(room, 'GAME_STARTED', {
          snapshotId: snapshot.id,
          seedCommitment: mutation.projection.seedCommitment,
        });
        this.#emitEffects(room, mutation.effects);
        this.#broadcastState(room);
        return {
          room: roomView(room, this.#now()),
          nextWakeAt: mutation.nextWakeAt,
        };
      } catch (error) {
        if (error instanceof PersistenceConflictError) {
          throw new DomainError(
            'CONFLICT',
            'Another server process changed this room. Refresh and try again.',
          );
        }
        room.phase = 'LOBBY';
        await this.#commit(room, 'PREPARATION_FAILED', {
          memberId,
          reason: error instanceof Error ? error.message : 'unknown error',
        });
        this.#broadcastState(room);
        if (error instanceof DomainError) throw error;
        if (error instanceof Error && error.message.startsWith('STRICT_BUDGET_INFEASIBLE')) {
          throw new DomainError(
            'STRICT_BUDGET_INFEASIBLE',
            'That strict budget cannot safely complete this formation. Increase the budget or use Classic Chaos mode.',
          );
        }
        throw new DomainError(
          'DATA_UNAVAILABLE',
          error instanceof Error ? error.message : 'Football data is currently unavailable.',
        );
      }
    });
  }

  async bid(roomCode: string, memberId: string, input: BidInput): Promise<MutationOutcome> {
    const attempts = await this.#cache.increment(`rate:bid:${roomCode}:${memberId}`, 1_000);
    if (attempts > 20)
      throw new DomainError('RATE_LIMITED', 'Too many bid attempts. Wait a moment.');
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const duplicate = await this.#cache.get<MutationOutcome>(
        `idempotency:${roomCode}:${memberId}:${input.idempotencyKey}`,
      );
      if (duplicate !== null) return duplicate;
      const room = await this.#requireRoom(roomCode);
      this.#assertDirector(room, memberId);
      if (room.hiddenState === null)
        throw new DomainError('AUCTION_CLOSED', 'The auction is not open.');
      const now = this.#now();
      this.#assertBeforeDeadline(room, now);
      const mutation = this.#engine.bid(room.hiddenState, memberId, input, now);
      if (!mutation.accepted) this.#throwEngineError(mutation.error, room);
      if (mutation.effects.length === 0) {
        // The persisted engine remembers idempotency keys, so this also remains a
        // no-op after a cache loss or process restart.
        await this.#applyMutation(room, mutation);
        const duplicateOutcome = {
          room: roomView(room, this.#now()),
          nextWakeAt: mutation.nextWakeAt,
        };
        await this.#cache.set(
          `idempotency:${roomCode}:${memberId}:${input.idempotencyKey}`,
          duplicateOutcome,
          10 * 60 * 1_000,
        );
        return duplicateOutcome;
      }
      await this.#applyMutation(room, mutation);
      await this.#commit(room, 'BID_ACCEPTED', {
        memberId,
        amountEUR: input.amountEUR,
        auctionSequence: input.auctionSequence,
        idempotencyKey: input.idempotencyKey,
      });
      this.#emitEffects(room, mutation.effects);
      this.#broadcastState(room);
      const outcome = {
        room: roomView(room, this.#now()),
        nextWakeAt: mutation.nextWakeAt,
      };
      await this.#cache.set(
        `idempotency:${roomCode}:${memberId}:${input.idempotencyKey}`,
        outcome,
        10 * 60 * 1_000,
      );
      return outcome;
    });
  }

  async pass(roomCode: string, memberId: string, input: PassInput): Promise<MutationOutcome> {
    const attempts = await this.#cache.increment(`rate:pass:${roomCode}:${memberId}`, 1_000);
    if (attempts > 20)
      throw new DomainError('RATE_LIMITED', 'Too many pass attempts. Wait a moment.');
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      this.#assertDirector(room, memberId);
      if (room.hiddenState === null)
        throw new DomainError('AUCTION_CLOSED', 'The auction is not open.');
      const now = this.#now();
      this.#assertBeforeDeadline(room, now);
      const mutation = this.#engine.pass(room.hiddenState, memberId, input, now);
      if (!mutation.accepted) this.#throwEngineError(mutation.error, room);
      await this.#applyMutation(room, mutation);
      await this.#commit(room, 'PASS_ACCEPTED', {
        memberId,
        auctionSequence: input.auctionSequence,
      });
      this.#emitEffects(room, mutation.effects);
      this.#broadcastState(room);
      return {
        room: roomView(room, this.#now()),
        nextWakeAt: mutation.nextWakeAt,
      };
    });
  }

  async advance(roomCode: string, expectedWakeAt?: number): Promise<MutationOutcome | null> {
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      if (room.hiddenState === null || ['LOBBY', 'COMPLETE'].includes(room.phase)) return null;
      const currentWakeAt = this.#engine.nextWakeAt(room.hiddenState);
      if (expectedWakeAt !== undefined && currentWakeAt !== expectedWakeAt) {
        // Another worker may have extended the timer and then failed before
        // installing its local replacement timeout. Hand the authoritative wake
        // back to this scheduler so a stale timer heals instead of being dropped.
        return { room: roomView(room, this.#now()), nextWakeAt: currentWakeAt };
      }
      const mutation = this.#engine.advance(room.hiddenState, this.#now());
      await this.#applyMutation(room, mutation);
      await this.#commit(room, 'ENGINE_ADVANCED', { phase: room.phase });
      this.#emitEffects(room, mutation.effects);
      this.#broadcastState(room);
      return {
        room: roomView(room, this.#now()),
        nextWakeAt: mutation.nextWakeAt,
      };
    });
  }

  async checkpoint(roomCode: string, memberId: string): Promise<MutationOutcome> {
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      const member = this.#requireMember(room, memberId);
      if (!member.isHost)
        throw new DomainError('NOT_HOST', 'Only the host can broadcast a room team check.');
      if (room.hiddenState === null)
        throw new DomainError('AUCTION_CLOSED', 'No active game to check.');
      const mutation = this.#engine.checkpoint(room.hiddenState, this.#now());
      if (!mutation.accepted) this.#throwEngineError(mutation.error, room);
      await this.#applyMutation(room, mutation);
      await this.#commit(room, 'CHECKPOINT_REQUESTED', { memberId });
      this.#emitEffects(room, mutation.effects);
      this.#broadcastState(room);
      return {
        room: roomView(room, this.#now()),
        nextWakeAt: mutation.nextWakeAt,
      };
    });
  }

  async pause(roomCode: string, memberId: string): Promise<MutationOutcome> {
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      const member = this.#requireMember(room, memberId);
      if (!member.isHost) throw new DomainError('NOT_HOST', 'Only the host can pause the auction.');
      if (room.hiddenState === null)
        throw new DomainError('AUCTION_CLOSED', 'No active auction to pause.');
      const mutation = this.#engine.pause(room.hiddenState, this.#now());
      await this.#applyMutation(room, mutation);
      await this.#commit(room, 'AUCTION_PAUSED', { memberId });
      this.#broadcastState(room);
      return { room: roomView(room, this.#now()), nextWakeAt: mutation.nextWakeAt };
    });
  }

  async resumeAuction(roomCode: string, memberId: string): Promise<MutationOutcome> {
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      const member = this.#requireMember(room, memberId);
      if (!member.isHost)
        throw new DomainError('NOT_HOST', 'Only the host can resume the auction.');
      if (room.hiddenState === null)
        throw new DomainError('AUCTION_CLOSED', 'No active auction to resume.');
      const mutation = this.#engine.resume(room.hiddenState, this.#now());
      await this.#applyMutation(room, mutation);
      await this.#commit(room, 'AUCTION_RESUMED', { memberId });
      this.#broadcastState(room);
      return { room: roomView(room, this.#now()), nextWakeAt: mutation.nextWakeAt };
    });
  }

  async team(roomCode: string, memberId: string, scope: 'MY' | 'ALL'): Promise<TeamResponse> {
    const room = await this.#requireRoom(roomCode);
    this.#requireMember(room, memberId);
    const memberIds =
      scope === 'ALL' ? new Set(room.members.map((member) => member.id)) : new Set([memberId]);
    return {
      members: room.members
        .filter((member) => memberIds.has(member.id))
        .map((member) => memberView(room, member)),
      squads: room.squads
        .filter((entry) => memberIds.has(entry.memberId))
        .map((entry) => structuredClone(entry)),
    };
  }

  async heartbeat(roomCode: string, memberId: string): Promise<void> {
    await this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      const member = this.#requireMember(room, memberId);
      const now = this.#now();
      member.lastSeenAt = now;
      member.isConnected = true;
      member.disconnectedAt = null;
      // Heartbeat freshness is intentionally ephemeral. Connection state changes
      // (resume/disconnect) remain durable events; per-ping writes would add noisy
      // Postgres contention and could never authorize an auction mutation.
      await this.#markPresent(roomCode, memberId, now);
    });
  }

  async disconnect(roomCode: string, memberId: string): Promise<number | null> {
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      const member = this.#requireMember(room, memberId);
      const now = this.#now();
      member.isConnected = false;
      member.disconnectedAt = now;
      room.updatedAt = now;
      await this.#cache.delete(presenceKey(roomCode, memberId));
      await this.#commit(room, 'MEMBER_DISCONNECTED', { memberId });
      this.#publisher.emit(room.code, 'member:left', memberView(room, member));
      this.#broadcastState(room);
      return member.isHost ? now + this.#hostTransferGraceMs : null;
    });
  }

  async leave(roomCode: string, memberId: string): Promise<number | null> {
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      const member = this.#requireMember(room, memberId);
      if (room.phase === 'LOBBY' || member.isSpectator) {
        const wasHost = member.isHost;
        room.members = room.members.filter((entry) => entry.id !== memberId);
        const newHost = wasHost ? this.#selectNewHost(room) : null;
        await this.#cache.delete(presenceKey(roomCode, memberId));
        await this.#commit(room, 'MEMBER_LEFT', { memberId });
        this.#publisher.emit(room.code, 'member:left', memberView(room, member));
        if (newHost !== null) {
          this.#publisher.emit(room.code, 'host:transferred', {
            roomCode: room.code,
            hostMemberId: newHost.id,
          });
        }
        this.#broadcastState(room);
        return null;
      }
      member.isConnected = false;
      member.disconnectedAt = this.#now();
      await this.#cache.delete(presenceKey(roomCode, memberId));
      await this.#commit(room, 'MEMBER_DISCONNECTED', { memberId, explicit: true });
      this.#publisher.emit(room.code, 'member:left', memberView(room, member));
      this.#broadcastState(room);
      return member.isHost ? this.#now() + this.#hostTransferGraceMs : null;
    });
  }

  async transferHostIfDisconnected(
    roomCode: string,
    expectedHostId: string,
  ): Promise<string | null> {
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      const host = room.members.find((member) => member.id === expectedHostId && member.isHost);
      if (host === undefined || host.isConnected) return null;
      const newHost = this.#selectNewHost(room);
      if (newHost === null) return null;
      await this.#commit(room, 'HOST_TRANSFERRED', {
        fromMemberId: expectedHostId,
        toMemberId: newHost.id,
      });
      this.#publisher.emit(room.code, 'host:transferred', {
        roomCode: room.code,
        hostMemberId: newHost.id,
      });
      this.#broadcastState(room);
      return newHost.id;
    });
  }

  async getRoom(roomCode: string): Promise<RoomView> {
    return roomView(await this.#requireRoom(roomCode), this.#now());
  }

  /** Re-emits only this director's hidden-information-derived bid ceiling after a new socket binds. */
  async publishBidLimit(roomCode: string, memberId: string): Promise<void> {
    const room = await this.#requireRoom(roomCode);
    const member = this.#requireMember(room, memberId);
    this.#publishBidLimit(room, member);
  }

  async getStoredRoom(roomCode: string): Promise<StoredRoom> {
    return this.#requireRoom(roomCode);
  }

  async eventLog(roomCode: string, afterSequence = 0): Promise<PersistedEvent[]> {
    await this.#requireRoom(roomCode);
    return this.#persistence.listEvents(roomCode, afterSequence);
  }

  async recoverActiveRooms(): Promise<Array<{ roomCode: string; nextWakeAt: number }>> {
    const rooms = await this.#persistence.listRooms();
    const active: Array<{ roomCode: string; nextWakeAt: number }> = [];
    for (const listedRoom of rooms) {
      let room = listedRoom;
      if (room.phase === 'PREPARING_DATA' && room.hiddenState === null) {
        room = await this.#cache.withLock(`room:${room.code}`, async () => {
          const current = await this.#requireRoom(room.code);
          if (current.phase === 'PREPARING_DATA' && current.hiddenState === null) {
            current.phase = 'LOBBY';
            await this.#commit(current, 'PREPARATION_RECOVERED', {
              reason: 'startup-without-engine-state',
            });
          }
          return current;
        });
      }
      if (room.hiddenState === null || ['LOBBY', 'COMPLETE'].includes(room.phase)) continue;
      const wake = this.#engine.nextWakeAt(room.hiddenState);
      if (wake !== null) active.push({ roomCode: room.code, nextWakeAt: wake });
    }
    return active;
  }

  /**
   * Socket.IO connection flags are process-external facts, so a clean process
   * restart cannot trust the last persisted `isConnected` value. Reconcile it
   * against the adapter-wide socket inventory before restoring host timers.
   *
   * A presence lease newer than this scan protects the narrow race where a
   * resume commits while the startup socket inventory is being collected but
   * has not bound its Socket.IO identity yet.
   */
  async reconcileStartupPresence(
    activeIdentities: readonly ActivePresenceIdentity[],
    scanStartedAt: number,
  ): Promise<void> {
    const active = new Set(
      activeIdentities.map(({ roomCode, memberId }) => `${roomCode}:${memberId}`),
    );
    const rooms = await this.#persistence.listRooms();
    for (const listedRoom of rooms) {
      if (!listedRoom.members.some((member) => member.isConnected)) continue;
      await this.#cache.withLock(`room:${listedRoom.code}`, async () => {
        const room = await this.#requireRoom(listedRoom.code);
        const disconnectedMemberIds: string[] = [];
        for (const member of room.members) {
          if (!member.isConnected || active.has(`${room.code}:${member.id}`)) continue;
          const lease = await this.#cache.get<PresenceLease>(presenceKey(room.code, member.id));
          if (lease !== null && lease.lastSeenAt >= scanStartedAt) continue;
          member.isConnected = false;
          member.disconnectedAt = scanStartedAt;
          disconnectedMemberIds.push(member.id);
        }
        if (disconnectedMemberIds.length === 0) return;
        await this.#commit(room, 'STARTUP_PRESENCE_RESET', {
          memberIds: disconnectedMemberIds,
          scanStartedAt,
        });
        this.#broadcastState(room);
      });
    }
  }

  async recoverHostTransfers(): Promise<
    Array<{ roomCode: string; hostMemberId: string; wakeAt: number }>
  > {
    const rooms = await this.#persistence.listRooms();
    return rooms.flatMap((room) => {
      const host = room.members.find(
        (member) => member.isHost && !member.isConnected && member.disconnectedAt !== null,
      );
      if (host === undefined || host.disconnectedAt === null) return [];
      return [
        {
          roomCode: room.code,
          hostMemberId: host.id,
          wakeAt: host.disconnectedAt + this.#hostTransferGraceMs,
        },
      ];
    });
  }

  async #mutateLobby(
    roomCode: string,
    memberId: string,
    work: (room: StoredRoom, member: StoredMember) => Promise<void>,
  ): Promise<RoomView> {
    return this.#cache.withLock(`room:${roomCode}`, async () => {
      const room = await this.#requireRoom(roomCode);
      if (room.phase !== 'LOBBY')
        throw new DomainError('LOBBY_CLOSED', 'Lobby settings are locked after kick-off.');
      const member = this.#requireMember(room, memberId);
      await work(room, member);
      this.#broadcastState(room);
      return roomView(room, this.#now());
    });
  }

  async #applyMutation(room: StoredRoom, mutation: EngineMutation): Promise<void> {
    room.hiddenState = structuredClone(mutation.state);
    room.phase = mutation.projection.phase;
    room.seedCommitment = mutation.projection.seedCommitment;
    room.currentLot = structuredClone(mutation.projection.currentLot);
    room.squads = structuredClone(mutation.projection.squads);
    room.auctionSequence = mutation.projection.auctionSequence;
    room.resolvedCycles = mutation.projection.resolvedCycles;
    room.totalCycles = mutation.projection.totalCycles;
    room.checkpoint = structuredClone(mutation.projection.checkpoint);
    room.evaluation = structuredClone(mutation.projection.evaluation);
    room.replay = structuredClone(mutation.projection.replay);
    for (const member of room.members.filter((entry) => !entry.isSpectator)) {
      const squad = room.squads.filter((entry) => entry.memberId === member.id);
      member.spentEUR = squad.reduce((total, entry) => total + entry.purchasePriceEUR, 0);
      member.budgetEUR = Math.max(0, room.settings.budgetEUR - member.spentEUR);
      member.emergencyAllocations = squad.filter(
        (entry) => entry.acquisition === 'EMERGENCY',
      ).length;
    }
    room.updatedAt = this.#now();
    if (['RESULTS', 'COMPLETE'].includes(room.phase) && room.completedAt === null) {
      room.completedAt = this.#now();
    }
    if (room.evaluation !== null && this.#narratives !== undefined) {
      try {
        const authoritative = room.evaluation;
        const proposed = await this.#narratives.enrich({
          roomCode: room.code,
          members: room.members.map(({ id, name }) => ({ id, name })),
          evaluation: authoritative,
        });
        room.evaluation = mergeEvaluationNarrative(authoritative, proposed);
      } catch {
        // Narrative enrichment is never allowed to reject or delay a valid
        // numerical result beyond the enricher's own bounded fallback.
      }
    }
  }

  #emitEffects(room: StoredRoom, effects: EngineEffect[]): void {
    for (const effect of effects) {
      const view = roomView(room, this.#now());
      switch (effect.type) {
        case 'GAME_PREPARED':
          this.#publisher.emit(room.code, 'game:prepared', view);
          break;
        case 'LOT_REVEALED':
          this.#publisher.emit(room.code, 'auction:reveal', { room: view, lot: effect.lot });
          break;
        case 'LOT_OPENED':
          this.#publisher.emit(room.code, 'auction:opened', { room: view, lot: effect.lot });
          if (effect.lot.endsAt !== null) {
            this.#publisher.emit(room.code, 'auction:timer', {
              roomCode: room.code,
              auctionSequence: effect.lot.sequence,
              endsAt: effect.lot.endsAt,
              serverNow: this.#now(),
            });
          }
          break;
        case 'BID_ACCEPTED':
          this.#publisher.emit(room.code, 'auction:bidAccepted', {
            roomCode: room.code,
            lot: effect.lot,
            bidderId: effect.memberId,
            amountEUR: effect.amountEUR,
          });
          if (effect.lot.endsAt !== null) {
            this.#publisher.emit(room.code, 'auction:timer', {
              roomCode: room.code,
              auctionSequence: effect.lot.sequence,
              endsAt: effect.lot.endsAt,
              serverNow: this.#now(),
            });
          }
          break;
        case 'LOT_SOLD':
          this.#publisher.emit(room.code, 'auction:sold', {
            room: view,
            lot: effect.lot,
            winnerId: effect.memberId,
            amountEUR: effect.amountEUR,
          });
          break;
        case 'LOT_UNSOLD':
          this.#publisher.emit(room.code, 'auction:unsold', { room: view, lot: effect.lot });
          break;
        case 'LOT_FORCED':
          this.#publisher.emit(room.code, 'auction:forced', {
            room: view,
            lot: effect.lot,
            memberId: effect.memberId,
            amountEUR: effect.amountEUR,
            emergency: effect.emergency,
          });
          break;
        case 'CHECKPOINT_STARTED':
          this.#publisher.emit(room.code, 'checkpoint:start', {
            roomCode: room.code,
            number: effect.number,
          });
          break;
        case 'CHECKPOINT_READY':
          this.#publisher.emit(room.code, 'checkpoint:result', view);
          break;
        case 'GAME_COMPLETE':
          this.#publisher.emit(room.code, 'game:complete', view);
          break;
        case 'EVALUATION_PROGRESS':
          this.#publisher.emit(room.code, 'evaluation:progress', {
            roomCode: room.code,
            progress: effect.progress,
          });
          break;
        case 'EVALUATION_COMPLETE':
          if (view.evaluation !== null) {
            this.#publisher.emit(room.code, 'evaluation:complete', {
              room: view,
              evaluation: view.evaluation,
            });
          }
          break;
      }
    }
  }

  #throwEngineError(
    error: { code: string; message: string; latestLot?: StoredRoom['currentLot'] } | undefined,
    room: StoredRoom,
  ): never {
    const latest = error?.latestLot ?? room.currentLot ?? undefined;
    const knownCodes = new Set([
      'STALE_AUCTION',
      'DUPLICATE_ACTION',
      'NOT_ELIGIBLE',
      'BID_TOO_LOW',
      'BUDGET_EXCEEDED',
      'AUCTION_CLOSED',
      'ALREADY_PASSED',
      'CONFLICT',
    ]);
    throw new DomainError(
      knownCodes.has(error?.code ?? '')
        ? (error!.code as ConstructorParameters<typeof DomainError>[0])
        : 'CONFLICT',
      error?.message ?? 'The auction state changed before that action arrived.',
      latest === null ? undefined : latest,
    );
  }

  #assertDirector(room: StoredRoom, memberId: string): StoredMember {
    const member = this.#requireMember(room, memberId);
    if (member.isSpectator)
      throw new DomainError('NOT_DIRECTOR', 'Spectators can watch but cannot act in auctions.');
    return member;
  }

  #assertBeforeDeadline(room: StoredRoom, now: number): void {
    const lot = room.currentLot;
    if (lot?.endsAt !== null && lot?.endsAt !== undefined && now >= lot.endsAt) {
      throw new DomainError('AUCTION_CLOSED', 'The gavel has already fallen on this card.', lot);
    }
  }

  #requireMember(room: StoredRoom, memberId: string): StoredMember {
    const member = room.members.find((entry) => entry.id === memberId);
    if (member === undefined)
      throw new DomainError('NOT_A_MEMBER', 'Join this room before taking that action.');
    return member;
  }

  async #requireRoom(roomCode: string): Promise<StoredRoom> {
    const room = await this.#persistence.get(roomCode);
    if (room === null) throw new DomainError('ROOM_NOT_FOUND', 'No room exists with that code.');
    return room;
  }

  async #uniqueRoomCode(): Promise<string> {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const code = this.#roomCode();
      if ((await this.#persistence.get(code)) === null) return code;
    }
    throw new DomainError('INTERNAL', 'Could not allocate a unique room code.');
  }

  async #markPresent(roomCode: string, memberId: string, lastSeenAt: number): Promise<void> {
    await this.#cache.set<PresenceLease>(
      presenceKey(roomCode, memberId),
      { lastSeenAt },
      PRESENCE_LEASE_TTL_MS,
    );
  }

  #session(room: StoredRoom, member: StoredMember): SessionPayload {
    return {
      sessionToken: this.#tokens.issue(room.code, member.id),
      memberId: member.id,
      room: roomView(room, this.#now()),
    };
  }

  async #commit(room: StoredRoom, type: string, payload: unknown): Promise<void> {
    room.eventSequence += 1;
    room.updatedAt = this.#now();
    await this.#persistence.commit(room, this.#event(room, type, payload));
  }

  #event(room: StoredRoom, type: string, payload: unknown): PersistedEvent {
    return {
      id: randomUUID(),
      roomCode: room.code,
      sequence: room.eventSequence,
      type,
      at: this.#now(),
      payload: structuredClone(payload),
    };
  }

  #broadcastState(room: StoredRoom): void {
    this.#publisher.emit(room.code, 'room:state', roomView(room, this.#now()));
    if (room.hiddenState === null || room.currentLot === null) return;
    for (const member of room.members) {
      this.#publishBidLimit(room, member);
    }
  }

  #publishBidLimit(room: StoredRoom, member: StoredMember): void {
    if (member.isSpectator || room.hiddenState === null || room.currentLot === null) return;
    this.#publisher.emitToMember(member.id, 'auction:limit', {
      roomCode: room.code,
      auctionSequence: room.auctionSequence,
      maxBidEUR: this.#engine.maximumLegalBid(room.hiddenState, member.id),
    });
  }

  #selectNewHost(room: StoredRoom): StoredMember | null {
    const replacement = room.members
      .filter((member) => member.isConnected && !member.isSpectator)
      .sort((left, right) => left.joinedAt - right.joinedAt || left.id.localeCompare(right.id))[0];
    if (replacement === undefined) return null;
    for (const member of room.members) member.isHost = false;
    replacement.isHost = true;
    return replacement;
  }
}
