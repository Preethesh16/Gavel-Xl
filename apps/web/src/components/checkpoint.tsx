'use client';

import type { CheckpointView, RoomMemberView, RoomView } from '@gavel-xi/shared';
import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format';
import { ArrowIcon, CrownIcon, GavelIcon } from './icons';
import { TeamBoard } from './team-check';
import { BroadcastAtmosphere, BroadcastStrip, CountUp } from './broadcast-kit';
import { emitBroadcast, cancelBroadcastNarration } from '@/lib/broadcast-audio';

function MemberName({ room, memberId }: { room: RoomView; memberId: string }) {
  const member = room.members.find((candidate) => candidate.id === memberId);
  return <>{member?.name ?? 'Pending'}</>;
}

function ReportCard({
  label,
  value,
  detail,
  index,
  member,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  index: number;
  member: RoomMemberView | undefined;
}) {
  return (
    <article
      className="report-card"
      style={
        {
          '--report-index': index,
          '--member-color': member?.color ?? '#f1bf00',
        } as React.CSSProperties
      }
    >
      <span className="report-card__number">{String(index).padStart(2, '0')}</span>
      <p>{label}</p>
      <h3>{value}</h3>
      <small>{detail}</small>
      <i />
    </article>
  );
}

function CheckpointContent({ room, checkpoint }: { room: RoomView; checkpoint: CheckpointView }) {
  const leader = room.members.find((member) => member.id === checkpoint.leaderId);
  const business = room.members.find((member) => member.id === checkpoint.bestBusinessMemberId);
  const budget = room.members.find((member) => member.id === checkpoint.budgetLeaderId);
  const signing = room.squads.find((entry) => entry.id === checkpoint.bestSigningEntryId);
  const overpay = room.squads.find((entry) => entry.id === checkpoint.biggestOverpayEntryId);
  const rankings = [...room.members]
    .filter((member) => !member.isSpectator)
    .sort(
      (a, b) => (checkpoint.projectedScores[b.id] ?? 0) - (checkpoint.projectedScores[a.id] ?? 0),
    );
  return (
    <>
      <div className="scout-desk">
        <section className="scout-spotlight">
          <div className="scout-spotlight__radar" aria-hidden="true">
            <i />
            <i />
            <i />
            <b>+</b>
          </div>
          <div className="scout-spotlight__image">
            {signing?.candidate.imageUrl ? (
              <img
                src={signing.candidate.imageUrl}
                alt={signing.candidate.commonName}
                onError={(event) => {
                  event.currentTarget.style.visibility = 'hidden';
                }}
              />
            ) : (
              <span>XI</span>
            )}
          </div>
          <div className="scout-spotlight__copy">
            <p>THE TRANSFER THAT TURNS HEADS</p>
            <h2>{signing?.candidate.commonName ?? 'The next big move'}</h2>
            <span>{signing?.candidate.club ?? 'Your scouting desk is live'}</span>
            <div>
              <b>
                {formatMoney(signing?.purchasePriceEUR, true)}
                <small>DEAL CLOSED</small>
              </b>
              <b>
                {formatMoney(signing?.marketValueEUR, true)}
                <small>MARKET VALUE</small>
              </b>
            </div>
          </div>
          <span className="scout-spotlight__tag">SIGNING OF THE WINDOW ↗</span>
        </section>
        <section className="scout-leaderboard" data-testid="checkpoint-rankings">
          <header>
            <p>POWER RANKINGS</p>
            <span>LIVE PROJECTION</span>
          </header>
          {rankings.map((member, index) => (
            <article
              key={member.id}
              style={{ '--team-color': member.color, '--row-index': index } as React.CSSProperties}
            >
              <span className="scout-rank">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3>{member.name}</h3>
                <small>
                  {(checkpoint.remainingPositions[member.id] ?? []).length} POSITIONS REMAIN ·{' '}
                  {formatMoney(member.budgetEUR, true)}
                </small>
                <div className="scout-rank-track">
                  <i
                    style={{
                      transform: `scaleX(${(checkpoint.projectedScores[member.id] ?? 0) / 100})`,
                    }}
                  />
                </div>
                <p>
                  PRIORITY <b>{checkpoint.weaknesses[member.id] ?? 'Build squad depth'}</b>
                </p>
              </div>
              <strong>
                <CountUp value={checkpoint.projectedScores[member.id] ?? 0} />
              </strong>
            </article>
          ))}
          <footer>
            <i /> PROVISIONAL. THE NEXT SIGNING CHANGES EVERYTHING.
          </footer>
        </section>
      </div>
      <div className="checkpoint-cards" data-testid="checkpoint-cards">
        <ReportCard
          index={1}
          label="CURRENT LEADER"
          value={<MemberName room={room} memberId={checkpoint.leaderId} />}
          detail={`${(checkpoint.projectedScores[checkpoint.leaderId] ?? 0).toFixed(1)} projected`}
          member={leader}
        />
        <ReportCard
          index={2}
          label="BEST BUSINESS"
          value={<MemberName room={room} memberId={checkpoint.bestBusinessMemberId} />}
          detail="Value and role profile aligned"
          member={business}
        />
        <ReportCard
          index={3}
          label="SIGNING OF THE WINDOW"
          value={signing?.candidate.commonName ?? 'Still open'}
          detail={
            signing
              ? `${formatMoney(signing.purchasePriceEUR, true)} · ${formatMoney(signing.marketValueEUR, true)} value`
              : 'No completed deals yet'
          }
          member={room.members.find((member) => member.id === signing?.memberId)}
        />
        <ReportCard
          index={4}
          label="BUDGET CONTROL"
          value={<MemberName room={room} memberId={checkpoint.budgetLeaderId} />}
          detail={`${formatMoney(budget?.budgetEUR, true)} still available`}
          member={budget}
        />
        <ReportCard
          index={5}
          label="MARKET HEAT"
          value={overpay?.candidate.commonName ?? 'Disciplined room'}
          detail={overpay ? 'The boldest premium so far' : 'No major premium detected'}
          member={room.members.find((member) => member.id === overpay?.memberId)}
        />
      </div>
    </>
  );
}

