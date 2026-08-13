import type {
  CandidateSnapshot,
  CheckpointView,
  EvaluationView,
  GamePhase,
  ReplayEventView,
  RoomSettingsInput,
  SquadEntryView,
} from '@gavel-xi/shared';

export interface StoredMember {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isHost: boolean;
  isReady: boolean;
  isConnected: boolean;
  isSpectator: boolean;
  joinedAt: number;
  lastSeenAt: number;
  disconnectedAt: number | null;
  budgetEUR: number;
  spentEUR: number;
  emergencyAllocations: number;
}

export interface StoredLot {
  id: string;
  sequence: number;
  cycleId: string;
  position: CandidateSnapshot['preferredPosition'];
  candidate: CandidateSnapshot;
  openingBidEUR: number;
  originalOpeningBidEUR: number;
  isReturning: boolean;
  returnCount: number;
  currentBidEUR: number | null;
  currentLeaderId: string | null;
  eligibleMemberIds: string[];
  passedMemberIds: string[];
  openedAt: number | null;
  endsAt: number | null;
}

export interface HiddenCandidate {
  candidate: CandidateSnapshot;
  cycleId: string;
  openingBidEUR: number;
  tier: 'STRONG' | 'FALLBACK';
}

export interface StoredRoom {
  code: string;
  title: string;
  phase: GamePhase;
  settings: RoomSettingsInput;
  members: StoredMember[];
  seed: string | null;
  seedCommitment: string | null;
  snapshotId: string | null;
  snapshotUpdatedAt: string | null;
  currentLot: StoredLot | null;
  squads: SquadEntryView[];
  auctionSequence: number;
  resolvedCycles: number;
  totalCycles: number;
  checkpoint: CheckpointView | null;
  evaluation: EvaluationView | null;
  replay: ReplayEventView[];
  hiddenState: unknown | null;
  eventSequence: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface PersistedEvent {
  id: string;
  roomCode: string;
  sequence: number;
  type: string;
  at: number;
  payload: unknown;
}

export interface FrozenSnapshot {
  id: string;
  provider: string;
  createdAt: string;
  sourceUpdatedAt: string;
  candidates: CandidateSnapshot[];
}
