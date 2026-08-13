'use client';

import type {
  Ack,
  CreateRoomInput,
  JoinRoomInput,
  PublicLot,
  RoomMemberView,
  RoomSettingsInput,
  RoomView,
  SessionPayload,
} from '@gavel-xi/shared';
import { io, type Socket } from 'socket.io-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearSession, loadSession, saveSession, type StoredSession } from '@/lib/session';

export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'offline';

export type AuctionMomentKind =
  'reveal' | 'opened' | 'bid' | 'outbid' | 'sold' | 'unsold' | 'forced' | 'checkpoint' | 'complete';

export interface AuctionMoment {
  id: number;
  kind: AuctionMomentKind;
  title: string;
  detail: string;
  memberId?: string;
  amountEUR?: number;
  lot?: PublicLot;
}

interface ActionResult {
  ok: boolean;
  message?: string;
}

interface UseGavelRoomValue {
  room: RoomView | null;
  me: RoomMemberView | null;
  memberId: string | null;
  connection: ConnectionState;
  initialising: boolean;
  busyAction: string | null;
  error: string | null;
  notice: string | null;
  moment: AuctionMoment | null;
  clockOffset: number;
  maxSafeBidEUR: number | null;
  serverUrl: string;
  createRoom: (input: CreateRoomInput) => Promise<ActionResult>;
  joinRoom: (input: JoinRoomInput) => Promise<ActionResult>;
  setReady: (ready: boolean) => Promise<ActionResult>;
  updateSettings: (settings: Partial<RoomSettingsInput>) => Promise<ActionResult>;
  startGame: () => Promise<ActionResult>;
  placeBid: (amountEUR: number) => Promise<ActionResult>;
  pass: () => Promise<ActionResult>;
  broadcastCheckpoint: () => Promise<ActionResult>;
  togglePause: () => Promise<ActionResult>;
  leaveRoom: () => Promise<void>;
  clearError: () => void;
  pushNotice: (message: string) => void;
}

function runtimeServerUrl(): string {
  if (process.env.NEXT_PUBLIC_SERVER_URL) return process.env.NEXT_PUBLIC_SERVER_URL;
  if (typeof window !== 'undefined')
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  return 'http://localhost:4000';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRoom(value: unknown): value is RoomView {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.phase === 'string' &&
    Array.isArray(value.members)
  );
}

function roomFromPayload(payload: unknown): RoomView | null {
  if (isRoom(payload)) return payload;
  if (isRecord(payload) && isRoom(payload.room)) return payload.room;
  return null;
}

function lotFromPayload(payload: unknown): PublicLot | undefined {
  if (isRecord(payload) && isRecord(payload.lot) && typeof payload.lot.id === 'string')
    return payload.lot as unknown as PublicLot;
  if (isRecord(payload) && typeof payload.id === 'string' && isRecord(payload.candidate))
    return payload as unknown as PublicLot;
  return roomFromPayload(payload)?.currentLot ?? undefined;
}

