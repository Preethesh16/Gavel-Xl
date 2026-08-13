import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './contracts.js';
import type { RealtimePublisher } from './events.js';

export function roomChannel(roomCode: string): string {
  return `room:${roomCode}`;
}

export function memberChannel(memberId: string): string {
  return `member:${memberId}`;
}

export class SocketPublisher implements RealtimePublisher {
  constructor(
    private readonly io: Server<
      ClientToServerEvents,
      ServerToClientEvents,
      InterServerEvents,
      SocketData
    >,
  ) {}

  emit<K extends keyof ServerToClientEvents>(
    roomCode: string,
    event: K,
    payload: Parameters<ServerToClientEvents[K]>[0],
  ): void {
    // Socket.IO's union-of-functions generic cannot correlate a dynamic key with its payload.
    const target = this.io.to(roomChannel(roomCode)) as unknown as {
      emit(event: K, payload: Parameters<ServerToClientEvents[K]>[0]): boolean;
    };
    target.emit(event, payload);
  }

  emitToMember<K extends keyof ServerToClientEvents>(
    memberId: string,
    event: K,
    payload: Parameters<ServerToClientEvents[K]>[0],
  ): void {
    const target = this.io.to(memberChannel(memberId)) as unknown as {
      emit(event: K, payload: Parameters<ServerToClientEvents[K]>[0]): boolean;
    };
    target.emit(event, payload);
  }
}
