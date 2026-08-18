'use client';

import type { RoomMemberView, RoomView } from '@gavel-xi/shared';
import { useCallback, useEffect, useState } from 'react';
import type { AuctionMoment, ConnectionState } from '@/hooks/use-gavel-room';
import { clamp, formatClock, formatMoney, MILLION } from '@/lib/format';
import { ArrowIcon, EyeIcon, GavelIcon, TeamIcon } from './icons';
import { PlayerCard } from './player-card';
import { StatusDock } from './status-dock';
import { TeamCheck } from './team-check';
import { AuctionOutcome } from './auction-outcome';

interface AuctionStageProps {
  room: RoomView;
  me: RoomMemberView;
  connection: ConnectionState;
  clockOffset: number;
  maxSafeBidEUR: number | null;
  busyAction: string | null;
  moment: AuctionMoment | null;
  onBid: (amountEUR: number) => Promise<{ ok: boolean }>;
  onPass: () => Promise<{ ok: boolean }>;
  onBroadcast: () => Promise<{ ok: boolean }>;
  onTogglePause: () => Promise<{ ok: boolean }>;
}

function useCountdown(endsAt: number | null | undefined, clockOffset: number): number {
  const calculate = useCallback(
    () => (endsAt ? Math.max(0, endsAt - (Date.now() + clockOffset)) : 0),
    [clockOffset, endsAt],
  );
  const [remaining, setRemaining] = useState(calculate);
  useEffect(() => {
    setRemaining(calculate());
    if (!endsAt) return;
    const interval = window.setInterval(
      () => setRemaining(calculate()),
      process.env.NEXT_PUBLIC_E2E === 'true' ? 50 : 250,
    );
    return () => window.clearInterval(interval);
  }, [calculate, endsAt]);
  return remaining;
}

