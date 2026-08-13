import type { RoomSettingsInput } from './schemas.js';

export type Position =
  'GK' | 'LB' | 'CB' | 'RB' | 'LWB' | 'RWB' | 'DM' | 'CM' | 'AM' | 'LW' | 'RW' | 'ST' | 'MANAGER';

export type GamePhase =
  | 'LOBBY'
  | 'PREPARING_DATA'
  | 'GENERATING_POOL'
  | 'READY'
  | 'REVEALING'
  | 'BIDDING'
  | 'RESOLVING'
  | 'SOLD'
  | 'UNSOLD'
  | 'FORCED_ASSIGNMENT'
  | 'CHECKPOINT'
  | 'NEXT_LOT'
  | 'FINALIZING'
  | 'EVALUATING'
  | 'RESULTS'
  | 'COMPLETE';

export interface FormationSlot {
  id: string;
  label: string;
  position: Position;
  compatiblePositions: Position[];
  x: number;
  y: number;
  cycleIndex: number;
}

export interface Formation {
  name: RoomSettingsInput['formation'];
  slots: FormationSlot[];
}

export interface Valuation {
  valueEUR: number | null;
  source: string;
  sourceUrl: string | null;
  valuationDate: string | null;
  retrievedAt: string;
  confidence: number;
  type: 'market_value' | 'estimated_transfer_value' | 'game_estimate';
}

export interface RoleProfile {
  pace: number;
  physical: number;
  technique: number;
  creativity: number;
  defending: number;
  aerial: number;
  passing: number;
  finishing: number;
  pressing: number;
  composure: number;
}

export interface TacticalProfile {
  possession: number;
  pressing: number;
  transition: number;
  lowBlock: number;
  highLine: number;
  directness: number;
  widthPreference: number;
  buildUpRisk: number;
  tacticalFlexibility: number;
}

export interface CandidateSnapshot {
  id: string;
  kind: 'PLAYER' | 'MANAGER';
  fullName: string;
  commonName: string;
  age: number;
  nationality: string;
  club: string;
  league: string;
  positions: Position[];
  preferredPosition: Position;
  imageUrl: string | null;
  season: string;
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  currentFormRating: number;
  availabilityRating: number;
  competitionStrength: number;
  lastFive: number[];
  role: RoleProfile;
  tactics?: TacticalProfile;
  valuation: Valuation;
  dataSource: string;
  dataUpdatedAt: string;
}

export interface RoomMemberView {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isHost: boolean;
  isReady: boolean;
  isConnected: boolean;
  isSpectator: boolean;
  joinedAt: number;
  budgetEUR: number;
  spentEUR: number;
  emergencyAllocations: number;
  filledSlots: number;
  totalSlots: number;
}

export interface PublicLot {
  id: string;
  sequence: number;
  cycleId: string;
  position: Position;
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

export interface SquadEntryView {
  id: string;
  memberId: string;
  slotId: string;
  cycleId: string;
  candidate: CandidateSnapshot;
  purchasePriceEUR: number;
  marketValueEUR: number | null;
  acquisition: 'AUCTION' | 'FORCED' | 'EMERGENCY';
  acquiredAt: number;
}

export interface MetricScoreView {
  index: number;
  category: string;
  metric: string;
  scores: Record<string, number>;
  winnerIds: string[];
}

export interface TeamResultView {
  memberId: string;
  rank: number;
  overallScore: number;
  categoryScores: Record<string, number>;
  metricWins: number;
  categoryWins: number;
  strengths: string[];
  weakness: string;
  squadMarketValueEUR: number;
  spentEUR: number;
  remainingEUR: number;
  auctionEfficiency: number;
  leaguePoints: number;
  knockoutRating: number;
  finalRating: number;
}

export interface EvaluationView {
  metrics: MetricScoreView[];
  teams: TeamResultView[];
  awards: Array<{ title: string; memberId: string; detail: string }>;
  headToHead: Array<{
    homeMemberId: string;
    awayMemberId: string;
    homeGoals: number;
    awayGoals: number;
    explanation: string;
  }>;
  seed: string;
  seedCommitment: string;
}

export interface CheckpointView {
  number: number;
  resolvedCycles: number;
  leaderId: string;
  bestBusinessMemberId: string;
  bestSigningEntryId: string | null;
  biggestOverpayEntryId: string | null;
  budgetLeaderId: string;
  projectedScores: Record<string, number>;
  weaknesses: Record<string, string>;
  remainingPositions: Record<string, string[]>;
}

export interface ReplayEventView {
  id: string;
  at: number;
  sequence: number;
  type: string;
  title: string;
  detail: string;
  memberId?: string;
  candidateId?: string;
  amountEUR?: number;
}

export interface RoomView {
  code: string;
  title: string;
  phase: GamePhase;
  settings: RoomSettingsInput;
  members: RoomMemberView[];
  seedCommitment: string | null;
  seed: string | null;
  snapshotId: string | null;
  snapshotUpdatedAt: string | null;
  currentLot: PublicLot | null;
  squads: SquadEntryView[];
  auctionSequence: number;
  resolvedCycles: number;
  totalCycles: number;
  checkpoint: CheckpointView | null;
  evaluation: EvaluationView | null;
  replay: ReplayEventView[];
  serverNow: number;
}

export interface Ack<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; latestLot?: PublicLot };
}

