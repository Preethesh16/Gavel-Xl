import type { PublicLot } from '@gavel-xi/shared';
import { PersistenceConflictError } from './persistence.js';

export type ErrorCode =
  | 'BAD_PAYLOAD'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'SESSION_INVALID'
  | 'NOT_A_MEMBER'
  | 'NOT_HOST'
  | 'NOT_DIRECTOR'
  | 'LOBBY_CLOSED'
  | 'GAME_ALREADY_STARTED'
  | 'NOT_READY'
  | 'TOO_FEW_PLAYERS'
  | 'RATE_LIMITED'
  | 'STALE_AUCTION'
  | 'DUPLICATE_ACTION'
  | 'NOT_ELIGIBLE'
  | 'BID_TOO_LOW'
  | 'BUDGET_EXCEEDED'
  | 'STRICT_BUDGET_INFEASIBLE'
  | 'AUCTION_CLOSED'
  | 'ALREADY_PASSED'
  | 'CONFLICT'
  | 'DATA_UNAVAILABLE'
  | 'INTERNAL';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly latestLot?: PublicLot,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function errorMessage(error: unknown): {
  code: string;
  message: string;
  latestLot?: PublicLot;
} {
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.latestLot === undefined ? {} : { latestLot: error.latestLot }),
    };
  }
  if (error instanceof PersistenceConflictError) {
    return {
      code: 'CONFLICT',
      message: 'Another server process changed this room. Refresh and try again.',
    };
  }
  return {
    code: 'INTERNAL',
    message: 'The auction room hit an unexpected problem.',
  };
}