export function AuctionStage({
  room,
  me,
  connection,
  clockOffset,
  maxSafeBidEUR,
  busyAction,
  moment,
  onBid,
  onPass,
  onBroadcast,
  onTogglePause,
}: AuctionStageProps) {
  const [teamOpen, setTeamOpen] = useState(false);
  const [customBid, setCustomBid] = useState('');
  const lot = room.currentLot;
  const remaining = useCountdown(lot?.endsAt, clockOffset);
  const isBidding = room.phase === 'BIDDING' && Boolean(lot?.openedAt) && !room.isPaused;
  const eligible = Boolean(lot?.eligibleMemberIds.includes(me.id)) && !me.isSpectator;
  const hasPassed = Boolean(lot?.passedMemberIds.includes(me.id));
  const limitReady = room.settings.budgetMode === 'CHAOS' || maxSafeBidEUR !== null;
  const canAct =
    isBidding && eligible && !hasPassed && connection === 'online' && !busyAction && limitReady;
  const baseAmount =
    lot?.currentBidEUR ?? (lot ? lot.openingBidEUR - room.settings.bidIncrementEUR : 0);
  const displayedBid = lot?.currentBidEUR ?? lot?.openingBidEUR ?? 0;
  const minimumBid = lot
    ? Math.max(lot.openingBidEUR, baseAmount + room.settings.bidIncrementEUR)
    : 0;
  const maxBid = room.settings.budgetMode === 'CHAOS' ? me.budgetEUR : (maxSafeBidEUR ?? 0);
  const legalBidAtOrAbove = useCallback(
    (target: number) => {
      if (!lot) return 0;
      const increments = Math.max(
        0,
        Math.ceil((target - lot.openingBidEUR) / room.settings.bidIncrementEUR),
      );
      return Math.max(minimumBid, lot.openingBidEUR + increments * room.settings.bidIncrementEUR);
    },
    [lot, minimumBid, room.settings.bidIncrementEUR],
  );
  const jumpBid = legalBidAtOrAbove(displayedBid + 5 * MILLION);
  const statementBid = legalBidAtOrAbove(displayedBid + 10 * MILLION);
  const customBidEUR = Number(customBid) * MILLION;
  const customBidIsLegal =
    Number.isSafeInteger(customBidEUR) &&
    customBidEUR >= minimumBid &&
    customBidEUR <= maxBid &&
    lot !== null &&
    (customBidEUR - lot.openingBidEUR) % room.settings.bidIncrementEUR === 0;
  const timerRatio =
    room.settings.auctionTimerSeconds > 0
      ? clamp(remaining / (room.settings.auctionTimerSeconds * 1_000), 0, 1)
      : 0;
  const leader = room.members.find((member) => member.id === lot?.currentLeaderId);

  const submitCustom = () => {
    if (!customBidIsLegal) return;
    void onBid(customBidEUR);
  };
  const quickBid = useCallback(
    (incrementMillions: number) => {
      const requested =
        incrementMillions === 1
          ? minimumBid
          : legalBidAtOrAbove(displayedBid + incrementMillions * MILLION);
      if (requested > maxBid) return;
      void onBid(requested);
    },
    [displayedBid, legalBidAtOrAbove, maxBid, minimumBid, onBid],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      )
        return;
      if (event.key.toLowerCase() === 't') {
        setTeamOpen((value) => !value);
        return;
      }
      if (!canAct) return;
      if (event.key.toLowerCase() === 'b' || event.key === ' ') {
        event.preventDefault();
        quickBid(1);
      }
      if (event.key === '5') quickBid(5);
      if (event.key === '0') quickBid(10);
      if (event.key.toLowerCase() === 'p') void onPass();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canAct, onPass, quickBid]);

  if (!lot) {
    return (
      <main className="auction-empty" data-testid="auction-loading">
        <div className="stadium-lines" />
        <div className="scan-ring">
          <i />
          <i />
        </div>
        <p className="eyebrow">LOT {String(room.auctionSequence + 1).padStart(2, '0')}</p>
        <h1>
          {room.phase === 'READY' || room.phase === 'NEXT_LOT'
            ? 'THE NEXT CARD IS SEALED'
            : 'MARKET DATA IS LOCKING'}
        </h1>
        <p>Nobody knows which position comes next.</p>
      </main>
    );
  }

  return (
    <main
      className={`auction-stage auction-stage--${room.phase.toLowerCase()}`}
      data-testid="auction-screen"
    >
      <div className="stadium-lines" />
      <div className="auction-lights">
        <i />
        <i />
      </div>
      <div className="auction-stage__top">
        <div className="lot-heading">
          <span>
            LIVE LOT <b>{String(lot.sequence).padStart(2, '0')}</b>
          </span>
          <h1>
            {lot.isReturning
              ? 'BACK ON THE MARKET'
              : room.phase === 'REVEALING'
                ? 'CARD REVEAL'
                : 'THE MARKET IS OPEN'}
          </h1>
        </div>
        <button
          className="team-check-button"
          data-testid="team-check-open"
          type="button"
          onClick={() => setTeamOpen(true)}
        >
          <TeamIcon />
          <span>PREVIEW TEAM</span>
          <b>
            {me.filledSlots}/{me.totalSlots}
          </b>
        </button>
      </div>

      <section className="auction-stage__main">
        <div className="auction-stage__card">
          <PlayerCard lot={lot} phase={room.phase} />
        </div>
        <div className="auction-console">
          <header className="auction-console__timer">
            <div
              className={`timer-orb ${remaining <= 3_000 && isBidding ? 'timer-orb--urgent' : ''}`}
              style={{ '--timer-progress': timerRatio } as React.CSSProperties}
            >
              <span data-testid="auction-timer">
                {room.isPaused ? 'PAUSED' : isBidding ? formatClock(remaining) : '—'}
              </span>
              <small>SECONDS</small>
            </div>
            <div>
              <p>
                {room.isPaused
                  ? 'Auction paused by the host.'
                  : isBidding
                    ? remaining <= 3_000
                      ? 'FINAL CALL'
                      : 'BIDDING LIVE'
                    : room.phase.replaceAll('_', ' ')}
              </p>
              <h2>
                {leader ? (
                  <>
                    <span style={{ color: leader.color }}>{leader.name}</span> LEADS
                  </>
                ) : (
                  'WHO MOVES FIRST?'
                )}
              </h2>
              <small>Every bid resets the clock to 20 seconds. The server owns the gavel.</small>
            </div>
          </header>

          <div className="bid-readout">
            <span>CURRENT BID</span>
            <strong>{formatMoney(lot.currentBidEUR ?? lot.openingBidEUR, true)}</strong>
            <small>
              {lot.currentBidEUR
                ? `OPENED AT ${formatMoney(lot.openingBidEUR, true)}`
                : 'RESERVE PRICE'}
            </small>
          </div>

          {me.isSpectator ? (
            <div className="eligibility-message">
              <EyeIcon />
              <div>
                <b>SPECTATOR MODE</b>
                <span>You can watch every deal, but the paddle stays down.</span>
              </div>
            </div>
          ) : !eligible ? (
            <div className="eligibility-message">
              <span className="eligibility-message__mark">✓</span>
              <div>
                <b>POSITION ALREADY FILLED</b>
                <span>Your squad has no compatible empty slot for this cycle.</span>
              </div>
            </div>
          ) : hasPassed ? (
            <div className="eligibility-message eligibility-message--passed">
              <span className="eligibility-message__mark">P</span>
              <div>
                <b>YOU PASSED</b>
                <span>Watch this one play out. Your next card is still unknown.</span>
              </div>
            </div>
          ) : (
            <div className="bid-controls">
              <p>
                RAISE THE PADDLE <span>KEYBOARD: B / 5 / 0</span>
              </p>
              <div className="quick-bids">
                <button
                  data-testid="bid-quick-1"
                  disabled={!canAct || minimumBid > maxBid}
                  type="button"
                  onClick={() => quickBid(1)}
                >
                  <small>MINIMUM</small>
                  <b>{formatMoney(minimumBid, true)}</b>
                </button>
                <button
                  data-testid="bid-quick-5"
                  disabled={!canAct || jumpBid > maxBid}
                  type="button"
                  onClick={() => quickBid(5)}
                >
                  <small>JUMP</small>
                  <b>{formatMoney(jumpBid - displayedBid, true).replace('€', '+€')}</b>
                </button>
                <button
                  data-testid="bid-quick-10"
                  disabled={!canAct || statementBid > maxBid}
                  type="button"
                  onClick={() => quickBid(10)}
                >
                  <small>STATEMENT</small>
                  <b>{formatMoney(statementBid - displayedBid, true).replace('€', '+€')}</b>
                </button>
              </div>
              <div className="custom-bid">
                <label>
                  <span>€</span>
                  <input
                    aria-label="Custom bid in millions"
                    data-testid="bid-custom-input"
                    disabled={!canAct}
                    inputMode="numeric"
                    min={Math.ceil(minimumBid / MILLION)}
                    max={Math.floor(maxBid / MILLION)}
                    onChange={(event) => setCustomBid(event.target.value.replace(/\D/g, ''))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitCustom();
                    }}
                    placeholder={`${Math.ceil(minimumBid / MILLION)}`}
                    value={customBid}
                  />
                  <b>M</b>
                </label>
                <button
                  data-testid="bid-custom-submit"
                  disabled={!canAct || !customBidIsLegal}
                  type="button"
                  onClick={submitCustom}
                >
                  <GavelIcon /> BID
                </button>
              </div>
              <button
                className="pass-button"
                data-testid="pass-button"
                disabled={!canAct}
                type="button"
                onClick={() => void onPass()}
              >
                <span>PASS THIS LOT</span>
                <small>P KEY</small>
                <ArrowIcon />
              </button>
              <p className="safe-bid">
                MAX SAFE BID <b>{formatMoney(maxBid, true)}</b> ·{' '}
                {maxSafeBidEUR === null
                  ? 'SERVER LIMIT SYNCING'
                  : room.settings.budgetMode === 'STRICT'
                    ? 'COMPLETION PROTECTED'
                    : 'CLASSIC CHAOS'}
              </p>
            </div>
          )}
        </div>
      </section>

      <StatusDock room={room} me={me} maxBid={maxBid} />
      {me.isHost ? (
        <button
          className="auction-pause-button"
          data-testid="auction-pause"
          type="button"
          onClick={() => void onTogglePause()}
        >
          {room.isPaused ? 'RESUME AUCTION' : 'PAUSE AUCTION'}
        </button>
      ) : null}
      <AuctionOutcome room={room} moment={moment} />
      {teamOpen ? (
        <TeamCheck
          room={room}
          me={me}
          onClose={() => setTeamOpen(false)}
          onBroadcast={onBroadcast}
        />
      ) : null}
      <div
        className="sr-auction-status"
        role="status"
        aria-live="polite"
      >{`${lot.candidate.commonName || lot.candidate.fullName}. Current bid ${formatMoney(lot.currentBidEUR ?? lot.openingBidEUR, true)}. ${leader ? `${leader.name} leads.` : 'No leader.'}`}</div>
    </main>
  );
}