export function Checkpoint({
  room,
  me,
  onBroadcast,
}: {
  room: RoomView;
  me: RoomMemberView;
  onBroadcast: () => Promise<{ ok: boolean }>;
}) {
  const checkpoint = room.checkpoint;
  const directors = useMemo(
    () => room.members.filter((member) => !member.isSpectator),
    [room.members],
  );
  const [activeDirector, setActiveDirector] = useState(() =>
    Math.max(
      0,
      directors.findIndex((member) => member.id === me.id),
    ),
  );
  const activeMember = directors[Math.min(activeDirector, Math.max(0, directors.length - 1))] ?? me;

  useEffect(() => {
    const mine = directors.findIndex((member) => member.id === me.id);
    setActiveDirector(Math.max(0, mine));
  }, [checkpoint?.number, me.id]);

  useEffect(() => {
    if (!checkpoint) return;
    const leaderName =
      room.members.find((member) => member.id === checkpoint.leaderId)?.name ?? 'The leader';
    emitBroadcast({
      id: `checkpoint-${room.code}-${checkpoint.number}`,
      cue: 'checkpoint',
      message: `Back to the scouting desk. ${leaderName} leads the projections. There is still business to be done.`,
      delayMs: 350,
    });
    return cancelBroadcastNarration;
  }, [checkpoint?.number, checkpoint?.leaderId, room.code]);

  const selectDirector = (index: number) => {
    if (directors.length === 0) return;
    setActiveDirector((index + directors.length) % directors.length);
  };

  return (
    <main className="checkpoint broadcast-checkpoint" data-testid="checkpoint-screen">
      <BroadcastAtmosphere />
      <BroadcastStrip
        label="THE SCOUTING DESK"
        detail={`Live intelligence / ${room.resolvedCycles} of ${room.totalCycles} rounds played`}
      />
      <header className="checkpoint__heading">
        <div>
          <p className="eyebrow">
            <span>HALF-TIME INTELLIGENCE</span> PROVISIONAL
          </p>
          <h1>
            THE WINDOW.
            <br />
            <em>WIDE OPEN.</em>
          </h1>
          <p>
            {checkpoint
              ? `${checkpoint.resolvedCycles} of ${room.totalCycles} position cycles resolved.`
              : 'The model is reading every deal in the room.'}
          </p>
        </div>
        <div className="checkpoint__badge">
          <span>CHECKPOINT</span>
          <b>{String(checkpoint?.number ?? Math.ceil(room.resolvedCycles / 4)).padStart(2, '0')}</b>
        </div>
      </header>
      {checkpoint ? (
        <CheckpointContent room={room} checkpoint={checkpoint} />
      ) : (
        <div className="report-loading" role="status">
          <div className="scan-ring">
            <i />
            <i />
          </div>
          <p>ANALYSING FORM, FIT & VALUE</p>
          <h2>THE TABLE IS STILL MOVING</h2>
        </div>
      )}
      {checkpoint ? (
        <section className="checkpoint-squad-reel" data-testid="checkpoint-squads">
          <header>
            <div>
              <p className="eyebrow">
                <span>EVERY DIRECTOR</span> SQUAD REVIEW
              </p>
              <h2>{activeMember.name}&apos;S WINDOW</h2>
            </div>
            <div className="checkpoint-squad-reel__controls">
              <button
                aria-label="Previous director squad"
                data-testid="checkpoint-squad-previous"
                type="button"
                onClick={() => selectDirector(activeDirector - 1)}
              >
                <ArrowIcon />
              </button>
              <span data-testid="checkpoint-squad-index">
                {activeDirector + 1} / {directors.length}
              </span>
              <button
                aria-label="Next director squad"
                data-testid="checkpoint-squad-next"
                type="button"
                onClick={() => selectDirector(activeDirector + 1)}
              >
                <ArrowIcon />
              </button>
            </div>
          </header>
          <div className="checkpoint-squad-reel__board" key={activeMember.id}>
            <TeamBoard room={room} member={activeMember} />
          </div>
          <nav aria-label="Choose a director squad">
            {directors.map((member, index) => (
              <button
                aria-current={index === activeDirector ? 'true' : undefined}
                className={index === activeDirector ? 'is-active' : ''}
                data-testid={`checkpoint-squad-director-${index + 1}`}
                key={member.id}
                type="button"
                onClick={() => selectDirector(index)}
              >
                <i style={{ background: member.color }} />
                {member.name}
              </button>
            ))}
          </nav>
        </section>
      ) : null}
      <footer className="checkpoint__footer">
        <p>
          <i /> PROVISIONAL MODEL — NO VERDICT IS FINAL UNTIL THE WINDOW CLOSES
        </p>
        {me.isHost ? (
          <button
            data-testid="checkpoint-broadcast"
            type="button"
            onClick={() => void onBroadcast()}
          >
            <GavelIcon /> CONTINUE AUCTION
          </button>
        ) : (
          <span>
            <CrownIcon /> HOST CONTROLS THE RETURN TO MARKET
          </span>
        )}
      </footer>
    </main>
  );
}
