import { PrismaClient } from '@prisma/client';
import type {
  AcquisitionKind,
  CandidateKind,
  Prisma,
  RoomPhase,
  PrismaClient as PrismaClientType,
} from '@prisma/client';
import type { CandidateSnapshot, ReplayEventView } from '@gavel-xi/shared';
import type { EngineState } from '@gavel-xi/game-engine';
import type { FrozenSnapshot, PersistedEvent, StoredRoom } from './domain.js';

export interface RoomRepository {
  create(room: StoredRoom, event?: PersistedEvent): Promise<void>;
  get(code: string): Promise<StoredRoom | null>;
  save(room: StoredRoom): Promise<void>;
  commit(room: StoredRoom, event: PersistedEvent): Promise<void>;
  listRooms(): Promise<StoredRoom[]>;
}

export interface EventRepository {
  append(event: PersistedEvent): Promise<void>;
  listEvents(roomCode: string, afterSequence?: number): Promise<PersistedEvent[]>;
}

export interface SnapshotRepository {
  putSnapshot(snapshot: FrozenSnapshot): Promise<void>;
  getSnapshot(id: string): Promise<FrozenSnapshot | null>;
  getLatestSnapshot(): Promise<FrozenSnapshot | null>;
}

export interface PersistenceAdapter extends RoomRepository, EventRepository, SnapshotRepository {
  connect?(): Promise<void>;
  close?(): Promise<void>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * The local adapter deliberately implements the same write-through boundaries as a
 * Postgres repository. It is deterministic, process-local, and suitable for tests
 * and zero-dependency development—not for horizontally scaled production.
 */
export class InMemoryPersistence implements PersistenceAdapter {
  readonly #rooms = new Map<string, StoredRoom>();
  readonly #events = new Map<string, PersistedEvent[]>();
  readonly #snapshots = new Map<string, FrozenSnapshot>();

