import type {
  CandidateSnapshot,
  CheckpointView,
  EvaluationView,
  Formation,
  GamePhase,
  PublicLot,
  ReplayEventView,
  RoomSettingsInput,
  SquadEntryView,
} from '@gavel-xi/shared';

export type CandidateTier = 'STRONG' | 'FALLBACK';

export interface EngineMember {
  id: string;
  budgetEUR: number;
  joinedAt: number;
}

export interface EngineSnapshot {
  id: string;
  provider: string;
  createdAt: string;
  sourceUpdatedAt: string;
  candidates: CandidateSnapshot[];
}

export interface PoolCandidate {
  candidate: CandidateSnapshot;
  tier: CandidateTier;
  openingBidEUR: number;
  returnPriority: number;
  status: 'QUEUED' | 'ACTIVE' | 'UNSOLD' | 'SOLD' | 'FORCED';
  returnCount: number;
}

export interface CycleState {
  id: string;
  slotId: string;
  position: CandidateSnapshot['preferredPosition'];
  cycleIndex: number;
  candidates: PoolCandidate[];
  assignments: Record<string, string>;
  resolved: boolean;
}

export interface EngineMemberState extends EngineMember {
  initialBudgetEUR: number;
  remainingBudgetEUR: number;
  emergencyAllocations: number;
}

export interface EngineState {
  version: 1;
  phase: GamePhase;
  seed: string;
  seedCommitment: string;
  settings: RoomSettingsInput;
  formation: Formation;
  members: EngineMemberState[];
  cycles: CycleState[];
  revealQueue: string[];
  currentLot: PublicLot | null;
  auctionSequence: number;
  squads: SquadEntryView[];
  resolvedCycles: number;
  lastCheckpointCycles: number;
  checkpointNumber: number;
  checkpoint: CheckpointView | null;
  evaluation: EvaluationView | null;
  replay: ReplayEventView[];
  replaySequence: number;
  processedIdempotencyKeys: Record<string, number>;
  nextWakeAt: number | null;
}

export type EngineEffect =
  | { type: 'GAME_PREPARED' }
  | { type: 'LOT_REVEALED'; lot: PublicLot }
  | { type: 'LOT_OPENED'; lot: PublicLot }
  | { type: 'BID_ACCEPTED'; lot: PublicLot; memberId: string; amountEUR: number }
  | { type: 'LOT_SOLD'; lot: PublicLot; memberId: string; amountEUR: number }
  | { type: 'LOT_UNSOLD'; lot: PublicLot }
  | {
      type: 'LOT_FORCED';
      lot: PublicLot;
      memberId: string;
      amountEUR: number;
      emergency: boolean;
    }
  | { type: 'CHECKPOINT_STARTED'; number: number }
  | { type: 'CHECKPOINT_READY' }
  | { type: 'GAME_COMPLETE' }
  | { type: 'EVALUATION_PROGRESS'; progress: number }
  | { type: 'EVALUATION_COMPLETE' };

export interface EngineProjection {
  phase: GamePhase;
  seedCommitment: string;
  currentLot: PublicLot | null;
  squads: SquadEntryView[];
  auctionSequence: number;
  resolvedCycles: number;
  totalCycles: number;
  checkpoint: CheckpointView | null;
  evaluation: EvaluationView | null;
  replay: ReplayEventView[];
}

export interface EngineMutation {
  state: EngineState;
  projection: EngineProjection;
  effects: EngineEffect[];
  nextWakeAt: number | null;
}

export interface EngineCommandResult extends EngineMutation {
  accepted: boolean;
  error?: {
    code: string;
    message: string;
    latestLot?: PublicLot;
  };
}

export interface EngineStartInput {
  seed: string;
  now: number;
  settings: RoomSettingsInput;
  members: EngineMember[];
  snapshot: EngineSnapshot;
}

export interface GeneratedPool {
  formation: Formation;
  cycles: CycleState[];
  revealQueue: string[];
}
