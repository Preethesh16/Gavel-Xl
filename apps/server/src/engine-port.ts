import type {
  BidInput,
  CandidateSnapshot,
  CheckpointView,
  EvaluationView,
  GamePhase,
  PassInput,
  ReplayEventView,
  RoomSettingsInput,
  SquadEntryView,
} from '@gavel-xi/shared';
import type { FrozenSnapshot, StoredLot, StoredMember } from './domain.js';

export interface EngineProjection {
  phase: GamePhase;
  seedCommitment: string;
  currentLot: StoredLot | null;
  squads: SquadEntryView[];
  auctionSequence: number;
  resolvedCycles: number;
  totalCycles: number;
  checkpoint: CheckpointView | null;
  evaluation: EvaluationView | null;
  replay: ReplayEventView[];
}

export type EngineEffect =
  | { type: 'GAME_PREPARED' }
  | { type: 'LOT_REVEALED'; lot: StoredLot }
  | { type: 'LOT_OPENED'; lot: StoredLot }
  | { type: 'BID_ACCEPTED'; lot: StoredLot; memberId: string; amountEUR: number }
  | { type: 'LOT_SOLD'; lot: StoredLot; memberId: string; amountEUR: number }
  | { type: 'LOT_UNSOLD'; lot: StoredLot }
  | {
      type: 'LOT_FORCED';
      lot: StoredLot;
      memberId: string;
      amountEUR: number;
      emergency: boolean;
    }
  | { type: 'CHECKPOINT_STARTED'; number: number }
  | { type: 'CHECKPOINT_READY' }
  | { type: 'GAME_COMPLETE' }
  | { type: 'EVALUATION_PROGRESS'; progress: number }
  | { type: 'EVALUATION_COMPLETE' };

export interface EngineMutation {
  state: unknown;
  projection: EngineProjection;
  effects: EngineEffect[];
  /** Absolute epoch milliseconds; null means the engine currently needs no wake-up. */
  nextWakeAt: number | null;
}

export interface EngineCommandResult extends EngineMutation {
  accepted: boolean;
  error?: {
    code: string;
    message: string;
    latestLot?: StoredLot;
  };
}

export interface EngineStartInput {
  seed: string;
  now: number;
  settings: RoomSettingsInput;
  members: Array<Pick<StoredMember, 'id' | 'budgetEUR' | 'joinedAt'>>;
  snapshot: FrozenSnapshot;
}

/**
 * Adapter boundary for the framework-independent @gavel-xi/game-engine package.
 * Keeping it explicit makes persistence and timer replay independently testable.
 */
export interface AuthoritativeEngine {
  start(input: EngineStartInput): EngineMutation;
  bid(state: unknown, memberId: string, input: BidInput, now: number): EngineCommandResult;
  pass(state: unknown, memberId: string, input: PassInput, now: number): EngineCommandResult;
  advance(state: unknown, now: number): EngineMutation;
  checkpoint(state: unknown, now: number): EngineCommandResult;
  /** Private per-director ceiling. Never include every member's values in a public room view. */
  maximumLegalBid(state: unknown, memberId: string): number;
  nextWakeAt(state: unknown): number | null;
  candidatesForDebug(state: unknown): CandidateSnapshot[];
}