export interface SessionPayload {
  sessionToken: string;
  memberId: string;
  room: RoomView;
}

export interface TeamResponseView {
  members: RoomMemberView[];
  squads: SquadEntryView[];
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'auction:limit': (payload: {
    roomCode: string;
    auctionSequence: number;
    maxBidEUR: number;
  }) => void;
  'member:joined': (member: RoomMemberView) => void;
  'member:left': (member: RoomMemberView) => void;
  'host:transferred': (payload: { roomCode: string; hostMemberId: string }) => void;
  'game:prepared': (room: RoomView) => void;
  'auction:reveal': (payload: { room: RoomView; lot: PublicLot }) => void;
  'auction:opened': (payload: { room: RoomView; lot: PublicLot }) => void;
  'auction:bidAccepted': (payload: {
    roomCode: string;
    lot: PublicLot;
    bidderId: string;
    amountEUR: number;
  }) => void;
  'auction:outbid': (payload: { roomCode: string; latestLot: PublicLot; message: string }) => void;
  'auction:timer': (payload: {
    roomCode: string;
    auctionSequence: number;
    endsAt: number;
    serverNow: number;
  }) => void;
  'auction:sold': (payload: {
    room: RoomView;
    lot: PublicLot;
    winnerId: string;
    amountEUR: number;
  }) => void;
  'auction:unsold': (payload: { room: RoomView; lot: PublicLot }) => void;
  'auction:forced': (payload: {
    room: RoomView;
    lot: PublicLot;
    memberId: string;
    amountEUR: number;
    emergency: boolean;
  }) => void;
  'budget:update': (payload: { roomCode: string; memberId: string; remainingEUR: number }) => void;
  'squad:update': (payload: {
    roomCode: string;
    memberId: string;
    squad: SquadEntryView[];
  }) => void;
  'checkpoint:start': (payload: { roomCode: string; number: number }) => void;
  'checkpoint:result': (room: RoomView) => void;
  'game:complete': (room: RoomView) => void;
  'evaluation:progress': (payload: { roomCode: string; progress: number }) => void;
  'evaluation:complete': (payload: { room: RoomView; evaluation: EvaluationView }) => void;
  'replay:event': (payload: { roomCode: string; event: ReplayEventView }) => void;
  'server:error': (payload: { code: string; message: string }) => void;
}

export interface ClientToServerEvents {
  'room:create': (
    input: { name: string; avatar?: string },
    callback: (ack: Ack<SessionPayload>) => void,
  ) => void;
  'room:join': (
    input: { roomCode: string; name: string; avatar?: string; sessionToken?: string },
    callback: (ack: Ack<SessionPayload>) => void,
  ) => void;
  'room:resume': (
    input: { sessionToken: string },
    callback: (ack: Ack<SessionPayload>) => void,
  ) => void;
  'room:ready': (
    input: { roomCode: string; ready: boolean },
    callback: (ack: Ack<RoomView>) => void,
  ) => void;
  'room:settings': (
    input: { roomCode: string; settings: Partial<RoomSettingsInput> },
    callback: (ack: Ack<RoomView>) => void,
  ) => void;
  'room:leave': (input: { roomCode: string }, callback: (ack: Ack) => void) => void;
  'game:start': (input: { roomCode: string }, callback: (ack: Ack<RoomView>) => void) => void;
  'auction:bid': (
    input: { roomCode: string; amountEUR: number; auctionSequence: number; idempotencyKey: string },
    callback: (ack: Ack<{ room: RoomView }>) => void,
  ) => void;
  'auction:pass': (
    input: { roomCode: string; auctionSequence: number },
    callback: (ack: Ack<{ room: RoomView }>) => void,
  ) => void;
  'team:request': (
    input: { roomCode: string; scope: 'MY' | 'ALL' },
    callback: (ack: Ack<TeamResponseView>) => void,
  ) => void;
  'checkpoint:request': (
    input: { roomCode: string },
    callback: (ack: Ack<RoomView>) => void,
  ) => void;
  'presence:heartbeat': (input: { roomCode: string }, callback: (ack: Ack) => void) => void;
}
