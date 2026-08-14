'use client';

import { useEffect, useMemo, useRef } from 'react';
import { AuctionStage } from '@/components/auction-stage';
import { Checkpoint } from '@/components/checkpoint';
import { DebugPanel } from '@/components/debug-panel';
import { Evaluating } from '@/components/evaluating';
import { Landing } from '@/components/landing';
import { Lobby } from '@/components/lobby';
import { ResultsHub } from '@/components/results-hub';
import { RoomHeader } from '@/components/room-header';
import { LoadingRoom, Toasts } from '@/components/system-feedback';
import { useGavelRoom } from '@/hooks/use-gavel-room';
import { useSound } from '@/hooks/use-sound';

const LOBBY_PHASES = ['LOBBY', 'PREPARING_DATA', 'GENERATING_POOL'];
const AUCTION_PHASES = [
  'READY',
  'REVEALING',
  'BIDDING',
  'RESOLVING',
  'SOLD',
  'UNSOLD',
  'FORCED_ASSIGNMENT',
  'NEXT_LOT',
];

export default function Home() {
  const game = useGavelRoom();
  const sound = useSound(game.room?.settings.soundEnabled ?? true, game.moment);
  const lastRoom = useRef<string | null>(null);
  const suggestedCode = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    return (
      new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() || undefined
    );
  }, []);

  useEffect(() => {
    if (game.room && lastRoom.current !== game.room.code) {
      lastRoom.current = game.room.code;
      sound.play('join');
    }
  }, [game.room, sound]);

  useEffect(() => {
    const toggleSound = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      if (event.key.toLowerCase() === 'm') sound.toggle();
    };
    window.addEventListener('keydown', toggleSound);
    return () => window.removeEventListener('keydown', toggleSound);
  }, [sound]);

  const activeScreen =
    !game.room || !game.me
      ? 'landing'
      : LOBBY_PHASES.includes(game.room.phase)
        ? 'lobby'
        : AUCTION_PHASES.includes(game.room.phase)
          ? 'auction'
          : game.room.phase === 'CHECKPOINT'
            ? 'checkpoint'
            : game.room.phase === 'RESULTS' || game.room.phase === 'COMPLETE'
              ? 'results'
              : 'evaluating';

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeScreen]);

  const copyInvite = async () => {
    if (!game.room) return;
    const url = `${window.location.origin}/?room=${game.room.code}`;
    const invite = `Join my Gavel XI room ${game.room.code}: ${url}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(invite);
      game.pushNotice(`Room ${game.room.code} copied with its invite link.`);
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = invite;
      fallback.setAttribute('readonly', '');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      document.body.append(fallback);
      fallback.select();
      const copied = document.execCommand('copy');
      fallback.remove();
      game.pushNotice(
        copied
          ? `Room ${game.room.code} copied with its invite link.`
          : `Room code: ${game.room.code}`,
      );
    }
  };

  if (game.initialising) return <LoadingRoom />;

  if (!game.room || !game.me) {
    return (
      <>
        <Landing
          busyAction={game.busyAction}
          {...(suggestedCode ? { suggestedCode } : {})}
          onCreate={game.createRoom}
          onJoin={game.joinRoom}
        />
        <Toasts error={game.error} notice={game.notice} onClear={game.clearError} />
      </>
    );
  }

  const room = game.room;
  const me = game.me;

  return (
    <div className="app-shell" data-e2e={process.env.NEXT_PUBLIC_E2E === 'true' ? 'true' : 'false'}>
      <RoomHeader
        room={room}
        me={me}
        connection={game.connection}
        soundEnabled={sound.enabled}
        onSoundToggle={sound.toggle}
        onCopy={() => void copyInvite()}
        onBack={() => void game.leaveRoom()}
      />
      {LOBBY_PHASES.includes(room.phase) ? (
        <Lobby
          room={room}
          me={me}
          busyAction={game.busyAction}
          onReady={game.setReady}
          onSettings={game.updateSettings}
          onStart={game.startGame}
          onLeave={game.leaveRoom}
          onCopyInvite={copyInvite}
        />
      ) : null}
      {AUCTION_PHASES.includes(room.phase) ? (
        <AuctionStage
          room={room}
          me={me}
          connection={game.connection}
          clockOffset={game.clockOffset}
          maxSafeBidEUR={game.maxSafeBidEUR}
          busyAction={game.busyAction}
          moment={game.moment}
          onBid={game.placeBid}
          onPass={game.pass}
          onBroadcast={game.broadcastCheckpoint}
          onTogglePause={game.togglePause}
        />
      ) : null}
      {room.phase === 'CHECKPOINT' ? (
        <Checkpoint room={room} me={me} onBroadcast={game.broadcastCheckpoint} />
      ) : null}
      {room.phase === 'FINALIZING' || room.phase === 'EVALUATING' ? (
        <Evaluating room={room} />
      ) : null}
      {room.phase === 'RESULTS' || room.phase === 'COMPLETE' ? (
        room.evaluation ? (
          <ResultsHub
            room={room}
            me={me}
            busyAction={game.busyAction}
            onRestart={game.restartGame}
          />
        ) : (
          <Evaluating room={room} />
        )
      ) : null}
      <DebugPanel
        room={room}
        me={me}
        connection={game.connection}
        clockOffset={game.clockOffset}
        serverUrl={game.serverUrl}
      />
      <Toasts error={game.error} notice={game.notice} onClear={game.clearError} />
    </div>
  );
}