function stringFrom(payload: unknown, keys: string[]): string | undefined {
  if (!isRecord(payload)) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function numberFrom(payload: unknown, keys: string[]): number | undefined {
  if (!isRecord(payload)) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function messageForAck<T>(ack: Ack<T>): string {
  return ack.error?.message ?? 'The war room did not accept that action.';
}

function eventMoment(kind: AuctionMomentKind, payload: unknown, id: number): AuctionMoment {
  const lot = lotFromPayload(payload);
  const candidate = lot?.candidate.commonName ?? lot?.candidate.fullName;
  const memberId = stringFrom(payload, ['memberId', 'winnerId', 'leaderId', 'assignedMemberId']);
  const amountEUR = numberFrom(payload, [
    'amountEUR',
    'priceEUR',
    'purchasePriceEUR',
    'currentBidEUR',
  ]);
  const content: Record<AuctionMomentKind, [string, string]> = {
    reveal: [
      lot?.isReturning ? 'BACK ON THE MARKET' : (lot?.position ?? 'NEXT LOT'),
      lot?.isReturning ? 'Same talent. New reserve.' : 'One card. One decision.',
    ],
    opened: ['THE MARKET IS OPEN', candidate ?? 'Bidding unlocked'],
    bid: ['NEW BID', candidate ? `${candidate} has a new leader.` : 'The room just moved.'],
    outbid: ['OUTBID', 'The gavel is still moving.'],
    sold: ['SOLD', candidate ?? 'Deal completed'],
    unsold: ['UNSOLD', candidate ? `${candidate} enters the vault.` : 'No takers.'],
    forced: ['FORCED DEAL', candidate ? `${candidate} has a destination.` : 'No more running.'],
    checkpoint: ['SCOUT REPORT', 'The room takes stock.'],
    complete: ['WINDOW CLOSED', 'The final verdict is ready.'],
  };
  const [title, detail] = content[kind];
  return {
    id,
    kind,
    title,
    detail,
    ...(memberId ? { memberId } : {}),
    ...(amountEUR !== undefined ? { amountEUR } : {}),
    ...(lot ? { lot } : {}),
  };
}

export function useGavelRoom(): UseGavelRoomValue {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [initialising, setInitialising] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moment, setMoment] = useState<AuctionMoment | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [bidLimit, setBidLimit] = useState<{
    roomCode: string;
    auctionSequence: number;
    maxBidEUR: number;
  } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  const roomRef = useRef<RoomView | null>(null);
  const momentId = useRef(0);
  const serverUrl = useMemo(runtimeServerUrl, []);

  const acceptRoom = useCallback((nextRoom: RoomView) => {
    roomRef.current = nextRoom;
    setRoom(nextRoom);
    if (Number.isFinite(nextRoom.serverNow)) setClockOffset(nextRoom.serverNow - Date.now());
  }, []);

  const acceptSession = useCallback(
    (session: SessionPayload) => {
      const stored: StoredSession = {
        sessionToken: session.sessionToken,
        memberId: session.memberId,
        roomCode: session.room.code,
      };
      sessionRef.current = stored;
      saveSession(stored);
      setMemberId(session.memberId);
      acceptRoom(session.room);
      window.history.replaceState({}, '', `/?room=${session.room.code}`);
    },
    [acceptRoom],
  );

  const emitAck = useCallback(
    <T>(event: string, payload: unknown, timeout = 12_000): Promise<Ack<T>> => {
      return new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({
            ok: false,
            error: { code: 'OFFLINE', message: 'Reconnecting to the auction room…' },
          });
          return;
        }
        socket
          .timeout(timeout)
          .emit(event, payload, (timeoutError: Error | null, response: Ack<T> | undefined) => {
            if (timeoutError || !response) {
              resolve({
                ok: false,
                error: {
                  code: 'TIMEOUT',
                  message: 'The server took too long to answer. Try again.',
                },
              });
              return;
            }
            resolve(response);
          });
      });
    },
    [],
  );

  useEffect(() => {
    const socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4_000,
      timeout: 10_000,
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;
    sessionRef.current = loadSession();
    if (!sessionRef.current) setInitialising(false);

    const resume = () => {
      const session = sessionRef.current;
      if (!session) {
        setInitialising(false);
        return;
      }
      socket
        .timeout(12_000)
        .emit(
          'room:resume',
          { sessionToken: session.sessionToken },
          (resumeError: Error | null, ack: Ack<SessionPayload> | undefined) => {
            setInitialising(false);
            if (resumeError || !ack?.ok || !ack.data) {
              if (ack?.error?.code === 'SESSION_INVALID' || ack?.error?.code === 'ROOM_NOT_FOUND') {
                clearSession();
                sessionRef.current = null;
                setMemberId(null);
                setRoom(null);
              } else {
                setNotice(
                  'Your room could not be restored yet. You can retry when the connection returns.',
                );
              }
              return;
            }
            acceptSession(ack.data);
          },
        );
    };

    socket.on('connect', () => {
      setConnection('online');
      setError(null);
      resume();
    });
    socket.on('disconnect', () => setConnection('reconnecting'));
    socket.io.on('reconnect_attempt', () => setConnection('reconnecting'));
    socket.io.on('reconnect_failed', () => {
      setConnection('offline');
      setInitialising(false);
    });
    socket.on('connect_error', () => {
      setConnection('offline');
      setInitialising(false);
    });

    socket.on('room:state', (payload: unknown) => {
      const nextRoom = roomFromPayload(payload);
      if (nextRoom) acceptRoom(nextRoom);
    });
    socket.on('auction:limit', (payload: unknown) => {
      if (!isRecord(payload)) return;
      const roomCode = stringFrom(payload, ['roomCode']);
      const auctionSequence = numberFrom(payload, ['auctionSequence']);
      const maxBidEUR = numberFrom(payload, ['maxBidEUR']);
      if (roomCode === undefined || auctionSequence === undefined || maxBidEUR === undefined)
        return;
      setBidLimit({ roomCode, auctionSequence, maxBidEUR });
    });

    const outcomeQueue: AuctionMoment[] = [];
    let outcomeActive = false;
    let outcomeTimer: number | undefined;
    const drainOutcomeQueue = () => {
      const next = outcomeQueue.shift();
      if (!next) {
        outcomeActive = false;
        return;
      }
      outcomeActive = true;
      setMoment(next);
      const duration = process.env.NEXT_PUBLIC_E2E === 'true' ? 360 : 3_260;
      outcomeTimer = window.setTimeout(drainOutcomeQueue, duration);
    };
    const publishMoment = (kind: AuctionMomentKind, payload: unknown) => {
      momentId.current += 1;
      const next = eventMoment(kind, payload, momentId.current);
      if (kind === 'sold' || kind === 'unsold' || kind === 'forced') {
        outcomeQueue.push(next);
        if (!outcomeActive) drainOutcomeQueue();
        return;
      }
      if (!outcomeActive) setMoment(next);
    };

    const momentEvents: Array<[string, AuctionMomentKind]> = [
      ['auction:reveal', 'reveal'],
      ['auction:opened', 'opened'],
      ['auction:bidAccepted', 'bid'],
      ['auction:outbid', 'outbid'],
      ['auction:sold', 'sold'],
      ['auction:unsold', 'unsold'],
      ['auction:forced', 'forced'],
      ['checkpoint:start', 'checkpoint'],
      ['checkpoint:result', 'checkpoint'],
      ['game:complete', 'complete'],
      ['evaluation:complete', 'complete'],
    ];
    for (const [event, kind] of momentEvents) {
      socket.on(event, (payload: unknown) => {
        const nextRoom = roomFromPayload(payload);
        if (nextRoom) acceptRoom(nextRoom);
        publishMoment(kind, payload);
      });
    }

    const roomEvents = [
      'game:prepared',
      'budget:update',
      'squad:update',
      'checkpoint:result',
      'evaluation:complete',
      'host:transferred',
    ];
    for (const event of roomEvents) {
      socket.on(event, (payload: unknown) => {
        const nextRoom = roomFromPayload(payload);
        if (nextRoom) acceptRoom(nextRoom);
      });
    }

    socket.on('auction:timer', (payload: unknown) => {
      if (!isRecord(payload)) return;
      const endsAt = numberFrom(payload, ['endsAt']);
      const serverNow = numberFrom(payload, ['serverNow']);
      const auctionSequence = numberFrom(payload, ['auctionSequence', 'sequence']);
      if (serverNow !== undefined) setClockOffset(serverNow - Date.now());
      if (endsAt === undefined) return;
      setRoom((current) => {
        if (
          !current?.currentLot ||
          (auctionSequence !== undefined && current.auctionSequence !== auctionSequence)
        )
          return current;
        const next = {
          ...current,
          currentLot: { ...current.currentLot, endsAt },
          ...(serverNow !== undefined ? { serverNow } : {}),
        };
        roomRef.current = next;
        return next;
      });
    });
    socket.on('server:error', (payload: unknown) => {
      const message =
        stringFrom(payload, ['message', 'error']) ?? 'The server reported an unexpected problem.';
      setError(message);
    });

    const heartbeat = window.setInterval(() => {
      const activeRoom = roomRef.current;
      if (socket.connected && activeRoom)
        socket.emit('presence:heartbeat', { roomCode: activeRoom.code }, () => undefined);
    }, 15_000);

    return () => {
      window.clearInterval(heartbeat);
      if (outcomeTimer !== undefined) window.clearTimeout(outcomeTimer);
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [acceptRoom, acceptSession, serverUrl]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => setNotice(null),
      process.env.NEXT_PUBLIC_E2E === 'true' ? 200 : 4_000,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  const run = useCallback(
    async <T>(
      action: string,
      callback: () => Promise<Ack<T>>,
      onSuccess?: (data: T) => void,
    ): Promise<ActionResult> => {
      setBusyAction(action);
      setError(null);
      const ack = await callback();
      setBusyAction(null);
      if (!ack.ok || ack.data === undefined) {
        const message = messageForAck(ack);
        setError(message);
        if (ack.error?.latestLot) {
          setRoom((current) =>
            current
              ? { ...current, currentLot: ack.error?.latestLot ?? current.currentLot }
              : current,
          );
        }
        return { ok: false, message };
      }
      onSuccess?.(ack.data);
      return { ok: true };
    },
    [],
  );

  const createRoom = useCallback(
    async (input: CreateRoomInput) => {
      return run('create', () => emitAck<SessionPayload>('room:create', input), acceptSession);
    },
    [acceptSession, emitAck, run],
  );

  const joinRoom = useCallback(
    async (input: JoinRoomInput) => {
      return run('join', () => emitAck<SessionPayload>('room:join', input), acceptSession);
    },
    [acceptSession, emitAck, run],
  );

  const setReady = useCallback(
    async (ready: boolean) => {
      const activeRoom = roomRef.current;
      if (!activeRoom) return { ok: false, message: 'Join a room first.' };
      return run(
        'ready',
        () => emitAck<RoomView>('room:ready', { roomCode: activeRoom.code, ready }),
        acceptRoom,
      );
    },
    [acceptRoom, emitAck, run],
  );

  const updateSettings = useCallback(
    async (settings: Partial<RoomSettingsInput>) => {
      const activeRoom = roomRef.current;
      if (!activeRoom) return { ok: false, message: 'Join a room first.' };
      return run(
        'settings',
        () => emitAck<RoomView>('room:settings', { roomCode: activeRoom.code, settings }),
        acceptRoom,
      );
    },
    [acceptRoom, emitAck, run],
  );

  const startGame = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom) return { ok: false, message: 'Join a room first.' };
    return run(
      'start',
      async () => {
        if (process.env.NEXT_PUBLIC_E2E === 'true') {
          const fastSettings = await emitAck<RoomView>('room:settings', {
            roomCode: activeRoom.code,
            settings: { revealSeconds: 0, auctionTimerSeconds: 5, antiSnipeSeconds: 0 },
          });
          if (!fastSettings.ok) return fastSettings;
          if (fastSettings.data) acceptRoom(fastSettings.data);
        }
        return emitAck<RoomView>('game:start', { roomCode: activeRoom.code }, 30_000);
      },
      acceptRoom,
    );
  }, [acceptRoom, emitAck, run]);

  const placeBid = useCallback(
    async (amountEUR: number) => {
      const activeRoom = roomRef.current;
      if (!activeRoom) return { ok: false, message: 'Join a room first.' };
      const idempotencyKey =
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      return run(
        'bid',
        () =>
          emitAck<{ room: RoomView }>('auction:bid', {
            roomCode: activeRoom.code,
            amountEUR,
            auctionSequence: activeRoom.auctionSequence,
            idempotencyKey,
          }),
        (data) => acceptRoom(data.room),
      );
    },
    [acceptRoom, emitAck, run],
  );

  const pass = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom) return { ok: false, message: 'Join a room first.' };
    return run(
      'pass',
      () =>
        emitAck<{ room: RoomView }>('auction:pass', {
          roomCode: activeRoom.code,
          auctionSequence: activeRoom.auctionSequence,
        }),
      (data) => acceptRoom(data.room),
    );
  }, [acceptRoom, emitAck, run]);

  const broadcastCheckpoint = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom) return { ok: false, message: 'Join a room first.' };
    return run(
      'checkpoint',
      () => emitAck<RoomView>('checkpoint:request', { roomCode: activeRoom.code }),
      acceptRoom,
    );
  }, [acceptRoom, emitAck, run]);

  const togglePause = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom) return { ok: false, message: 'Join a room first.' };
    return run(
      'pause',
      () => emitAck<RoomView>('auction:pause', { roomCode: activeRoom.code }),
      acceptRoom,
    );
  }, [acceptRoom, emitAck, run]);

  const leaveRoom = useCallback(async () => {
    const activeRoom = roomRef.current;
    if (activeRoom && socketRef.current?.connected)
      await emitAck('room:leave', { roomCode: activeRoom.code });
    clearSession();
    sessionRef.current = null;
    roomRef.current = null;
    setRoom(null);
    setMemberId(null);
    setMoment(null);
    setError(null);
    window.history.replaceState({}, '', '/');
  }, [emitAck]);

  const me = room?.members.find((member) => member.id === memberId) ?? null;
  const maxSafeBidEUR =
    room !== null &&
    bidLimit?.roomCode === room.code &&
    bidLimit.auctionSequence === room.auctionSequence
      ? bidLimit.maxBidEUR
      : null;

  return {
    room,
    me,
    memberId,
    connection,
    initialising,
    busyAction,
    error,
    notice,
    moment,
    clockOffset,
    maxSafeBidEUR,
    serverUrl,
    createRoom,
    joinRoom,
    setReady,
    updateSettings,
    startGame,
    placeBid,
    pass,
    broadcastCheckpoint,
    togglePause,
    leaveRoom,
    clearError: () => setError(null),
    pushNotice: (message: string) => setNotice(message),
  };
}
