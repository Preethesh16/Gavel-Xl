import type {
  Ack,
  BidInput,
  CreateRoomInput,
  EvaluationView,
  JoinRoomInput,
  PassInput,
  PublicLot,
  ReplayEventView,
  RoomMemberView,
  RoomSettingsInput,
  RoomView,
  SessionPayload,
  SquadEntryView,
} from '@gavel-xi/shared';

export interface SettingsPayload {
  roomCode: string;
  settings: Partial<RoomSettingsInput>;
}

export interface ReadyPayload {
  roomCode: string;
  ready: boolean;
}

export interface ResumePayload {
  sessionToken: string;
}

export interface TeamRequestPayload {
  roomCode: string;
  scope: 'MY' | 'ALL';
}

export interface TeamResponse {
  members: RoomMemberView[];
  squads: SquadEntryView[];
}

export interface ClientToServerEvents {
  'room:create': (payload: CreateRoomInput, callback: (ack: Ack<SessionPayload>) => void) => void;
  'room:join': (payload: JoinRoomInput, callback: (ack: Ack<SessionPayload>) => void) => void;
  'room:resume': (payload: ResumePayload, callback: (ack: Ack<SessionPayload>) => void) => void;
  'room:settings': (payload: SettingsPayload, callback: (ack: Ack<RoomView>) => void) => void;
  'room:ready': (payload: ReadyPayload, callback: (ack: Ack<RoomView>) => void) => void;
  'room:leave': (payload: { roomCode: string }, callback: (ack: Ack) => void) => void;
  'game:start': (payload: { roomCode: string }, callback: (ack: Ack<RoomView>) => void) => void;
  'game:restart': (payload: { roomCode: string }, callback: (ack: Ack<RoomView>) => void) => void;
  'auction:bid': (payload: BidInput, callback: (ack: Ack<{ room: RoomView }>) => void) => void;
  'auction:pass': (payload: PassInput, callback: (ack: Ack<{ room: RoomView }>) => void) => void;
  'team:request': (payload: TeamRequestPayload, callback: (ack: Ack<TeamResponse>) => void) => void;
  'checkpoint:request': (
    payload: { roomCode: string },
    callback: (ack: Ack<RoomView>) => void,
  ) => void;
  'auction:pause': (payload: { roomCode: string }, callback: (ack: Ack<RoomView>) => void) => void;
  'presence:heartbeat': (payload: { roomCode: string }, callback: (ack: Ack) => void) => void;
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

export interface InterServerEvents {
  'room:invalidate': (roomCode: string) => void;
}

export interface SocketData {
  memberId?: string;
  roomCode?: string;
  sessionToken?: string;
  lastHeartbeatAt?: number;
}
