'use client';

import type { RoomMemberView, RoomView } from '@gavel-xi/shared';
import { useState } from 'react';
import type { ConnectionState } from '@/hooks/use-gavel-room';

interface DebugPanelProps {
  room: RoomView;
  me: RoomMemberView;
  connection: ConnectionState;
  clockOffset: number;
  serverUrl: string;
}

export function DebugPanel({ room, me, connection, clockOffset, serverUrl }: DebugPanelProps) {
  const [open, setOpen] = useState(false);
  if (process.env.NODE_ENV !== 'development' && process.env.NEXT_PUBLIC_DEBUG !== 'true')
    return null;
  const debug = {
    room: room.code,
    phase: room.phase,
    memberId: me.id,
    role: me.isSpectator ? 'SPECTATOR' : me.isHost ? 'HOST' : 'DIRECTOR',
    socket: connection,
    serverUrl,
    clockOffsetMs: Math.round(clockOffset),
    auctionSequence: room.auctionSequence,
    resolvedCycles: `${room.resolvedCycles}/${room.totalCycles}`,
    lot: room.currentLot ? `${room.currentLot.sequence}:${room.currentLot.id}` : null,
    snapshotId: room.snapshotId,
    snapshotUpdatedAt: room.snapshotUpdatedAt,
    seedCommitment: room.seedCommitment,
    seed: room.seed ?? '[withheld until complete]',
    publicSquadEntries: room.squads.length,
    connectedMembers: room.members.filter((member) => member.isConnected).length,
    hiddenPool: '[server only — correctly withheld]',
    valuationSource: room.currentLot?.candidate.valuation.source ?? null,
  };
  return (
    <aside className={`debug-panel ${open ? 'debug-panel--open' : ''}`} data-testid="debug-panel">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        DEV <span>{open ? '×' : '+'}</span>
      </button>
      {open ? (
        <>
          <p>PUBLIC CLIENT STATE</p>
          <pre>{JSON.stringify(debug, null, 2)}</pre>
        </>
      ) : null}
    </aside>
  );
}
