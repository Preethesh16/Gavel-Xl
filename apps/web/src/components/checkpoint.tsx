'use client';

import type { CheckpointView, RoomMemberView, RoomView } from '@gavel-xi/shared';
import { formatMoney, initials } from '@/lib/format';
import { CrownIcon, GavelIcon } from './icons';
import { TeamBoard } from './team-check';

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
          '--member-color': member?.color ?? '#d6ff3f',
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
          detail="Value and current form aligned"
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
      <section className="checkpoint-table" data-testid="checkpoint-rankings">
        <header>
          <span>LIVE PROJECTION</span>
          <span>WEAK LINK</span>
          <span>BUDGET</span>
          <span>SCORE</span>
        </header>
        {rankings.map((member, index) => (
          <article key={member.id}>
            <span className="checkpoint-rank">{index + 1}</span>
            <span className="checkpoint-avatar" style={{ background: member.color }}>
              {initials(member.name)}
            </span>
            <span className="checkpoint-name">
              <b>{member.name}</b>
              <small>
                {(checkpoint.remainingPositions[member.id] ?? []).length} POSITIONS REMAIN
              </small>
            </span>
            <span className="checkpoint-weakness">
              {checkpoint.weaknesses[member.id] ?? 'Still taking shape'}
            </span>
            <strong>{formatMoney(member.budgetEUR, true)}</strong>
            <em>{(checkpoint.projectedScores[member.id] ?? 0).toFixed(1)}</em>
          </article>
        ))}
      </section>
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
  return (
    <main className="checkpoint" data-testid="checkpoint-screen">
      <div className="stadium-lines" />
      <div className="broadcast-bars">
        <i />
        <i />
        <i />
        <i />
      </div>
      <header className="checkpoint__heading">
        <div>
          <p className="eyebrow">
            <span>HALF-TIME INTELLIGENCE</span> PROVISIONAL
          </p>
          <h1>SCOUT REPORT</h1>
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
      {checkpoint && me ? (
        <div className="checkpoint-team-preview">
          <TeamBoard room={room} member={me} compact />
        </div>
      ) : null}
    </main>
  );
}
