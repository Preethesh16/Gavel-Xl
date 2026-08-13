import type { PublicLot, RoomMemberView, RoomView } from '@gavel-xi/shared';
import type { StoredLot, StoredMember, StoredRoom } from './domain.js';

const FORMATION_SLOT_COUNTS: Record<StoredRoom['settings']['formation'], number> = {
  '4-2-1-3': 11,
  '4-3-3': 11,
  '4-2-3-1': 11,
  '4-4-2': 11,
  '3-4-2-1': 11,
  '3-5-2': 11,
  '5-2-1-2': 11,
};

export function publicLot(lot: StoredLot | null): PublicLot | null {
  return lot === null ? null : structuredClone(lot);
}

export function memberView(room: StoredRoom, member: StoredMember): RoomMemberView {
  const filledSlots = room.squads.filter((entry) => entry.memberId === member.id).length;
  return {
    id: member.id,
    name: member.name,
    avatar: member.avatar,
    color: member.color,
    isHost: member.isHost,
    isReady: member.isReady,
    isConnected: member.isConnected,
    isSpectator: member.isSpectator,
    joinedAt: member.joinedAt,
    budgetEUR: member.budgetEUR,
    spentEUR: member.spentEUR,
    emergencyAllocations: member.emergencyAllocations,
    filledSlots,
    totalSlots: member.isSpectator ? 0 : FORMATION_SLOT_COUNTS[room.settings.formation] + 1,
  };
}

/** The only ordinary-client serialization path. hiddenState and unrevealed seed never cross it. */
export function roomView(room: StoredRoom, serverNow = Date.now()): RoomView {
  const seedVisible = ['RESULTS', 'COMPLETE'].includes(room.phase);
  return {
    code: room.code,
    title: room.title,
    phase: room.phase,
    isPaused:
      room.hiddenState !== null &&
      (room.hiddenState as { pausedAt?: number | null }).pausedAt != null,
    settings: structuredClone(room.settings),
    members: room.members.map((member) => memberView(room, member)),
    seedCommitment: room.seedCommitment,
    seed: seedVisible ? room.seed : null,
    snapshotId: room.snapshotId,
    snapshotUpdatedAt: room.snapshotUpdatedAt,
    currentLot: publicLot(room.currentLot),
    squads: structuredClone(room.squads),
    auctionSequence: room.auctionSequence,
    resolvedCycles: room.resolvedCycles,
    totalCycles: room.totalCycles,
    checkpoint: structuredClone(room.checkpoint),
    evaluation: structuredClone(room.evaluation),
    replay: structuredClone(room.replay),
    serverNow,
  };
}

export interface DebugRoomView {
  room: StoredRoom;
  warnings: string[];
}

export function debugRoomView(room: StoredRoom): DebugRoomView {
  return {
    room: structuredClone(room),
    warnings: [
      'Contains game seed and hidden candidate state.',
      'This representation must never be exposed when NODE_ENV=production.',
    ],
  };
}
