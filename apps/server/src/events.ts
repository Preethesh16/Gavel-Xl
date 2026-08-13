import type { ServerToClientEvents } from './contracts.js';

type EventPayload<K extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[K]>[0];

export interface RealtimePublisher {
  emit<K extends keyof ServerToClientEvents>(
    roomCode: string,
    event: K,
    payload: EventPayload<K>,
  ): void;
  emitToMember<K extends keyof ServerToClientEvents>(
    memberId: string,
    event: K,
    payload: EventPayload<K>,
  ): void;
}

export class NoopPublisher implements RealtimePublisher {
  emit<K extends keyof ServerToClientEvents>(
    _roomCode: string,
    _event: K,
    _payload: EventPayload<K>,
  ): void {}

  emitToMember<K extends keyof ServerToClientEvents>(
    _memberId: string,
    _event: K,
    _payload: EventPayload<K>,
  ): void {}
}
