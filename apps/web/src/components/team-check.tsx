'use client';

import type { RoomMemberView, RoomView, SquadEntryView } from '@gavel-xi/shared';
import { useEffect, useMemo, useState } from 'react';
import { buildLineup } from '@/lib/formations';
import { formatMoney, initials } from '@/lib/format';
import { ArrowIcon, CloseIcon, CrownIcon } from './icons';

function PitchPlayer({
  entry,
  label,
  x,
  y,
}: {
  entry: SquadEntryView | null;
  label: string;
  x: number;
  y: number;
}) {
  return (
    <div
      className={`pitch-player ${entry ? 'pitch-player--filled' : ''}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      title={entry ? `${entry.candidate.commonName || entry.candidate.fullName} · ${label}` : label}
    >
      <span>{label}</span>
      <b>{entry ? entry.candidate.commonName || entry.candidate.fullName : 'EMPTY'}</b>
    </div>
  );
}

function TeamBoard({
  room,
  member,
  compact = false,
}: {
  room: RoomView;
  member: RoomMemberView;
  compact?: boolean;
}) {
  const entries = room.squads.filter((entry) => entry.memberId === member.id);
  const manager = entries.find((entry) => entry.candidate.kind === 'MANAGER');
  const lineup = buildLineup(room.settings.formation, member, entries);
  const value = entries.reduce((total, entry) => total + (entry.marketValueEUR ?? 0), 0);
  const spent = entries.reduce((total, entry) => total + entry.purchasePriceEUR, 0);

  return (
    <article
      className={`team-board ${compact ? 'team-board--compact' : ''}`}
      data-testid={`team-board-${member.id}`}
    >
      <header>
        <span className="team-board__avatar" style={{ background: member.color }}>
          {initials(member.name)}
        </span>
        <div>
          <p>{member.isHost ? 'HOST · ' : ''}SPORTING DIRECTOR</p>
          <h3>{member.name}</h3>
        </div>
        <strong>
          {member.filledSlots}
          <small> / {member.totalSlots}</small>
        </strong>
      </header>
      <div className="team-board__manager">
        <span>MANAGER</span>
        <b>{manager?.candidate.commonName ?? manager?.candidate.fullName ?? 'VACANT'}</b>
        {manager ? <small>{formatMoney(manager.purchasePriceEUR, true)}</small> : null}
      </div>
      <div className="pitch" aria-label={`${member.name}'s ${room.settings.formation} formation`}>
        <div className="pitch__circle" />
        <div className="pitch__box pitch__box--top" />
        <div className="pitch__box pitch__box--bottom" />
        {lineup.map(({ slot, entry }) => (
          <PitchPlayer key={slot.id} entry={entry} label={slot.label} x={slot.x} y={slot.y} />
        ))}
      </div>
      <footer>
        <div>
          <span>REMAINING</span>
          <b>{formatMoney(member.budgetEUR, true)}</b>
        </div>
        <div>
          <span>SPENT</span>
          <b>{formatMoney(spent, true)}</b>
        </div>
        <div>
          <span>SQUAD VALUE</span>
          <b>{formatMoney(value, true)}</b>
        </div>
        <div>
          <span>AVG. DEAL</span>
          <b>{formatMoney(entries.length ? spent / entries.length : 0, true)}</b>
        </div>
      </footer>
    </article>
  );
}

interface TeamCheckProps {
  room: RoomView;
  me: RoomMemberView;
  onClose: () => void;
  onBroadcast: () => Promise<{ ok: boolean }>;
}

export function TeamCheck({ room, me, onClose, onBroadcast }: TeamCheckProps) {
  const [scope, setScope] = useState<'MY' | 'ALL'>('MY');
  const [activeDirector, setActiveDirector] = useState(0);
  const directors = useMemo(
    () => room.members.filter((member) => !member.isSpectator),
    [room.members],
  );
  const shown = scope === 'MY' ? [me] : directors;
  const activeMember = shown[Math.min(activeDirector, Math.max(0, shown.length - 1))] ?? me;

  useEffect(() => {
    setActiveDirector(0);
  }, [scope]);

  const selectDirector = (index: number) => {
    if (shown.length === 0) return;
    setActiveDirector((index + shown.length) % shown.length);
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="team-check"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-check-title"
        data-testid="team-check-modal"
      >
        <header className="team-check__header">
          <div>
            <p className="eyebrow">LIVE TACTICAL VIEW</p>
            <h2 id="team-check-title">TEAM CHECK</h2>
          </div>
          <button
            className="icon-button"
            data-testid="team-check-close"
            type="button"
            onClick={onClose}
            aria-label="Close team check"
          >
            <CloseIcon />
          </button>
        </header>
        <nav className="segmented-tabs" aria-label="Team scope">
          <button
            className={scope === 'MY' ? 'is-active' : ''}
            data-testid="team-check-mine"
            type="button"
            onClick={() => setScope('MY')}
          >
            MY TEAM
          </button>
          <button
            className={scope === 'ALL' ? 'is-active' : ''}
            data-testid="team-check-all"
            type="button"
            onClick={() => setScope('ALL')}
          >
            ALL TEAMS
          </button>
        </nav>
        {scope === 'ALL' && shown.length > 1 ? (
          <div className="team-director-switcher" data-testid="team-director-switcher">
            <button
              aria-label="Previous director"
              data-testid="team-director-previous"
              type="button"
              onClick={() => selectDirector(activeDirector - 1)}
            >
              <ArrowIcon />
            </button>
            <div>
              <span>
                DIRECTOR {activeDirector + 1} / {shown.length}
              </span>
              <strong data-testid="team-director-current">{activeMember.name}</strong>
            </div>
            <button
              aria-label="Next director"
              data-testid="team-director-next"
              type="button"
              onClick={() => selectDirector(activeDirector + 1)}
            >
              <ArrowIcon />
            </button>
          </div>
        ) : null}
        <div className="team-check__boards">
          <TeamBoard key={activeMember.id} room={room} member={activeMember} />
        </div>
        {me.isHost && room.phase === 'CHECKPOINT' ? (
          <button
            className="broadcast-button"
            data-testid="checkpoint-broadcast-team-check"
            type="button"
            onClick={() => void onBroadcast()}
          >
            <CrownIcon /> CONTINUE AUCTION
          </button>
        ) : null}
      </section>
    </div>
  );
}

export { TeamBoard };