  async create(room: StoredRoom, event?: PersistedEvent): Promise<void> {
    if (this.#rooms.has(room.code)) throw new Error(`Room ${room.code} already exists`);
    this.#rooms.set(room.code, clone(room));
    if (event !== undefined) await this.append(event);
  }

  async get(code: string): Promise<StoredRoom | null> {
    const room = this.#rooms.get(code);
    return room === undefined ? null : clone(room);
  }

  async save(room: StoredRoom): Promise<void> {
    this.#rooms.set(room.code, clone(room));
  }

  async commit(room: StoredRoom, event: PersistedEvent): Promise<void> {
    const existing = this.#rooms.get(room.code);
    if (existing === undefined) throw new Error(`Room ${room.code} does not exist`);
    if (existing.eventSequence !== event.sequence - 1) {
      throw new Error(`Room ${room.code} persistence revision conflict`);
    }
    const events = this.#events.get(event.roomCode) ?? [];
    if (events.some((entry) => entry.sequence === event.sequence)) return;
    this.#rooms.set(room.code, clone(room));
    events.push(clone(event));
    events.sort((left, right) => left.sequence - right.sequence);
    this.#events.set(event.roomCode, events);
  }

  async listRooms(): Promise<StoredRoom[]> {
    return [...this.#rooms.values()].map(clone);
  }

  async append(event: PersistedEvent): Promise<void> {
    const events = this.#events.get(event.roomCode) ?? [];
    if (events.some((existing) => existing.sequence === event.sequence)) return;
    events.push(clone(event));
    events.sort((left, right) => left.sequence - right.sequence);
    this.#events.set(event.roomCode, events);
  }

  async listEvents(roomCode: string, afterSequence = 0): Promise<PersistedEvent[]> {
    return (this.#events.get(roomCode) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .map(clone);
  }

  async putSnapshot(snapshot: FrozenSnapshot): Promise<void> {
    this.#snapshots.set(snapshot.id, clone(snapshot));
  }

  async getSnapshot(id: string): Promise<FrozenSnapshot | null> {
    const snapshot = this.#snapshots.get(id);
    return snapshot === undefined ? null : clone(snapshot);
  }

  async getLatestSnapshot(): Promise<FrozenSnapshot | null> {
    const snapshots = [...this.#snapshots.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    return snapshots[0] === undefined ? null : clone(snapshots[0]);
  }

  async close(): Promise<void> {
    // The process-local adapter owns no external resources.
  }
}

/** Exported for focused adapter tests and dependency injection. */
export type PrismaPersistenceClient = PrismaClientType;

export interface PrismaPersistenceOptions {
  connectionString?: string;
  client?: PrismaPersistenceClient;
  /** Defaults to true only when the adapter creates the client. */
  ownsClient?: boolean;
}

export class PersistenceConflictError extends Error {
  constructor(readonly roomCode: string) {
    super(`Room ${roomCode} was changed by another server process`);
    this.name = 'PersistenceConflictError';
  }
}

interface RoomWrite {
  code: string;
  title: string;
  phase: RoomPhase;
  revision: number;
  state: Prisma.InputJsonValue;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

interface SnapshotWrite {
  id: string;
  provider: string;
  createdAt: Date;
  sourceUpdatedAt: Date;
  payload: Prisma.InputJsonValue;
}

function invalidJson(label: string, detail: string, cause?: unknown): TypeError {
  return new TypeError(`${label} is not safely JSON serializable: ${detail}`, { cause });
}

/**
 * Prisma's Json input type deliberately rejects non-JSON values. Round-tripping here
 * prevents undefined, bigint, non-finite numbers, functions, or cycles from being
 * silently changed by the database driver.
 */
function jsonClone(value: unknown, label: string): unknown {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (_key, entry: unknown) => {
      if (entry === undefined) throw invalidJson(label, 'undefined values are not supported');
      if (typeof entry === 'bigint') throw invalidJson(label, 'bigint values are not supported');
      if (typeof entry === 'function' || typeof entry === 'symbol') {
        throw invalidJson(label, `${typeof entry} values are not supported`);
      }
      if (typeof entry === 'number' && !Number.isFinite(entry)) {
        throw invalidJson(label, 'non-finite numbers are not supported');
      }
      return entry;
    });
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(`${label} is not safely`)) {
      throw error;
    }
    throw invalidJson(label, 'serialization failed', error);
  }
  if (serialized === undefined) throw invalidJson(label, 'the top-level value is undefined');
  try {
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    throw invalidJson(label, 'round-trip parsing failed', error);
  }
}

function encodedDocument(value: unknown, label: string): string {
  return JSON.stringify(jsonClone(value, label));
}

function decodedDocument(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return jsonClone(value, label);
  try {
    return jsonClone(JSON.parse(value) as unknown, label);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(`${label} is not safely`)) {
      throw error;
    }
    throw invalidJson(label, 'stored document parsing failed', error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeRoom(value: unknown): StoredRoom {
  const room = decodedDocument(value, 'StoredRoom payload');
  if (
    !isRecord(room) ||
    typeof room.code !== 'string' ||
    typeof room.title !== 'string' ||
    typeof room.phase !== 'string' ||
    !isRecord(room.settings) ||
    !Array.isArray(room.members) ||
    !Array.isArray(room.squads) ||
    !Array.isArray(room.replay) ||
    typeof room.eventSequence !== 'number' ||
    typeof room.createdAt !== 'number' ||
    typeof room.updatedAt !== 'number'
  ) {
    throw new TypeError('StoredRoom payload is malformed');
  }
  return room as unknown as StoredRoom;
}

function decodeSnapshot(value: unknown): FrozenSnapshot {
  const snapshot = decodedDocument(value, 'FrozenSnapshot payload');
  if (
    !isRecord(snapshot) ||
    typeof snapshot.id !== 'string' ||
    typeof snapshot.provider !== 'string' ||
    typeof snapshot.createdAt !== 'string' ||
    typeof snapshot.sourceUpdatedAt !== 'string' ||
    !Array.isArray(snapshot.candidates)
  ) {
    throw new TypeError('FrozenSnapshot payload is malformed');
  }
  return snapshot as unknown as FrozenSnapshot;
}

function requiredDate(value: number | string, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} is not a valid date`);
  return date;
}

function roomWrite(room: StoredRoom): RoomWrite {
  return {
    code: room.code,
    title: room.title,
    phase: room.phase as RoomPhase,
    revision: room.eventSequence,
    // Store the canonical document as a JSON string inside JSONB. PostgreSQL's
    // JSONB numeric normalization can otherwise alter an IEEE-754 value's textual
    // round trip (important for deterministic seeded engine priorities).
    state: encodedDocument(room, 'StoredRoom payload'),
    createdAt: requiredDate(room.createdAt, 'StoredRoom.createdAt'),
    updatedAt: requiredDate(room.updatedAt, 'StoredRoom.updatedAt'),
    completedAt:
      room.completedAt === null ? null : requiredDate(room.completedAt, 'StoredRoom.completedAt'),
  };
}

function snapshotWrite(snapshot: FrozenSnapshot): SnapshotWrite {
  return {
    id: snapshot.id,
    provider: snapshot.provider,
    createdAt: requiredDate(snapshot.createdAt, 'FrozenSnapshot.createdAt'),
    sourceUpdatedAt: requiredDate(snapshot.sourceUpdatedAt, 'FrozenSnapshot.sourceUpdatedAt'),
    payload: encodedDocument(snapshot, 'FrozenSnapshot payload'),
  };
}

function eventPayload(payload: unknown): Prisma.InputJsonValue {
  // The envelope permits a JSON null payload without relying on Prisma's DbNull/JsonNull sentinels.
  return encodedDocument({ value: payload }, 'PersistedEvent payload');
}

function gameId(roomCode: string): string {
  return `game-${roomCode}`;
}

function cycleRowId(id: string, engineCycleId: string): string {
  return `${id}:cycle:${engineCycleId}`;
}

function candidateRowId(id: string, canonicalId: string): string {
  return `${id}:candidate:${canonicalId}`;
}

function lotRowId(id: string, engineLotId: string): string {
  return `${id}:lot:${engineLotId}`;
}

function squadRowId(id: string, engineEntryId: string): string {
  return `${id}:squad:${engineEntryId}`;
}

function snapshotRowId(snapshotId: string, candidate: CandidateSnapshot): string {
  return `${candidate.kind.toLowerCase()}-${snapshotId}-${candidate.id}`;
}

function hiddenEngineState(room: StoredRoom): EngineState | null {
  if (!isRecord(room.hiddenState) || room.hiddenState.version !== 1) return null;
  const state = room.hiddenState as unknown as EngineState;
  return Array.isArray(state.cycles) && Array.isArray(state.squads) ? state : null;
}

function replayOutcome(event: ReplayEventView): string | null {
  if (['SOLD', 'UNSOLD', 'FORCED', 'EMERGENCY'].includes(event.type)) return event.type;
  return null;
}

/**
 * Projects the complete room aggregate into the normalized relational tables in
 * one transaction. JSON remains the recovery authority; these rows support
 * operational queries, analytics, and durable bid/squad/result history.
 */
async function projectRoom(transaction: Prisma.TransactionClient, room: StoredRoom): Promise<void> {
  const roomRow = await transaction.room.findUnique({
    where: { code: room.code },
    select: { id: true },
  });
  if (roomRow === null) throw new Error(`Room ${room.code} projection has no parent row`);

  const activeMemberIds = new Set(room.members.map((member) => member.id));
  await transaction.roomMember.deleteMany({
    where: { roomId: roomRow.id, id: { notIn: [...activeMemberIds] } },
  });
  for (const member of room.members) {
    await transaction.roomMember.upsert({
      where: { id: member.id },
      create: {
        id: member.id,
        roomId: roomRow.id,
        displayName: member.name,
        avatar: member.avatar,
        color: member.color,
        isHost: member.isHost,
        isReady: member.isReady,
        isSpectator: member.isSpectator,
        joinedAt: requiredDate(member.joinedAt, 'StoredMember.joinedAt'),
        lastSeenAt: requiredDate(member.lastSeenAt, 'StoredMember.lastSeenAt'),
        budgetEUR: BigInt(member.budgetEUR),
        spentEUR: BigInt(member.spentEUR),
        emergencyAllocations: member.emergencyAllocations,
      },
      update: {
        displayName: member.name,
        avatar: member.avatar,
        color: member.color,
        isHost: member.isHost,
        isReady: member.isReady,
        isSpectator: member.isSpectator,
        lastSeenAt: requiredDate(member.lastSeenAt, 'StoredMember.lastSeenAt'),
        budgetEUR: BigInt(member.budgetEUR),
        spentEUR: BigInt(member.spentEUR),
        emergencyAllocations: member.emergencyAllocations,
      },
    });
  }

  const state = hiddenEngineState(room);
  if (state === null || room.snapshotId === null || room.seedCommitment === null) return;
  const id = gameId(room.code);
  await transaction.game.upsert({
    where: { roomId: roomRow.id },
    create: {
      id,
      roomId: roomRow.id,
      seedCommitment: room.seedCommitment,
      revealedSeed: ['RESULTS', 'COMPLETE'].includes(room.phase) ? room.seed : null,
      snapshotId: room.snapshotId,
      auctionSequence: room.auctionSequence,
      resolvedCycles: room.resolvedCycles,
      hiddenState: jsonClone(room.hiddenState, 'EngineState payload') as Prisma.InputJsonValue,
      createdAt: requiredDate(room.createdAt, 'StoredRoom.createdAt'),
      completedAt:
        room.completedAt === null ? null : requiredDate(room.completedAt, 'StoredRoom.completedAt'),
    },
    update: {
      seedCommitment: room.seedCommitment,
      revealedSeed: ['RESULTS', 'COMPLETE'].includes(room.phase) ? room.seed : null,
      snapshotId: room.snapshotId,
      auctionSequence: room.auctionSequence,
      resolvedCycles: room.resolvedCycles,
      hiddenState: jsonClone(room.hiddenState, 'EngineState payload') as Prisma.InputJsonValue,
      completedAt:
        room.completedAt === null ? null : requiredDate(room.completedAt, 'StoredRoom.completedAt'),
    },
  });
  await transaction.gameSettings.upsert({
    where: { gameId: id },
    create: {
      gameId: id,
      formationName: room.settings.formation,
      budgetEUR: BigInt(room.settings.budgetEUR),
      bidIncrementEUR: BigInt(room.settings.bidIncrementEUR),
      auctionTimerSeconds: room.settings.auctionTimerSeconds,
      revealSeconds: room.settings.revealSeconds,
      antiSnipeSeconds: room.settings.antiSnipeSeconds,
      soundEnabled: room.settings.soundEnabled,
      budgetMode: room.settings.budgetMode,
      formLookback: room.settings.formLookback,
    },
    update: {
      formationName: room.settings.formation,
      budgetEUR: BigInt(room.settings.budgetEUR),
      bidIncrementEUR: BigInt(room.settings.bidIncrementEUR),
      auctionTimerSeconds: room.settings.auctionTimerSeconds,
      revealSeconds: room.settings.revealSeconds,
      antiSnipeSeconds: room.settings.antiSnipeSeconds,
      soundEnabled: room.settings.soundEnabled,
      budgetMode: room.settings.budgetMode,
      formLookback: room.settings.formLookback,
    },
  });
  await transaction.formation.upsert({
    where: { name: state.formation.name },
    create: {
      name: state.formation.name,
      slotsJson: jsonClone(state.formation.slots, 'Formation slots') as Prisma.InputJsonValue,
    },
    update: {
      slotsJson: jsonClone(state.formation.slots, 'Formation slots') as Prisma.InputJsonValue,
    },
  });

  for (const [cycleOrder, cycle] of state.cycles.entries()) {
    const cycleId = cycleRowId(id, cycle.id);
    await transaction.positionCycle.upsert({
      where: { id: cycleId },
      create: {
        id: cycleId,
        gameId: id,
        position: cycle.position,
        slotIndex: cycle.cycleIndex,
        revealOrder: cycleOrder,
        resolved: cycle.resolved,
      },
      update: {
        position: cycle.position,
        slotIndex: cycle.cycleIndex,
        revealOrder: cycleOrder,
        resolved: cycle.resolved,
      },
    });
    for (const [revealIndex, poolCandidate] of cycle.candidates.entries()) {
      const candidate = poolCandidate.candidate;
      const playerSnapshotId =
        candidate.kind === 'PLAYER' ? snapshotRowId(room.snapshotId, candidate) : null;
      const managerSnapshotId =
        candidate.kind === 'MANAGER' ? snapshotRowId(room.snapshotId, candidate) : null;
      await transaction.candidate.upsert({
        where: { id: candidateRowId(id, candidate.id) },
        create: {
          id: candidateRowId(id, candidate.id),
          cycleId,
          kind: candidate.kind as CandidateKind,
          playerSnapshotId,
          managerSnapshotId,
          tier: poolCandidate.tier,
          openingBidEUR: BigInt(poolCandidate.openingBidEUR),
          revealIndex,
        },
        update: {
          cycleId,
          kind: candidate.kind as CandidateKind,
          playerSnapshotId,
          managerSnapshotId,
          tier: poolCandidate.tier,
          openingBidEUR: BigInt(poolCandidate.openingBidEUR),
          revealIndex,
        },
      });
    }
  }

  interface ProjectedLot {
    id: string;
    sequence: number;
    candidateId: string;
    openingBidEUR: number;
    originalOpeningBidEUR: number;
    returnCount: number;
    openedAt: number | null;
    endsAt: number | null;
    resolvedAt: number | null;
    outcome: string | null;
    winnerMemberId: string | null;
    soldPriceEUR: number | null;
  }
  const pool = state.cycles.flatMap((cycle) => cycle.candidates);
  const lots: ProjectedLot[] = [];
  const bids: Array<{ event: ReplayEventView; lotId: string; sequence: number }> = [];
  const returnCounts = new Map<string, number>();
  let activeLot: ProjectedLot | null = null;
  const startLot = (event: ReplayEventView, outcome: string | null = null): ProjectedLot | null => {
    if (event.candidateId === undefined) return null;
    const poolCandidate = pool.find(({ candidate }) => candidate.id === event.candidateId);
    if (poolCandidate === undefined) return null;
    const sequence = lots.length + 1;
    const returnCount = returnCounts.get(event.candidateId) ?? 0;
    const current = room.currentLot?.candidate.id === event.candidateId ? room.currentLot : null;
    const projected: ProjectedLot = {
      id: lotRowId(id, `${sequence}-${event.candidateId}`),
      sequence,
      candidateId: event.candidateId,
      openingBidEUR:
        current?.openingBidEUR ??
        (returnCount > 0 ? poolCandidate.openingBidEUR / 2 : poolCandidate.openingBidEUR),
      originalOpeningBidEUR: current?.originalOpeningBidEUR ?? poolCandidate.openingBidEUR,
      returnCount: current?.returnCount ?? returnCount,
      openedAt: current?.openedAt ?? null,
      endsAt: current?.endsAt ?? null,
      resolvedAt: outcome === null ? null : event.at,
      outcome,
      winnerMemberId: event.memberId ?? current?.currentLeaderId ?? null,
      soldPriceEUR: event.amountEUR ?? current?.currentBidEUR ?? null,
    };
    lots.push(projected);
    return projected;
  };
  for (const event of [...room.replay].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === 'REVEAL') {
      activeLot = startLot(event);
      continue;
    }
    if (['FORCED', 'EMERGENCY'].includes(event.type)) {
      activeLot = startLot(event, event.type);
      continue;
    }
    if (activeLot === null || event.candidateId !== activeLot.candidateId) continue;
    if (event.type === 'OPENED') activeLot.openedAt = event.at;
    if (event.type === 'BID' && event.memberId !== undefined && event.amountEUR !== undefined) {
      bids.push({ event, lotId: activeLot.id, sequence: activeLot.sequence });
      activeLot.winnerMemberId = event.memberId;
      activeLot.soldPriceEUR = event.amountEUR;
    }
    const outcome = replayOutcome(event);
    if (outcome !== null) {
      activeLot.outcome = outcome;
      activeLot.resolvedAt = event.at;
      activeLot.winnerMemberId = event.memberId ?? activeLot.winnerMemberId;
      activeLot.soldPriceEUR = event.amountEUR ?? activeLot.soldPriceEUR;
      if (outcome === 'UNSOLD') {
        returnCounts.set(activeLot.candidateId, activeLot.returnCount + 1);
      }
    }
  }
  if (lots.length === 0 && room.currentLot !== null) {
    startLot({
      id: `projection-${room.currentLot.id}`,
      at: room.currentLot.openedAt ?? room.updatedAt,
      sequence: 1,
      type: 'REVEAL',
      title: 'CARD REVEALED',
      detail: room.currentLot.candidate.commonName,
      candidateId: room.currentLot.candidate.id,
    });
  }
  for (const lot of lots) {
    await transaction.auctionLot.upsert({
      where: { id: lot.id },
      create: {
        id: lot.id,
        gameId: id,
        candidateId: candidateRowId(id, lot.candidateId),
        sequence: lot.sequence,
        openingBidEUR: BigInt(lot.openingBidEUR),
        originalOpeningBidEUR: BigInt(lot.originalOpeningBidEUR),
        returnCount: lot.returnCount,
        openedAt: lot.openedAt === null ? null : requiredDate(lot.openedAt, 'AuctionLot.openedAt'),
        endsAt: lot.endsAt === null ? null : requiredDate(lot.endsAt, 'AuctionLot.endsAt'),
        resolvedAt:
          lot.resolvedAt === null ? null : requiredDate(lot.resolvedAt, 'AuctionLot.resolvedAt'),
        outcome: lot.outcome,
        winnerMemberId: lot.winnerMemberId,
        soldPriceEUR: lot.soldPriceEUR === null ? null : BigInt(lot.soldPriceEUR),
      },
      update: {
        openingBidEUR: BigInt(lot.openingBidEUR),
        originalOpeningBidEUR: BigInt(lot.originalOpeningBidEUR),
        returnCount: lot.returnCount,
        openedAt: lot.openedAt === null ? null : requiredDate(lot.openedAt, 'AuctionLot.openedAt'),
        endsAt: lot.endsAt === null ? null : requiredDate(lot.endsAt, 'AuctionLot.endsAt'),
        resolvedAt:
          lot.resolvedAt === null ? null : requiredDate(lot.resolvedAt, 'AuctionLot.resolvedAt'),
        outcome: lot.outcome,
        winnerMemberId: lot.winnerMemberId,
        soldPriceEUR: lot.soldPriceEUR === null ? null : BigInt(lot.soldPriceEUR),
      },
    });
    if (lot.outcome === 'UNSOLD') {
      await transaction.unsoldEntry.upsert({
        where: { lotId: lot.id },
        create: {
          lotId: lot.id,
          returnReserveEUR: BigInt(lot.originalOpeningBidEUR / 2),
          returnCount: lot.returnCount + 1,
          requeuedAt: requiredDate(lot.resolvedAt ?? room.updatedAt, 'UnsoldEntry.requeuedAt'),
        },
        update: {
          returnReserveEUR: BigInt(lot.originalOpeningBidEUR / 2),
          returnCount: lot.returnCount + 1,
          requeuedAt: requiredDate(lot.resolvedAt ?? room.updatedAt, 'UnsoldEntry.requeuedAt'),
        },
      });
    }
  }

  for (const { event, lotId, sequence } of bids) {
    await transaction.bid.upsert({
      where: { idempotencyKey: `replay:${id}:${event.id}` },
      create: {
        id: `${id}:bid:${event.id}`,
        lotId,
        memberId: event.memberId!,
        amountEUR: BigInt(event.amountEUR!),
        auctionSequence: sequence,
        idempotencyKey: `replay:${id}:${event.id}`,
        accepted: true,
        createdAt: requiredDate(event.at, 'Bid.createdAt'),
      },
      update: {
        amountEUR: BigInt(event.amountEUR!),
        accepted: true,
      },
    });
  }

  for (const event of room.replay) {
    await transaction.gameEvent.upsert({
      where: { gameId_sequence: { gameId: id, sequence: event.sequence } },
      create: {
        id: `${id}:event:${event.id}`,
        gameId: id,
        sequence: event.sequence,
        type: event.type,
        payload: jsonClone(event, 'GameEvent payload') as Prisma.InputJsonValue,
        at: requiredDate(event.at, 'GameEvent.at'),
      },
      update: {
        type: event.type,
        payload: jsonClone(event, 'GameEvent payload') as Prisma.InputJsonValue,
        at: requiredDate(event.at, 'GameEvent.at'),
      },
    });
  }

  for (const entry of room.squads) {
    const entryId = squadRowId(id, entry.id);
    await transaction.squadEntry.upsert({
      where: { id: entryId },
      create: {
        id: entryId,
        gameId: id,
        memberId: entry.memberId,
        cycleId: cycleRowId(id, entry.cycleId),
        slotId: entry.slotId,
        candidateId: candidateRowId(id, entry.candidate.id),
        purchasePriceEUR: BigInt(entry.purchasePriceEUR),
        marketValueEUR: entry.marketValueEUR === null ? null : BigInt(entry.marketValueEUR),
        acquisition: entry.acquisition as AcquisitionKind,
        acquiredAt: requiredDate(entry.acquiredAt, 'SquadEntry.acquiredAt'),
      },
      update: {
        memberId: entry.memberId,
        cycleId: cycleRowId(id, entry.cycleId),
        slotId: entry.slotId,
        purchasePriceEUR: BigInt(entry.purchasePriceEUR),
        marketValueEUR: entry.marketValueEUR === null ? null : BigInt(entry.marketValueEUR),
        acquisition: entry.acquisition as AcquisitionKind,
        acquiredAt: requiredDate(entry.acquiredAt, 'SquadEntry.acquiredAt'),
      },
    });
    await transaction.budgetLedger.upsert({
      where: { id: `ledger-${entryId}` },
      create: {
        id: `ledger-${entryId}`,
        memberId: entry.memberId,
        amountEUR: -BigInt(entry.purchasePriceEUR),
        balanceEUR: BigInt(
          room.members.find((member) => member.id === entry.memberId)?.budgetEUR ?? 0,
        ),
        reason: entry.acquisition,
        referenceId: entryId,
        createdAt: requiredDate(entry.acquiredAt, 'BudgetLedger.createdAt'),
      },
      update: {
        amountEUR: -BigInt(entry.purchasePriceEUR),
        balanceEUR: BigInt(
          room.members.find((member) => member.id === entry.memberId)?.budgetEUR ?? 0,
        ),
        reason: entry.acquisition,
      },
    });
  }

  if (room.checkpoint !== null) {
    await transaction.checkpoint.upsert({
      where: { gameId_checkpointNo: { gameId: id, checkpointNo: room.checkpoint.number } },
      create: {
        gameId: id,
        checkpointNo: room.checkpoint.number,
        resolvedCycles: room.checkpoint.resolvedCycles,
        payload: jsonClone(room.checkpoint, 'Checkpoint payload') as Prisma.InputJsonValue,
      },
      update: {
        resolvedCycles: room.checkpoint.resolvedCycles,
        payload: jsonClone(room.checkpoint, 'Checkpoint payload') as Prisma.InputJsonValue,
      },
    });
  }
  if (room.evaluation !== null) {
    const evaluation = await transaction.evaluation.upsert({
      where: { gameId: id },
      create: {
        gameId: id,
        overallJson: jsonClone(room.evaluation, 'Evaluation payload') as Prisma.InputJsonValue,
      },
      update: {
        overallJson: jsonClone(room.evaluation, 'Evaluation payload') as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    for (const metric of room.evaluation.metrics) {
      await transaction.metricScore.upsert({
        where: {
          evaluationId_metricIndex: { evaluationId: evaluation.id, metricIndex: metric.index },
        },
        create: {
          evaluationId: evaluation.id,
          metricIndex: metric.index,
          category: metric.category,
          metricName: metric.metric,
          scores: jsonClone(metric.scores, 'Metric scores') as Prisma.InputJsonValue,
          winnerIds: jsonClone(metric.winnerIds, 'Metric winners') as Prisma.InputJsonValue,
        },
        update: {
          category: metric.category,
          metricName: metric.metric,
          scores: jsonClone(metric.scores, 'Metric scores') as Prisma.InputJsonValue,
          winnerIds: jsonClone(metric.winnerIds, 'Metric winners') as Prisma.InputJsonValue,
        },
      });
    }
    await transaction.award.deleteMany({ where: { evaluationId: evaluation.id } });
    if (room.evaluation.awards.length > 0) {
      await transaction.award.createMany({
        data: room.evaluation.awards.map((award) => ({ evaluationId: evaluation.id, ...award })),
      });
    }
  }
}

/** PostgreSQL persistence backed by the Prisma schema in ../prisma/schema.prisma. */
export class PrismaPersistence implements PersistenceAdapter {
  readonly #client: PrismaPersistenceClient;
  readonly #ownsClient: boolean;
  #connected = false;
  #closed = false;

  constructor(options: PrismaPersistenceOptions = {}) {
    this.#client =
      options.client ??
      (new PrismaClient(
        options.connectionString === undefined
          ? undefined
          : { datasourceUrl: options.connectionString },
      ) as unknown as PrismaPersistenceClient);
    this.#ownsClient = options.ownsClient ?? options.client === undefined;
  }

  async connect(): Promise<void> {
    if (this.#closed) throw new Error('PRISMA_PERSISTENCE_CLOSED');
    if (this.#connected) return;
    await this.#client.$connect();
    this.#connected = true;
  }

  async create(room: StoredRoom, event?: PersistedEvent): Promise<void> {
    if (event !== undefined && event.sequence !== room.eventSequence) {
      throw new Error('The initial event sequence must match the room revision');
    }
    await this.#client.$transaction(async (transaction) => {
      await transaction.room.create({ data: roomWrite(room) });
      await projectRoom(transaction, room);
      if (event !== undefined) await this.#appendWith(transaction, event);
    });
  }

  async get(code: string): Promise<StoredRoom | null> {
    const row = await this.#client.room.findUnique({ where: { code }, select: { state: true } });
    return row === null ? null : decodeRoom(row.state);
  }

  async save(room: StoredRoom): Promise<void> {
    const write = roomWrite(room);
    await this.#client.$transaction(async (transaction) => {
      const updated = await transaction.room.updateMany({
        // Administrative/non-event writes are permitted only at the exact known
        // event revision. Runtime authoritative mutations use commit() below.
        where: { code: room.code, revision: room.eventSequence },
        data: {
          title: write.title,
          phase: write.phase,
          revision: write.revision,
          state: write.state,
          updatedAt: write.updatedAt,
          completedAt: write.completedAt,
        },
      });
      if (updated.count !== 1) throw new PersistenceConflictError(room.code);
      await projectRoom(transaction, room);
    });
  }

  async commit(room: StoredRoom, event: PersistedEvent): Promise<void> {
    if (event.roomCode !== room.code || event.sequence !== room.eventSequence) {
      throw new Error('Committed event does not match the StoredRoom revision');
    }
    const write = roomWrite(room);
    await this.#client.$transaction(async (transaction) => {
      const updated = await transaction.room.updateMany({
        where: { code: room.code, revision: event.sequence - 1 },
        data: {
          title: write.title,
          phase: write.phase,
          revision: write.revision,
          state: write.state,
          updatedAt: write.updatedAt,
          completedAt: write.completedAt,
        },
      });
      if (updated.count !== 1) throw new PersistenceConflictError(room.code);
      await projectRoom(transaction, room);
      await this.#appendWith(transaction, event);
    });
  }

  async listRooms(): Promise<StoredRoom[]> {
    const rows = await this.#client.room.findMany({
      select: { state: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => decodeRoom(row.state));
  }

  async append(event: PersistedEvent): Promise<void> {
    await this.#appendWith(this.#client, event);
  }

  async #appendWith(
    client: Pick<PrismaPersistenceClient, 'roomEvent'> | Prisma.TransactionClient,
    event: PersistedEvent,
  ): Promise<void> {
    await client.roomEvent.upsert({
      where: {
        roomCode_sequence: { roomCode: event.roomCode, sequence: event.sequence },
      },
      create: {
        id: event.id,
        roomCode: event.roomCode,
        sequence: event.sequence,
        type: event.type,
        at: requiredDate(event.at, 'PersistedEvent.at'),
        payload: eventPayload(event.payload),
      },
      update: {},
    });
  }

  async listEvents(roomCode: string, afterSequence = 0): Promise<PersistedEvent[]> {
    const rows = await this.#client.roomEvent.findMany({
      where: { roomCode, sequence: { gt: afterSequence } },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        roomCode: true,
        sequence: true,
        type: true,
        at: true,
        payload: true,
      },
    });
    return rows.map((row) => {
      const envelope = decodedDocument(row.payload, 'PersistedEvent payload');
      if (!isRecord(envelope) || !Object.hasOwn(envelope, 'value')) {
        throw new TypeError(`PersistedEvent ${row.id} payload is malformed`);
      }
      return {
        id: row.id,
        roomCode: row.roomCode,
        sequence: row.sequence,
        type: row.type,
        at: row.at.getTime(),
        payload: envelope.value,
      };
    });
  }

  async putSnapshot(snapshot: FrozenSnapshot): Promise<void> {
    const write = snapshotWrite(snapshot);
    await this.#client.$transaction(async (transaction) => {
      await transaction.dataSnapshot.upsert({
        where: { id: snapshot.id },
        create: write,
        update: {
          provider: write.provider,
          createdAt: write.createdAt,
          sourceUpdatedAt: write.sourceUpdatedAt,
          payload: write.payload,
        },
      });
      for (const candidate of snapshot.candidates) {
        const rowId = snapshotRowId(snapshot.id, candidate);
        const valuation = candidate.valuation;
        if (candidate.kind === 'PLAYER') {
          await transaction.playerSnapshot.upsert({
            where: {
              snapshotId_canonicalId: { snapshotId: snapshot.id, canonicalId: candidate.id },
            },
            create: {
              id: rowId,
              snapshotId: snapshot.id,
              canonicalId: candidate.id,
              payload: jsonClone(candidate, 'PlayerSnapshot payload') as Prisma.InputJsonValue,
              valuationValue:
                valuation.valueEUR === null ? null : BigInt(Math.round(valuation.valueEUR)),
              valuationType: valuation.type,
              valuationSource: valuation.source,
            },
            update: {
              payload: jsonClone(candidate, 'PlayerSnapshot payload') as Prisma.InputJsonValue,
              valuationValue:
                valuation.valueEUR === null ? null : BigInt(Math.round(valuation.valueEUR)),
              valuationType: valuation.type,
              valuationSource: valuation.source,
            },
          });
        } else {
          await transaction.managerSnapshot.upsert({
            where: {
              snapshotId_canonicalId: { snapshotId: snapshot.id, canonicalId: candidate.id },
            },
            create: {
              id: rowId,
              snapshotId: snapshot.id,
              canonicalId: candidate.id,
              payload: jsonClone(candidate, 'ManagerSnapshot payload') as Prisma.InputJsonValue,
              reserveEstimate:
                valuation.valueEUR === null ? null : BigInt(Math.round(valuation.valueEUR)),
              valuationType: valuation.type,
              valuationSource: valuation.source,
            },
            update: {
              payload: jsonClone(candidate, 'ManagerSnapshot payload') as Prisma.InputJsonValue,
              reserveEstimate:
                valuation.valueEUR === null ? null : BigInt(Math.round(valuation.valueEUR)),
              valuationType: valuation.type,
              valuationSource: valuation.source,
            },
          });
        }
      }
    });
  }

  async getSnapshot(id: string): Promise<FrozenSnapshot | null> {
    const row = await this.#client.dataSnapshot.findUnique({
      where: { id },
      select: { payload: true },
    });
    return row === null ? null : decodeSnapshot(row.payload);
  }

  async getLatestSnapshot(): Promise<FrozenSnapshot | null> {
    const row = await this.#client.dataSnapshot.findFirst({
      select: { payload: true },
      orderBy: { createdAt: 'desc' },
    });
    return row === null ? null : decodeSnapshot(row.payload);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#ownsClient) await this.#client.$disconnect();
    this.#connected = false;
  }
}

export type PostgresPersistence = PrismaPersistence;
